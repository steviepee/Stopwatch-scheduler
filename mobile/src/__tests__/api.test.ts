import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

const mockSecureStore: Record<string, string> = {};

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) =>
    key in mockSecureStore ? mockSecureStore[key] : null
  ),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore[key] = value;
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    delete mockSecureStore[key];
  }),
}));

type AuthModule = typeof import('../services/auth');
type ApiModule = typeof import('../services/api');

const ENV_URL = 'http://192.168.0.5:8000/api';

let requests: InternalAxiosRequestConfig[] = [];
let nextResponse: unknown = {};

const adapter: AxiosAdapter = async (config) => {
  requests.push(config);
  return {
    data: nextResponse,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  } as AxiosResponse;
};

const loadClient = () => {
  jest.resetModules();
  const auth = require('../services/auth') as AuthModule;
  const api = require('../services/api') as ApiModule;
  api.default.defaults.adapter = adapter;
  return { auth, api };
};

const authHeader = (config: InternalAxiosRequestConfig): unknown =>
  config.headers.get('Authorization');

const fullUrl = (config: InternalAxiosRequestConfig): string =>
  `${config.baseURL ?? ''}${config.url ?? ''}`;

beforeEach(() => {
  for (const key of Object.keys(mockSecureStore)) delete mockSecureStore[key];
  requests = [];
  nextResponse = {};
  process.env.EXPO_PUBLIC_API_URL = ENV_URL;
});

describe('auth storage', () => {
  it('returns the env default API url when nothing is stored', async () => {
    const { auth } = loadClient();

    await expect(auth.getApiUrl()).resolves.toBe(ENV_URL);
  });

  it('returns the stored API url once one is set', async () => {
    const { auth } = loadClient();

    await auth.setApiUrl('http://10.0.0.9:8000/api');

    await expect(auth.getApiUrl()).resolves.toBe('http://10.0.0.9:8000/api');
  });

  it('round-trips the token through secure store', async () => {
    const { auth } = loadClient();

    await expect(auth.getToken()).resolves.toBeNull();

    await auth.setToken('secret-token');

    await expect(auth.getToken()).resolves.toBe('secret-token');
    expect(Object.values(mockSecureStore)).toContain('secret-token');
  });
});

describe('bearer token interceptor', () => {
  it('sends the bearer header when a token is stored', async () => {
    const { auth, api } = loadClient();
    await auth.setToken('secret-token');
    nextResponse = [];

    await api.taskAPI.getAll();

    expect(requests).toHaveLength(1);
    expect(authHeader(requests[0])).toBe('Bearer secret-token');
  });

  it('sends no Authorization header when no token is stored', async () => {
    const { api } = loadClient();
    nextResponse = [];

    await api.taskAPI.getAll();

    expect(requests).toHaveLength(1);
    expect(authHeader(requests[0])).toBeUndefined();
  });

  it('resolves the base url from the stored value', async () => {
    const { auth, api } = loadClient();
    await auth.setApiUrl('http://10.0.0.9:8000/api');
    nextResponse = [];

    await api.taskAPI.getAll();

    expect(fullUrl(requests[0])).toBe('http://10.0.0.9:8000/api/tasks/');
  });
});

describe('collection endpoints keep their trailing slash', () => {
  it('lists tasks at /tasks/', async () => {
    const { api } = loadClient();
    nextResponse = [];

    await api.taskAPI.getAll();

    expect(fullUrl(requests[0])).toBe(`${ENV_URL}/tasks/`);
  });

  it('lists sessions at /sessions/', async () => {
    const { api } = loadClient();
    nextResponse = [];

    await api.sessionAPI.getAll();

    expect(fullUrl(requests[0])).toBe(`${ENV_URL}/sessions/`);
  });

  it('lists schedules at /schedules/', async () => {
    const { api } = loadClient();
    nextResponse = [];

    await api.scheduleAPI.getAll();

    expect(fullUrl(requests[0])).toBe(`${ENV_URL}/schedules/`);
  });
});

describe('scheduleAPI.generate', () => {
  const request = {
    start_time: '2026-09-06T08:00:00Z',
    day_start: '2026-09-06T00:00:00Z',
    day_end: '2026-09-06T23:00:00Z',
    activities: [
      { task_id: 1, name: 'Gym', estimated_duration: 1800 },
      { task_id: null, name: 'Reading', estimated_duration: 900 },
    ],
    existing_events: [],
    strategies: ['your-order', 'shortest-first', 'longest-first', 'best-fit'],
  };

  const response = {
    options: [
      {
        strategy: 'your-order',
        label: 'Your Order',
        description: 'Kept in the order you picked',
        timeline: [
          {
            task_id: 1,
            name: 'Gym',
            start: '2026-09-06T08:00:00Z',
            end: '2026-09-06T08:30:00Z',
          },
        ],
        flagged: [],
        excluded: [],
      },
    ],
  };

  it('posts to /schedules/generate without a trailing slash', async () => {
    const { api } = loadClient();
    nextResponse = response;

    await api.scheduleAPI.generate(request);

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('post');
    expect(fullUrl(requests[0])).toBe(`${ENV_URL}/schedules/generate`);
  });

  it('sends the request body unchanged', async () => {
    const { api } = loadClient();
    nextResponse = response;

    await api.scheduleAPI.generate(request);

    expect(JSON.parse(requests[0].data)).toEqual(request);
  });

  it('returns the parsed response body', async () => {
    const { api } = loadClient();
    nextResponse = response;

    await expect(api.scheduleAPI.generate(request)).resolves.toEqual(response);
  });
});
