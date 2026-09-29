import type { ComponentType, ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import ScheduleBuilderComponent from '../components/ScheduleBuilder';
import ScheduleListComponent from '../components/ScheduleList';
import HomePage from '../pages/HomePage';
import { scheduleAPI, sessionAPI, taskAPI } from '../services/api';
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
  },
  googleCalendarAPI: {
    checkAuthStatus: vi.fn().mockResolvedValue({ authenticated: false }),
    login: vi.fn(),
  },
  calendarImportAPI: { getEvents: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../components/calendar', () => ({ CalendarView: () => null }));

type TimelineProps = {
  activities: unknown[];
  startTime: Date;
  existingEvents: { name: string; start: string; end: string }[];
  onSelect: (ordered: unknown[], items: ScheduleItemCreate[]) => void;
};

const timeline = vi.hoisted(() => ({
  props: null as unknown,
  items: [
    { task_id: 1, estimated_duration: 1800, position: 0, scheduled_time: '2026-10-02T13:00:00.000Z' },
    { custom_name: 'Stretch', estimated_duration: 1200, position: 1, scheduled_time: '2026-10-02T13:30:00.000Z' },
  ],
}));

vi.mock('../components/ScheduleTimeline', () => ({
  default: (props: TimelineProps): ReactNode => {
    timeline.props = props;
    return (
      <button onClick={() => props.onSelect(props.activities, timeline.items)}>Use This Schedule</button>
    );
  },
}));

const schedules = scheduleAPI as unknown as Record<string, Mock>;
const tasksApi = taskAPI as unknown as Record<string, Mock>;
const sessions = sessionAPI as unknown as Record<string, Mock>;

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

async function renderToGenerateStep(date?: string) {
  const onScheduleCreated = vi.fn();
  render(<ScheduleBuilder tasks={TASKS} onScheduleCreated={onScheduleCreated} />);
  if (date) fireEvent.change(screen.getByTestId('input-target-date'), { target: { value: date } });
  fireEvent.change(screen.getByPlaceholderText('Activity name (e.g. Go for a run)'), { target: { value: 'Stretch' } });
  fireEvent.change(screen.getByPlaceholderText('min'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  fireEvent.click(screen.getByText('Generate Schedule Options'));
  await screen.findByText('Use This Schedule');
  return { onScheduleCreated };
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
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ScheduleBuilder: generating around the day', () => {
  it('defaults the date to the local today', () => {
    render(<ScheduleBuilder tasks={TASKS} onScheduleCreated={vi.fn()} />);
    expect(screen.getByTestId('input-target-date')).toHaveValue('2026-09-29');
  });

  it("passes the day's existing Items to the timeline as existingEvents", async () => {
    schedules.getRange.mockResolvedValue([DAY_ITEMS]);
    await renderToGenerateStep('2026-10-02');

    expect(schedules.getRange).toHaveBeenCalledWith('2026-10-02', '2026-10-02');
    await waitFor(() => {
      const events = (timeline.props as TimelineProps).existingEvents;
      expect(events).toHaveLength(2);
    });
    const events = (timeline.props as TimelineProps).existingEvents;
    for (const e of events) {
      expect(e.start).toMatch(/Z$/);
      expect(e.end).toMatch(/Z$/);
    }
    const byName = Object.fromEntries(events.map((e) => [e.name, e]));
    expect(Date.parse(byName.Gym.start)).toBe(Date.parse('2026-10-02T15:00:00Z'));
    expect(Date.parse(byName.Gym.end)).toBe(Date.parse('2026-10-02T16:00:00Z'));
    expect(Date.parse(byName.Dentist.start)).toBe(Date.parse('2026-10-02T19:30:00Z'));
    expect(Date.parse(byName.Dentist.end)).toBe(Date.parse('2026-10-02T20:00:00Z'));
    expect(byName.Someday).toBeUndefined();
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
