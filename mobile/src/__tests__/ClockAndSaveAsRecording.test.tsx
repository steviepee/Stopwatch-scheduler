import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import CalendarDayScreen from '../app/(tabs)/calendar';
import ScheduleScreen from '../app/(tabs)/schedule';
import RecordingsScreen from '../app/(tabs)/recordings';
import SettingsScreen from '../app/settings';
import type { ScheduleItem, Task } from '../types';

// B69 (D128, D132). `formatClock` itself is pinned in formatClock.test.ts.
//
// Clock (D128):
//   - `settingsAPI.getDisplay()` (GET /settings/display -> { clock_24h }) and
//     `settingsAPI.updateDisplay({ clock_24h })` (PUT /settings/display).
//   - A hook reads `clock_24h` through TanStack Query and every time of day goes through
//     `formatClock`. Until the setting loads, or if it fails, the clock is 12-hour.
//     The other screen test files mock `../services/api` WITHOUT `settingsAPI`, so the hook
//     must call `settingsAPI.getDisplay()` inside its queryFn (a missing mock then becomes a
//     query error, i.e. 12-hour), never dereference it at render.
//   - What this file pins, with the setting on:
//       calendar day view: the hour gutter reads `17:00` (no `5 PM`);
//       calendar week agenda: `week-item-{id}` shows `17:30`;
//       Schedule: `picker-start-time-open` and `picker-day-end-open` labels in 24-hour;
//       Recordings: `manual-start-time-open` label in 24-hour.
//     And with it off (or not loaded yet), the same places in `formatClock` 12-hour form.
//   - Settings: Switch `toggle-clock-24h` ("Use 24-hour clock"), value = `clock_24h`; toggling
//     calls `updateDisplay({ clock_24h })` and the switch then shows the server's answer.
//
// Save as Recording (D132):
//   - Selecting a Block in the day view (pressing it, as for Edit block) shows
//     `btn-save-recording-{itemId}` ("Save as Recording") in the selected Block's action row.
//   - Pressing it opens the existing `ManualForm` from recordings.tsx (`manual-form`, same
//     testIDs), taking initial values: `manual-name` = the Activity's name, the Activity
//     chosen, `manual-hours` / `manual-minutes` = the Block's `estimated_duration` split into
//     whole hours and minutes, start = the Block's `scheduled_time`.
//   - Everything stays editable. Editing the duration does NOT move the start (the start is
//     fixed to the Block's, as if the user had picked it).
//   - Save calls `sessionAPI.create` (the hand-entered path) with `name`, `duration`,
//     `start_time`, `end_time` = start + duration, and `task_id`. On success the form closes.
//     Cancel closes it with nothing posted.

jest.mock('../services/auth', () => ({
  getApiUrl: jest.fn(async () => 'http://192.168.0.5:8000/api'),
  setApiUrl: jest.fn(),
  getToken: jest.fn(async () => 'stored-token'),
  setToken: jest.fn(),
}));

jest.mock('axios', () => {
  const instance = {
    interceptors: { request: { use: jest.fn() } },
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    defaults: {},
  };
  return { __esModule: true, default: { get: jest.fn(), create: () => instance } };
});

jest.mock('../services/api', () => ({
  ...jest.requireActual('../services/api'),
  taskAPI: { getAll: jest.fn() },
  sessionAPI: { getAll: jest.fn(), create: jest.fn(), delete: jest.fn(), update: jest.fn() },
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
  insightsAPI: { getPeakHours: jest.fn() },
  settingsAPI: {
    getPomodoro: jest.fn(),
    updatePomodoro: jest.fn(),
    getCoach: jest.fn(),
    updateCoach: jest.fn(),
    getReminders: jest.fn(),
    updateReminders: jest.fn(),
    getDisplay: jest.fn(),
    updateDisplay: jest.fn(),
  },
  coachAPI: {
    getNotes: jest.fn(),
    createNote: jest.fn(),
    updateNote: jest.fn(),
    deleteNote: jest.fn(),
    getUsage: jest.fn(),
    getConversations: jest.fn(),
    getConversation: jest.fn(),
  },
}));

jest.mock('react-native-gesture-handler', () => {
  function makeGesture() {
    const gesture: any = {
      onBegin: () => gesture,
      onUpdate: () => gesture,
      onEnd: () => gesture,
      onFinalize: () => gesture,
      minDistance: () => gesture,
      activeOffsetY: () => gesture,
      activeOffsetX: () => gesture,
      activateAfterLongPress: () => gesture,
      hitSlop: () => gesture,
    };
    return gesture;
  }
  const ReactLib = require('react');
  return {
    __esModule: true,
    Gesture: { Pan: makeGesture },
    ScrollView: require('react-native').ScrollView,
    GestureDetector: ({ children }: { children: any }) => children,
    GestureHandlerRootView: ({ children }: { children: any }) => ReactLib.createElement(ReactLib.Fragment, null, children),
  };
});

let mockPickerValue = new Date(2026, 1, 3, 17, 30);
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

type Mocks = Record<string, jest.Mock>;
const apiModule = require('../services/api') as Record<string, Mocks>;
const taskMock = apiModule.taskAPI;
const sessionMock = apiModule.sessionAPI;
const scheduleMock = apiModule.scheduleAPI;
const calendarMock = apiModule.calendarImportAPI;
const insightsMock = apiModule.insightsAPI;
const settingsMock = apiModule.settingsAPI;
const coachMock = apiModule.coachAPI;

const GYM: Task = {
  id: 7,
  name: 'Gym',
  average_duration: 1800,
  total_recordings: 3,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

type DaySchedule = { id: number; target_date: string; is_regimen: false; items: ScheduleItem[] };
let schedules: DaySchedule[] = [];

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

function block(overrides: Partial<ScheduleItem>): ScheduleItem {
  return {
    id: 1,
    schedule_id: 50,
    task_id: 7,
    estimated_duration: 4500,
    position: 0,
    scheduled_time: todayAt(9, 30),
    task: GYM,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function today(items: ScheduleItem[]): DaySchedule {
  return { id: 50, target_date: localKey(new Date()), is_regimen: false, items };
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

async function renderWith(element: React.ReactElement) {
  return render(<QueryClientProvider client={client()}>{element}</QueryClientProvider>);
}

function clockOn(on: boolean) {
  settingsMock.getDisplay.mockResolvedValue({ clock_24h: on });
}

beforeEach(() => {
  for (const group of [taskMock, sessionMock, scheduleMock, calendarMock, insightsMock, settingsMock, coachMock]) {
    Object.values(group).forEach((m) => m.mockReset());
  }
  schedules = [];
  mockPickerValue = new Date(2026, 1, 3, 17, 30);
  taskMock.getAll.mockResolvedValue([GYM]);
  sessionMock.getAll.mockResolvedValue([]);
  scheduleMock.getAll.mockResolvedValue([]);
  scheduleMock.getRange.mockImplementation((start: string, end: string) =>
    Promise.resolve(schedules.filter((s) => s.target_date >= start && s.target_date <= end))
  );
  calendarMock.getEvents.mockResolvedValue([]);
  insightsMock.getPeakHours.mockResolvedValue({ peak_hour: null });
  clockOn(false);
  settingsMock.updateDisplay.mockImplementation(async (body) => body);
  settingsMock.getPomodoro.mockResolvedValue({ work_minutes: 25, break_minutes: 5, long_break_minutes: 15, long_break_every: 4 });
  settingsMock.getCoach.mockResolvedValue({ notes_enabled: true });
  settingsMock.getReminders.mockResolvedValue({ enabled: true, minutes_before: 5 });
  coachMock.getNotes.mockResolvedValue([]);
  coachMock.getUsage.mockResolvedValue({ month: '2026-11', conversations: 0, accepted: 0, cost_usd: 0 });
  coachMock.getConversations.mockResolvedValue([]);
});

describe('24-hour clock on the calendar (D128)', () => {
  it('day view hour labels read 17:00 with the setting on', async () => {
    clockOn(true);
    await renderWith(<CalendarDayScreen />);

    await waitFor(() => expect(settingsMock.getDisplay).toHaveBeenCalled());
    expect(await screen.findByText('17:00')).toBeTruthy();
    expect(screen.queryByText('5 PM')).toBeNull();
    expect(screen.queryByText('5:00 PM')).toBeNull();
  });

  it('week agenda times are 24-hour with the setting on', async () => {
    clockOn(true);
    schedules = [today([block({ id: 1, scheduled_time: todayAt(17, 30) })])];
    await renderWith(<CalendarDayScreen />);

    await waitFor(() => expect(settingsMock.getDisplay).toHaveBeenCalled());
    await fireEvent.press(screen.getByTestId('view-toggle-week'));

    await waitFor(() => expect(screen.getByTestId('week-item-1')).toHaveTextContent(/17:30/));
  });

  it('week agenda times are formatClock 12-hour with the setting off', async () => {
    schedules = [today([block({ id: 1, scheduled_time: todayAt(17, 30) })])];
    await renderWith(<CalendarDayScreen />);

    await waitFor(() => expect(settingsMock.getDisplay).toHaveBeenCalled());
    await fireEvent.press(screen.getByTestId('view-toggle-week'));

    await waitFor(() => expect(screen.getByTestId('week-item-1')).toHaveTextContent(/5:30 PM/));
  });
});

describe('24-hour clock on the Schedule (D128)', () => {
  // Only Date is faked, so Start time's default (now rounded up to 15 min) is fixed.
  const NOW = new Date(2026, 1, 3, 17, 7);

  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('Start time and Day end read 24-hour with the setting on', async () => {
    clockOn(true);
    await renderWith(<ScheduleScreen />);

    await waitFor(() => expect(screen.getByTestId('picker-start-time-open')).toHaveTextContent('17:15'));
    expect(screen.getByTestId('picker-day-end-open')).toHaveTextContent('23:00');
  });

  it('Start time and Day end read 12-hour with the setting off', async () => {
    await renderWith(<ScheduleScreen />);

    await waitFor(() => expect(settingsMock.getDisplay).toHaveBeenCalled());
    expect(screen.getByTestId('picker-start-time-open')).toHaveTextContent('5:15 PM');
    expect(screen.getByTestId('picker-day-end-open')).toHaveTextContent('11:00 PM');
  });
});

describe('24-hour clock on Recordings (D128)', () => {
  async function openFormAndPickStart() {
    await fireEvent.press(await screen.findByTestId('btn-add-manual'));
    await screen.findByTestId('manual-form');
    await fireEvent.press(screen.getByTestId('manual-start-time-open'));
    await fireEvent.press(screen.getByTestId('manual-start-time'));
  }

  it('the hand-entered start time reads 24-hour with the setting on', async () => {
    clockOn(true);
    await renderWith(<RecordingsScreen />);

    await openFormAndPickStart();

    await waitFor(() => expect(screen.getByTestId('manual-start-time-open')).toHaveTextContent('17:30'));
  });

  it('is 12-hour until the setting loads', async () => {
    settingsMock.getDisplay.mockReturnValue(new Promise(() => {}));
    await renderWith(<RecordingsScreen />);

    await openFormAndPickStart();

    expect(screen.getByTestId('manual-start-time-open')).toHaveTextContent('5:30 PM');
  });
});

describe('Clock setting (D128)', () => {
  it('shows the stored value and the switch round-trips through updateDisplay', async () => {
    settingsMock.updateDisplay.mockResolvedValue({ clock_24h: true });
    await renderWith(<SettingsScreen />);

    expect(await screen.findByText('Use 24-hour clock')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('toggle-clock-24h')).toHaveProp('value', false));
    await fireEvent(screen.getByTestId('toggle-clock-24h'), 'valueChange', true);

    await waitFor(() => expect(settingsMock.updateDisplay).toHaveBeenCalledWith({ clock_24h: true }));
    await waitFor(() => expect(screen.getByTestId('toggle-clock-24h')).toHaveProp('value', true));
  });
});

describe('Save as Recording (D132)', () => {
  async function openFromBlock() {
    schedules = [today([block({ id: 1 })])];
    await renderWith(<CalendarDayScreen />);
    const blockView = await screen.findByTestId('item-block-1');
    await fireEvent.press(within(blockView).getByText('Gym'));
    await fireEvent.press(await screen.findByTestId('btn-save-recording-1'));
    await screen.findByTestId('manual-form');
  }

  it('is offered on a selected Block', async () => {
    schedules = [today([block({ id: 1 })])];
    await renderWith(<CalendarDayScreen />);
    const blockView = await screen.findByTestId('item-block-1');
    expect(screen.queryByTestId('btn-save-recording-1')).toBeNull();

    await fireEvent.press(within(blockView).getByText('Gym'));

    expect(await screen.findByTestId('btn-save-recording-1')).toHaveTextContent('Save as Recording');
  });

  it('opens the form filled from the Block', async () => {
    await openFromBlock();

    expect(screen.getByTestId('manual-name')).toHaveProp('value', 'Gym');
    expect(screen.getByTestId('manual-hours')).toHaveProp('value', '1');
    expect(screen.getByTestId('manual-minutes')).toHaveProp('value', '15');
    expect(screen.getByTestId('manual-start-time-open')).toHaveTextContent('9:30 AM');
  });

  it('posts the edited duration from the Block start through sessionAPI.create', async () => {
    sessionMock.create.mockResolvedValue({ id: 90 });
    await openFromBlock();

    await fireEvent.changeText(screen.getByTestId('manual-minutes'), '30');
    await fireEvent.press(screen.getByTestId('btn-manual-save'));

    await waitFor(() => expect(sessionMock.create).toHaveBeenCalledTimes(1));
    const start = todayAt(9, 30);
    expect(sessionMock.create).toHaveBeenCalledWith({
      name: 'Gym',
      duration: 5400,
      start_time: start,
      end_time: new Date(new Date(start).getTime() + 5400 * 1000).toISOString(),
      task_id: 7,
    });
    await waitFor(() => expect(screen.queryByTestId('manual-form')).toBeNull());
  });

  it('Cancel closes the form and posts nothing', async () => {
    await openFromBlock();

    await fireEvent.press(screen.getByTestId('btn-manual-cancel'));

    await waitFor(() => expect(screen.queryByTestId('manual-form')).toBeNull());
    expect(sessionMock.create).not.toHaveBeenCalled();
  });
});
