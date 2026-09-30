import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ScheduleScreen from '../app/(tabs)/schedule';
import { calendarImportAPI, taskAPI, scheduleAPI } from '../services/api';
import type { GenerateResponse, Schedule, ScheduleItem, StrategyOption, Task } from '../types';

// P8d contract: src/app/(tabs)/schedule.tsx is a three-step flow on one screen.
//
// Step 1 (setup): activities come from `['tasks']`; each selected row gets an
// editable `input-duration-{id}` displaying its average_duration in whole
// minutes. `durations` holds only what the user typed: an untouched row
// sends its average rounded UP to the next whole minute (a cushion, and
// it keeps the block on a minute boundary), an edited one sends minutes
// x60. `estimated_duration` is always seconds, the unit the backend stores. A single `picker-start-time`
// and `picker-day-end` (mocked datetime pickers, same convention as
// RecordingsScreen's date-range pickers) supply the request's `start_time`
// and `day_end`; this screen sends `day_start` equal to `start_time` since
// the contract exposes no separate day-start control. `btn-generate` posts
// `scheduleAPI.generate` with the four known strategies. A rejected generate
// renders `btn-retry-generate` instead of crashing, and retry re-calls
// generate with the same request.
//
// Step 2 (options): one `option-card-{strategy}` per response option;
// `btn-select-{strategy}` chooses it, which is what mounts `btn-save`
// (Step 3) — mirroring the "elements exist only when reachable" convention
// used by the other P8 screens instead of a disabled prop.
//
// B8 contract (Build 2a, D44/D47 context, ADR 0003):
//
// The plan's date is the LOCAL `YYYY-MM-DD` of the start-time picker's value.
//
// Generate: before calling `scheduleAPI.generate`, the screen fetches that date's
// Schedule Items with `scheduleAPI.getRange(date, date)` and its Google events with
// `calendarImportAPI.getEvents(date)`, and sends both as `existing_events`
// (`{ name, start, end }`, UTC Z). An Item becomes `{ name: task.name ?? custom_name,
// start: scheduled_time, end: scheduled_time + estimated_duration }`; Items without a
// `scheduled_time` are skipped. A Google event becomes `{ name: summary, start, end }`.
//
// Save (Step 3): ONE `scheduleAPI.create` call carrying the timeline as `items`
// (`task_id`, `position`, `scheduled_time`, `estimated_duration` per entry, in order).
// No `addItem` calls.
//   - Day plan (`checkbox-regimen` off): body has `target_date` (the local date), `items`,
//     `is_regimen: false`, and NO `name` key. `input-schedule-name` is not rendered.
//   - Regimen (`checkbox-regimen` on): `input-schedule-name` appears, starts empty, and is
//     required — Save calls nothing while it is blank. Body has `name`, `items`,
//     `is_regimen: true`, and no `target_date` key.
//   - `btn-save` reads "Saving…" (disabled) in flight, then "Saved" (disabled until the
//     request, option, name or regimen switch changes — the P8d-reopened guard). A failure
//     shows `save-error` and leaves Save enabled; retrying calls `create` again.
//
// Apply (Regimens): `btn-apply-{id}` reveals `picker-apply-{id}`; its onChange calls
// `scheduleAPI.applyRegimen(id, { target_date: <local YYYY-MM-DD>, tz_offset:
// new Date().getTimezoneOffset() })` — exactly those two keys. Success shows `apply-success`
// whose text includes that `YYYY-MM-DD`; failure shows `apply-error`.
//
// Push / Remove on this tab (`btn-push-schedule`, `btn-push-{id}`, `btn-remove-calendar-{id}`,
// `btn-remove-schedule-calendar`) report like B7: `schedule-action-working` in flight, then
// `schedule-action-success` (a push's text includes the number of Items carrying a
// `calendar_event_id`) or `schedule-action-error`. A 401 shows text matching
// /authorize from a laptop/i (in `schedule-action-error` or the `google-auth-error` banner);
// any other failure must not show it.
//
// B14 contract: Generate survives Google being unavailable.
//   - If `calendarImportAPI.getEvents` rejects, Generate still calls `scheduleAPI.generate`
//     with only the day's Items as `existing_events`, and shows `google-events-skipped`
//     whose text matches /Planned without Google events/i. On a 401 that notice also
//     matches /authorize from a laptop/i; on any other status it does not.
//   - If `scheduleAPI.getRange` rejects, `generate` is not called and `btn-retry-generate`
//     shows, as before — planning over unknown Items could overlap the user's own plan.
//   - When both succeed, `google-events-skipped` is not rendered.
jest.mock('../services/api', () => ({
  taskAPI: { getAll: jest.fn() },
  scheduleAPI: {
    getAll: jest.fn(),
    getRange: jest.fn(),
    generate: jest.fn(),
    create: jest.fn(),
    addItem: jest.fn(),
    applyRegimen: jest.fn(),
    pushToCalendar: jest.fn(),
    removeFromCalendar: jest.fn(),
  },
  calendarImportAPI: { getEvents: jest.fn() },
}));

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
const mockedApplyRegimen = mockedScheduleAPI.applyRegimen;
const mockedPushToCalendar = mockedScheduleAPI.pushToCalendar;
const mockedRemoveFromCalendar = mockedScheduleAPI.removeFromCalendar;

const GYM: Task = {
  id: 7,
  name: 'Gym',
  average_duration: 1800,
  total_recordings: 3,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const READING: Task = { ...GYM, id: 8, name: 'Reading', average_duration: 900, total_recordings: 5 };

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

const TIMELINE = [
  { task_id: 7, name: 'Gym', start: '2026-02-03T08:00:00.000Z', end: '2026-02-03T08:30:00.000Z' },
  { task_id: 8, name: 'Reading', start: '2026-02-03T08:30:00.000Z', end: '2026-02-03T08:45:00.000Z' },
];

function localKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function scheduleItem(overrides: Partial<ScheduleItem>): ScheduleItem {
  return {
    id: 1,
    schedule_id: 50,
    estimated_duration: 1800,
    position: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function httpError(status: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

async function renderScreen() {
  return render(
    <QueryClientProvider client={client()}>
      <ScheduleScreen />
    </QueryClientProvider>
  );
}

async function selectActivity(id: number) {
  await fireEvent.press(screen.getByTestId(`activity-row-${id}`));
}

async function pickStart(value: Date) {
  mockPickerValue = value;
  await fireEvent.press(screen.getByTestId('picker-start-time-open'));
  await fireEvent.press(screen.getByTestId('picker-start-time'));
}

async function reachSaveStep() {
  await screen.findByTestId('activity-row-7');
  await selectActivity(7);
  await pickStart(new Date('2026-02-03T08:00:00.000Z'));
  await fireEvent.press(screen.getByTestId('btn-generate'));
  await screen.findByTestId('option-card-your-order');
  await fireEvent.press(screen.getByTestId('btn-select-your-order'));
}

beforeEach(() => {
  for (const mock of Object.values(mockedScheduleAPI)) mock.mockReset();
  mockedTasksGetAll.mockReset();
  mockedGetEvents.mockReset();
  mockedTasksGetAll.mockResolvedValue([GYM, READING]);
  mockedSchedulesGetAll.mockResolvedValue([]);
  mockedGetRange.mockResolvedValue([]);
  mockedGetEvents.mockResolvedValue([]);
  mockedAddItem.mockResolvedValue({});
  mockPickerValue = new Date('2026-02-01T09:00:00.000Z');
});

describe('setup step', () => {
  it('pre-fills duration from the average and respects an edit in the request', async () => {
    mockedGenerate.mockResolvedValue({ options: [] } as GenerateResponse);
    await renderScreen();

    await screen.findByTestId('activity-row-7');
    await selectActivity(7);
    expect(screen.getByTestId('input-duration-7')).toHaveProp('value', '30');

    await fireEvent.changeText(screen.getByTestId('input-duration-7'), '40');
    await fireEvent.press(screen.getByTestId('btn-generate'));

    await waitFor(() => expect(mockedGenerate).toHaveBeenCalledTimes(1));
    const request = mockedGenerate.mock.calls[0][0];
    expect(request.activities).toEqual([
      expect.objectContaining({ task_id: 7, name: 'Gym', estimated_duration: 2400 }), // 40 min
    ]);
  });

  it('calls generate with the four known strategies and UTC Z datetimes', async () => {
    mockedGenerate.mockResolvedValue({ options: [] } as GenerateResponse);
    await renderScreen();

    await screen.findByTestId('activity-row-7');
    await selectActivity(7);

    await pickStart(new Date('2026-02-03T08:00:00.000Z'));
    mockPickerValue = new Date('2026-02-03T23:00:00.000Z');
    await fireEvent.press(screen.getByTestId('picker-day-end-open'));
    await fireEvent.press(screen.getByTestId('picker-day-end'));

    await fireEvent.press(screen.getByTestId('btn-generate'));

    await waitFor(() => expect(mockedGenerate).toHaveBeenCalledTimes(1));
    const request = mockedGenerate.mock.calls[0][0];
    expect(request.strategies).toEqual(['your-order', 'shortest-first', 'longest-first', 'best-fit']);
    expect(request.start_time).toBe('2026-02-03T08:00:00.000Z');
    expect(request.day_start).toBe('2026-02-03T08:00:00.000Z');
    expect(request.day_end).toBe('2026-02-03T23:00:00.000Z');
  });

  it('renders a retry control instead of crashing when generate fails', async () => {
    mockedGenerate.mockRejectedValue(new Error('network down'));
    await renderScreen();

    await screen.findByTestId('activity-row-7');
    await selectActivity(7);
    await fireEvent.press(screen.getByTestId('btn-generate'));

    await screen.findByTestId('btn-retry-generate');
    expect(screen.queryByTestId('option-card-your-order')).toBeNull();

    mockedGenerate.mockResolvedValueOnce({ options: [option({})] });
    await fireEvent.press(screen.getByTestId('btn-retry-generate'));

    await screen.findByTestId('option-card-your-order');
    expect(mockedGenerate).toHaveBeenCalledTimes(2);
  });

  it("sends the date's existing Items and Google events to generate as existing_events", async () => {
    const start = new Date('2026-02-03T08:00:00.000Z');
    const key = localKey(start);
    mockedGetRange.mockResolvedValue([
      {
        ...REGIMEN,
        id: 50,
        name: null,
        is_regimen: false,
        target_date: key,
        items: [
          scheduleItem({
            id: 1,
            task_id: 8,
            task: READING,
            scheduled_time: '2026-02-03T10:00:00Z',
            estimated_duration: 1800,
          }),
          scheduleItem({ id: 2, custom_name: 'Dentist', scheduled_time: '2026-02-03T13:00:00Z', estimated_duration: 3600 }),
          scheduleItem({ id: 3, task_id: 7, task: GYM }),
        ],
      },
    ]);
    mockedGetEvents.mockResolvedValue([
      { id: 'g1', summary: 'Standup', start: '2026-02-03T15:00:00Z', end: '2026-02-03T15:15:00Z' },
    ]);
    mockedGenerate.mockResolvedValue({ options: [] } as GenerateResponse);
    await renderScreen();

    await screen.findByTestId('activity-row-7');
    await selectActivity(7);
    await pickStart(start);
    await fireEvent.press(screen.getByTestId('btn-generate'));

    await waitFor(() => expect(mockedGenerate).toHaveBeenCalledTimes(1));
    expect(mockedGetRange).toHaveBeenCalledWith(key, key);
    expect(mockedGetEvents).toHaveBeenCalledWith(key);

    const events = mockedGenerate.mock.calls[0][0].existing_events;
    expect(events).toHaveLength(3);
    const byName = Object.fromEntries(
      events.map((e: { name: string; start: string; end: string }) => [
        e.name,
        [new Date(e.start).getTime(), new Date(e.end).getTime()],
      ])
    );
    expect(byName.Reading).toEqual([Date.parse('2026-02-03T10:00:00Z'), Date.parse('2026-02-03T10:30:00Z')]);
    expect(byName.Dentist).toEqual([Date.parse('2026-02-03T13:00:00Z'), Date.parse('2026-02-03T14:00:00Z')]);
    expect(byName.Standup).toEqual([Date.parse('2026-02-03T15:00:00Z'), Date.parse('2026-02-03T15:15:00Z')]);
    for (const e of events) {
      expect(e.start).toMatch(/Z$/);
      expect(e.end).toMatch(/Z$/);
    }
  });
});

describe('Generate when Google is unavailable', () => {
  const START = new Date('2026-02-03T08:00:00.000Z');

  function daySchedule() {
    return {
      ...REGIMEN,
      id: 50,
      name: null,
      is_regimen: false,
      target_date: localKey(START),
      items: [
        scheduleItem({ id: 1, task_id: 8, task: READING, scheduled_time: '2026-02-03T10:00:00Z', estimated_duration: 1800 }),
      ],
    };
  }

  async function generate() {
    await renderScreen();
    await screen.findByTestId('activity-row-7');
    await selectActivity(7);
    await pickStart(START);
    await fireEvent.press(screen.getByTestId('btn-generate'));
  }

  it('plans with only the day Items and shows a notice when getEvents fails', async () => {
    mockedGetRange.mockResolvedValue([daySchedule()]);
    mockedGetEvents.mockRejectedValue(httpError(500));
    mockedGenerate.mockResolvedValue({ options: [option({})] });

    await generate();

    await waitFor(() => expect(mockedGenerate).toHaveBeenCalledTimes(1));
    const events = mockedGenerate.mock.calls[0][0].existing_events;
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('Reading');
    expect(new Date(events[0].start).getTime()).toBe(Date.parse('2026-02-03T10:00:00Z'));
    expect(new Date(events[0].end).getTime()).toBe(Date.parse('2026-02-03T10:30:00Z'));

    expect(await screen.findByTestId('google-events-skipped')).toHaveTextContent(/Planned without Google events/i);
    await screen.findByTestId('option-card-your-order');
    expect(screen.queryByTestId('btn-retry-generate')).toBeNull();
  });

  it('a 401 from getEvents puts the laptop text in the notice', async () => {
    mockedGetEvents.mockRejectedValue(httpError(401));
    mockedGenerate.mockResolvedValue({ options: [option({})] });

    await generate();

    const notice = await screen.findByTestId('google-events-skipped');
    expect(notice).toHaveTextContent(/Planned without Google events/i);
    expect(notice).toHaveTextContent(/authorize from a laptop/i);
    expect(mockedGenerate).toHaveBeenCalledTimes(1);
  });

  it('a 500 from getEvents leaves the laptop text out', async () => {
    mockedGetEvents.mockRejectedValue(httpError(500));
    mockedGenerate.mockResolvedValue({ options: [option({})] });

    await generate();

    const notice = await screen.findByTestId('google-events-skipped');
    expect(notice).not.toHaveTextContent(/authorize from a laptop/i);
    expect(screen.queryAllByText(/authorize from a laptop/i)).toHaveLength(0);
  });

  it('does not generate when getRange fails, and offers Retry', async () => {
    mockedGetRange.mockRejectedValue(httpError(500));
    mockedGenerate.mockResolvedValue({ options: [option({})] });

    await generate();

    await screen.findByTestId('btn-retry-generate');
    expect(mockedGenerate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('option-card-your-order')).toBeNull();
  });

  it('shows no notice when both fetches succeed', async () => {
    mockedGetRange.mockResolvedValue([daySchedule()]);
    mockedGenerate.mockResolvedValue({ options: [option({})] });

    await generate();

    await screen.findByTestId('option-card-your-order');
    expect(mockedGenerate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('google-events-skipped')).toBeNull();
  });
});

describe('options step', () => {
  it('renders one card per option and enables Save once one is selected', async () => {
    mockedGenerate.mockResolvedValue({
      options: [
        option({ strategy: 'your-order', label: 'Your Order' }),
        option({ strategy: 'shortest-first', label: 'Shortest First' }),
      ],
    });
    await renderScreen();

    await screen.findByTestId('activity-row-7');
    await selectActivity(7);
    await fireEvent.press(screen.getByTestId('btn-generate'));

    await screen.findByTestId('option-card-your-order');
    expect(screen.getByTestId('option-card-shortest-first')).toBeTruthy();
    expect(screen.queryByTestId('btn-save')).toBeNull();

    await fireEvent.press(screen.getByTestId('btn-select-shortest-first'));

    expect(screen.getByTestId('btn-save')).toBeTruthy();
  });
});

describe('save step', () => {
  it('saves a day plan in one create call with target_date and items, and no name', async () => {
    mockedGenerate.mockResolvedValue({ options: [option({ strategy: 'your-order', timeline: TIMELINE })] });
    mockedCreate.mockResolvedValue({ ...REGIMEN, id: 55, name: null, is_regimen: false, items: [] });
    await renderScreen();

    await reachSaveStep();
    expect(screen.queryByTestId('input-schedule-name')).toBeNull();
    await fireEvent.press(screen.getByTestId('btn-save'));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    const body = mockedCreate.mock.calls[0][0];
    expect(body.target_date).toBe(localKey(new Date('2026-02-03T08:00:00.000Z')));
    expect(body.is_regimen).toBe(false);
    expect('name' in body).toBe(false);
    expect(body.items).toEqual([
      expect.objectContaining({ task_id: 7, position: 0, scheduled_time: TIMELINE[0].start, estimated_duration: 1800 }),
      expect.objectContaining({ task_id: 8, position: 1, scheduled_time: TIMELINE[1].start, estimated_duration: 900 }),
    ]);
    await screen.findByText('Saved');
    expect(mockedAddItem).not.toHaveBeenCalled();
  });

  it('shows the name field only for a Regimen, and requires it', async () => {
    mockedGenerate.mockResolvedValue({ options: [option({ strategy: 'your-order', timeline: TIMELINE })] });
    mockedCreate.mockResolvedValue({ ...REGIMEN, id: 57, name: 'Mornings', items: [] });
    await renderScreen();

    await reachSaveStep();
    expect(screen.queryByTestId('input-schedule-name')).toBeNull();

    await fireEvent(screen.getByTestId('checkbox-regimen'), 'valueChange', true);
    const nameInput = await screen.findByTestId('input-schedule-name');
    expect(nameInput).toHaveProp('value', '');

    await fireEvent.press(screen.getByTestId('btn-save'));
    await fireEvent.changeText(nameInput, '   ');
    await fireEvent.press(screen.getByTestId('btn-save'));
    expect(mockedCreate).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('input-schedule-name'), 'Mornings');
    await fireEvent.press(screen.getByTestId('btn-save'));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    const body = mockedCreate.mock.calls[0][0];
    expect(body.name).toBe('Mornings');
    expect(body.is_regimen).toBe(true);
    expect('target_date' in body).toBe(false);
    expect(body.items).toHaveLength(2);
    expect(mockedAddItem).not.toHaveBeenCalled();
  });

  it('reads Saving… while in flight, then Saved', async () => {
    const pending = deferred<Schedule>();
    mockedGenerate.mockResolvedValue({ options: [option({ strategy: 'your-order', timeline: TIMELINE })] });
    mockedCreate.mockReturnValue(pending.promise);
    await renderScreen();

    await reachSaveStep();
    await fireEvent.press(screen.getByTestId('btn-save'));

    await screen.findByText('Saving…');
    await fireEvent.press(screen.getByTestId('btn-save'));
    expect(mockedCreate).toHaveBeenCalledTimes(1);

    pending.resolve({ ...REGIMEN, id: 55, is_regimen: false, items: [] });
    await screen.findByText('Saved');
    expect(screen.queryByTestId('save-error')).toBeNull();
  });

  it('shows an error on failure and leaves Save enabled to retry', async () => {
    mockedGenerate.mockResolvedValue({ options: [option({ strategy: 'your-order', timeline: TIMELINE })] });
    mockedCreate
      .mockRejectedValueOnce(httpError(500))
      .mockResolvedValueOnce({ ...REGIMEN, id: 55, is_regimen: false, items: [] });
    await renderScreen();

    await reachSaveStep();
    await fireEvent.press(screen.getByTestId('btn-save'));

    await screen.findByTestId('save-error');
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByTestId('btn-save')).not.toBeDisabled();

    await fireEvent.press(screen.getByTestId('btn-save'));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(2));
    await screen.findByText('Saved');
    expect(screen.queryByTestId('save-error')).toBeNull();
  });

  it('cannot save the same schedule twice, but can save again after a change', async () => {
    mockedGenerate.mockResolvedValue({ options: [option({ strategy: 'your-order' })] });
    mockedCreate.mockResolvedValue({ ...REGIMEN, id: 56, name: 'Twice', is_regimen: false, items: [] });
    await renderScreen();

    await reachSaveStep();

    await fireEvent.press(screen.getByTestId('btn-save'));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    await screen.findByText('Saved');
    await fireEvent.press(screen.getByTestId('btn-save'));
    expect(mockedCreate).toHaveBeenCalledTimes(1);

    await fireEvent(screen.getByTestId('checkbox-regimen'), 'valueChange', true);
    await fireEvent.changeText(await screen.findByTestId('input-schedule-name'), 'Twice');
    await fireEvent.press(screen.getByTestId('btn-save'));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(2));
  });
});

describe('regimens', () => {
  it('applies a regimen with a local date and tz_offset, and reports the date', async () => {
    const picked = new Date(2026, 2, 1, 12, 0, 0);
    const key = localKey(picked);
    mockedSchedulesGetAll.mockResolvedValue([REGIMEN]);
    mockedApplyRegimen.mockResolvedValue({ ...REGIMEN, id: 200, name: null, is_regimen: false, target_date: key });
    await renderScreen();

    await screen.findByTestId('regimen-row-99');
    await fireEvent.press(screen.getByTestId('btn-apply-99'));

    mockPickerValue = picked;
    await fireEvent.press(screen.getByTestId('picker-apply-99'));

    await waitFor(() => expect(mockedApplyRegimen).toHaveBeenCalledTimes(1));
    expect(mockedApplyRegimen).toHaveBeenCalledWith(99, {
      target_date: key,
      tz_offset: new Date().getTimezoneOffset(),
    });
    expect(await screen.findByTestId('apply-success')).toHaveTextContent(new RegExp(key));
    expect(screen.queryByTestId('apply-error')).toBeNull();
  });

  it('shows an error when Apply fails', async () => {
    mockedSchedulesGetAll.mockResolvedValue([REGIMEN]);
    mockedApplyRegimen.mockRejectedValue(httpError(422));
    await renderScreen();

    await screen.findByTestId('regimen-row-99');
    await fireEvent.press(screen.getByTestId('btn-apply-99'));
    mockPickerValue = new Date(2026, 2, 1, 12, 0, 0);
    await fireEvent.press(screen.getByTestId('picker-apply-99'));

    await screen.findByTestId('apply-error');
    expect(screen.queryByTestId('apply-success')).toBeNull();
  });
});

describe('push and remove feedback', () => {
  async function saveDayPlan() {
    mockedGenerate.mockResolvedValue({ options: [option({ strategy: 'your-order', timeline: TIMELINE })] });
    mockedCreate.mockResolvedValue({ ...REGIMEN, id: 55, name: null, is_regimen: false, items: [] });
    await renderScreen();
    await reachSaveStep();
    await fireEvent.press(screen.getByTestId('btn-save'));
    await screen.findByTestId('btn-push-schedule');
  }

  it('a push shows working, then success with the event count', async () => {
    const pending = deferred<Schedule>();
    mockedPushToCalendar.mockReturnValue(pending.promise);
    await saveDayPlan();

    await fireEvent.press(screen.getByTestId('btn-push-schedule'));
    await screen.findByTestId('schedule-action-working');
    expect(mockedPushToCalendar).toHaveBeenCalledWith(55);

    pending.resolve({
      ...REGIMEN,
      id: 55,
      is_regimen: false,
      items: [
        scheduleItem({ id: 1, calendar_event_id: 'evt1' }),
        scheduleItem({ id: 2, calendar_event_id: 'evt2' }),
        scheduleItem({ id: 3, calendar_event_id: 'evt3' }),
      ],
    });
    expect(await screen.findByTestId('schedule-action-success')).toHaveTextContent(/3/);
    expect(screen.queryByTestId('schedule-action-working')).toBeNull();
  });

  it('a failed push is shown, not silent, and is not called an auth problem', async () => {
    mockedPushToCalendar.mockRejectedValue(httpError(500));
    await saveDayPlan();

    await fireEvent.press(screen.getByTestId('btn-push-schedule'));

    await screen.findByTestId('schedule-action-error');
    expect(screen.queryByTestId('schedule-action-success')).toBeNull();
    expect(screen.queryAllByText(/authorize from a laptop/i)).toHaveLength(0);
  });

  it('a 401 on a Regimen push shows the laptop message', async () => {
    mockedSchedulesGetAll.mockResolvedValue([REGIMEN]);
    mockedPushToCalendar.mockRejectedValue(httpError(401));
    await renderScreen();

    await fireEvent.press(await screen.findByTestId('btn-push-99'));

    await waitFor(() => expect(screen.queryAllByText(/authorize from a laptop/i).length).toBeGreaterThan(0));
    expect(screen.queryByTestId('schedule-action-success')).toBeNull();
  });

  it('a failed remove is shown, not silent', async () => {
    mockedSchedulesGetAll.mockResolvedValue([
      { ...REGIMEN, items: [scheduleItem({ id: 1, schedule_id: 99, calendar_event_id: 'evt1' })] },
    ]);
    mockedRemoveFromCalendar.mockRejectedValue(httpError(500));
    await renderScreen();

    await fireEvent.press(await screen.findByTestId('btn-remove-calendar-99'));

    await waitFor(() => expect(mockedRemoveFromCalendar).toHaveBeenCalledWith(99));
    await screen.findByTestId('schedule-action-error');
    expect(screen.queryByTestId('schedule-action-success')).toBeNull();
  });

  it('a successful remove reports success', async () => {
    mockedSchedulesGetAll.mockResolvedValue([
      { ...REGIMEN, items: [scheduleItem({ id: 1, schedule_id: 99, calendar_event_id: 'evt1' })] },
    ]);
    mockedRemoveFromCalendar.mockResolvedValue(undefined);
    await renderScreen();

    await fireEvent.press(await screen.findByTestId('btn-remove-calendar-99'));

    await screen.findByTestId('schedule-action-success');
    expect(screen.queryByTestId('schedule-action-error')).toBeNull();
  });
});
