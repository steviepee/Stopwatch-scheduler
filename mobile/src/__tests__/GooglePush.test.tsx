import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import CalendarDayScreen from '../app/(tabs)/calendar';
import ScheduleScreen from '../app/(tabs)/schedule';
import { calendarImportAPI, scheduleAPI, taskAPI } from '../services/api';
import type { Schedule, ScheduleItem, StrategyOption, Task } from '../types';

// B7 contract (Build 2a, D42/D43/D45): Block actions, edit mode, Push day / Remove day,
// and visible feedback on the Calendar tab (`src/app/(tabs)/calendar.tsx`).
//
// Block actions. Tapping a Block (a press anywhere on its label) selects it and shows:
//   - `btn-edit-block-{itemId}` — "Edit block", toggles edit mode on that Block. It stays
//     reachable while edit mode is on; pressing it again ends edit mode.
//   - `btn-remove-google-{itemId}` — "Remove from Google", ONLY on an Exported Block
//     (`calendar_event_id` set). It opens `Alert.alert(title, message, buttons)` first; the
//     non-"Cancel" button calls `scheduleAPI.removeItemFromCalendar(scheduleId, itemId)`,
//     "Cancel" calls nothing.
//
// Edit mode. A bottom-edge handle `item-block-{itemId}-resize-handle` exists ONLY in edit
// mode, wrapped in its own `GestureDetector` (so the registry mock below can reach it).
// Its `onEnd({ translationY })` calls `scheduleAPI.updateItem(scheduleId, itemId,
// { estimated_duration })` — that key only — snapped to 5 minutes (a multiple of 300 s),
// minimum 300. While edit mode is on, the Block's move gesture does nothing (it may be
// disabled, detached, or ignore its onEnd).
//
// Day header (day view), only for a day with Items:
//   - `btn-push-day` — `scheduleAPI.pushToCalendar(scheduleId)`. Hidden when every Item is
//     already Exported (and when there are no Items).
//   - `btn-remove-day` — opens ONE `Alert.alert` with buttons exactly "Clear all" →
//     `clearDay(scheduleId, true)`, "Remove from Google only" → `removeFromCalendar(scheduleId)`,
//     "Cancel" → nothing.
//
// Feedback (every push, remove and clear, per-Block "Remove from Google" included):
//   - `day-action-working` while the request is in flight;
//   - `day-action-success` on success; for a push its text includes the number of events
//     (Items in the response carrying a `calendar_event_id`);
//   - `day-action-error` on failure. A 401 shows text matching /authorize from a laptop/i
//     (D14) — in `day-action-error` or the existing `google-auth-error` banner.
//
// No gesture (move, resize, drop) ever calls `pushToCalendar`: an Item reaches Google
// only through Push day (D35). Gesture-driven Google changes are server-side (B3) and
// only for Items already Exported.
//
// B17 contract (D43 revised 2026-10-03): edits to Exported Blocks wait for Push.
//   - `ScheduleItem.calendar_stale` (server-set). A Block whose Item is stale shows
//     `item-block-{itemId}-changed`; a pushed, unchanged Block does not.
//   - `btn-push-day` shows when any Item has no `calendar_event_id` OR is stale. Its label is
//     "Push day" if any Item is new, else "Push changes". Either way it calls
//     `pushToCalendar(scheduleId)` once.
//   - Push success counts new and updated events separately: the number of Items that had no
//     event id before the push, and the number that were stale.
//   - Moving or resizing an Exported Block calls only `updateItem` (no Google route), then the
//     range query refetches so the marker appears.
//
// The Schedule-tab push tests at the bottom are P17's and unchanged; B8 owns that tab.
jest.mock('../services/api', () => ({
  taskAPI: { getAll: jest.fn() },
  scheduleAPI: {
    getAll: jest.fn(),
    getRange: jest.fn(),
    generate: jest.fn(),
    create: jest.fn(),
    addItem: jest.fn(),
    applyRegimen: jest.fn(),
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
      onStart: () => gesture,
      onUpdate: () => gesture,
      onFinalize: () => gesture,
      minDistance: () => gesture,
      activeOffsetY: () => gesture,
      activeOffsetX: () => gesture,
      activateAfterLongPress: () => gesture,
      enabled: () => gesture,
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

let mockPickerValue = new Date('2026-02-01T09:00:00.000Z');
jest.mock('@react-native-community/datetimepicker', () => {
  const RN = require('react-native');
  const ReactLib = require('react');
  return {
    __esModule: true,
    default: ({ testID, onChange }: { testID: string; onChange: (e: unknown, d: Date) => void }) =>
      ReactLib.createElement(RN.Pressable, {
        testID,
        accessibilityRole: 'button',
        onPress: () => onChange({ type: 'set' }, mockPickerValue),
      }),
  };
});

const mockedScheduleAPI = scheduleAPI as unknown as Record<string, jest.Mock>;
const mockedTasksGetAll = taskAPI.getAll as jest.Mock;
const mockedGetEvents = calendarImportAPI.getEvents as jest.Mock;
const mockedSchedulesGetAll = mockedScheduleAPI.getAll;
const mockedGetRange = mockedScheduleAPI.getRange;
const mockedGenerate = mockedScheduleAPI.generate;
const mockedCreate = mockedScheduleAPI.create;
const mockedAddItem = mockedScheduleAPI.addItem;
const mockedPlaceActivity = mockedScheduleAPI.placeActivity;
const mockedUpdateItem = mockedScheduleAPI.updateItem;
const mockedDeleteItem = mockedScheduleAPI.deleteItem;
const mockedRemoveItemFromCalendar = mockedScheduleAPI.removeItemFromCalendar;
const mockedClearDay = mockedScheduleAPI.clearDay;
const mockedPushToCalendar = mockedScheduleAPI.pushToCalendar;
const mockedRemoveScheduleCalendar = mockedScheduleAPI.removeFromCalendar;

let alertSpy: jest.SpyInstance;

const GYM: Task = {
  id: 7,
  name: 'Gym',
  average_duration: 1800,
  total_recordings: 3,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function option(overrides: Partial<StrategyOption>): StrategyOption {
  return {
    strategy: 'your-order',
    label: 'Your Order',
    description: 'Keeps the order you picked',
    timeline: [],
    flagged: [],
    excluded: [],
    ...overrides,
  };
}

const REGIMEN: Schedule = {
  id: 99,
  name: 'Morning Routine',
  schedule_type: 'day',
  is_regimen: true,
  items: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

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

function item(overrides: Partial<ScheduleItem>): ScheduleItem {
  const id = overrides.id ?? 1;
  return {
    id,
    schedule_id: 50,
    task_id: id,
    estimated_duration: 1800,
    position: 0,
    scheduled_time: todayAt(9),
    task: { ...GYM, id, name: `Activity ${id}` },
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// `calendar_stale` is added to `ScheduleItem` by B17.impl; the cast keeps tsc clean until then.
function staleItem(overrides: Partial<ScheduleItem>): ScheduleItem {
  return { ...item(overrides), calendar_stale: true } as ScheduleItem;
}

function freshItem(overrides: Partial<ScheduleItem>): ScheduleItem {
  return { ...item(overrides), calendar_stale: false } as ScheduleItem;
}

function today(items: ScheduleItem[]): DaySchedule {
  return { id: 50, target_date: localKey(new Date()), is_regimen: false, items };
}

function httpError(status: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function lastAlertButtons(): { text: string; style?: string; onPress?: () => void }[] {
  return alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2];
}

function pressAlertButton(text: string) {
  const button = lastAlertButtons().find((b) => b.text === text);
  if (!button) throw new Error(`No "${text}" button in ${JSON.stringify(lastAlertButtons().map((b) => b.text))}`);
  button.onPress?.();
}

function pressAlertConfirm() {
  const button = lastAlertButtons().find((b) => b.text !== 'Cancel');
  if (!button) throw new Error('No confirm button');
  button.onPress?.();
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

async function renderCalendar() {
  return render(
    <QueryClientProvider client={client()}>
      <CalendarDayScreen />
    </QueryClientProvider>
  );
}

async function renderSchedule() {
  return render(
    <QueryClientProvider client={client()}>
      <ScheduleScreen />
    </QueryClientProvider>
  );
}

async function layoutBank() {
  await fireEvent(screen.getByTestId('bank-panel'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 600, width: 400, height: 200 } },
  });
}

async function tapBlock(id: number) {
  const block = await screen.findByTestId(`item-block-${id}`);
  await fireEvent.press(within(block).getByText(`Activity ${id}`));
}

async function pressEditBlock(id: number) {
  if (!screen.queryByTestId(`btn-edit-block-${id}`)) await tapBlock(id);
  await fireEvent.press(await screen.findByTestId(`btn-edit-block-${id}`));
}

async function wait(ms = 50) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
  mockedUpdateItem.mockResolvedValue({});
  mockedDeleteItem.mockResolvedValue(undefined);
  mockedRemoveItemFromCalendar.mockResolvedValue({});
  mockedClearDay.mockResolvedValue(undefined);
  mockedRemoveScheduleCalendar.mockResolvedValue(undefined);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  for (const key of Object.keys(gestureRegistry())) delete gestureRegistry()[key];

  mockPickerValue = new Date('2026-02-01T09:00:00.000Z');
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('Block actions', () => {
  it('tapping a plain Block shows Edit block but no Remove from Google', async () => {
    schedules = [today([item({ id: 9 })])];
    await renderCalendar();

    await tapBlock(9);

    await screen.findByTestId('btn-edit-block-9');
    expect(screen.queryByTestId('btn-remove-google-9')).toBeNull();
  });

  it('Remove from Google on an Exported Block confirms first, then calls removeItemFromCalendar', async () => {
    schedules = [today([item({ id: 8, calendar_event_id: 'evt-8' })])];
    await renderCalendar();

    await tapBlock(8);
    await fireEvent.press(await screen.findByTestId('btn-remove-google-8'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    expect(mockedRemoveItemFromCalendar).not.toHaveBeenCalled();

    pressAlertConfirm();

    await waitFor(() => expect(mockedRemoveItemFromCalendar).toHaveBeenCalledWith(50, 8));
    expect(mockedRemoveItemFromCalendar).toHaveBeenCalledTimes(1);
    expect(mockedDeleteItem).not.toHaveBeenCalled();
    await screen.findByTestId('day-action-success');
  });

  it('Remove from Google: Cancel makes no call', async () => {
    schedules = [today([item({ id: 8, calendar_event_id: 'evt-8' })])];
    await renderCalendar();

    await tapBlock(8);
    await fireEvent.press(await screen.findByTestId('btn-remove-google-8'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));

    pressAlertButton('Cancel');

    await wait();
    expect(mockedRemoveItemFromCalendar).not.toHaveBeenCalled();
    expect(mockedDeleteItem).not.toHaveBeenCalled();
  });
});

describe('edit mode on', () => {
  it('shows the handle, ignores the move gesture, and resizes with a 5-minute-snapped duration', async () => {
    schedules = [today([item({ id: 5, estimated_duration: 1800 })])];
    await renderCalendar();

    await screen.findByTestId('item-block-5');
    await layoutBank();
    expect(screen.queryByTestId('item-block-5-resize-handle')).toBeNull();

    delete gestureRegistry()['item-block-5'];
    await pressEditBlock(5);

    await screen.findByTestId('item-block-5-resize-handle');

    gestureRegistry()['item-block-5']?.onEnd({ translationY: 100, absoluteY: 300 });
    await wait();
    expect(mockedUpdateItem).not.toHaveBeenCalled();
    expect(mockedDeleteItem).not.toHaveBeenCalled();

    gestureRegistry()['item-block-5-resize-handle'].onEnd({ translationY: 37 });

    await waitFor(() => expect(mockedUpdateItem).toHaveBeenCalledTimes(1));
    const [scheduleId, itemId, body] = mockedUpdateItem.mock.calls[0];
    expect(scheduleId).toBe(50);
    expect(itemId).toBe(5);
    expect(Object.keys(body)).toEqual(['estimated_duration']);
    expect(body.estimated_duration % 300).toBe(0);
    expect(body.estimated_duration).toBeGreaterThan(1800);
  });

  it('never resizes below 5 minutes', async () => {
    schedules = [today([item({ id: 5, estimated_duration: 900 })])];
    await renderCalendar();

    await pressEditBlock(5);
    await screen.findByTestId('item-block-5-resize-handle');
    gestureRegistry()['item-block-5-resize-handle'].onEnd({ translationY: -100000 });

    await waitFor(() => expect(mockedUpdateItem).toHaveBeenCalledTimes(1));
    expect(mockedUpdateItem.mock.calls[0][2]).toEqual({ estimated_duration: 300 });
  });
});

describe('edit mode off', () => {
  it('pressing Edit block again removes the handle and the Block moves again', async () => {
    schedules = [today([item({ id: 5, estimated_duration: 1800 })])];
    await renderCalendar();

    await screen.findByTestId('item-block-5');
    await layoutBank();
    await pressEditBlock(5);
    await screen.findByTestId('item-block-5-resize-handle');

    await pressEditBlock(5);

    await waitFor(() => expect(screen.queryByTestId('item-block-5-resize-handle')).toBeNull());
    gestureRegistry()['item-block-5'].onEnd({ translationY: 100, absoluteY: 300 });

    await waitFor(() => expect(mockedUpdateItem).toHaveBeenCalledTimes(1));
    expect(Object.keys(mockedUpdateItem.mock.calls[0][2])).toEqual(['scheduled_time']);
  });
});

describe('Remove day', () => {
  it('is absent on a day with no Items, and so is Push day', async () => {
    await renderCalendar();

    await screen.findByTestId('day-label');
    await wait();
    expect(screen.queryByTestId('btn-remove-day')).toBeNull();
    expect(screen.queryByTestId('btn-push-day')).toBeNull();
  });

  it('opens one dialog offering exactly Clear all, Remove from Google only, and Cancel', async () => {
    schedules = [today([item({ id: 1, calendar_event_id: 'evt-1' })])];
    await renderCalendar();

    await fireEvent.press(await screen.findByTestId('btn-remove-day'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    expect(lastAlertButtons().map((b) => b.text).sort()).toEqual(['Cancel', 'Clear all', 'Remove from Google only']);
  });

  it('Clear all calls clearDay(id, true) and nothing else', async () => {
    schedules = [today([item({ id: 1, calendar_event_id: 'evt-1' }), item({ id: 2 })])];
    await renderCalendar();

    await fireEvent.press(await screen.findByTestId('btn-remove-day'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    pressAlertButton('Clear all');

    await waitFor(() => expect(mockedClearDay).toHaveBeenCalledWith(50, true));
    expect(mockedClearDay).toHaveBeenCalledTimes(1);
    expect(mockedRemoveScheduleCalendar).not.toHaveBeenCalled();
    expect(mockedDeleteItem).not.toHaveBeenCalled();
    await screen.findByTestId('day-action-success');
  });

  it('Remove from Google only calls removeFromCalendar(id) and nothing else', async () => {
    schedules = [today([item({ id: 1, calendar_event_id: 'evt-1' })])];
    await renderCalendar();

    await fireEvent.press(await screen.findByTestId('btn-remove-day'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    pressAlertButton('Remove from Google only');

    await waitFor(() => expect(mockedRemoveScheduleCalendar).toHaveBeenCalledWith(50));
    expect(mockedRemoveScheduleCalendar).toHaveBeenCalledTimes(1);
    expect(mockedClearDay).not.toHaveBeenCalled();
    expect(mockedDeleteItem).not.toHaveBeenCalled();
    await screen.findByTestId('day-action-success');
  });

  it('Cancel makes no call', async () => {
    schedules = [today([item({ id: 1, calendar_event_id: 'evt-1' })])];
    await renderCalendar();

    await fireEvent.press(await screen.findByTestId('btn-remove-day'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    pressAlertButton('Cancel');

    await wait();
    expect(mockedClearDay).not.toHaveBeenCalled();
    expect(mockedRemoveScheduleCalendar).not.toHaveBeenCalled();
    expect(mockedDeleteItem).not.toHaveBeenCalled();
  });

  it('a failed Clear all is shown, not silent', async () => {
    schedules = [today([item({ id: 1, calendar_event_id: 'evt-1' })])];
    mockedClearDay.mockRejectedValue(httpError(500));
    await renderCalendar();

    await fireEvent.press(await screen.findByTestId('btn-remove-day'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    pressAlertButton('Clear all');

    await screen.findByTestId('day-action-error');
  });

  it('a 401 on Remove from Google only shows the laptop message', async () => {
    schedules = [today([item({ id: 1, calendar_event_id: 'evt-1' })])];
    mockedRemoveScheduleCalendar.mockRejectedValue(httpError(401));
    await renderCalendar();

    await fireEvent.press(await screen.findByTestId('btn-remove-day'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    pressAlertButton('Remove from Google only');

    await screen.findByText(/authorize from a laptop/i);
  });
});

describe('Push day', () => {
  it('is hidden when every Item is already Exported', async () => {
    schedules = [today([item({ id: 1, calendar_event_id: 'evt-1' }), item({ id: 2, calendar_event_id: 'evt-2' })])];
    await renderCalendar();

    await screen.findByTestId('btn-remove-day');
    expect(screen.queryByTestId('btn-push-day')).toBeNull();
  });

  it('shows a working state, then success with the event count', async () => {
    schedules = [today([item({ id: 1 }), item({ id: 2, scheduled_time: todayAt(11) })])];
    const pending = deferred<unknown>();
    mockedPushToCalendar.mockReturnValue(pending.promise);
    await renderCalendar();

    await fireEvent.press(await screen.findByTestId('btn-push-day'));

    await waitFor(() => expect(mockedPushToCalendar).toHaveBeenCalledWith(50));
    await screen.findByTestId('day-action-working');

    pending.resolve({
      ...today([
        item({ id: 1, calendar_event_id: 'evt-1' }),
        item({ id: 2, scheduled_time: todayAt(11), calendar_event_id: 'evt-2' }),
      ]),
    });

    await screen.findByTestId('day-action-success');
    expect(screen.getByTestId('day-action-success')).toHaveTextContent(/2/);
    expect(screen.queryByTestId('day-action-working')).toBeNull();
    expect(mockedPushToCalendar).toHaveBeenCalledTimes(1);
  });

  it('a 500 shows an error', async () => {
    schedules = [today([item({ id: 1 })])];
    mockedPushToCalendar.mockRejectedValue(httpError(500));
    await renderCalendar();

    await fireEvent.press(await screen.findByTestId('btn-push-day'));

    await screen.findByTestId('day-action-error');
    expect(screen.queryByTestId('day-action-success')).toBeNull();
    expect(screen.queryByText(/authorize from a laptop/i)).toBeNull();
  });

  it('a 401 shows the laptop message', async () => {
    schedules = [today([item({ id: 1 })])];
    mockedPushToCalendar.mockRejectedValue(httpError(401));
    await renderCalendar();

    await fireEvent.press(await screen.findByTestId('btn-push-day'));

    await screen.findByText(/authorize from a laptop/i);
    expect(screen.queryByTestId('day-action-success')).toBeNull();
  });
});

describe('B17: changed marker', () => {
  it('a stale Block shows the marker; a fresh pushed Block and a new Block do not', async () => {
    schedules = [
      today([
        staleItem({ id: 1, calendar_event_id: 'evt-1' }),
        freshItem({ id: 2, calendar_event_id: 'evt-2', scheduled_time: todayAt(11) }),
        item({ id: 3, scheduled_time: todayAt(13) }),
      ]),
    ];
    await renderCalendar();

    const staleBlock = await screen.findByTestId('item-block-1');
    expect(within(staleBlock).getByTestId('item-block-1-changed')).toBeTruthy();
    await screen.findByTestId('item-block-2');
    expect(screen.queryByTestId('item-block-2-changed')).toBeNull();
    expect(screen.queryByTestId('item-block-3-changed')).toBeNull();
  });
});

describe('B17: push button', () => {
  it('is absent when every Item is pushed and none is stale', async () => {
    schedules = [
      today([
        freshItem({ id: 1, calendar_event_id: 'evt-1' }),
        freshItem({ id: 2, calendar_event_id: 'evt-2', scheduled_time: todayAt(11) }),
      ]),
    ];
    await renderCalendar();

    await screen.findByTestId('btn-remove-day');
    expect(screen.queryByTestId('btn-push-day')).toBeNull();
  });

  it('reads "Push changes" when only stale Items need pushing, and calls pushToCalendar once', async () => {
    schedules = [
      today([
        staleItem({ id: 1, calendar_event_id: 'evt-1' }),
        freshItem({ id: 2, calendar_event_id: 'evt-2', scheduled_time: todayAt(11) }),
        freshItem({ id: 3, calendar_event_id: 'evt-3', scheduled_time: todayAt(13) }),
      ]),
    ];
    mockedPushToCalendar.mockResolvedValue(
      today([
        freshItem({ id: 1, calendar_event_id: 'evt-1' }),
        freshItem({ id: 2, calendar_event_id: 'evt-2', scheduled_time: todayAt(11) }),
        freshItem({ id: 3, calendar_event_id: 'evt-3', scheduled_time: todayAt(13) }),
      ])
    );
    await renderCalendar();

    const button = await screen.findByTestId('btn-push-day');
    expect(button).toHaveTextContent(/push changes/i);
    expect(button).not.toHaveTextContent(/push day/i);

    await fireEvent.press(button);

    await waitFor(() => expect(mockedPushToCalendar).toHaveBeenCalledWith(50));
    expect(mockedPushToCalendar).toHaveBeenCalledTimes(1);
    const success = await screen.findByTestId('day-action-success');
    expect(success).toHaveTextContent(/1/);
    expect(success).not.toHaveTextContent(/3/);
  });

  it('reads "Push day" when any Item is new, even with stale Items, and calls pushToCalendar once', async () => {
    schedules = [
      today([
        staleItem({ id: 1, calendar_event_id: 'evt-1' }),
        item({ id: 2, scheduled_time: todayAt(11) }),
        item({ id: 3, scheduled_time: todayAt(13) }),
        freshItem({ id: 4, calendar_event_id: 'evt-4', scheduled_time: todayAt(15) }),
      ]),
    ];
    mockedPushToCalendar.mockResolvedValue(
      today([
        freshItem({ id: 1, calendar_event_id: 'evt-1' }),
        freshItem({ id: 2, calendar_event_id: 'evt-2', scheduled_time: todayAt(11) }),
        freshItem({ id: 3, calendar_event_id: 'evt-3', scheduled_time: todayAt(13) }),
        freshItem({ id: 4, calendar_event_id: 'evt-4', scheduled_time: todayAt(15) }),
      ])
    );
    await renderCalendar();

    const button = await screen.findByTestId('btn-push-day');
    expect(button).toHaveTextContent(/push day/i);
    expect(button).not.toHaveTextContent(/push changes/i);

    await fireEvent.press(button);

    await waitFor(() => expect(mockedPushToCalendar).toHaveBeenCalledWith(50));
    expect(mockedPushToCalendar).toHaveBeenCalledTimes(1);
    const success = await screen.findByTestId('day-action-success');
    expect(success).toHaveTextContent(/2/);
    expect(success).toHaveTextContent(/1/);
    expect(success).not.toHaveTextContent(/4/);
  });
});

describe('B17: edits to Exported Blocks wait for Push', () => {
  it('moving an Exported Block calls updateItem only, then the marker appears after the refetch', async () => {
    schedules = [today([freshItem({ id: 5, calendar_event_id: 'evt-5' })])];
    mockedUpdateItem.mockImplementation((_scheduleId: number, itemId: number, body: Partial<ScheduleItem>) => {
      schedules = [today([staleItem({ id: itemId, calendar_event_id: 'evt-5', ...body })])];
      return Promise.resolve(schedules[0].items[0]);
    });
    await renderCalendar();

    await screen.findByTestId('item-block-5');
    await layoutBank();
    expect(screen.queryByTestId('item-block-5-changed')).toBeNull();
    const rangeCallsBefore = mockedGetRange.mock.calls.length;

    gestureRegistry()['item-block-5'].onEnd({ translationY: 90, absoluteY: 300 });

    await waitFor(() => expect(mockedUpdateItem).toHaveBeenCalledTimes(1));
    expect(Object.keys(mockedUpdateItem.mock.calls[0][2])).toEqual(['scheduled_time']);
    await screen.findByTestId('item-block-5-changed');
    expect(mockedGetRange.mock.calls.length).toBeGreaterThan(rangeCallsBefore);

    expect(mockedPushToCalendar).not.toHaveBeenCalled();
    expect(mockedRemoveItemFromCalendar).not.toHaveBeenCalled();
    expect(mockedRemoveScheduleCalendar).not.toHaveBeenCalled();
    expect(mockedClearDay).not.toHaveBeenCalled();
    expect(mockedDeleteItem).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('resizing an Exported Block calls updateItem only, then the marker appears', async () => {
    schedules = [today([freshItem({ id: 5, calendar_event_id: 'evt-5', estimated_duration: 1800 })])];
    mockedUpdateItem.mockImplementation((_scheduleId: number, itemId: number, body: Partial<ScheduleItem>) => {
      schedules = [today([staleItem({ id: itemId, calendar_event_id: 'evt-5', ...body })])];
      return Promise.resolve(schedules[0].items[0]);
    });
    await renderCalendar();

    await pressEditBlock(5);
    await screen.findByTestId('item-block-5-resize-handle');
    gestureRegistry()['item-block-5-resize-handle'].onEnd({ translationY: 45 });

    await waitFor(() => expect(mockedUpdateItem).toHaveBeenCalledTimes(1));
    expect(Object.keys(mockedUpdateItem.mock.calls[0][2])).toEqual(['estimated_duration']);
    await screen.findByTestId('item-block-5-changed');

    expect(mockedPushToCalendar).not.toHaveBeenCalled();
    expect(mockedRemoveItemFromCalendar).not.toHaveBeenCalled();
    expect(mockedRemoveScheduleCalendar).not.toHaveBeenCalled();
    expect(mockedClearDay).not.toHaveBeenCalled();
    expect(mockedDeleteItem).not.toHaveBeenCalled();
  });
});

describe('no gesture pushes', () => {
  it('moving, resizing, placing and dropping on the Bank never push a non-Exported Item', async () => {
    mockedTasksGetAll.mockResolvedValue([GYM]);
    mockedPlaceActivity.mockResolvedValue(item({ id: 70 }));
    schedules = [today([item({ id: 5 }), item({ id: 6, scheduled_time: todayAt(13) })])];
    await renderCalendar();

    await screen.findByTestId('item-block-5');
    await screen.findByTestId('bank-item-7');
    await layoutBank();

    gestureRegistry()['item-block-5'].onEnd({ translationY: 100, absoluteY: 300 });
    await waitFor(() => expect(mockedUpdateItem).toHaveBeenCalledTimes(1));

    gestureRegistry()['bank-item-7'].onEnd({ absoluteY: 540 });
    await waitFor(() => expect(mockedPlaceActivity).toHaveBeenCalledTimes(1));

    await pressEditBlock(6);
    await screen.findByTestId('item-block-6-resize-handle');
    gestureRegistry()['item-block-6-resize-handle'].onEnd({ translationY: 60 });
    await waitFor(() => expect(mockedUpdateItem).toHaveBeenCalledTimes(2));
    await pressEditBlock(6);
    await waitFor(() => expect(screen.queryByTestId('item-block-6-resize-handle')).toBeNull());

    gestureRegistry()['item-block-6'].onEnd({ translationY: 0, absoluteY: 700 });
    await waitFor(() => expect(mockedDeleteItem).toHaveBeenCalledWith(50, 6, false));

    await wait();
    expect(mockedPushToCalendar).not.toHaveBeenCalled();
    expect(mockedRemoveItemFromCalendar).not.toHaveBeenCalled();
    expect(mockedRemoveScheduleCalendar).not.toHaveBeenCalled();
    expect(mockedClearDay).not.toHaveBeenCalled();
  });
});

// Schedule tab (P17, unchanged): the schedule just saved in Step 3 gets `btn-push-schedule`
// → `scheduleAPI.pushToCalendar(id)`, reporting `text-events-pushed`; each Regimens row gets
// `btn-push-{id}` / `btn-remove-calendar-{id}`.
async function saveAScheduleAndReachSavedCard() {
  mockedTasksGetAll.mockResolvedValue([GYM]);
  mockedSchedulesGetAll.mockResolvedValue([]);
  const timeline = [{ task_id: 7, name: 'Gym', start: '2026-02-03T08:00:00.000Z', end: '2026-02-03T08:30:00.000Z' }];
  mockedGenerate.mockResolvedValue({ options: [option({ strategy: 'your-order', timeline })] });
  mockedCreate.mockResolvedValue({ ...REGIMEN, id: 55, name: 'My Day', is_regimen: false, items: [] });
  mockedAddItem.mockResolvedValue({});

  await renderSchedule();
  await screen.findByTestId('activity-row-7');
  await fireEvent.press(screen.getByTestId('activity-row-7'));
  await fireEvent.press(screen.getByTestId('btn-generate'));
  await screen.findByTestId('option-card-your-order');
  await fireEvent.press(screen.getByTestId('btn-select-your-order'));
  await fireEvent.press(screen.getByTestId('btn-save'));
  await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
  await screen.findByTestId('btn-push-schedule');
}

describe('Schedule tab: pushing a schedule', () => {
  it('calls the schedules calendar route once and reports the events pushed', async () => {
    await saveAScheduleAndReachSavedCard();
    mockedPushToCalendar.mockResolvedValue({
      id: 55,
      items: [
        { id: 1, calendar_event_id: 'evt1' },
        { id: 2, calendar_event_id: 'evt2' },
      ],
    });

    await fireEvent.press(screen.getByTestId('btn-push-schedule'));

    await waitFor(() => expect(mockedPushToCalendar).toHaveBeenCalledTimes(1));
    expect(mockedPushToCalendar).toHaveBeenCalledWith(55);
    await screen.findByTestId('text-events-pushed');
    expect(screen.getByTestId('text-events-pushed')).toHaveTextContent('2');
  });
});

describe('Schedule tab: a second push is offered as remove', () => {
  it('flips a pushed regimen row to remove instead of another push', async () => {
    mockedGenerate.mockResolvedValue({ options: [] });
    mockedSchedulesGetAll
      .mockResolvedValueOnce([REGIMEN])
      .mockResolvedValueOnce([{ ...REGIMEN, items: [{ id: 1, calendar_event_id: 'evt1' }] as any }]);
    mockedPushToCalendar.mockResolvedValue({
      ...REGIMEN,
      items: [{ id: 1, calendar_event_id: 'evt1' }],
    });
    await renderSchedule();

    await screen.findByTestId('btn-push-99');
    await fireEvent.press(screen.getByTestId('btn-push-99'));

    await waitFor(() => expect(mockedPushToCalendar).toHaveBeenCalledTimes(1));
    await screen.findByTestId('btn-remove-calendar-99');
    expect(screen.queryByTestId('btn-push-99')).toBeNull();

    await fireEvent.press(screen.getByTestId('btn-remove-calendar-99'));

    await waitFor(() => expect(mockedRemoveScheduleCalendar).toHaveBeenCalledWith(99));
    expect(mockedPushToCalendar).toHaveBeenCalledTimes(1);
  });
});

describe('Schedule tab: explicit pushes only', () => {
  it('saving a schedule calls no calendar route until the push button is pressed', async () => {
    await saveAScheduleAndReachSavedCard();

    expect(mockedPushToCalendar).not.toHaveBeenCalled();
    expect(mockedRemoveScheduleCalendar).not.toHaveBeenCalled();
  });
});
