import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import CalendarDayScreen from '../app/(tabs)/calendar';
import { scheduleAPI, taskAPI, calendarImportAPI } from '../services/api';
import { getWeekDays } from '../utils/calendarUtils';
import type { ScheduleItem, Task } from '../types';

// B6 contract: the Bank is an Activity Bank (D40) and the week agenda reads Schedule Items.
//
//   - The Bank lists EVERY Activity (`taskAPI.getAll`), filtered by `bank-search`
//     (case-insensitive substring). One draggable `bank-item-{taskId}` per Activity. An
//     Activity with no history (`average_duration` 0 / `total_recordings` 0) carries a
//     `bank-item-{taskId}-no-history` marker. Placing never removes an Activity.
//   - Dropping a Bank item on the grid ends with `{ absoluteY }` and calls
//     `scheduleAPI.placeActivity(localDate, { task_id, scheduled_time })` — the shown day's
//     local `YYYY-MM-DD`, a 15-minute-snapped UTC `Z` time, and NO `estimated_duration`
//     (the server seeds it, B2).
//   - Dropping a Block (`item-block-{itemId}`) on the Bank: `absoluteY` at or below the
//     top of `bank-panel` (its onLayout, as in P16-reopened). Not Exported →
//     `deleteItem(scheduleId, itemId, false)` with no dialog. Exported (has a
//     `calendar_event_id`) → `Alert.alert` with buttons "Also delete from Google" /
//     "Keep on Google" / "Cancel", mapping to `true` / `false` / no call (D45).
//   - Week mode: one `getRange(weekStart, weekEnd)` call (local keys, Sunday-first per
//     `getWeekDays`) plus Google events per day. `week-day-{YYYY-MM-DD}` sections hold
//     `week-item-{itemId}` / `week-google-{id}` rows in time order, read-only.
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
const mockedPlaceActivity = mockedScheduleAPI.placeActivity;
const mockedUpdateItem = mockedScheduleAPI.updateItem;
const mockedDeleteItem = mockedScheduleAPI.deleteItem;
const mockedTasksGetAll = taskAPI.getAll as jest.Mock;
const mockedGetEvents = calendarImportAPI.getEvents as jest.Mock;

type DaySchedule = { id: number; target_date: string; is_regimen: false; items: ScheduleItem[] };
let schedules: DaySchedule[] = [];
let alertSpy: jest.SpyInstance;

function gestureRegistry(): Record<string, { onEnd: (e: Record<string, unknown>) => void }> {
  return (require('react-native-gesture-handler') as any).__registry;
}

function localKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function at(base: Date, hour: number, minute = 0): string {
  const d = new Date(base);
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
    estimated_duration: 900,
    position: 0,
    scheduled_time: at(new Date(), 9),
    task: task({ id: overrides.task_id ?? 1 }),
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function daySchedule(id: number, date: Date, items: ScheduleItem[]): DaySchedule {
  return { id, target_date: localKey(date), is_regimen: false, items };
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

async function layoutBank() {
  await fireEvent(screen.getByTestId('bank-panel'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 600, width: 400, height: 200 } },
  });
}

function pressAlertButton(text: string) {
  const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as { text: string; onPress?: () => void }[];
  const button = buttons.find((b) => b.text === text);
  if (!button) throw new Error(`No "${text}" button in ${JSON.stringify(buttons.map((b) => b.text))}`);
  button.onPress?.();
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
  mockedDeleteItem.mockResolvedValue(undefined);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  for (const key of Object.keys(gestureRegistry())) delete gestureRegistry()[key];
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('Activity Bank', () => {
  it('lists every Activity, marks the ones with no history, and search narrows it', async () => {
    mockedTasksGetAll.mockResolvedValue([
      task({ id: 1, name: 'Reading', average_duration: 900, total_recordings: 4 }),
      task({ id: 2, name: 'Gym', average_duration: 0, total_recordings: 0 }),
    ]);
    // An Activity already placed today is still in the Bank.
    schedules = [daySchedule(50, new Date(), [item({ id: 9, task_id: 1, task: task({ id: 1, name: 'Reading' }) })])];
    await renderScreen();

    await screen.findByTestId('bank-item-1');
    await screen.findByTestId('item-block-9');
    expect(screen.getByTestId('bank-item-2')).toBeTruthy();
    expect(screen.getByTestId('bank-item-2-no-history')).toBeTruthy();
    expect(screen.queryByTestId('bank-item-1-no-history')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('bank-search'), 'GYM');
    expect(screen.getByTestId('bank-item-2')).toBeTruthy();
    expect(screen.queryByTestId('bank-item-1')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('bank-search'), '');
    expect(screen.getByTestId('bank-item-1')).toBeTruthy();
  });
});

describe('dropping a Bank Activity on the grid', () => {
  it('calls placeActivity with the local date and a snapped UTC Z time, no duration, and the Activity stays listed', async () => {
    const deepWork = task({ id: 7, name: 'Deep work', average_duration: 1800 });
    mockedTasksGetAll.mockResolvedValue([deepWork]);
    mockedPlaceActivity.mockImplementation((date: string, body: { task_id: number; scheduled_time: string }) => {
      const placed = item({ id: 70, schedule_id: 50, task_id: 7, task: deepWork, scheduled_time: body.scheduled_time, estimated_duration: 1800 });
      schedules = [{ id: 50, target_date: date, is_regimen: false, items: [placed] }];
      return Promise.resolve(placed);
    });
    await renderScreen();

    await screen.findByTestId('bank-item-7');
    await layoutBank();
    gestureRegistry()['bank-item-7'].onEnd({ absoluteY: 540 });

    await waitFor(() => expect(mockedPlaceActivity).toHaveBeenCalledTimes(1));
    const [date, body] = mockedPlaceActivity.mock.calls[0];
    expect(date).toBe(localKey(new Date()));
    expect(body.task_id).toBe(7);
    expect(body).not.toHaveProperty('estimated_duration');
    expect(body.scheduled_time).toMatch(/Z$/);

    const start = new Date(body.scheduled_time);
    expect(start.getUTCMinutes() % 15).toBe(0);
    expect(start.getUTCSeconds()).toBe(0);
    expect(localKey(start)).toBe(localKey(new Date()));

    await screen.findByTestId('item-block-70');
    expect(screen.getByTestId('bank-item-7')).toBeTruthy();
  });
});

describe('dropping a Block on the Bank', () => {
  it('deletes a non-Exported Item with deleteEvent false and no dialog', async () => {
    schedules = [daySchedule(50, new Date(), [item({ id: 8 })])];
    await renderScreen();

    await screen.findByTestId('item-block-8');
    await layoutBank();
    gestureRegistry()['item-block-8'].onEnd({ translationY: 0, absoluteY: 700 });

    await waitFor(() => expect(mockedDeleteItem).toHaveBeenCalledWith(50, 8, false));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockedUpdateItem).not.toHaveBeenCalled();
  });

  it.each([
    ['Also delete from Google', true],
    ['Keep on Google', false],
  ])('an Exported Item asks first; "%s" deletes with deleteEvent %s', async (choice, deleteEvent) => {
    schedules = [daySchedule(50, new Date(), [item({ id: 8, calendar_event_id: 'evt-8' })])];
    await renderScreen();

    await screen.findByTestId('item-block-8');
    await layoutBank();
    gestureRegistry()['item-block-8'].onEnd({ translationY: 0, absoluteY: 700 });

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    expect(mockedDeleteItem).not.toHaveBeenCalled();

    pressAlertButton(choice);

    await waitFor(() => expect(mockedDeleteItem).toHaveBeenCalledWith(50, 8, deleteEvent));
    expect(mockedDeleteItem).toHaveBeenCalledTimes(1);
    expect(mockedUpdateItem).not.toHaveBeenCalled();
  });

  it('an Exported Item: "Cancel" makes no call', async () => {
    schedules = [daySchedule(50, new Date(), [item({ id: 8, calendar_event_id: 'evt-8' })])];
    await renderScreen();

    await screen.findByTestId('item-block-8');
    await layoutBank();
    gestureRegistry()['item-block-8'].onEnd({ translationY: 0, absoluteY: 700 });

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    pressAlertButton('Cancel');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockedDeleteItem).not.toHaveBeenCalled();
    expect(mockedUpdateItem).not.toHaveBeenCalled();
    expect(screen.getByTestId('item-block-8')).toBeTruthy();
  });
});

describe('week mode', () => {
  it('fetches the week with one getRange call and merges Items and Google events per day in time order', async () => {
    const weekDays = getWeekDays(new Date());
    const dayKeys = weekDays.map(localKey);
    const targetDay = weekDays[2];
    const targetKey = dayKeys[2];

    const focus = item({ id: 21, schedule_id: 60, task_id: 3, task: task({ id: 3, name: 'Focus block' }), scheduled_time: at(targetDay, 9) });
    const googleEvent = { id: 'g5', summary: 'Standup', start: at(targetDay, 8), end: at(targetDay, 8, 15) };
    schedules = [daySchedule(60, targetDay, [focus])];
    mockedGetEvents.mockImplementation((date: string) =>
      Promise.resolve(date.slice(0, 10) === targetKey ? [googleEvent] : [])
    );

    await renderScreen();
    await fireEvent.press(screen.getByTestId('view-toggle-week'));

    await waitFor(() => expect(screen.getByTestId('week-google-g5')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('week-item-21')).toBeTruthy());

    const weekCalls = mockedGetRange.mock.calls.filter(([start, end]) => start !== end);
    expect(weekCalls).toEqual([[dayKeys[0], dayKeys[6]]]);

    const sections = screen.getAllByTestId(/^week-day-/);
    expect(sections.map((s) => s.props.testID)).toEqual(dayKeys.map((k) => `week-day-${k}`));

    const rows = within(screen.getByTestId(`week-day-${targetKey}`)).getAllByTestId(/^week-(item|google)-/);
    expect(rows.map((r) => r.props.testID)).toEqual(['week-google-g5', 'week-item-21']);
    expect(within(screen.getByTestId('week-item-21')).getByText(/Focus block/)).toBeTruthy();
  });

  it('has no drag targets, and tapping a day switches back to Day mode for that date', async () => {
    const weekDays = getWeekDays(new Date());
    const targetDay = weekDays[1];
    const targetKey = localKey(targetDay);
    schedules = [daySchedule(61, targetDay, [item({ id: 31, schedule_id: 61, scheduled_time: at(targetDay, 9) })])];
    await renderScreen();
    await fireEvent.press(screen.getByTestId('view-toggle-week'));

    await waitFor(() => expect(screen.getByTestId('week-item-31')).toBeTruthy());
    expect(Object.keys(gestureRegistry()).some((key) => key.startsWith('week-'))).toBe(false);

    await fireEvent.press(screen.getByTestId(`week-day-${targetKey}`));

    await waitFor(() => expect(screen.getByTestId('item-block-31')).toBeTruthy());
    expect(screen.queryByTestId(`week-day-${targetKey}`)).toBeNull();
  });
});
