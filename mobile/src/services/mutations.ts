import { useMutation, useQueryClient } from '@tanstack/react-query';

import { CREATE_SESSION_KEY } from './queryClient';
import type { StopwatchSession, StopwatchSessionCreate } from '../types';

type SessionsContext = { previous: StopwatchSession[] | undefined };

export function useCreateSession() {
  const client = useQueryClient();

  return useMutation<StopwatchSession, Error, StopwatchSessionCreate, SessionsContext>({
    mutationKey: CREATE_SESSION_KEY,
    onMutate: async (session) => {
      await client.cancelQueries({ queryKey: ['sessions'] });
      const previous = client.getQueryData<StopwatchSession[]>(['sessions']);
      const optimistic = { ...session } as unknown as StopwatchSession;
      client.setQueryData<StopwatchSession[]>(['sessions'], (old) => [optimistic, ...(old ?? [])]);
      return { previous };
    },
    onError: (_error, _session, context) => {
      if (context) {
        client.setQueryData(['sessions'], context.previous);
      }
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}
