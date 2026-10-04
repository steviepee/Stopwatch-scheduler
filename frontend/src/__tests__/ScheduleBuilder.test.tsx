import type { ComponentType, ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import ActivityInput from '../components/ActivityInput';
import ScheduleBuilderComponent from '../components/ScheduleBuilder';
import ScheduleListComponent from '../components/ScheduleList';
import HomePage from '../pages/HomePage';
import { calendarImportAPI, googleCalendarAPI, scheduleAPI, sessionAPI, taskAPI } from '../services/api';
import type { Schedule, ScheduleItemCreate, Task } from '../types';

// B11 contract (Build 2a, D39, D44, B8 on the web): the Schedule tab saves into the day, Apply
// lands on a local date, and every Save and Apply shows its outcome on the page.
//
// These tests run in America/Chicago with the clock at 21:00 local on 2026-09-29, which is
// already 2026-09-30 in UTC. Every date below is the LOCAL `YYYY-MM-DD`; a `toISOString()`
// date is the wrong answer.
//
// ScheduleBuilder (props `tasks`, `options?`, `onScheduleCreated(schedule)`):
//   - The date input is `data-testid="input-target-date"` and defaults to the local today.
//   - "Generate Schedule Options" fetches the day's Items with
//     `scheduleAPI.getRange(date, date)` and passes them to `ScheduleTimeline` in its
//     `existingEvents` prop (mocked below), alongside any imported Google events. An Item maps to
//     `{ name: task?.name ?? custom_name, start: scheduled_time (UTC, Z), end: start +
//     estimated_duration }`; Items with no `scheduled_time` are skipped.
//   - Save step. `checkbox-regimen` toggles saving as a Regimen. `input-schedule-name` exists
//     ONLY while it is checked, starts empty, and `btn-save-schedule` is disabled while the
//     trimmed name is blank.
//   - A day Save is ONE `scheduleAPI.create` with `target_date` = the local `YYYY-MM-DD`, the
//     chosen `items`, a falsy `is_regimen`, and NO `name` key. A Regimen Save sends `name`,
//     `is_regimen: true`, the `items`, and NO `target_date` key.
//   - Feedback: `btn-save-schedule` is disabled while the save is in flight; success shows
//     `save-success` and calls `onScheduleCreated` with the response; failure shows `save-error`
//     and leaves `btn-save-schedule` enabled to retry. No `window.alert`.
//
// ScheduleList: a day Schedule has no name (D39), so its card shows its `target_date` as that
// local date, and never the day before.
//
// HomePage Apply (Schedule tab → Regimens → "Apply to Date"): `window.prompt` asks for the date,
// offering the local today as its default. `scheduleAPI.applyRegimen(id, { target_date,
// tz_offset })` with exactly those two keys, `tz_offset` = `new Date().getTimezoneOffset()`.
// Success shows `apply-success` containing the date; failure shows `apply-error`. No
// `window.alert`.
//
// B28 contract (D44 amended, B26): the web plans through the server's Generate, as mobile does.
//   - `scheduleAPI.generate(req)` POSTs `/schedules/generate` (no trailing slash). Request and
//     response shapes match mobile's `GenerateRequest` / `GenerateResponse`.
//   - "Generate Schedule Options" fetches the day's Items (as B11) and then calls `generate`
//     ONCE with: `start_time` (date + Start Time, local, as UTC `Z`), `day_start` (06:00 local on
//     the date), `day_end` (23:00 local), `activities` in list order as `{ task_id?, name,
//     estimated_duration }`, `existing_events` = the day's timed Items plus any imported Google
//     events, `strategies: ['your-order', 'shortest-first', 'longest-first', 'best-fit']` and
//     `avoid_existing: true`. A failed call shows `generate-error` inline and stays on setup.
//   - `ScheduleTimeline` is a presenter: props `options` (the response's `options`),
//     `onSelect(items)`, `onReorder(activities)`. One tab (a button) per option with the
//     server's `label` and `description`; the selected option's entries (draggable rows on the
//     Your Order tab) with start–end; its `excluded` as "Didn't fit: <names>". "Use This
//     Schedule" calls `onSelect` with one Item per entry: `task_id`, `custom_name` when there is
//     no task, `estimated_duration` = end − start in seconds, `position`, `scheduled_time` = the
//     entry's start.
//   - Reordering rows on Your Order calls `onReorder` with the reordered activities (`name`,
//     `estimated_duration`, `task_id`), and the builder calls `generate` again in that order.
//
// B33 contract (D40): `ActivityInput`'s fallback, when there is no suggested duration and no
// custom one, is 600 s (was 1800). A suggested or custom duration is unchanged.

process.env.TZ = 'America/Chicago';

vi.mock('../services/api', () => ({
  taskAPI: { getAll: vi.fn(), getStats: vi.fn(), getById: vi.fn(), create: vi.fn(), delete: vi.fn() },
  timeLogAPI: { create: vi.fn() },
  sessionAPI: { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  scheduleAPI: {
    getAll: vi.fn(),
    getRange: vi.fn(),
    create: vi.fn(),
    applyRegimen: vi.fn(),
    rate: vi.fn(),
    delete: vi.fn(),
    pushToCalendar: vi.fn(),
    removeFromCalendar: vi.fn(),
    generate: vi.fn(),
  },
  googleCalendarAPI: {
    checkAuthStatus: vi.fn().mockResolvedValue({ authenticated: false }),
    login: vi.fn(),
  },
  calendarImportAPI: { getEvents: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../components/calendar', () => ({ CalendarView: () => null }));

type Entry = { task_id: number | null; name: string; start: string; end: string };
type Flag = { name: string; reason: string };
type Option = {
  strategy: string;
  label: string;
  description: string;
  timeline: Entry[];
  flagged: Flag[];
  excluded: Flag[];
};
type ReorderActivity = { task_id?: number | null; name: string; estimated_duration: number };

type TimelineProps = {
  options: Option[];
  onSelect: (items: ScheduleItemCreate[]) => void;
  onReorder: (activities: ReorderActivity[]) => void;
};

const timeline = vi.hoisted(() => ({
  props: null as unknown,
  items: [
    { task_id: 1, estimated_duration: 1800, position: 0, scheduled_time: '2026-10-02T13:00:00.000Z' },
    { custom_name: 'Stretch', estimated_duration: 1200, position: 1, scheduled_time: '2026-10-02T13:30:00.000Z' },
  ],
  reorderTo: [] as unknown[],
}));

vi.mock('../components/ScheduleTimeline', () => ({
  default: (props: TimelineProps): ReactNode => {
    timeline.props = props;
    return (
      <>
        <button onClick={() => props.onSelect(timeline.items)}>Use This Schedule</button>
        <button onClick={() => props.onReorder(timeline.reorderTo as ReorderActivity[])}>Mock reorder</button>
      </>
    );
  },
}));

const schedules = scheduleAPI as unknown as Record<string, Mock>;
const tasksApi = taskAPI as unknown as Record<string, Mock>;
const sessions = sessionAPI as unknown as Record<string, Mock>;
const google = googleCalendarAPI as unknown as Record<string, Mock>;
const calImport = calendarImportAPI as unknown as Record<string, Mock>;

const OPTIONS: Option[] = [
  {
    strategy: 'your-order',
    label: 'Your Order',
    description: 'Server: as you listed them',
    timeline: [
      { task_id: 1, name: 'Gym', start: '2026-10-02T13:00:00Z', end: '2026-10-02T14:00:00Z' },
      { task_id: null, name: 'Stretch', start: '2026-10-02T16:00:00Z', end: '2026-10-02T16:20:00Z' },
    ],
    flagged: [],
    excluded: [],
  },
  {
    strategy: 'shortest-first',
    label: 'Shortest First',
    description: 'Server: quick wins first',
    timeline: [{ task_id: null, name: 'Stretch', start: '2026-10-02T13:00:00Z', end: '2026-10-02T13:20:00Z' }],
    flagged: [],
    excluded: [{ name: 'Gym', reason: 'no-free-slot' }],
  },
  {
    strategy: 'longest-first',
    label: 'Longest First',
    description: 'Server: hardest thing early',
    timeline: [
      { task_id: 1, name: 'Gym', start: '2026-10-02T13:00:00Z', end: '2026-10-02T14:00:00Z' },
      { task_id: null, name: 'Stretch', start: '2026-10-02T14:00:00Z', end: '2026-10-02T14:20:00Z' },
    ],
    flagged: [],
    excluded: [],
  },
  {
    strategy: 'best-fit',
    label: 'Best Fit',
    description: 'Server: fills the gaps',
    timeline: [
      { task_id: 1, name: 'Gym', start: '2026-10-02T13:00:00Z', end: '2026-10-02T14:00:00Z' },
      { task_id: null, name: 'Stretch', start: '2026-10-02T14:00:00Z', end: '2026-10-02T14:20:00Z' },
    ],
    flagged: [],
    excluded: [],
  },
];

const ScheduleBuilder = ScheduleBuilderComponent as unknown as ComponentType<{
  tasks: Task[];
  onScheduleCreated: (s: Schedule) => void;
}>;
const ScheduleList = ScheduleListComponent as unknown as ComponentType<{
  schedules: Schedule[];
  regimens: Schedule[];
  onScheduleUpdate: (s: Schedule) => void;
  onScheduleDelete: (id: number) => void;
  onApplyRegimen: (r: Schedule) => void;
}>;

const TASKS: Task[] = [
  { id: 1, name: 'Gym', average_duration: 1800, total_recordings: 3, created_at: '', updated_at: '' },
];

const DAY_ITEMS = {
  id: 7,
  name: null,
  schedule_type: 'day',
  target_date: '2026-10-02',
  is_regimen: false,
  created_at: '',
  updated_at: '',
  items: [
    {
      id: 71, schedule_id: 7, task_id: 1, task: TASKS[0], estimated_duration: 3600, position: 0,
      scheduled_time: '2026-10-02T15:00:00Z', created_at: '',
    },
    {
      id: 72, schedule_id: 7, custom_name: 'Dentist', estimated_duration: 1800, position: 1,
      scheduled_time: '2026-10-02T19:30:00Z', created_at: '',
    },
    { id: 73, schedule_id: 7, custom_name: 'Someday', estimated_duration: 600, position: 2, created_at: '' },
  ],
} as unknown as Schedule;

const REGIMEN = {
  id: 20,
  name: 'Morning',
  schedule_type: 'day',
  is_regimen: true,
  created_at: '',
  updated_at: '',
  items: [{ id: 201, schedule_id: 20, custom_name: 'Coffee', estimated_duration: 600, position: 0, created_at: '' }],
} as unknown as Schedule;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function addActivity(name: string, minutes: string) {
  fireEvent.change(screen.getByPlaceholderText('Activity name (e.g. Go for a run)'), { target: { value: name } });
  fireEvent.change(screen.getByPlaceholderText('min'), { target: { value: minutes } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
}

function renderToSetup(date?: string) {
  const onScheduleCreated = vi.fn();
  render(<ScheduleBuilder tasks={TASKS} onScheduleCreated={onScheduleCreated} />);
  if (date) fireEvent.change(screen.getByTestId('input-target-date'), { target: { value: date } });
  addActivity('Stretch', '20');
  addActivity('Walk', '30');
  return { onScheduleCreated };
}

async function renderToGenerateStep(date?: string) {
  const result = renderToSetup(date);
  fireEvent.click(screen.getByText('Generate Schedule Options'));
  await screen.findByText('Use This Schedule');
  return result;
}

async function renderToSaveStep(date?: string) {
  const result = await renderToGenerateStep(date);
  fireEvent.click(screen.getByText('Use This Schedule'));
  await screen.findByTestId('btn-save-schedule');
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 29, 21, 0));
  timeline.props = null;
  window.alert = vi.fn();
  schedules.getRange.mockResolvedValue([]);
  schedules.generate.mockResolvedValue({ options: OPTIONS });
  timeline.reorderTo = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ScheduleBuilder: generating around the day', () => {
  it('defaults the date to the local today', () => {
    render(<ScheduleBuilder tasks={TASKS} onScheduleCreated={vi.fn()} />);
    expect(screen.getByTestId('input-target-date')).toHaveValue('2026-09-29');
  });

  it("sends one generate request with the day's Items and Google events, avoiding busy time", async () => {
    schedules.getRange.mockResolvedValue([DAY_ITEMS]);
    google.checkAuthStatus.mockResolvedValueOnce({ authenticated: true });
    calImport.getEvents.mockResolvedValueOnce([
      { summary: 'Standup', start: '2026-10-02T14:00:00Z', end: '2026-10-02T14:15:00Z' },
    ]);
    renderToSetup('2026-10-02');
    fireEvent.click(screen.getByText('Import from Google Calendar'));
    await screen.findByText(/1 imported/);

    fireEvent.click(screen.getByText('Generate Schedule Options'));
    await screen.findByText('Use This Schedule');

    expect(schedules.getRange).toHaveBeenCalledWith('2026-10-02', '2026-10-02');
    expect(schedules.generate).toHaveBeenCalledTimes(1);
    const req = schedules.generate.mock.calls[0][0];

    for (const key of ['start_time', 'day_start', 'day_end']) expect(req[key]).toMatch(/Z$/);
    expect(Date.parse(req.start_time)).toBe(Date.parse('2026-10-02T13:00:00Z'));
    expect(Date.parse(req.day_start)).toBe(Date.parse('2026-10-02T11:00:00Z'));
    expect(Date.parse(req.day_end)).toBe(Date.parse('2026-10-03T04:00:00Z'));

    expect(req.activities.map((a: ReorderActivity) => a.name)).toEqual(['Stretch', 'Walk']);
    expect(req.activities.map((a: ReorderActivity) => a.estimated_duration)).toEqual([1200, 1800]);

    expect(req.strategies).toEqual(['your-order', 'shortest-first', 'longest-first', 'best-fit']);
    expect(req.avoid_existing).toBe(true);

    const events = req.existing_events as { name: string; start: string; end: string }[];
    expect(events).toHaveLength(3);
    for (const e of events) {
      expect(e.start).toMatch(/Z$/);
      expect(e.end).toMatch(/Z$/);
    }
    const byName = Object.fromEntries(events.map((e) => [e.name, e]));
    expect(Date.parse(byName.Gym.start)).toBe(Date.parse('2026-10-02T15:00:00Z'));
    expect(Date.parse(byName.Gym.end)).toBe(Date.parse('2026-10-02T16:00:00Z'));
    expect(Date.parse(byName.Dentist.start)).toBe(Date.parse('2026-10-02T19:30:00Z'));
    expect(Date.parse(byName.Dentist.end)).toBe(Date.parse('2026-10-02T20:00:00Z'));
    expect(Date.parse(byName.Standup.start)).toBe(Date.parse('2026-10-02T14:00:00Z'));
    expect(byName.Someday).toBeUndefined();

    expect((timeline.props as TimelineProps).options).toEqual(OPTIONS);
  });

  it('reordering on Your Order calls generate again with the new order', async () => {
    await renderToGenerateStep('2026-10-02');
    expect(schedules.generate).toHaveBeenCalledTimes(1);

    timeline.reorderTo = [
      { name: 'Walk', estimated_duration: 1800 },
      { name: 'Stretch', estimated_duration: 1200 },
    ];
    fireEvent.click(screen.getByText('Mock reorder'));

    await waitFor(() => expect(schedules.generate).toHaveBeenCalledTimes(2));
    const req = schedules.generate.mock.calls[1][0];
    expect(req.activities.map((a: ReorderActivity) => a.name)).toEqual(['Walk', 'Stretch']);
    expect(req.activities.map((a: ReorderActivity) => a.estimated_duration)).toEqual([1800, 1200]);
    expect(req.avoid_existing).toBe(true);
  });

  it('a failed generate shows an error, no timeline, and stays on setup', async () => {
    schedules.generate.mockRejectedValueOnce({ response: { status: 500 } });
    renderToSetup('2026-10-02');
    fireEvent.click(screen.getByText('Generate Schedule Options'));

    expect(await screen.findByTestId('generate-error')).toBeInTheDocument();
    expect(timeline.props).toBeNull();
    expect(screen.queryByText('Use This Schedule')).not.toBeInTheDocument();
    expect(screen.getByText('Generate Schedule Options')).toBeEnabled();
  });
});

describe('ActivityInput: no-history fallback', () => {
  const NEW_TASK: Task = { id: 5, name: 'New thing', average_duration: 0, total_recordings: 0, created_at: '', updated_at: '' };

  function renderInput() {
    const onAdd = vi.fn();
    render(<ActivityInput tasks={[...TASKS, NEW_TASK]} onAdd={onAdd} />);
    return onAdd;
  }

  function typeName(name: string) {
    fireEvent.change(screen.getByPlaceholderText('Activity name (e.g. Go for a run)'), { target: { value: name } });
  }

  it('a new name with no custom duration is added at 600 s', () => {
    const onAdd = renderInput();
    typeName('Brand new');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Brand new', estimatedDuration: 600 }));
  });

  it('a no-history Activity with no custom duration is added at 600 s', async () => {
    tasksApi.getStats.mockResolvedValue({ average: 0, median: null, previous: null });
    const onAdd = renderInput();
    typeName('New thing');
    await waitFor(() => expect(tasksApi.getStats).toHaveBeenCalledWith(5));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ taskId: 5, estimatedDuration: 600 }));
  });

  it('a custom duration still wins', () => {
    const onAdd = renderInput();
    typeName('Brand new');
    fireEvent.change(screen.getByPlaceholderText('min'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ estimatedDuration: 1500 }));
  });
});

describe('ScheduleTimeline: presents the server options', () => {
  async function renderTimeline() {
    const { default: RealTimeline } = await vi.importActual<{ default: ComponentType<TimelineProps> }>(
      '../components/ScheduleTimeline'
    );
    const onSelect = vi.fn();
    const onReorder = vi.fn();
    render(<RealTimeline options={OPTIONS} onSelect={onSelect} onReorder={onReorder} />);
    return { onSelect, onReorder };
  }

  it('renders a tab per option with the server label and description, and Didn\'t fit', async () => {
    await renderTimeline();
    for (const o of OPTIONS) {
      expect(screen.getByRole('button', { name: new RegExp(o.label) })).toBeInTheDocument();
      expect(screen.getByText(o.description)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: /Your Order/ }));
    expect(screen.getByText('Gym')).toBeInTheDocument();
    expect(screen.getByText('Stretch')).toBeInTheDocument();
    expect(screen.queryByText(/Didn't fit/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Shortest First/ }));
    expect(screen.getByText('Stretch')).toBeInTheDocument();
    expect(screen.getByText(/Didn't fit:.*Gym/)).toBeInTheDocument();
  });

  it("Use This Schedule passes Items built from the selected option's entries", async () => {
    const { onSelect } = await renderTimeline();
    fireEvent.click(screen.getByRole('button', { name: /Your Order/ }));
    fireEvent.click(screen.getByText('Use This Schedule'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    const items = onSelect.mock.calls[0][0] as ScheduleItemCreate[];
    expect(items).toHaveLength(2);

    expect(items[0].task_id).toBe(1);
    expect(items[0].custom_name).toBeFalsy();
    expect(items[0].estimated_duration).toBe(3600);
    expect(items[0].position).toBe(0);
    expect(items[0].scheduled_time).toMatch(/Z$/);
    expect(Date.parse(items[0].scheduled_time!)).toBe(Date.parse('2026-10-02T13:00:00Z'));

    expect(items[1].task_id ?? null).toBeNull();
    expect(items[1].custom_name).toBe('Stretch');
    expect(items[1].estimated_duration).toBe(1200);
    expect(items[1].position).toBe(1);
    expect(items[1].scheduled_time).toMatch(/Z$/);
    expect(Date.parse(items[1].scheduled_time!)).toBe(Date.parse('2026-10-02T16:00:00Z'));
  });

  it('dragging a row on Your Order calls onReorder with the new activity order', async () => {
    const { onReorder } = await renderTimeline();
    fireEvent.click(screen.getByRole('button', { name: /Your Order/ }));

    const rows = ['Gym', 'Stretch'].map((n) => screen.getByText(n).closest('[draggable="true"]'));
    expect(rows[0]).not.toBeNull();
    expect(rows[1]).not.toBeNull();
    fireEvent.dragStart(rows[0]!);
    fireEvent.dragOver(rows[1]!);

    expect(onReorder).toHaveBeenCalled();
    const reordered = onReorder.mock.calls[onReorder.mock.calls.length - 1][0] as ReorderActivity[];
    expect(reordered.map((a) => a.name)).toEqual(['Stretch', 'Gym']);
    expect(reordered.map((a) => a.estimated_duration)).toEqual([1200, 3600]);
    expect(reordered[1].task_id).toBe(1);
  });
});

describe('ScheduleBuilder: saving', () => {
  it('a day Save sends the local target_date and the items, with no name', async () => {
    schedules.create.mockResolvedValue({ ...DAY_ITEMS, target_date: '2026-10-02' });
    await renderToSaveStep('2026-10-02');

    expect(screen.queryByTestId('input-schedule-name')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('btn-save-schedule'));

    await waitFor(() => expect(schedules.create).toHaveBeenCalledTimes(1));
    const body = schedules.create.mock.calls[0][0];
    expect(body.target_date).toBe('2026-10-02');
    expect(body.items).toEqual(timeline.items);
    expect(body.is_regimen).toBeFalsy();
    expect('name' in body).toBe(false);
  });

  it('a day Save on the default date sends the local today, not the UTC one', async () => {
    schedules.create.mockResolvedValue(DAY_ITEMS);
    await renderToSaveStep();
    fireEvent.click(screen.getByTestId('btn-save-schedule'));
    await waitFor(() => expect(schedules.create).toHaveBeenCalledTimes(1));
    expect(schedules.create.mock.calls[0][0].target_date).toBe('2026-09-29');
  });

  it('a Regimen Save requires a name and sends no target_date', async () => {
    schedules.create.mockResolvedValue({ ...REGIMEN, id: 21 });
    await renderToSaveStep('2026-10-02');

    fireEvent.click(screen.getByTestId('checkbox-regimen'));
    const nameInput = screen.getByTestId('input-schedule-name');
    expect(nameInput).toHaveValue('');
    expect(screen.getByTestId('btn-save-schedule')).toBeDisabled();
    fireEvent.click(screen.getByTestId('btn-save-schedule'));
    fireEvent.change(nameInput, { target: { value: '   ' } });
    expect(screen.getByTestId('btn-save-schedule')).toBeDisabled();
    expect(schedules.create).not.toHaveBeenCalled();

    fireEvent.change(nameInput, { target: { value: 'Weekday mornings' } });
    expect(screen.getByTestId('btn-save-schedule')).toBeEnabled();
    fireEvent.click(screen.getByTestId('btn-save-schedule'));

    await waitFor(() => expect(schedules.create).toHaveBeenCalledTimes(1));
    const body = schedules.create.mock.calls[0][0];
    expect(body.name).toBe('Weekday mornings');
    expect(body.is_regimen).toBe(true);
    expect(body.items).toEqual(timeline.items);
    expect('target_date' in body).toBe(false);
  });

  it('shows the save in flight, then success, and hands the Schedule up', async () => {
    const pending = deferred<Schedule>();
    schedules.create.mockReturnValue(pending.promise);
    const { onScheduleCreated } = await renderToSaveStep('2026-10-02');

    fireEvent.click(screen.getByTestId('btn-save-schedule'));
    await waitFor(() => expect(screen.getByTestId('btn-save-schedule')).toBeDisabled());
    fireEvent.click(screen.getByTestId('btn-save-schedule'));
    expect(schedules.create).toHaveBeenCalledTimes(1);

    await act(async () => { pending.resolve(DAY_ITEMS); });
    expect(await screen.findByTestId('save-success')).toBeInTheDocument();
    expect(onScheduleCreated).toHaveBeenCalledWith(DAY_ITEMS);
    expect(screen.queryByTestId('save-error')).not.toBeInTheDocument();
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('shows a failure and lets Save retry', async () => {
    schedules.create.mockRejectedValueOnce({ response: { status: 500 } });
    const { onScheduleCreated } = await renderToSaveStep('2026-10-02');

    fireEvent.click(screen.getByTestId('btn-save-schedule'));
    expect(await screen.findByTestId('save-error')).toBeInTheDocument();
    expect(screen.queryByTestId('save-success')).not.toBeInTheDocument();
    expect(screen.getByTestId('btn-save-schedule')).toBeEnabled();
    expect(onScheduleCreated).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();

    schedules.create.mockResolvedValueOnce(DAY_ITEMS);
    fireEvent.click(screen.getByTestId('btn-save-schedule'));
    expect(await screen.findByTestId('save-success')).toBeInTheDocument();
    expect(schedules.create).toHaveBeenCalledTimes(2);
    expect(onScheduleCreated).toHaveBeenCalledWith(DAY_ITEMS);
  });
});

describe('ScheduleList: day Schedules', () => {
  it("shows a nameless day Schedule by its local date", () => {
    render(
      <ScheduleList
        schedules={[DAY_ITEMS]}
        regimens={[]}
        onScheduleUpdate={vi.fn()}
        onScheduleDelete={vi.fn()}
        onApplyRegimen={vi.fn()}
      />
    );
    expect(screen.getAllByText(/Oct 2\b/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Oct 1\b/)).not.toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });
});

describe('HomePage: Regimen Apply', () => {
  async function openRegimens() {
    tasksApi.getAll.mockResolvedValue(TASKS);
    sessions.getAll.mockResolvedValue([]);
    schedules.getAll.mockResolvedValue([REGIMEN]);
    render(<HomePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Schedule' }));
    fireEvent.click(screen.getByRole('button', { name: /Regimens \(1\)/ }));
  }

  it('offers the local today and sends a local date with tz_offset', async () => {
    window.prompt = vi.fn().mockReturnValue('2026-10-02');
    schedules.applyRegimen.mockResolvedValue({ ...DAY_ITEMS, target_date: '2026-10-02' });
    await openRegimens();

    fireEvent.click(screen.getByText('Apply to Date'));
    expect((window.prompt as Mock).mock.calls[0][1]).toBe('2026-09-29');

    await waitFor(() => expect(schedules.applyRegimen).toHaveBeenCalledTimes(1));
    expect(schedules.applyRegimen).toHaveBeenCalledWith(20, { target_date: '2026-10-02', tz_offset: 300 });
    expect(new Date().getTimezoneOffset()).toBe(300);

    expect(await screen.findByTestId('apply-success')).toHaveTextContent('2026-10-02');
    expect(screen.queryByTestId('apply-error')).not.toBeInTheDocument();
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('shows an Apply failure on the page', async () => {
    window.prompt = vi.fn().mockReturnValue('2026-10-02');
    schedules.applyRegimen.mockRejectedValue({ response: { status: 422 } });
    await openRegimens();

    fireEvent.click(screen.getByText('Apply to Date'));
    expect(await screen.findByTestId('apply-error')).toBeInTheDocument();
    expect(screen.queryByTestId('apply-success')).not.toBeInTheDocument();
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('a cancelled prompt applies nothing', async () => {
    window.prompt = vi.fn().mockReturnValue(null);
    await openRegimens();
    fireEvent.click(screen.getByText('Apply to Date'));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(schedules.applyRegimen).not.toHaveBeenCalled();
  });
});
