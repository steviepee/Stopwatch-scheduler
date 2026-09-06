import { onlineManager, QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/react-query-persist-client';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { PropsWithChildren } from 'react';

const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
  },
}));

type NetInfoState = { isConnected: boolean; isInternetReachable: boolean };
type NetInfoListener = (state: NetInfoState) => void;

jest.mock('@react-native-community/netinfo', () => {
  const listeners = new Set<NetInfoListener>();
  const addEventListener = (listener: NetInfoListener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const fetch = async () => ({ isConnected: true, isInternetReachable: true });
  return {
    __esModule: true,
    __listeners: listeners,
    default: { addEventListener, fetch },
    addEventListener,
    fetch,
  };
});

const netInfoListeners = (): Set<NetInfoListener> =>
  (require('@react-native-community/netinfo') as { __listeners: Set<NetInfoListener> }).__listeners;

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

import api from '../services/api';
import { useCreateSession } from '../services/mutations';
import { createQueryClient, persister, queryClient } from '../services/queryClient';
import type { StopwatchSession, StopwatchSessionCreate } from '../types';

const ENV_URL = 'http://192.168.0.5:8000/api';

const body: StopwatchSessionCreate = {
  name: 'Gym',
  duration: 1800,
  task_id: 3,
  start_time: '2026-09-06T08:00:00Z',
  end_time: '2026-09-06T08:30:00Z',
};

const created: StopwatchSession = {
  id: 42,
  name: 'Gym',
  duration: 1800,
  task_id: 3,
  is_on_calendar: false,
  start_time: '2026-09-06T08:00:00Z',
  end_time: '2026-09-06T08:30:00Z',
  created_at: '2026-09-06T08:30:01Z',
  updated_at: '2026-09-06T08:30:01Z',
};

const existing: StopwatchSession = {
  id: 7,
  name: 'Reading',
  duration: 900,
  is_on_calendar: false,
  created_at: '2026-09-05T20:00:00Z',
  updated_at: '2026-09-05T20:00:00Z',
};

let requests: InternalAxiosRequestConfig[] = [];

const adapter: AxiosAdapter = async (config) => {
  requests.push(config);
  return {
    data: created,
    status: 201,
    statusText: 'Created',
    headers: {},
    config,
  } as AxiosResponse;
};

api.defaults.adapter = adapter;

const fullUrl = (config: InternalAxiosRequestConfig): string =>
  `${config.baseURL ?? ''}${config.url ?? ''}`;

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const clients: QueryClient[] = [];

const newClient = (): QueryClient => {
  const client = createQueryClient();
  clients.push(client);
  return client;
};

async function mountCreateSession(client: QueryClient) {
  client.setQueryData(['sessions'], (old: StopwatchSession[] | undefined) => old ?? []);
  return renderHook(() => useCreateSession(), { wrapper: wrap(client) });
}

beforeEach(() => {
  requests = [];
  mockStorage.clear();
  onlineManager.setOnline(true);
  process.env.EXPO_PUBLIC_API_URL = ENV_URL;
});

afterEach(() => {
  clients.splice(0).forEach((client) => {
    client
      .getMutationCache()
      .getAll()
      .forEach((mutation) => mutation.destroy());
    client.clear();
  });
});

describe('queryClient configuration', () => {
  it('registers resumable defaults for the createSession mutation key', () => {
    expect(typeof queryClient.getMutationDefaults(['createSession']).mutationFn).toBe('function');
    expect(typeof createQueryClient().getMutationDefaults(['createSession']).mutationFn).toBe(
      'function'
    );
  });

  it('leaves queries on the default online network mode', () => {
    expect(queryClient.getDefaultOptions().queries?.networkMode ?? 'online').toBe('online');
  });

  it('bounds mutation retries', () => {
    const retry = queryClient.getDefaultOptions().mutations?.retry;

    expect(typeof retry).toBe('number');
    expect(retry as number).toBeLessThanOrEqual(5);
  });

  it('drives onlineManager from netinfo', () => {
    const unsubscribe = onlineManager.subscribe(() => {});
    const listeners = netInfoListeners();
    expect(listeners.size).toBeGreaterThan(0);

    listeners.forEach((listener) => listener({ isConnected: false, isInternetReachable: false }));
    expect(onlineManager.isOnline()).toBe(false);

    listeners.forEach((listener) => listener({ isConnected: true, isInternetReachable: true }));
    expect(onlineManager.isOnline()).toBe(true);

    unsubscribe();
  });
});

describe('useCreateSession while offline', () => {
  it('pauses the save without calling the API', async () => {
    const client = newClient();
    const view = await mountCreateSession(client);
    onlineManager.setOnline(false);

    await act(async () => {
      view.result.current.mutate(body);
    });

    await waitFor(() => expect(view.result.current.isPaused).toBe(true));
    expect(requests).toHaveLength(0);
    expect(client.getMutationCache().getAll()).toHaveLength(1);
    expect(client.getMutationCache().getAll()[0].state.isPaused).toBe(true);
  });

  it('keeps the optimistic recording in the sessions cache', async () => {
    const client = newClient();
    client.setQueryData(['sessions'], [existing]);
    const view = await renderHook(() => useCreateSession(), { wrapper: wrap(client) });
    onlineManager.setOnline(false);

    await act(async () => {
      view.result.current.mutate(body);
    });
    await waitFor(() => expect(view.result.current.isPaused).toBe(true));

    const cached = client.getQueryData(['sessions']) as StopwatchSession[];
    expect(cached).toHaveLength(2);
    expect(cached[0].name).toBe('Gym');
    expect(cached[0].duration).toBe(1800);
    expect(cached[0].id).toBeUndefined();
    expect(cached[1]).toEqual(existing);
  });
});

describe('useCreateSession when the network returns', () => {
  it('flushes the paused save once with the original body', async () => {
    const client = newClient();
    const view = await mountCreateSession(client);
    onlineManager.setOnline(false);

    await act(async () => {
      view.result.current.mutate(body);
    });
    await waitFor(() => expect(view.result.current.isPaused).toBe(true));

    await act(async () => {
      onlineManager.setOnline(true);
    });

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].method).toBe('post');
    expect(fullUrl(requests[0])).toBe(`${ENV_URL}/sessions/`);
    expect(JSON.parse(requests[0].data)).toEqual(body);

    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(requests).toHaveLength(1);
  });
});

describe('persisted offline queue', () => {
  it('resumes a paused save on a fresh query client restored from storage', async () => {
    const first = newClient();
    const view = await mountCreateSession(first);
    onlineManager.setOnline(false);

    await act(async () => {
      view.result.current.mutate(body);
    });
    await waitFor(() => expect(view.result.current.isPaused).toBe(true));

    await persistQueryClientSave({ queryClient: first, persister });
    await waitFor(() => expect(mockStorage.size).toBeGreaterThan(0));

    await view.unmount();

    const second = newClient();
    await persistQueryClientRestore({ queryClient: second, persister });

    expect(second.getMutationCache().getAll()).toHaveLength(1);
    expect(second.getMutationCache().getAll()[0].state.isPaused).toBe(true);
    expect(requests).toHaveLength(0);

    onlineManager.setOnline(true);
    await act(async () => {
      await second.resumePausedMutations();
    });

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(fullUrl(requests[0])).toBe(`${ENV_URL}/sessions/`);
    expect(JSON.parse(requests[0].data)).toEqual(body);
  });
});
