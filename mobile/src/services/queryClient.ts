import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { onlineManager, QueryClient } from '@tanstack/react-query';

import { sessionAPI } from './api';
import type { StopwatchSessionCreate } from '../types';

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected);
  })
);

export const CREATE_SESSION_KEY = ['createSession'];

// Mutations stay on the default 'online' network mode: 'offlineFirst' fires the
// request before pausing, which would hit the API while offline and again on flush.
export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'online',
        retry: 2,
      },
      mutations: {
        retry: 3,
      },
    },
  });

  client.setMutationDefaults(CREATE_SESSION_KEY, {
    mutationFn: (session: StopwatchSessionCreate) => sessionAPI.create(session),
  });

  return client;
}

export const queryClient = createQueryClient();

export const persister = createAsyncStoragePersister({ storage: AsyncStorage });
