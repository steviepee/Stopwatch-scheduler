import type { ComponentType, ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import { CalendarView } from '../components/calendar';
import ScheduleTimeline from '../components/ScheduleTimeline';
import SessionListComponent from '../components/SessionList';
import TaskDetailModal from '../components/TaskDetailModal';
import * as apiModule from '../services/api';
import type { ScheduleItem, StopwatchSession, StrategyOption, Task } from '../types';

// B70 (D128, D132), web parity with mobile's B69. `formatClock` itself is pinned in
// formatClock.test.ts; the Clock switch in OptionsPage.test.tsx.
//
// Clock (D128):
//   - `settingsAPI.getDisplay()` (GET /settings/display -> { clock_24h }) and
//     `settingsAPI.updateDisplay({ clock_24h })` (PUT /settings/display), added to api.ts with a
//     `DisplaySettings` type, same names as mobile.
//   - `src/utils/formatClock.ts` also exports a hook (`useClock24h()`, as on mobile) that loads
//     `clock_24h` on mount. The web app has no react-query: fetch in an effect, like
//     OptionsPage's Pomodoro load. Until it loads, or if it fails, the clock is 12-hour.
//     Other test files (SessionList, ManualRecording, TaskDetailModal, ...) mock
//     `../services/api` WITHOUT `settingsAPI`, and vitest throws when a missing mock export is
//     read. So the hook must touch `settingsAPI` only inside the effect's try/catch, never at
//     render or module load.
//   - Every time of day goes through `formatClock`. What this file pins:
//       calendar grid hour gutter (`calendarUtils.formatHour`): `17:00` on, `5:00 PM` off
//         (no more `5 PM`, as on mobile);
//       the Block action bar's start time (was `hhmm`, 24-hour always);
//       the Activity picker's `at <time>` line;
//       ScheduleTimeline's Start / End summary and each row's `<start> – <end>` (en dash);
//       Recordings: each row's Created line, now `data-testid="session-created-{id}"`;
//       TaskDetailModal: each time log's date line.
//     Durations and the Stopwatch display are not times of day and stay as they are, and so
//     does ScheduleBuilder's peak-hour hint (`2 PM`, pinned in ScheduleBuilder.test.tsx).
//     Dates keep their current wording; only the time-of-day part changes.
//
// Save as Recording (D132):
//   - The Block action bar (`block-action-bar`, shown while a Block is selected) gains
//     `btn-save-recording-{itemId}` ("Save as Recording").
//   - Clicking it opens the existing hand-entered form, `ManualForm` from SessionList.tsx (export
//     it), with the same testIDs (`manual-form`, `manual-name`, `manual-activity`,
//     `manual-hours`, `manual-minutes`, `manual-start`, `btn-manual-save`), taking initial
//     values: name = the Activity's name (else the Block's `custom_name`), `manual-activity` =
//     the Block's `task_id` ("" with none), hours / minutes = `estimated_duration` split into
//     whole hours and minutes, start = the Block's `scheduled_time` as local
//     `YYYY-MM-DDTHH:mm`.
//   - Everything stays editable. Editing the duration does NOT move the start (the start is the
//     Block's, as if the user had edited it).
//   - Save calls `sessionAPI.create` (the hand-entered path) with `name`, `duration`,
//     `start_time`, `end_time` = start + duration, and `task_id` when there is an Activity. On
//     success the form closes. Cancel closes it with nothing posted.
//   Not pinned: where the form sits (a modal over the calendar is fine), and telling HomePage
//   about the new Recording (an optional `onSessionCreated` prop on CalendarView is fine).
//
// These tests run in America/Chicago with Date frozen at 10:00 local on Wed 2026-09-30.

process.env.TZ = 'America/Chicago';

vi.mock('../services/api', () => ({
  taskAPI: { getAll: vi.fn(), getById: vi.fn(), update: vi.fn() },
  timeLogAPI: { delete: vi.fn() },
  sessionAPI: { create: vi.fn() },
  scheduleAPI: {
    getAll: vi.fn(),
    getRange: vi.fn(),
    placeActivity: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    removeItemFromCalendar: vi.fn(),
    clearDay: vi.fn(),
    pushToCalendar: vi.fn(),
    removeFromCalendar: vi.fn(),
  },
  settingsAPI: {
    getPomodoro: vi.fn(),
    updatePomodoro: vi.fn(),
    getDisplay: vi.fn(),
    updateDisplay: vi.fn(),
  },
  googleCalendarAPI: {
    checkAuthStatus: vi.fn(),
    login: vi.fn(),
  },
  calendarImportAPI: { getEvents: vi.fn() },
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: (props: { children: ReactNode }) => <div>{props.children}</div>,
  DragOverlay: () => null,
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, isDragging: false }),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  pointerWithin: vi.fn(),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: { toString: vi.fn().mockReturnValue('') },
    Translate: { toString: vi.fn().mockReturnValue('') },
  },
}));

type Mocks = Record<string, Mock>;
// `getDisplay` / `updateDisplay` are B70.impl's additions; reach them through the module
// namespace so tsc passes before they exist.
const api = apiModule as unknown as Record<string, Mocks>;
const settings = api.settingsAPI;
const schedule = api.scheduleAPI;
const sessions = api.sessionAPI;
const taskMock = api.taskAPI;

const View = CalendarView as unknown as ComponentType<{ tasks: Task[] }>;
const SessionList = SessionListComponent as unknown as ComponentType<{
  sessions: StopwatchSession[];
  tasks: Task[];
  onDeleteSession: (sessionId: number) => void;
  onUpdateSession: (sessionId: number, name: string) => void;
  onSessionCreated: (session: StopwatchSession) => void;
}>;

const local = (h: number, min: number, d = 30) => new Date(2026, 8, d, h, min).toISOString();

const READING: Task = { id: 1, name: 'Reading', average_duration: 1800, total_recordings: 3, created_at: '', updated_at: '' };
const TASKS: Task[] = [READING];

function block(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 11,
    schedule_id: 100,
    task_id: 1,
    task: READING,
    estimated_duration: 4500,
    position: 0,
    scheduled_time: local(8, 0),
    created_at: '',
    ...overrides,
  };
}

let items: ScheduleItem[];

function clockOn(on: boolean) {
  settings.getDisplay.mockResolvedValue({ clock_24h: on });
}

beforeEach(() => {
  Object.values(api).forEach((group) => Object.values(group).forEach((m) => m.mockReset()));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 30, 10, 0));
  items = [block()];
  schedule.getRange.mockImplementation(async () => [
    { id: 100, target_date: '2026-09-30', name: null, schedule_type: 'day', is_regimen: false, items, created_at: '', updated_at: '' },
  ]);
  api.googleCalendarAPI.checkAuthStatus.mockResolvedValue({ authenticated: true });
  api.calendarImportAPI.getEvents.mockResolvedValue([]);
  clockOn(false);
  settings.updateDisplay.mockImplementation(async (body: unknown) => body);
});

afterEach(() => {
  vi.useRealTimers();
});

async function renderCalendar() {
  render(<View tasks={TASKS} />);
  await screen.findByTestId('item-block-11');
  await waitFor(() => expect(settings.getDisplay).toHaveBeenCalled());
}

async function selectBlock(itemId = 11) {
  fireEvent.click(screen.getByTestId(`item-block-${itemId}`));
  return screen.findByTestId('block-action-bar');
}

describe('24-hour clock on the calendar (D128)', () => {
  it('the hour gutter reads 17:00 with the setting on', async () => {
    clockOn(true);
    await renderCalendar();

    expect(await screen.findByText('17:00')).toBeInTheDocument();
    expect(screen.queryByText('5 PM')).toBeNull();
    expect(screen.queryByText('5:00 PM')).toBeNull();
  });

  it('the hour gutter reads 5:00 PM with the setting off', async () => {
    await renderCalendar();

    expect(await screen.findByText('5:00 PM')).toBeInTheDocument();
    expect(screen.queryByText('5 PM')).toBeNull();
    expect(screen.queryByText('17:00')).toBeNull();
  });

  it('the Block action bar time follows the setting', async () => {
    clockOn(true);
    await renderCalendar();
    await waitFor(() => expect(screen.getByText('17:00')).toBeInTheDocument());

    expect((await selectBlock()).textContent).toMatch(/(^|\D)08:00(?!\d)/);
  });

  it('the Block action bar time is 12-hour with the setting off', async () => {
    await renderCalendar();

    const bar = await selectBlock();
    expect(bar.textContent).toMatch(/8:00 AM/);
    expect(bar.textContent).not.toMatch(/08:00/);
  });

  it("the Activity picker's time follows the setting", async () => {
    clockOn(true);
    await renderCalendar();
    await waitFor(() => expect(screen.getByText('17:00')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('day-column-2026-09-30'), { clientY: 150 }); // 08:30
    expect(await screen.findByTestId('activity-picker')).toHaveTextContent(/at 08:30/);
  });

  it("the Activity picker's time is 12-hour with the setting off", async () => {
    await renderCalendar();

    fireEvent.click(screen.getByTestId('day-column-2026-09-30'), { clientY: 150 });
    expect(await screen.findByTestId('activity-picker')).toHaveTextContent(/at 8:30 AM/);
  });

  it('is 12-hour until the setting loads', async () => {
    settings.getDisplay.mockReturnValue(new Promise(() => {}));
    await renderCalendar();

    expect(screen.getByText('5:00 PM')).toBeInTheDocument();
    expect((await selectBlock()).textContent).toMatch(/8:00 AM/);
  });

  it('is 12-hour when the setting fails to load', async () => {
    settings.getDisplay.mockRejectedValue(new Error('Network Error'));
    await renderCalendar();

    expect((await selectBlock()).textContent).toMatch(/8:00 AM/);
    expect(screen.queryByText('17:00')).toBeNull();
  });
});

describe('24-hour clock on the Schedule (D128)', () => {
  const OPTION: StrategyOption = {
    strategy: 'your-order',
    label: 'Your Order',
    description: 'As listed.',
    timeline: [
      { task_id: 1, name: 'Reading', start: local(8, 0), end: local(9, 0) },
      { task_id: null, name: 'Stretch', start: local(17, 30), end: local(17, 50) },
    ],
    flagged: [],
    excluded: [],
  };

  function renderTimeline() {
    return render(<ScheduleTimeline options={[OPTION]} onSelect={vi.fn()} onReorder={vi.fn()} />);
  }

  it('summary and rows read 24-hour with the setting on', async () => {
    clockOn(true);
    const { container } = renderTimeline();

    await waitFor(() => expect(container.textContent).toContain('17:30 – 17:50'));
    expect(container.textContent).toContain('08:00 – 09:00');
    expect(container.textContent).toMatch(/Start:\s*08:00/);
    expect(container.textContent).toMatch(/End:\s*17:50/);
    expect(container.textContent).not.toMatch(/AM|PM/);
  });

  it('summary and rows read formatClock 12-hour with the setting off', async () => {
    const { container } = renderTimeline();

    await waitFor(() => expect(settings.getDisplay).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toContain('5:30 PM – 5:50 PM'));
    expect(container.textContent).toContain('8:00 AM – 9:00 AM');
    expect(container.textContent).toMatch(/Start:\s*8:00 AM/);
    expect(container.textContent).toMatch(/End:\s*5:50 PM/);
    expect(container.textContent).not.toMatch(/08:00/);
  });
});

describe('24-hour clock on Recordings (D128)', () => {
  const SESSION = {
    id: 5,
    name: 'Reading',
    duration: 1800,
    task_id: 1,
    created_at: local(17, 30, 29),
    updated_at: local(17, 30, 29),
  } as StopwatchSession;

  function renderList() {
    render(
      <SessionList
        sessions={[SESSION]}
        tasks={TASKS}
        onDeleteSession={vi.fn()}
        onUpdateSession={vi.fn()}
        onSessionCreated={vi.fn()}
      />,
    );
  }

  it('the Created time reads 24-hour with the setting on', async () => {
    clockOn(true);
    renderList();

    await waitFor(() => expect(screen.getByTestId('session-created-5')).toHaveTextContent(/(^|\D)17:30(?!\d)/));
    expect(screen.getByTestId('session-created-5')).not.toHaveTextContent(/AM|PM/);
  });

  it('the Created time reads 12-hour with the setting off', async () => {
    renderList();

    await waitFor(() => expect(settings.getDisplay).toHaveBeenCalled());
    expect(screen.getByTestId('session-created-5')).toHaveTextContent(/5:30 PM/);
    expect(screen.getByTestId('session-created-5')).not.toHaveTextContent(/05:30/);
  });
});

describe('24-hour clock on Activity time logs (D128)', () => {
  beforeEach(() => {
    taskMock.getById.mockResolvedValue({
      ...READING,
      time_logs: [{ id: 3, task_id: 1, duration: 1800, created_at: local(17, 30, 29) }],
    });
  });

  it('a time log reads 24-hour with the setting on', async () => {
    clockOn(true);
    render(<TaskDetailModal task={READING} onClose={vi.fn()} onTaskUpdated={vi.fn()} />);

    expect(await screen.findByText(/(^|\D)17:30(?!\d)/)).toBeInTheDocument();
    expect(screen.queryByText(/5:30 PM/)).toBeNull();
  });

  it('a time log reads 12-hour with the setting off', async () => {
    render(<TaskDetailModal task={READING} onClose={vi.fn()} onTaskUpdated={vi.fn()} />);

    expect(await screen.findByText(/5:30 PM/)).toBeInTheDocument();
    expect(screen.queryByText(/05:30/)).toBeNull();
  });
});

describe('Save as Recording (D132)', () => {
  async function openFromBlock() {
    await renderCalendar();
    const bar = await selectBlock();
    fireEvent.click(within(bar).getByTestId('btn-save-recording-11'));
    return screen.findByTestId('manual-form');
  }

  function field(testId: string) {
    return screen.getByTestId(testId) as HTMLInputElement;
  }

  it('is offered on a selected Block', async () => {
    await renderCalendar();
    expect(screen.queryByTestId('btn-save-recording-11')).toBeNull();

    const bar = await selectBlock();

    expect(within(bar).getByTestId('btn-save-recording-11')).toHaveTextContent('Save as Recording');
  });

  it('opens the form filled from the Block', async () => {
    await openFromBlock();

    expect(field('manual-name').value).toBe('Reading');
    expect(field('manual-activity').value).toBe('1');
    expect(field('manual-hours').value).toBe('1');
    expect(field('manual-minutes').value).toBe('15');
    expect(field('manual-start').value).toBe('2026-09-30T08:00');
  });

  it('a Block with only a custom name opens with that name and No Activity', async () => {
    items = [block({ task_id: undefined, task: undefined, custom_name: 'Stretch', estimated_duration: 1200 })];
    await openFromBlock();

    expect(field('manual-name').value).toBe('Stretch');
    expect(field('manual-activity').value).toBe('');
    expect(Number(field('manual-hours').value || 0)).toBe(0);
    expect(field('manual-minutes').value).toBe('20');
  });

  it('posts the edited duration from the Block start through sessionAPI.create', async () => {
    sessions.create.mockResolvedValue({ id: 90, name: 'Reading', duration: 5400 });
    await openFromBlock();

    fireEvent.change(field('manual-minutes'), { target: { value: '30' } });
    expect(field('manual-start').value).toBe('2026-09-30T08:00');
    fireEvent.click(screen.getByTestId('btn-manual-save'));

    await waitFor(() => expect(sessions.create).toHaveBeenCalledTimes(1));
    expect(sessions.create).toHaveBeenCalledWith({
      name: 'Reading',
      duration: 5400,
      start_time: local(8, 0),
      end_time: local(9, 30),
      task_id: 1,
    });
    await waitFor(() => expect(screen.queryByTestId('manual-form')).toBeNull());
  });

  it('Cancel closes the form and posts nothing', async () => {
    const form = await openFromBlock();

    fireEvent.click(within(form).getByText('Cancel'));

    await waitFor(() => expect(screen.queryByTestId('manual-form')).toBeNull());
    expect(sessions.create).not.toHaveBeenCalled();
  });
});
