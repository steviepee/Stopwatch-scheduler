import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';

import SettingsScreen from '../app/settings';
import { createQueryClient } from '../services/queryClient';
import { useCreateSession } from '../services/mutations';
import * as auth from '../services/auth';

// P8e contract: `src/app/settings.tsx` prefills the API URL and bearer token
// from `services/auth`, a "Test connection" button GETs `/health` then
// `/tasks/` with the *currently entered* (not necessarily saved) values and
// reports one of three outcomes, Save persists both values and invalidates
// every query, and the screen shows the count of paused `createSession`
// mutations. The two network calls bypass the shared `api` axios instance
// (its interceptor reads the *stored* url/token, not the entered ones), so
// the screen calls the bare `axios` module directly — mocked here.
jest.mock('../services/auth', () => ({
  getApiUrl: jest.fn(),
  setApiUrl: jest.fn(),
  getToken: jest.fn(),
  setToken: jest.fn(),
}));

// The mock's own state lives inside the factory closure (not in an outer
// `const`), because `services/api.ts` calls `axios.create()` synchronously
// while this test file's imports are still being resolved — before any of
// the test file's own top-level `const`s have run. See the offlineQueue.tests
// gotcha about factories only being able to read module-scope state lazily.
jest.mock('axios', () => {
  const mockGet = jest.fn();
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
      create: () => instance,
    },
    __mockGet: mockGet,
  };
});

// B50 contract: a Pomodoro section with four number fields (`pomodoro-work`,
// `pomodoro-break`, `pomodoro-long-break`, `pomodoro-long-every`) loaded from
// `settingsAPI.getPomodoro` via a react-query query on ['settings', 'pomodoro'],
// and a Save button (`pomodoro-save`) that sends all four as numbers through
// `settingsAPI.updatePomodoro`. A minutes value outside 1–180 (1–12 for the
// count, or not a whole number) disables Save and shows the range text
// `1–180` (`1–12`, en dash) under that field. A failed load shows the defaults
// 25/5/15/4 (greyed), the text "Couldn't load", and Save stays disabled.
jest.mock('../services/api', () => ({
  ...jest.requireActual('../services/api'),
  settingsAPI: { getPomodoro: jest.fn(), updatePomodoro: jest.fn() },
}));

const mockSettingsAPI = (require('../services/api') as {
  settingsAPI: { getPomodoro: jest.Mock; updatePomodoro: jest.Mock };
}).settingsAPI;

const mockAxiosGet = (require('axios') as { __mockGet: jest.Mock }).__mockGet;

const mockedGetApiUrl = auth.getApiUrl as jest.Mock;
const mockedGetToken = auth.getToken as jest.Mock;
const mockedSetApiUrl = auth.setApiUrl as jest.Mock;
const mockedSetToken = auth.setToken as jest.Mock;

const STORED_URL = 'http://192.168.0.5:8000/api';
const STORED_TOKEN = 'stored-token';
const SERVER_POMODORO = { work_minutes: 50, break_minutes: 10, long_break_minutes: 30, long_break_every: 3 };

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function renderScreen(queryClient: QueryClient = client()) {
  const view = await render(
    <QueryClientProvider client={queryClient}>
      <SettingsScreen />
    </QueryClientProvider>
  );
  return { view, queryClient };
}

beforeEach(() => {
  mockedGetApiUrl.mockReset();
  mockedGetToken.mockReset();
  mockedSetApiUrl.mockReset();
  mockedSetToken.mockReset();
  mockedGetApiUrl.mockResolvedValue(STORED_URL);
  mockedGetToken.mockResolvedValue(STORED_TOKEN);
  mockAxiosGet.mockReset();
  mockSettingsAPI.getPomodoro.mockReset();
  mockSettingsAPI.updatePomodoro.mockReset();
  mockSettingsAPI.getPomodoro.mockResolvedValue(SERVER_POMODORO);
  mockSettingsAPI.updatePomodoro.mockImplementation(async (s) => s);
});

describe('settings prefill', () => {
  it('prefills the API URL and token fields from stored values', async () => {
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('input-api-url')).toHaveProp('value', STORED_URL));
    expect(screen.getByTestId('input-token')).toHaveProp('value', STORED_TOKEN);
  });
});

describe('test connection', () => {
  it('reports unreachable when /health fails', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('input-api-url')).toHaveProp('value', STORED_URL));

    mockAxiosGet.mockRejectedValueOnce(new Error('Network Error'));

    await fireEvent.press(screen.getByTestId('btn-test-connection'));

    await screen.findByText('Unreachable');
    expect(mockAxiosGet).toHaveBeenCalledWith(`${STORED_URL}/health`);
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
  });

  it('reports the token as rejected when /health succeeds but /tasks/ 401s', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('input-api-url')).toHaveProp('value', STORED_URL));

    await fireEvent.changeText(screen.getByTestId('input-token'), 'wrong-token');
    mockAxiosGet.mockResolvedValueOnce({ status: 200, data: { status: 'healthy' } });
    mockAxiosGet.mockRejectedValueOnce({ response: { status: 401 } });

    await fireEvent.press(screen.getByTestId('btn-test-connection'));

    await screen.findByText('Reachable, token rejected');
    expect(mockAxiosGet).toHaveBeenNthCalledWith(1, `${STORED_URL}/health`);
    expect(mockAxiosGet).toHaveBeenNthCalledWith(2, `${STORED_URL}/tasks/`, {
      headers: { Authorization: 'Bearer wrong-token' },
    });
  });

  it('reports OK when both calls succeed, using the currently entered URL', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('input-api-url')).toHaveProp('value', STORED_URL));

    const typedUrl = 'http://10.0.0.9:8000/api';
    await fireEvent.changeText(screen.getByTestId('input-api-url'), typedUrl);
    mockAxiosGet.mockResolvedValueOnce({ status: 200, data: { status: 'healthy' } });
    mockAxiosGet.mockResolvedValueOnce({ status: 200, data: [] });

    await fireEvent.press(screen.getByTestId('btn-test-connection'));

    await screen.findByText('OK');
    expect(mockAxiosGet).toHaveBeenNthCalledWith(1, `${typedUrl}/health`);
    expect(mockAxiosGet).toHaveBeenNthCalledWith(2, `${typedUrl}/tasks/`, {
      headers: { Authorization: `Bearer ${STORED_TOKEN}` },
    });
  });
});

describe('save', () => {
  it('persists the entered URL and token and invalidates every query', async () => {
    const qc = client();
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');
    await renderScreen(qc);
    await waitFor(() => expect(screen.getByTestId('input-api-url')).toHaveProp('value', STORED_URL));

    await fireEvent.changeText(screen.getByTestId('input-api-url'), 'http://10.0.0.9:8000/api');
    await fireEvent.changeText(screen.getByTestId('input-token'), 'new-token');
    await fireEvent.press(screen.getByTestId('btn-save'));

    await waitFor(() => expect(mockedSetApiUrl).toHaveBeenCalledWith('http://10.0.0.9:8000/api'));
    expect(mockedSetToken).toHaveBeenCalledWith('new-token');
    expect(invalidateSpy).toHaveBeenCalled();
  });
});

describe('pomodoro lengths', () => {
  async function renderLoaded() {
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('pomodoro-work')).toHaveProp('value', '50'));
  }

  it('shows the server values and Save sends the edited four', async () => {
    await renderLoaded();
    expect(screen.getByTestId('pomodoro-break')).toHaveProp('value', '10');
    expect(screen.getByTestId('pomodoro-long-break')).toHaveProp('value', '30');
    expect(screen.getByTestId('pomodoro-long-every')).toHaveProp('value', '3');
    expect(screen.getByTestId('pomodoro-save')).not.toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('pomodoro-work'), '40');
    await fireEvent.changeText(screen.getByTestId('pomodoro-long-every'), '4');
    await fireEvent.press(screen.getByTestId('pomodoro-save'));

    await waitFor(() =>
      expect(mockSettingsAPI.updatePomodoro).toHaveBeenCalledWith({
        work_minutes: 40,
        break_minutes: 10,
        long_break_minutes: 30,
        long_break_every: 4,
      })
    );
    expect(mockSettingsAPI.getPomodoro).toHaveBeenCalled();
  });

  it('0 minutes disables Save and shows the range', async () => {
    await renderLoaded();
    expect(screen.queryByText('1–180')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('pomodoro-break'), '0');

    expect(screen.getByTestId('pomodoro-save')).toBeDisabled();
    expect(screen.getByText('1–180')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('pomodoro-save'));
    expect(mockSettingsAPI.updatePomodoro).not.toHaveBeenCalled();
  });

  it('181 minutes disables Save and shows the range', async () => {
    await renderLoaded();

    await fireEvent.changeText(screen.getByTestId('pomodoro-long-break'), '181');

    expect(screen.getByTestId('pomodoro-save')).toBeDisabled();
    expect(screen.getByText('1–180')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('pomodoro-long-break'), '180');
    expect(screen.getByTestId('pomodoro-save')).not.toBeDisabled();
    expect(screen.queryByText('1–180')).toBeNull();
  });

  it('a long-break count of 13 or 0 disables Save and shows 1–12', async () => {
    await renderLoaded();
    expect(screen.queryByText('1–12')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('pomodoro-long-every'), '13');
    expect(screen.getByTestId('pomodoro-save')).toBeDisabled();
    expect(screen.getByText('1–12')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('pomodoro-long-every'), '0');
    expect(screen.getByTestId('pomodoro-save')).toBeDisabled();
    expect(screen.getByText('1–12')).toBeTruthy();
  });

  it('a failed load shows the defaults, "Couldn\'t load", and Save disabled', async () => {
    mockSettingsAPI.getPomodoro.mockRejectedValue(new Error('Network Error'));
    await renderScreen();

    await screen.findByText("Couldn't load");
    expect(screen.getByTestId('pomodoro-work')).toHaveProp('value', '25');
    expect(screen.getByTestId('pomodoro-break')).toHaveProp('value', '5');
    expect(screen.getByTestId('pomodoro-long-break')).toHaveProp('value', '15');
    expect(screen.getByTestId('pomodoro-long-every')).toHaveProp('value', '4');
    expect(screen.getByTestId('pomodoro-save')).toBeDisabled();

    await fireEvent.press(screen.getByTestId('pomodoro-save'));
    expect(mockSettingsAPI.updatePomodoro).not.toHaveBeenCalled();
  });
});

describe('pending saves', () => {
  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it('reflects zero when nothing is paused', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('input-api-url')).toHaveProp('value', STORED_URL));

    expect(screen.getByTestId('text-pending-count')).toHaveTextContent('0');
  });

  it('counts a paused createSession mutation', async () => {
    const qc = createQueryClient();

    const hook = await renderHook(() => useCreateSession(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    onlineManager.setOnline(false);

    await act(async () => {
      hook.result.current.mutate({
        name: 'Yoga',
        duration: 600,
        start_time: '2026-01-04T08:00:00.000Z',
        end_time: '2026-01-04T08:10:00.000Z',
      });
    });
    await waitFor(() => expect(hook.result.current.isPaused).toBe(true));

    await renderScreen(qc);

    await waitFor(() => expect(screen.getByTestId('text-pending-count')).toHaveTextContent('1'));

    qc.getMutationCache().getAll().forEach((m) => m.destroy());
    qc.clear();
  });
});
