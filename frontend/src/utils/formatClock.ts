import { useEffect, useState } from 'react';
import { settingsAPI } from '../services/api';

export function formatClock(date: Date, clock24h: boolean): string {
  const h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, '0');
  if (clock24h) return `${h.toString().padStart(2, '0')}:${m}`;
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

export function useClock24h(): boolean {
  const [clock24h, setClock24h] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await settingsAPI.getDisplay();
        if (active) setClock24h(data.clock_24h);
      } catch {
        // 12-hour until it loads, or if it fails.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return clock24h;
}
