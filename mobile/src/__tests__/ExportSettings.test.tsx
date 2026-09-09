import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SettingsScreen from '../app/settings';

// P18 contract: Settings gains an Export section with four buttons —
// Recordings/Activities x CSV/JSON — reusing the same `apiUrl`/`token` state
// Test Connection already reads (the currently displayed values, prefilled
// from storage; there is no separate "saved" source of truth on this screen).
// Each button POSTs `{ resource, format }` to `${apiUrl}/exports` (no
// trailing slash — an action route, not a collection, same as
// `/schedules/generate`) via the bare `axios` module, mirroring Test
// Connection's reason for bypassing the shared `services/api` instance: mocked
// here with the same factory-closure trick as SettingsScreen.test.tsx, since
// `settings.tsx` transitively imports `services/api.ts` (for
// `services/queryClient`'s `CREATE_SESSION_KEY`), whose own `axios.create()`
// runs at import time.
//
// The backend (`POST /api/exports`, see `backend/app/routers/exports.py`)
// returns `{ url, expires_at }` where `url` is a *server-relative* path
// (`/api/exports/{token}`), not an absolute URL — `WebBrowser.openBrowserAsync`
// needs an absolute one. The screen derives the origin by stripping the
// trailing `/api` off `apiUrl` and prepending it to the returned `url`; this
// is the concrete meaning of "the returned url is what gets opened" for a
// backend that only ever returns a path. `expo-web-browser` is mocked below.
//
// A failed POST (`text-export-status`) shows "Export failed" and opens
// nothing. Offline (`onlineManager.isOnline() === false`) short-circuits to
// "Needs a connection" without ever calling axios — unlike a recording save,
// an export is not queued as a paused mutation.
jest.mock('../services/auth', () => ({
  getApiUrl: jest.fn(),
  setApiUrl: jest.fn(),
  getToken: jest.fn(),
  setToken: jest.fn(),
}));

jest.mock('axios', () => {
  const mockGet = jest.fn();
  const mockPost = jest.fn();
  const instance = {
    interceptors: { request: { use: jest.fn() } },
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    defaults: {},
  };
  return {
    __esModule: true,
    default: {
      get: mockGet,
      post: mockPost,
      create: () => instance,
    },
    __mockGet: mockGet,
    __mockPost: mockPost,
  };
});

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(),
}));

const mockAxiosPost = (require('axios') as { __mockPost: jest.Mock }).__mockPost;
const mockOpenBrowserAsync = (require('expo-web-browser') as { openBrowserAsync: jest.Mock }).openBrowserAsync;

const auth = require('../services/auth');
const mockedGetApiUrl = auth.getApiUrl as jest.Mock;
const mockedGetToken = auth.getToken as jest.Mock;

const STORED_URL = 'http://192.168.0.5:8000/api';
const STORED_TOKEN = 'stored-token';

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function renderScreen() {
  await render(
    <QueryClientProvider client={client()}>
      <SettingsScreen />
    </QueryClientProvider>
  );
  await waitFor(() => expect(screen.getByTestId('input-api-url')).toHaveProp('value', STORED_URL));
}

beforeEach(() => {
  mockedGetApiUrl.mockReset();
  mockedGetToken.mockReset();
  mockedGetApiUrl.mockResolvedValue(STORED_URL);
  mockedGetToken.mockResolvedValue(STORED_TOKEN);
  mockAxiosPost.mockReset();
  mockOpenBrowserAsync.mockReset();
});

describe('export buttons', () => {
  const combos: Array<[string, 'sessions' | 'tasks', 'csv' | 'json']> = [
    ['btn-export-sessions-csv', 'sessions', 'csv'],
    ['btn-export-sessions-json', 'sessions', 'json'],
    ['btn-export-tasks-csv', 'tasks', 'csv'],
    ['btn-export-tasks-json', 'tasks', 'json'],
  ];

  it('posts the right resource and format for each of the four buttons', async () => {
    await renderScreen();
    mockAxiosPost.mockResolvedValue({ data: { url: '/api/exports/tok', expires_at: '2026-01-01T00:00:01.000Z' } });

    for (const [testId, resource, format] of combos) {
      mockAxiosPost.mockClear();
      await fireEvent.press(screen.getByTestId(testId));

      await waitFor(() =>
        expect(mockAxiosPost).toHaveBeenCalledWith(
          `${STORED_URL}/exports`,
          { resource, format },
          { headers: { Authorization: `Bearer ${STORED_TOKEN}` } }
        )
      );
    }
  });

  it('opens the url the POST returned, resolved against the API origin', async () => {
    await renderScreen();
    mockAxiosPost.mockResolvedValueOnce({
      data: { url: '/api/exports/abc123', expires_at: '2026-01-01T00:00:01.000Z' },
    });

    await fireEvent.press(screen.getByTestId('btn-export-sessions-csv'));

    await waitFor(() =>
      expect(mockOpenBrowserAsync).toHaveBeenCalledWith('http://192.168.0.5:8000/api/exports/abc123')
    );
  });

  it('shows an error and opens nothing when the POST fails', async () => {
    await renderScreen();
    mockAxiosPost.mockRejectedValueOnce(new Error('Network Error'));

    await fireEvent.press(screen.getByTestId('btn-export-tasks-json'));

    await screen.findByText('Export failed');
    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
  });

  it('shows "needs a connection" when offline, without posting', async () => {
    await renderScreen();
    onlineManager.setOnline(false);

    await fireEvent.press(screen.getByTestId('btn-export-sessions-json'));

    await screen.findByText(/needs a connection/i);
    expect(mockAxiosPost).not.toHaveBeenCalled();
    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();

    onlineManager.setOnline(true);
  });
});
