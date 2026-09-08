import { useMutation, useQueryClient } from '@tanstack/react-query';

import { CREATE_SESSION_KEY } from './queryClient';
import type { StopwatchSession, StopwatchSessionCreate } from '../types';

// No optimistic row: a create payload carries no id or created_at, and a partial
// row in the ['sessions'] cache crashes the Recordings list (and is persisted, so
// it survives a restart). Pending saves render from the mutation cache instead.
export function useCreateSession() {
  const client = useQueryClient();

  return useMutation<StopwatchSession, Error, StopwatchSessionCreate>({
    mutationKey: CREATE_SESSION_KEY,
    onSettled: () => {
      client.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}
