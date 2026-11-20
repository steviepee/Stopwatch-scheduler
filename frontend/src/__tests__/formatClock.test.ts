import { beforeAll, describe, expect, it } from 'vitest';

// B70 (D128), web parity with mobile's B69: `src/utils/formatClock.ts` exports
// `formatClock(date, clock24h)`, the one formatter for every time of day the web app shows. It
// reads the Date's LOCAL hours and minutes.
//   - 12-hour: `h:mm AM` / `h:mm PM`, hour not padded, a plain ASCII space before AM/PM
//     (not the U+202F narrow space some ICU builds put in `toLocaleTimeString`).
//   - 24-hour: `HH:mm`, hour padded to two digits (`09:05`, `00:00`).
// Loaded through a variable path so tsc passes before B70.impl creates the module. B70.impl may
// leave it as is.

type FormatClock = (date: Date, clock24h: boolean) => string;
let formatClock: FormatClock;

beforeAll(async () => {
  const path = '../utils/formatClock';
  ({ formatClock } = (await import(/* @vite-ignore */ path)) as { formatClock: FormatClock });
});

function at(hour: number, minute: number): Date {
  return new Date(2026, 10, 19, hour, minute, 0, 0);
}

describe('formatClock (D128)', () => {
  it('gives 5:00 PM and 17:00 for the same time', () => {
    expect(formatClock(at(17, 0), false)).toBe('5:00 PM');
    expect(formatClock(at(17, 0), true)).toBe('17:00');
  });

  it('formats midnight in both clocks', () => {
    expect(formatClock(at(0, 0), false)).toBe('12:00 AM');
    expect(formatClock(at(0, 0), true)).toBe('00:00');
  });

  it('formats noon in both clocks', () => {
    expect(formatClock(at(12, 0), false)).toBe('12:00 PM');
    expect(formatClock(at(12, 0), true)).toBe('12:00');
  });

  it('pads minutes in both clocks and the hour only in 24-hour', () => {
    expect(formatClock(at(9, 5), false)).toBe('9:05 AM');
    expect(formatClock(at(9, 5), true)).toBe('09:05');
    expect(formatClock(at(23, 45), false)).toBe('11:45 PM');
    expect(formatClock(at(23, 45), true)).toBe('23:45');
  });
});
