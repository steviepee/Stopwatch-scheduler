import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import CalendarDayScreen from '../app/(tabs)/calendar';
import { scheduleAPI, taskAPI, calendarImportAPI } from '../services/api';
import type { ScheduleItem, Task } from '../types';

// B6 contract (Build 2a, ADR 0003): the day view plans Activities, not Recordings.
// Its Blocks are the day's Schedule Items, fetched with `scheduleAPI.getRange(day, day)`
// where both args are the shown day's LOCAL `YYYY-MM-DD`. A Block is positioned by the
// Item's `scheduled_time`, sized by its `estimated_duration`, and labelled with the
// Activity name (`item.task.name`).
//
// testIDs this file locks in:
//   - `item-block-{itemId}` — draggable Block (replaces P15's `session-block-{id}`)
//   - `google-block-{id}` — read-only Google event, no gesture attached (D34)
//   - `day-nav-prev` / `day-nav-next` / `day-label`, `google-events-error` /
//     `btn-retry-google`, `current-time-line` — unchanged from P15
//
// Moving a Block (15-minute snap, within its own day) calls
// `scheduleAPI.updateItem(scheduleId, itemId, { scheduled_time })` — the snapped time
// ONLY. Sending `estimated_duration` too would make the server patch Google for an
// unchanged length (B3.impl: "changes" means "present in the body").
//
// Drag is exercised through the mocked gesture-handler registry (keyed by the
// gestured child's testID), calling `.onEnd(event)` directly — see P15.tests.
jest.mock('../services/api', () => ({
  taskAPI: { getAll: jest.fn() },
  scheduleAPI: {
    getRange: jest.fn(),
    placeActivity: jest.fn(),
    updateItem: jest.fn(),
    deleteItem: jest.fn(),
    removeItemFromCalendar: jest.fn(),
    clearDay: jest.fn(),
    pushToCalendar: jest.fn(),
    removeFromCalendar: jest.fn(),
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
      activateAfterLongPress: () => gesture,
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
    ScrollView: require('react-native').ScrollView,
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

// The new scheduleAPI methods do not exist on the real type until B6.impl adds them.
const mockedScheduleAPI = scheduleAPI as unknown as Record<string, jest.Mock>;
const mockedGetRange = mockedScheduleAPI.getRange;
const mockedUpdateItem = mockedScheduleAPI.updateItem;
const mockedPlaceActivity = mockedScheduleAPI.placeActivity;
const mockedDeleteItem = mockedScheduleAPI.deleteItem;
const mockedTasksGetAll = taskAPI.getAll as jest.Mock;
const mockedGetEvents = calendarImportAPI.getEvents as jest.Mock;

type DaySchedule = { id: number; target_date: string; is_regimen: false; items: ScheduleItem[] };
let schedules: DaySchedule[] = [];

function gestureRegistry(): Record<string, { onEnd: (e: Record<string, unknown>) => void }> {
  return (require('react-native-gesture-handler') as any).__registry;
}

function localKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function task(overrides: Partial<Task>): Task {
  return {
    id: 1,
    name: 'Activity',
    average_duration: 1800,
    total_recordings: 3,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function item(overrides: Partial<ScheduleItem>): ScheduleItem {
  return {
    id: 1,
    schedule_id: 50,
    task_id: 1,
    estimated_duration: 1800,
    position: 0,
    scheduled_time: todayAt(9),
    task: task({ id: overrides.task_id ?? 1 }),
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function today(items: ScheduleItem[]): DaySchedule {
  return { id: 50, target_date: localKey(new Date()), is_regimen: false, items };
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function renderScreen() {
  return render(
    <QueryClientProvider client={client()}>
      <CalendarDayScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  for (const mock of Object.values(mockedScheduleAPI)) mock.mockReset();
  mockedTasksGetAll.mockReset();
  mockedGetEvents.mockReset();
  schedules = [];
  mockedGetRange.mockImplementation((start: string, end: string) =>
    Promise.resolve(schedules.filter((s) => s.target_date >= start && s.target_date <= end))
  );
  mockedTasksGetAll.mockResolvedValue([]);
  mockedGetEvents.mockResolvedValue([]);
  for (const key of Object.keys(gestureRegistry())) delete gestureRegistry()[key];
});

describe('Blocks from Schedule Items', () => {
  it('fetches the shown local day with getRange(day, day)', async () => {
    await renderScreen();

    const key = localKey(new Date());
    await waitFor(() => expect(mockedGetRange).toHaveBeenCalledWith(key, key));
  });

  it('positions by scheduled_time, sizes by estimated_duration, and labels with the Activity name', async () => {
    schedules = [
      today([
        item({ id: 1, task_id: 11, task: task({ id: 11, name: 'Reading' }), scheduled_time: todayAt(9), estimated_duration: 900 }),
        item({ id: 2, task_id: 12, task: task({ id: 12, name: 'Gym' }), scheduled_time: todayAt(14), estimated_duration: 1800 }),
      ]),
    ];
    await renderScreen();

    await screen.findByTestId('item-block-1');
    const { StyleSheet } = require('react-native');
    const earlyStyle = StyleSheet.flatten(screen.getByTestId('item-block-1').props.style);
    const lateStyle = StyleSheet.flatten(screen.getByTestId('item-block-2').props.style);

    expect(lateStyle.top).toBeGreaterThan(earlyStyle.top);
    expect(lateStyle.height).toBe(earlyStyle.height * 2);
    expect(within(screen.getByTestId('item-block-1')).getByText('Reading')).toBeTruthy();
    expect(within(screen.getByTestId('item-block-2')).getByText('Gym')).toBeTruthy();
  });
});

describe('moving a Block', () => {
  it('calls updateItem with only a 15-minute-snapped UTC Z scheduled_time on the same day', async () => {
    const original = todayAt(9);
    schedules = [today([item({ id: 5, scheduled_time: original, estimated_duration: 1800 })])];
    mockedUpdateItem.mockResolvedValue({});
    await renderScreen();

    await screen.findByTestId('item-block-5');
    await fireEvent(screen.getByTestId('bank-panel'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 600, width: 400, height: 200 } },
    });
    gestureRegistry()['item-block-5'].onEnd({ translationY: 100, absoluteY: 300 });

    await waitFor(() => expect(mockedUpdateItem).toHaveBeenCalledTimes(1));
    const [scheduleId, itemId, body] = mockedUpdateItem.mock.calls[0];
    expect(scheduleId).toBe(50);
    expect(itemId).toBe(5);
    expect(Object.keys(body)).toEqual(['scheduled_time']);
    expect(body.scheduled_time).toMatch(/Z$/);

    const moved = new Date(body.scheduled_time);
    expect(moved.getTime()).toBeGreaterThan(new Date(original).getTime());
    expect(moved.getUTCMinutes() % 15).toBe(0);
    expect(moved.getUTCSeconds()).toBe(0);
    expect(localKey(moved)).toBe(localKey(new Date()));
    expect(mockedDeleteItem).not.toHaveBeenCalled();
  });
});

describe('google events overlay', () => {
  it('renders read-only blocks with no gesture attached, so a drag calls no API', async () => {
    schedules = [today([item({ id: 3 })])];
    mockedGetEvents.mockResolvedValue([
      { id: 'g1', summary: 'Standup', start: todayAt(10), end: todayAt(10, 15) },
    ]);
    await renderScreen();

    await screen.findByTestId('google-block-g1');
    await screen.findByTestId('item-block-3');
    expect(gestureRegistry()['google-block-g1']).toBeUndefined();
    expect(mockedUpdateItem).not.toHaveBeenCalled();
    expect(mockedPlaceActivity).not.toHaveBeenCalled();
    expect(mockedDeleteItem).not.toHaveBeenCalled();
  });
});

describe('day navigation', () => {
  it('refetches the day’s Items and Google events for the new date', async () => {
    await renderScreen();

    await waitFor(() => expect(mockedGetEvents).toHaveBeenCalledTimes(1));
    const firstDate = mockedGetEvents.mock.calls[0][0];

    await fireEvent.press(screen.getByTestId('day-nav-next'));

    await waitFor(() => expect(mockedGetEvents).toHaveBeenCalledTimes(2));
    const secondDate = mockedGetEvents.mock.calls[1][0];
    expect(new Date(secondDate).getTime() - new Date(firstDate).getTime()).toBe(24 * 60 * 60 * 1000);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const key = localKey(tomorrow);
    await waitFor(() => expect(mockedGetRange).toHaveBeenCalledWith(key, key));
  });
});

describe('google fetch failure', () => {
  it('keeps Blocks visible and offers a retry instead of hiding the day', async () => {
    schedules = [today([item({ id: 9, estimated_duration: 900 })])];
    mockedGetEvents.mockRejectedValue(new Error('network down'));
    await renderScreen();

    await screen.findByTestId('item-block-9');
    await screen.findByTestId('btn-retry-google');
    expect(screen.getByTestId('item-block-9')).toBeTruthy();

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
