import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CalendarDayScreen from '../app/(tabs)/calendar';
import ScheduleScreen from '../app/(tabs)/schedule';
import { sessionAPI, scheduleAPI, taskAPI, calendarImportAPI } from '../services/api';
import type { Schedule, StopwatchSession, StrategyOption, Task } from '../types';

// P17 contract: pushes to Google Calendar are explicit-only (D35) — nothing
// pushes as a side effect of dragging, resizing, or saving.
//
// Calendar tab (`src/app/(tabs)/calendar.tsx`): each `session-block-{id}`
// gains a `session-block-{id}-push` button calling the existing
// `sessionAPI.addToCalendar`. Once the item comes back `is_on_calendar`, the
// push button is replaced by `session-block-{id}-remove-calendar` (calling
// `sessionAPI.removeFromCalendar`) plus a `session-block-{id}-calendar-marker`
// — never a second push/create control.
//
// Schedule tab (`src/app/(tabs)/schedule.tsx`): the schedule just saved in
// Step 3 gets a `btn-push-schedule` button calling the new
// `scheduleAPI.pushToCalendar(id)` (P13's route); its response's items are
// used to render `text-events-pushed` (count of items carrying a
// `calendar_event_id`) and flip the control to `btn-remove-schedule-calendar`
// (`scheduleAPI.removeFromCalendar`). Each row in the Regimens list gets the
// identical push/remove pair keyed by id: `btn-push-{id}` / `btn-remove-calendar-{id}`.
// This requires adding `calendar_event_id?: string` to `ScheduleItem` in
// `types/index.ts` — P17.impl's job, not this file's.
//
// A 401 from either push path (Google not authorized) renders a shared
// `google-auth-error` banner reading "authorize from a laptop" (D14) instead
// of crashing.
jest.mock('../services/api', () => ({
  taskAPI: { getAll: jest.fn() },
  sessionAPI: {
    getScheduled: jest.fn(),
    getUnscheduled: jest.fn().mockResolvedValue([]),
    schedule: jest.fn(),
    unschedule: jest.fn(),
    addToCalendar: jest.fn(),
    removeFromCalendar: jest.fn(),
  },
  scheduleAPI: {
    getAll: jest.fn(),
    generate: jest.fn(),
    create: jest.fn(),
    addItem: jest.fn(),
    applyRegimen: jest.fn(),
    pushToCalendar: jest.fn(),
    removeFromCalendar: jest.fn(),
  },
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

const mockedGetScheduled = sessionAPI.getScheduled as jest.Mock;
const mockedSchedule = sessionAPI.schedule as jest.Mock;
const mockedAddToCalendar = sessionAPI.addToCalendar as jest.Mock;
const mockedRemoveSessionCalendar = sessionAPI.removeFromCalendar as jest.Mock;
const mockedGetEvents = calendarImportAPI.getEvents as jest.Mock;

const mockedTasksGetAll = taskAPI.getAll as jest.Mock;
const mockedSchedulesGetAll = scheduleAPI.getAll as jest.Mock;
const mockedGenerate = scheduleAPI.generate as jest.Mock;
const mockedCreate = scheduleAPI.create as jest.Mock;
const mockedAddItem = scheduleAPI.addItem as jest.Mock;
const mockedPushToCalendar = (scheduleAPI as unknown as { pushToCalendar: jest.Mock }).pushToCalendar;
const mockedRemoveScheduleCalendar = (scheduleAPI as unknown as { removeFromCalendar: jest.Mock }).removeFromCalendar;

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

function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

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

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  await waitFor(() => expect(mockedAddItem).toHaveBeenCalledTimes(1));
  await screen.findByTestId('btn-push-schedule');
}

beforeEach(() => {
  mockedGetScheduled.mockReset();
  mockedSchedule.mockReset();
  mockedAddToCalendar.mockReset();
  mockedRemoveSessionCalendar.mockReset();
  mockedGetEvents.mockReset();
  mockedTasksGetAll.mockReset();
  mockedSchedulesGetAll.mockReset();
  mockedGenerate.mockReset();
  mockedCreate.mockReset();
  mockedAddItem.mockReset();
  mockedPushToCalendar.mockReset();
  mockedRemoveScheduleCalendar.mockReset();

  mockedGetScheduled.mockResolvedValue([]);
  mockedGetEvents.mockResolvedValue([]);
  mockPickerValue = new Date('2026-02-01T09:00:00.000Z');
  for (const key of Object.keys(gestureRegistry())) delete gestureRegistry()[key];
});

describe('pushing a recording', () => {
  it('calls sessionAPI.addToCalendar and shows the marker, not a second push control', async () => {
    const item = session({ id: 5, scheduled_start: todayAt(9), duration: 900 });
    mockedGetScheduled
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([{ ...item, is_on_calendar: true }]);
    mockedAddToCalendar.mockResolvedValue({ ...item, is_on_calendar: true });
    await renderCalendar();

    await screen.findByTestId('session-block-5-push');
    await fireEvent.press(screen.getByTestId('session-block-5-push'));

    await waitFor(() => expect(mockedAddToCalendar).toHaveBeenCalledWith(5));
    await screen.findByTestId('session-block-5-calendar-marker');

    expect(screen.queryByTestId('session-block-5-push')).toBeNull();
    expect(screen.getByTestId('session-block-5-remove-calendar')).toBeTruthy();
  });
});

describe('pushing a schedule', () => {
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

describe('a second push is offered as remove', () => {
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

describe('google auth error', () => {
  it('renders an authorize-from-a-laptop message instead of crashing on a 401', async () => {
    const item = session({ id: 6, scheduled_start: todayAt(9), duration: 900 });
    mockedGetScheduled.mockResolvedValue([item]);
    mockedAddToCalendar.mockRejectedValue({ response: { status: 401 } });
    await renderCalendar();

    await screen.findByTestId('session-block-6-push');
    await fireEvent.press(screen.getByTestId('session-block-6-push'));

    await screen.findByTestId('google-auth-error');
    expect(screen.getByTestId('google-auth-error')).toHaveTextContent(/authorize from a laptop/i);
  });
});

describe('explicit pushes only', () => {
  it('dragging and resizing a scheduled block call no calendar route', async () => {
    const item = session({
      id: 8,
      scheduled_start: todayAt(9),
      scheduled_end: todayAt(9, 30),
      duration: 1800,
    });
    mockedGetScheduled.mockResolvedValue([item]);
    mockedSchedule.mockResolvedValue({ ...item });
    await renderCalendar();

    await screen.findByTestId('session-block-8');
    gestureRegistry()['session-block-8'].onEnd({ translationY: 5000 });
    await waitFor(() => expect(mockedSchedule).toHaveBeenCalledTimes(1));

    gestureRegistry()['session-block-8-resize-handle'].onEnd({ translationY: 5000 });
    await waitFor(() => expect(mockedSchedule).toHaveBeenCalledTimes(2));

    expect(mockedAddToCalendar).not.toHaveBeenCalled();
    expect(mockedRemoveSessionCalendar).not.toHaveBeenCalled();
  });

  it('saving a schedule calls no calendar route until the push button is pressed', async () => {
    await saveAScheduleAndReachSavedCard();

    expect(mockedPushToCalendar).not.toHaveBeenCalled();
    expect(mockedRemoveScheduleCalendar).not.toHaveBeenCalled();
  });
});
