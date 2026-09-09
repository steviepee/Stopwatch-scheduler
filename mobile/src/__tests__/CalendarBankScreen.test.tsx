import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import CalendarDayScreen from '../app/(tabs)/calendar';
import { sessionAPI, calendarImportAPI } from '../services/api';
import { getWeekDays } from '../utils/calendarUtils';
import type { StopwatchSession } from '../types';

// P16 contract: the Calendar tab (`src/app/(tabs)/calendar.tsx`, already built in P15)
// gains a collapsible session bank and a Day/Week toggle. No prior art for either,
// so — same as P15.tests — the testIDs and gesture-event shapes defined here ARE
// the contract:
//
//   - `bank-search` — text input filtering the bank by name (case-insensitive substring)
//   - `bank-item-{id}` — one draggable row per unscheduled recording (`sessionAPI.getUnscheduled`)
//   - `view-toggle-day` / `view-toggle-week` — mode switch buttons
//   - `week-day-{YYYY-MM-DD}` — one pressable section per day of the week, in order,
//     Sunday-first (matches `calendarUtils.getWeekDays`); pressing it switches back to
//     Day mode showing that date
//   - `week-session-{id}` / `week-google-{id}` — read-only rows inside a week-day section,
//     in time order, no gesture attached
//
// Two gesture behaviours have no real on-screen geometry to hook into under RNTL (there
// is no layout engine, so `onLayout`-based hit-testing can't be exercised meaningfully),
// so — same invariant-based approach P15.tests took for drag/resize — the mocked pan
// event carries the *already-decided* signal directly instead of raw coordinates a real
// gesture would need bounds-checked against:
//   - dragging a `bank-item-{id}` ends with `{ absoluteY }`, the y position (in the
//     grid's own coordinate space) where the finger lifted; the impl converts it to a
//     time the same way the existing grid does and calls `sessionAPI.schedule`
//   - dragging a `session-block-{id}` onto the bank ends with `{ translationY, droppedOnBank: true }`;
//     when `droppedOnBank` is set the impl calls `sessionAPI.unschedule` instead of
//     rescheduling (a real implementation decides this flag from `absoluteY` vs. the
//     bank panel's measured bounds — that decision itself is not part of this contract)
jest.mock('../services/api', () => ({
  sessionAPI: {
    getScheduled: jest.fn(),
    getUnscheduled: jest.fn(),
    schedule: jest.fn(),
    unschedule: jest.fn(),
  },
  calendarImportAPI: { getEvents: jest.fn() },
}));

jest.mock('react-native-gesture-handler', () => {
  const registry: Record<string, { onEnd: (e: Record<string, unknown>) => void }> = {};

  function makeGesture() {
    const handlers: { onEnd?: (e: Record<string, unknown>) => void } = {};
    const gesture: any = {
      onBegin: () => gesture,
      onUpdate: () => gesture,
      onFinalize: () => gesture,
      minDistance: () => gesture,
      activeOffsetY: () => gesture,
      activeOffsetX: () => gesture,
      onEnd: (fn: (e: Record<string, unknown>) => void) => {
        handlers.onEnd = fn;
        return gesture;
      },
      __handlers: handlers,
    };
    return gesture;
  }

  const ReactLib = require('react');

  return {
    __esModule: true,
    __registry: registry,
    Gesture: { Pan: makeGesture },
    GestureDetector: ({ children, gesture }: { children: any; gesture: any }) => {
      const testID = children?.props?.testID;
      if (testID) {
        registry[testID] = { onEnd: (e) => gesture.__handlers.onEnd?.(e) };
      }
      return children;
    },
    GestureHandlerRootView: ({ children }: { children: any }) => ReactLib.createElement(ReactLib.Fragment, null, children),
  };
});

const mockedGetScheduled = sessionAPI.getScheduled as jest.Mock;
const mockedGetUnscheduled = sessionAPI.getUnscheduled as jest.Mock;
const mockedSchedule = sessionAPI.schedule as jest.Mock;
const mockedUnschedule = sessionAPI.unschedule as jest.Mock;
const mockedGetEvents = calendarImportAPI.getEvents as jest.Mock;

function gestureRegistry(): Record<string, { onEnd: (e: Record<string, unknown>) => void }> {
  return (require('react-native-gesture-handler') as any).__registry;
}

function session(overrides: Partial<StopwatchSession>): StopwatchSession {
  return {
    id: 1,
    name: 'Session',
    duration: 1800,
    is_on_calendar: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function dayKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function renderScreen() {
  return render(
    <QueryClientProvider client={client()}>
      <CalendarDayScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockedGetScheduled.mockReset();
  mockedGetUnscheduled.mockReset();
  mockedSchedule.mockReset();
  mockedUnschedule.mockReset();
  mockedGetEvents.mockReset();
  mockedGetScheduled.mockResolvedValue([]);
  mockedGetUnscheduled.mockResolvedValue([]);
  mockedGetEvents.mockResolvedValue([]);
  for (const key of Object.keys(gestureRegistry())) delete gestureRegistry()[key];
});

describe('session bank', () => {
  it('lists only unscheduled recordings, and search narrows it', async () => {
    mockedGetUnscheduled.mockResolvedValue([
      session({ id: 1, name: 'Reading' }),
      session({ id: 2, name: 'Gym' }),
    ]);
    mockedGetScheduled.mockResolvedValue([
      session({ id: 99, name: 'Already on the grid', scheduled_start: todayAt(9) }),
    ]);
    await renderScreen();

    await screen.findByTestId('bank-item-1');
    expect(screen.getByTestId('bank-item-2')).toBeTruthy();
    expect(screen.queryByTestId('bank-item-99')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('bank-search'), 'gym');
    expect(screen.getByTestId('bank-item-2')).toBeTruthy();
    expect(screen.queryByTestId('bank-item-1')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('bank-search'), '');
    expect(screen.getByTestId('bank-item-1')).toBeTruthy();
  });
});

describe('dropping a bank item on the grid', () => {
  it('calls sessionAPI.schedule with a 15-minute-snapped UTC Z time and the item’s duration', async () => {
    const item = session({ id: 7, name: 'Deep work', duration: 1800 });
    mockedGetUnscheduled.mockResolvedValue([item]);
    mockedSchedule.mockResolvedValue({ ...item, scheduled_start: todayAt(10) });
    await renderScreen();

    await screen.findByTestId('bank-item-7');
    gestureRegistry()['bank-item-7'].onEnd({ absoluteY: 540 });

    await waitFor(() => expect(mockedSchedule).toHaveBeenCalledTimes(1));
    const [id, body] = mockedSchedule.mock.calls[0];
    expect(id).toBe(7);
    expect(body.scheduled_start).toMatch(/Z$/);
    expect(body.scheduled_end).toMatch(/Z$/);

    const start = new Date(body.scheduled_start);
    const end = new Date(body.scheduled_end);
    expect(start.getUTCMinutes() % 15).toBe(0);
    expect(start.getUTCSeconds()).toBe(0);
    expect(end.getTime() - start.getTime()).toBe(item.duration * 1000);
  });
});

describe('dropping a scheduled block on the bank', () => {
  it('calls sessionAPI.unschedule instead of rescheduling', async () => {
    const item = session({ id: 8, name: 'Standup', scheduled_start: todayAt(9), duration: 900 });
    mockedGetScheduled.mockResolvedValue([item]);
    mockedUnschedule.mockResolvedValue({ ...item, scheduled_start: undefined });
    await renderScreen();

    await screen.findByTestId('session-block-8');
    gestureRegistry()['session-block-8'].onEnd({ translationY: 0, droppedOnBank: true });

    await waitFor(() => expect(mockedUnschedule).toHaveBeenCalledWith(8));
    expect(mockedSchedule).not.toHaveBeenCalled();
  });
});

describe('week mode', () => {
  it('lists seven days in order with recordings and Google events merged in time order', async () => {
    const weekDays = getWeekDays(new Date());
    const dayKeys = weekDays.map(dayKeyOf);
    const targetIndex = 2;
    const targetKey = dayKeys[targetIndex];

    const targetDay = weekDays[targetIndex];
    const scheduledOn = (base: Date, hour: number, minute = 0) => {
      const d = new Date(base);
      d.setHours(hour, minute, 0, 0);
      return d.toISOString();
    };

    const scheduledSession = session({
      id: 21,
      name: 'Focus block',
      scheduled_start: scheduledOn(targetDay, 9),
      duration: 1800,
    });
    const googleEvent = {
      id: 'g5',
      summary: 'Standup',
      start: scheduledOn(targetDay, 8),
      end: scheduledOn(targetDay, 8.25),
    };

    mockedGetScheduled.mockResolvedValue([scheduledSession]);
    mockedGetEvents.mockImplementation((date: string) =>
      Promise.resolve(date === targetKey ? [googleEvent] : [])
    );

    await renderScreen();
    await fireEvent.press(screen.getByTestId('view-toggle-week'));

    await waitFor(() => expect(screen.getByTestId(`week-google-${googleEvent.id}`)).toBeTruthy());

    const allSections = screen.getAllByTestId(/^week-day-/);
    expect(allSections.map((s) => s.props.testID)).toEqual(dayKeys.map((k) => `week-day-${k}`));

    const targetSection = screen.getByTestId(`week-day-${targetKey}`);
    const items = within(targetSection).getAllByTestId(/^week-(session|google)-/);
    expect(items.map((i) => i.props.testID)).toEqual([`week-google-${googleEvent.id}`, `week-session-${scheduledSession.id}`]);
  });

  it('renders no drag handles, and tapping a day switches back to Day mode for that date', async () => {
    const weekDays = getWeekDays(new Date());
    const dayKeys = weekDays.map(dayKeyOf);
    const targetIndex = 1;
    const targetKey = dayKeys[targetIndex];
    const targetDay = weekDays[targetIndex];

    const d = new Date(targetDay);
    d.setHours(9, 0, 0, 0);
    const scheduledSession = session({ id: 31, name: 'Reading', scheduled_start: d.toISOString(), duration: 900 });

    mockedGetScheduled.mockResolvedValue([scheduledSession]);
    await renderScreen();
    await fireEvent.press(screen.getByTestId('view-toggle-week'));

    await waitFor(() => expect(screen.getByTestId(`week-day-${targetKey}`)).toBeTruthy());
    expect(Object.keys(gestureRegistry()).some((key) => key.startsWith('week-'))).toBe(false);

    await fireEvent.press(screen.getByTestId(`week-day-${targetKey}`));

    await waitFor(() => expect(screen.getByTestId(`session-block-${scheduledSession.id}`)).toBeTruthy());
    expect(screen.queryByTestId(`week-day-${targetKey}`)).toBeNull();
  });
});
