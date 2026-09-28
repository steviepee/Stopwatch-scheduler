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

// B6: the calendar plans Schedule Items. The new methods are reached through a cast
// until B6.impl adds them to the real type.
describe('B6 schedule item routes', () => {
  const scheduleApi = (api: ApiModule) => api.scheduleAPI as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

  it('getRange lists day Schedules at /schedules/ with start_date and end_date', async () => {
    const { api } = loadClient();
    nextResponse = [];

    await scheduleApi(api).getRange('2026-09-27', '2026-10-03');

    expect(requests[0].method).toBe('get');
    expect(fullUrl(requests[0])).toBe(`${ENV_URL}/schedules/`);
    expect(requests[0].params).toEqual({ start_date: '2026-09-27', end_date: '2026-10-03' });
  });

  it('placeActivity posts the body unchanged to /schedules/days/{date}/items', async () => {
    const { api } = loadClient();
    const body = { task_id: 7, scheduled_time: '2026-09-29T14:00:00.000Z' };

    await scheduleApi(api).placeActivity('2026-09-29', body);

    expect(requests[0].method).toBe('post');
    expect(fullUrl(requests[0])).toBe(`${ENV_URL}/schedules/days/2026-09-29/items`);
    expect(JSON.parse(requests[0].data)).toEqual(body);
  });

  it('updateItem puts to /schedules/{id}/items/{itemId}', async () => {
    const { api } = loadClient();

    await scheduleApi(api).updateItem(50, 5, { scheduled_time: '2026-09-29T14:15:00.000Z' });

    expect(requests[0].method).toBe('put');
    expect(fullUrl(requests[0])).toBe(`${ENV_URL}/schedules/50/items/5`);
    expect(JSON.parse(requests[0].data)).toEqual({ scheduled_time: '2026-09-29T14:15:00.000Z' });
  });

  it.each([true, false])('deleteItem sends delete_event=%s', async (deleteEvent) => {
    const { api } = loadClient();

    await scheduleApi(api).deleteItem(50, 5, deleteEvent);

    expect(requests[0].method).toBe('delete');
    expect(fullUrl(requests[0])).toBe(`${ENV_URL}/schedules/50/items/5`);
    expect(requests[0].params).toEqual({ delete_event: deleteEvent });
  });

  it('removeItemFromCalendar deletes /schedules/{id}/items/{itemId}/calendar', async () => {
    const { api } = loadClient();

    await scheduleApi(api).removeItemFromCalendar(50, 5);

    expect(requests[0].method).toBe('delete');
    expect(fullUrl(requests[0])).toBe(`${ENV_URL}/schedules/50/items/5/calendar`);
  });

  it.each([true, false])('clearDay deletes the Schedule with delete_events=%s', async (deleteEvents) => {
    const { api } = loadClient();

    await scheduleApi(api).clearDay(50, deleteEvents);

    expect(requests[0].method).toBe('delete');
    expect(fullUrl(requests[0])).toBe(`${ENV_URL}/schedules/50`);
    expect(requests[0].params).toEqual({ delete_events: deleteEvents });
  });

  it('sessionAPI no longer offers Recording scheduling or push', () => {
    const { api } = loadClient();

    for (const name of ['schedule', 'unschedule', 'getScheduled', 'getUnscheduled', 'addToCalendar', 'removeFromCalendar']) {
      expect(api.sessionAPI).not.toHaveProperty(name);
    }
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
