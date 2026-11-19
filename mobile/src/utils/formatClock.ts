import { useQuery } from '@tanstack/react-query';

import { settingsAPI } from '@/services/api';

export function formatClock(date: Date, clock24h: boolean): string {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  if (clock24h) return `${String(hours).padStart(2, '0')}:${minutes}`;
  const period = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${minutes} ${period}`;
}

export function useClock24h(): boolean {
  const { data } = useQuery({ queryKey: ['settings', 'display'], queryFn: () => settingsAPI.getDisplay() });
  return data?.clock_24h ?? false;
}
