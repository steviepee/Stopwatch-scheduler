import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CalendarDayScreen from '../app/(tabs)/calendar';
import { sessionAPI, calendarImportAPI } from '../services/api';
import type { StopwatchSession } from '../types';

// P15 contract: `src/app/(tabs)/calendar.tsx` is a day time grid built on
// calendarUtils. Scheduled recordings (`sessionAPI.getScheduled`) render as
// blocks positioned/sized from `scheduled_start` and `duration`, draggable
// and resizable via `react-native-gesture-handler` + `react-native-reanimated`
// (mocked below — see the gotcha this leaves for P15.impl / P16). Google
// events (`calendarImportAPI.getEvents`) render as read-only blocks, never
// draggable (D34). Day nav refetches Google events for the new date. A
// Google fetch failure must not hide the recordings and must offer a retry.
//
// Testable contract this file locks in (markup has no prior art to follow,
// so these testIDs and the gesture-registry shape ARE the contract now):
//   - `day-nav-prev` / `day-nav-next` / `day-label`
//   - `session-block-{id}` — draggable scheduled-recording block
//   - `session-block-{id}-resize-handle` — nested draggable resize handle
//   - `google-block-{id}` — read-only Google event block, no gesture attached
//   - `google-events-error` / `btn-retry-google`
//   - `current-time-line` — present only when the shown day is today
// Drag/resize is exercised by reaching into the mocked
// `react-native-gesture-handler`'s `__registry` (keyed by the gestured
// child's testID) and calling `.onEnd(event)` directly, the same "expose the
// registration internals" pattern used for the netinfo listener mock in the
// P7 offline-queue tests — there is no way to simulate a native pan gesture
// through `fireEvent`.
jest.mock('../services/api', () => ({
  sessionAPI: { getScheduled: jest.fn(), schedule: jest.fn() },
  calendarImportAPI: { getEvents: jest.fn() },
}));

jest.mock('react-native-gesture-handler', () => {
  const registry: Record<string, { onEnd: (e: { translationY: number }) => void }> = {};

  function makeGesture() {
    const handlers: { onEnd?: (e: { translationY: number }) => void } = {};
    const gesture: any = {
      onBegin: () => gesture,
      onUpdate: () => gesture,
      onFinalize: () => gesture,
      minDistance: () => gesture,
      activeOffsetY: () => gesture,
      activeOffsetX: () => gesture,
      onEnd: (fn: (e: { translationY: number }) => void) => {
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
const mockedSchedule = sessionAPI.schedule as jest.Mock;
const mockedGetEvents = calendarImportAPI.getEvents as jest.Mock;

function gestureRegistry(): Record<string, { onEnd: (e: { translationY: number }) => void }> {
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

// The screen defaults to showing today, so fixtures scheduled "in the past"
// (e.g. a hardcoded January date) would never appear once filtered by day.
function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
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
  mockedSchedule.mockReset();
  mockedGetEvents.mockReset();
  mockedGetScheduled.mockResolvedValue([]);
  mockedGetEvents.mockResolvedValue([]);
  for (const key of Object.keys(gestureRegistry())) delete gestureRegistry()[key];
});

describe('scheduled blocks', () => {
  it('positions and sizes blocks from their scheduled time and duration', async () => {
    const early = session({ id: 1, name: 'Reading', scheduled_start: todayAt(9), duration: 900 });
    const late = session({ id: 2, name: 'Gym', scheduled_start: todayAt(14), duration: 1800 });
    mockedGetScheduled.mockResolvedValue([early, late]);
    await renderScreen();

    await screen.findByTestId('session-block-1');
    const earlyStyle = require('react-native').StyleSheet.flatten(screen.getByTestId('session-block-1').props.style);
    const lateStyle = require('react-native').StyleSheet.flatten(screen.getByTestId('session-block-2').props.style);

    // Later start time -> greater vertical offset.
    expect(lateStyle.top).toBeGreaterThan(earlyStyle.top);
    // Double the duration -> double the height, regardless of the chosen slot scale.
    expect(lateStyle.height).toBe(earlyStyle.height * 2);
  });
});

describe('dragging a scheduled block', () => {
  it('calls sessionAPI.schedule with a 15-minute-snapped UTC Z start, duration preserved', async () => {
    const item = session({
      id: 5,
      scheduled_start: todayAt(9),
      scheduled_end: todayAt(9, 30),
      duration: 1800,
    });
    mockedGetScheduled.mockResolvedValue([item]);
    mockedSchedule.mockResolvedValue({ ...item });
    await renderScreen();

    await screen.findByTestId('session-block-5');
    gestureRegistry()['session-block-5'].onEnd({ translationY: 5000 });

    await waitFor(() => expect(mockedSchedule).toHaveBeenCalledTimes(1));
    const [id, body] = mockedSchedule.mock.calls[0];
    expect(id).toBe(5);
    expect(body.scheduled_start).toMatch(/Z$/);
    expect(body.scheduled_end).toMatch(/Z$/);

    const newStart = new Date(body.scheduled_start);
    const newEnd = new Date(body.scheduled_end);
    expect(newStart.getTime()).not.toBe(new Date(item.scheduled_start!).getTime());
    expect(newStart.getUTCMinutes() % 15).toBe(0);
    expect(newStart.getUTCSeconds()).toBe(0);
    expect(newEnd.getTime() - newStart.getTime()).toBe(30 * 60 * 1000);
  });
});

describe('resizing a scheduled block', () => {
  it('changes scheduled_end only, still 15-minute-snapped', async () => {
    const item = session({
      id: 6,
      scheduled_start: todayAt(9),
      scheduled_end: todayAt(9, 30),
      duration: 1800,
    });
    mockedGetScheduled.mockResolvedValue([item]);
    mockedSchedule.mockResolvedValue({ ...item });
    await renderScreen();

    await screen.findByTestId('session-block-6-resize-handle');
    gestureRegistry()['session-block-6-resize-handle'].onEnd({ translationY: 5000 });

    await waitFor(() => expect(mockedSchedule).toHaveBeenCalledTimes(1));
    const [id, body] = mockedSchedule.mock.calls[0];
    expect(id).toBe(6);
    expect(body.scheduled_start).toBe(item.scheduled_start);
    expect(body.scheduled_end).not.toBe(item.scheduled_end);
    expect(new Date(body.scheduled_end).getUTCMinutes() % 15).toBe(0);
  });
});

describe('google events overlay', () => {
  it('renders read-only blocks with no gesture attached, so a drag calls no API', async () => {
    mockedGetEvents.mockResolvedValue([
      { id: 'g1', summary: 'Standup', start: '2026-01-05T10:00:00.000Z', end: '2026-01-05T10:15:00.000Z' },
    ]);
    await renderScreen();

    await screen.findByTestId('google-block-g1');
    expect(gestureRegistry()['google-block-g1']).toBeUndefined();
    expect(mockedSchedule).not.toHaveBeenCalled();
  });
});

describe('day navigation', () => {
  it('refetches Google events for the new date on next/previous', async () => {
    await renderScreen();

    await waitFor(() => expect(mockedGetEvents).toHaveBeenCalledTimes(1));
    const firstDate = mockedGetEvents.mock.calls[0][0];

    await fireEvent.press(screen.getByTestId('day-nav-next'));

    await waitFor(() => expect(mockedGetEvents).toHaveBeenCalledTimes(2));
    const secondDate = mockedGetEvents.mock.calls[1][0];

    expect(secondDate).not.toBe(firstDate);
    expect(new Date(secondDate).getTime() - new Date(firstDate).getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('google fetch failure', () => {
  it('keeps recordings visible and offers a retry instead of hiding the day', async () => {
    const item = session({ id: 9, scheduled_start: todayAt(9), duration: 900 });
    mockedGetScheduled.mockResolvedValue([item]);
    mockedGetEvents.mockRejectedValue(new Error('network down'));
    await renderScreen();

    await screen.findByTestId('session-block-9');
    await screen.findByTestId('btn-retry-google');
    expect(screen.getByTestId('session-block-9')).toBeTruthy();

    mockedGetEvents.mockResolvedValueOnce([]);
    await fireEvent.press(screen.getByTestId('btn-retry-google'));

    await waitFor(() => expect(mockedGetEvents).toHaveBeenCalledTimes(2));
  });
});

describe('current time indicator', () => {
  it('shows only when the displayed day is today', async () => {
    await renderScreen();

    await screen.findByTestId('day-label');
    expect(screen.getByTestId('current-time-line')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('day-nav-next'));

    expect(screen.queryByTestId('current-time-line')).toBeNull();
  });
});
