import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { vi } from 'vitest';
import App from '../App';
import api, { googleCalendarAPI } from '../services/api';

// C6 contract (D60, web half): in production the web app signs in with a cookie, not a header.
//
// Every call goes through the shared axios instance (`api`, the default export of
// services/api.ts), including the sign-in and sign-out calls. These tests swap that instance's
// adapter for a fake server, so the real 401 handling in api.ts is what runs.
//
//   - Any 401 response, except from Google-specific calls (`/auth/google/...`, `/auth/status`,
//     `/auth/calendar/...`, which keep their own "authorize from a laptop" handling) and the
//     sign-in POST itself, switches the app to the sign-in screen.
//   - Sign-in screen: `data-testid="signin-screen"`, one `type="password"` input labelled
//     "API token", and a "Sign in" button. Sign in POSTs `/auth/web-session` with exactly
//     `{ token }`. On 204 the app reloads its data (tasks, sessions, schedules) and shows the
//     normal screens. On 401 it shows "That token didn't work" and stays on the sign-in screen.
//   - Options gains a "Sign out" button: `DELETE /auth/web-session`, then the sign-in screen.
//   - The token is never written to localStorage, sessionStorage or a JS-readable cookie. The
//     server sets the HttpOnly `sw_session` cookie; the client never sees it.

vi.mock('../components/calendar', () => ({ CalendarView: () => null }));

const GOOD_TOKEN = 'fake-good-token-123';
const BAD_TOKEN = 'fake-bad-token-456';

const TASK = {
  id: 1,
  name: 'Reading',
  average_duration: 600,
  total_recordings: 2,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
};

type Call = { method: string; url: string; data: unknown };

const server = {
  authed: false,
  googleUnauthorized: false,
  calls: [] as Call[],
};

function respond(config: InternalAxiosRequestConfig, status: number, data: unknown = ''): AxiosResponse {
  const response = { data, status, statusText: String(status), headers: {}, config } as AxiosResponse;
  if (status >= 400) {
    throw new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_REQUEST, config, null, response);
  }
  return response;
}

async function fakeAdapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const method = (config.method ?? 'get').toUpperCase();
  const url = config.url ?? '';
  const data = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
  server.calls.push({ method, url, data });

  if (url === '/auth/web-session') {
    if (method === 'POST') {
      if (data?.token === GOOD_TOKEN) {
        server.authed = true;
        return respond(config, 204);
      }
      return respond(config, 401, { detail: 'Invalid token' });
    }
    if (method === 'DELETE') {
      server.authed = false;
      return respond(config, 204);
    }
  }

  if (url.startsWith('/auth/')) {
    if (server.googleUnauthorized) return respond(config, 401, { detail: 'Not authenticated with Google' });
    if (url === '/auth/status') return respond(config, 200, { authenticated: false });
  }

  if (!server.authed) return respond(config, 401, { detail: 'Not authenticated' });

  if (method === 'GET' && url === '/tasks/') return respond(config, 200, [TASK]);
  if (method === 'GET' && url === '/sessions/') return respond(config, 200, []);
  if (method === 'GET' && url === '/schedules/') return respond(config, 200, []);
  return respond(config, 404, { detail: 'Not Found' });
}

const originalAdapter = api.defaults.adapter;
let setItemSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  server.authed = false;
  server.googleUnauthorized = false;
  server.calls = [];
  api.defaults.adapter = fakeAdapter;
  localStorage.clear();
  sessionStorage.clear();
  setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
});

function tokenInput() {
  return screen.getByLabelText('API token') as HTMLInputElement;
}

async function signIn(token: string) {
  fireEvent.change(tokenInput(), { target: { value: token } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

async function showsNormalView() {
  expect(await screen.findByRole('button', { name: /Activities \(1\)/ })).toBeInTheDocument();
  expect(screen.queryByTestId('signin-screen')).not.toBeInTheDocument();
}

describe('Web sign-in page', () => {
  it('a 401 from a data call shows the sign-in screen', async () => {
    render(<App />);

    expect(await screen.findByTestId('signin-screen')).toBeInTheDocument();
    // White text needs the app's dark background layer behind it.
    expect(screen.getByTestId('signin-screen')).toHaveClass('glass-background');
    const input = tokenInput();
    expect(input.type).toBe('password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Options' })).not.toBeInTheDocument();
  });

  it('when already signed in, the normal view shows and no sign-in screen appears', async () => {
    server.authed = true;
    render(<App />);

    await showsNormalView();
  });

  it('Sign in POSTs the token, and on 204 the app reloads its data and shows the normal view', async () => {
    render(<App />);
    await screen.findByTestId('signin-screen');
    server.calls = [];

    await signIn(GOOD_TOKEN);

    await showsNormalView();
    const post = server.calls.find(c => c.method === 'POST' && c.url === '/auth/web-session');
    expect(post?.data).toEqual({ token: GOOD_TOKEN });
    const afterPost = server.calls.slice(server.calls.indexOf(post!) + 1);
    for (const url of ['/tasks/', '/sessions/', '/schedules/']) {
      expect(afterPost.some(c => c.method === 'GET' && c.url === url)).toBe(true);
    }
  });

  it('a rejected token shows the error and stays on the sign-in screen', async () => {
    render(<App />);
    await screen.findByTestId('signin-screen');

    await signIn(BAD_TOKEN);

    expect(await screen.findByText("That token didn't work")).toBeInTheDocument();
    expect(screen.getByTestId('signin-screen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Options' })).not.toBeInTheDocument();
    expect(server.calls.filter(c => c.method === 'POST' && c.url === '/auth/web-session')).toHaveLength(1);
  });

  it('a rejected token can be followed by a good one', async () => {
    render(<App />);
    await screen.findByTestId('signin-screen');

    await signIn(BAD_TOKEN);
    await screen.findByText("That token didn't work");
    await signIn(GOOD_TOKEN);

    await showsNormalView();
  });

  it('Sign out calls DELETE and shows the sign-in screen', async () => {
    server.authed = true;
    render(<App />);
    await showsNormalView();

    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByTestId('signin-screen')).toBeInTheDocument();
    expect(server.calls.some(c => c.method === 'DELETE' && c.url === '/auth/web-session')).toBe(true);
    expect(server.authed).toBe(false);
  });

  it('a 401 from a Google-specific call does not show the sign-in screen', async () => {
    server.authed = true;
    render(<App />);
    await showsNormalView();

    server.googleUnauthorized = true;
    await act(async () => {
      await expect(googleCalendarAPI.checkAuthStatus()).rejects.toBeTruthy();
      await expect(googleCalendarAPI.login()).rejects.toBeTruthy();
    });

    await waitFor(() => expect(screen.queryByTestId('signin-screen')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Activities \(1\)/ })).toBeInTheDocument();
  });

  it('nothing is written to localStorage, sessionStorage or a JS-readable cookie', async () => {
    render(<App />);
    await screen.findByTestId('signin-screen');
    await signIn(BAD_TOKEN);
    await screen.findByText("That token didn't work");
    await signIn(GOOD_TOKEN);
    await showsNormalView();

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain(GOOD_TOKEN);
    expect(document.cookie).not.toContain(BAD_TOKEN);
  });
});
