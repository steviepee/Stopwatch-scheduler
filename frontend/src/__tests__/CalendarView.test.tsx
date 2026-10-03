import type { ComponentType, ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import { CalendarView } from '../components/calendar';
import { scheduleAPI, sessionAPI } from '../services/api';
import type { Task } from '../types';

// B10 contract (Build 2a, D40–D45, D49, D50): the web week grid plans Activities on Schedule
// Items — the B6 and B7 behaviour, with the web differences below.
//
// Props. `CalendarView` takes `tasks: Task[]` (every Activity; HomePage passes its list) and
// may take other optional props. It loads its own Items with ONE
// `scheduleAPI.getRange(firstDay, lastDay)` for the visible range, LOCAL `YYYY-MM-DD` keys
// (week view: Sunday..Saturday), and refetches after every change it makes.
//
// Grid. Starts at 06:00; 1 px per minute (30 px per 30-minute slot). Each day column is a
// `useDroppable` with id `column-{YYYY-MM-DD}` (LOCAL date) and `data-testid`
// `day-column-{YYYY-MM-DD}`. A Block is `data-testid="item-block-{itemId}"`, sits in the column
// of its `scheduled_time`'s local date, has `style.top` = minutes since 06:00 in px and
// `style.height` = `estimated_duration` in minutes, in px, and shows the Activity name
// (`task.name`, else `custom_name`). Each Block is a `useDraggable` with id `block-{itemId}`.
//
// Bank. `data-testid="bank-panel"`, a `useDroppable` with id `bank`, search input
// `bank-search`. Lists every Activity as `bank-item-{taskId}` (a `useDraggable` with id
// `activity-{taskId}`), with a `bank-item-{taskId}-no-history` marker when `total_recordings`
// is 0. Placing never removes an Activity from the Bank.
//
// Drops (dnd-kit `onDragEnd`). The drop's y in the column is
// `active.rect.current.translated.top - over.rect.top`, snapped to 15 minutes.
//   - `activity-{taskId}` on `column-{date}` → `placeActivity(date, { task_id, scheduled_time })`,
//     UTC `Z`, and NO `estimated_duration` key (the server seeds it).
//   - `block-{itemId}` on its OWN day's column → `updateItem(scheduleId, itemId,
//     { scheduled_time })`, that key only. On another day's column → no call at all (D49).
//   - `block-{itemId}` on `bank`: not Exported → `deleteItem(scheduleId, itemId, false)`, no
//     dialog. Exported (`calendar_event_id` set) → an in-page dialog with buttons exactly
//     "Also delete from Google" / "Keep on Google" / "Cancel" → `true` / `false` / no call.
//
// Slot click (D50). Clicking empty column space opens `data-testid="activity-picker"` for the
// slot at y = `clientY - column.getBoundingClientRect().top`. It has a search input
// `activity-picker-search` and one `activity-picker-option-{taskId}` per matching Activity.
// Clicking an option calls `placeActivity(date, { task_id, scheduled_time })` for that slot and
// closes the picker. It never creates a Recording. Clicking a Block does not open the picker.
//
// Block actions (click a Block to select it):
//   - `btn-edit-block-{itemId}` toggles edit mode; it stays visible while editing.
//   - `btn-remove-google-{itemId}` only on an Exported Block; `window.confirm` first, then
//     `removeItemFromCalendar(scheduleId, itemId)`.
// Edit mode. `item-block-{itemId}-resize-handle` exists ONLY in edit mode. `mouseDown` on it,
// then `mouseMove` / `mouseUp` on `document`, resize by the clientY delta (1 px = 1 minute) →
// `updateItem(scheduleId, itemId, { estimated_duration })`, that key only, a multiple of 300,
// minimum 300. In edit mode the Block cannot move: its `useDraggable` is `disabled` (the mock
// below skips drags of disabled draggables, like dnd-kit), or its drop is ignored.
//
// Day headers. Per column: `btn-push-day-{date}` (`pushToCalendar(scheduleId)`; only when the
// day has an Item that is not Exported) and `btn-remove-day-{date}` (only when the day has
// Items). Remove day opens ONE in-page dialog, buttons exactly "Clear all" →
// `clearDay(scheduleId, true)`, "Remove from Google only" → `removeFromCalendar(scheduleId)`,
// "Cancel" → nothing. The day's Schedule is the `getRange` Schedule with that `target_date`.
//
// Feedback, for every push, remove and clear: `day-action-working` in flight, then
// `day-action-success` (a push's text includes the count of Items in the response with a
// `calendar_event_id`) or `day-action-error`. A 401 shows /authorize from a laptop/i (D14);
// no other error does. No gesture ever calls `pushToCalendar`.
//
// B18 contract (D43 revised 2026-10-03; B17 for the web): edits to Exported Blocks wait for Push.
//   - `ScheduleItem.calendar_stale` (server-set). `ItemBlock` shows `item-block-{itemId}-changed`
//     inside the Block for a stale Item; a pushed, unchanged Block and a new Block do not.
//   - `btn-push-day-{date}` shows when any of the day's Items has no `calendar_event_id` OR is
//     stale. Its label is "Push day" if any Item is new, else "Push changes". Either way it calls
//     `pushToCalendar(scheduleId)` once.
//   - Push success counts new and updated events separately, from the Items BEFORE the push: new
//     = no event id, updated = stale. Keep other digits out of the success text.
//   - Moving or resizing an Exported Block calls only `updateItem` (no Google route), then the
//     refetch shows the marker.

vi.mock('../services/api', () => ({
  taskAPI: { getAll: vi.fn(), getStats: vi.fn() },
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
  googleCalendarAPI: {
    checkAuthStatus: vi.fn().mockResolvedValue({ authenticated: true }),
  },
  calendarImportAPI: { getEvents: vi.fn().mockResolvedValue([]) },
}));

type Rect = { top: number; left: number; width: number; height: number; right: number; bottom: number };
type DndProps = {
  onDragStart?: (e: unknown) => void;
  onDragEnd?: (e: unknown) => void | Promise<void>;
};

const dnd = vi.hoisted(() => ({
  props: {} as DndProps,
  draggables: {} as Record<string, { data?: unknown; disabled?: boolean }>,
  droppables: {} as Record<string, { data?: unknown }>,
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: (props: DndProps & { children: ReactNode }) => {
    dnd.props = props;
    return <div>{props.children}</div>;
  },
  DragOverlay: () => null,
  useDraggable: (opts: { id: string; data?: unknown; disabled?: boolean }) => {
    dnd.draggables[opts.id] = { data: opts.data, disabled: opts.disabled };
    return { attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, isDragging: false };
  },
  useDroppable: (opts: { id: string; data?: unknown }) => {
    dnd.droppables[opts.id] = { data: opts.data };
    return { setNodeRef: vi.fn(), isOver: false };
  },
  pointerWithin: vi.fn(),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: { toString: vi.fn().mockReturnValue('') },
    Translate: { toString: vi.fn().mockReturnValue('') },
  },
}));

const api = scheduleAPI as unknown as Record<string, Mock>;
const sessions = sessionAPI as unknown as Record<string, Mock>;
const View = CalendarView as unknown as ComponentType<{ tasks: Task[] }>;

function rect(top: number): Rect {
  return { top, left: 0, width: 100, height: 40, right: 100, bottom: top + 40 };
}

// Simulates one dnd-kit drag: `y` is the dragged element's top relative to the drop target.
async function drag(activeId: string, overId: string | null, y = 0) {
  const draggable = dnd.draggables[activeId];
  expect(draggable).toBeDefined();
  if (draggable.disabled) return;
  const active = {
    id: activeId,
    data: { current: draggable.data },
    rect: { current: { initial: rect(0), translated: rect(y) } },
  };
  const over = overId === null
    ? null
    : { id: overId, data: { current: dnd.droppables[overId]?.data }, rect: rect(0), disabled: false };
  await act(async () => {
    dnd.props.onDragStart?.({ active });
    await dnd.props.onDragEnd?.({ active, over, delta: { x: 0, y }, collisions: [], activatorEvent: null });
  });
}

const iso = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m, d, h, min).toISOString();

const tasks: Task[] = [
  { id: 1, name: 'Reading', average_duration: 1800, total_recordings: 3, created_at: '', updated_at: '' },
  { id: 2, name: 'Running', average_duration: 0, total_recordings: 0, created_at: '', updated_at: '' },
  { id: 3, name: 'Writing', average_duration: 2700, total_recordings: 2, created_at: '', updated_at: '' },
];

// "Today" is Wednesday 2026-09-30, so the week is 2026-09-27 (Sun) .. 2026-10-03 (Sat).
function makeItem(
  id: number, scheduleId: number, task: Task, start: string, duration: number, eventId?: string, stale = false,
) {
  return {
    id,
    schedule_id: scheduleId,
    task_id: task.id,
    task,
    estimated_duration: duration,
    position: 0,
    scheduled_time: start,
    ...(eventId ? { calendar_event_id: eventId } : {}),
    calendar_stale: stale,
    created_at: '',
  };
}

type Fixture = { id: number; target_date: string; items: ReturnType<typeof makeItem>[] };
let schedules: Fixture[];

function resetSchedules() {
  schedules = [
    {
      id: 100,
      target_date: '2026-09-30',
      items: [
        makeItem(11, 100, tasks[0], iso(2026, 8, 30, 8, 0), 2700),
        makeItem(12, 100, tasks[2], iso(2026, 8, 30, 13, 0), 1800),
      ],
    },
    {
      id: 101,
      target_date: '2026-10-01',
      items: [makeItem(21, 101, tasks[2], iso(2026, 9, 1, 9, 0), 1800, 'evt-21')],
    },
  ];
}

function asSchedule(s: Fixture) {
  return {
    ...s,
    name: null,
    schedule_type: 'day',
    is_regimen: false,
    items: s.items.map((i) => ({ ...i })),
    created_at: '',
    updated_at: '',
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const httpError = (status: number) => Object.assign(new Error(`Request failed with status code ${status}`), {
  isAxiosError: true,
  response: { status, data: { detail: 'x' } },
});

async function renderView() {
  render(<View tasks={tasks} />);
  await screen.findByTestId('item-block-11');
}

async function selectBlock(itemId: number) {
  fireEvent.click(screen.getByTestId(`item-block-${itemId}`));
  await screen.findByTestId(`btn-edit-block-${itemId}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 30, 10, 0));
  dnd.props = {};
  dnd.draggables = {};
  dnd.droppables = {};
  resetSchedules();
  api.getRange.mockImplementation(async (start: string, end: string) =>
    schedules.filter((s) => s.target_date >= start && s.target_date <= end).map(asSchedule));
  api.placeActivity.mockImplementation(async (date: string, body: { task_id: number; scheduled_time: string }) => {
    let day = schedules.find((s) => s.target_date === date);
    if (!day) {
      day = { id: 300, target_date: date, items: [] };
      schedules.push(day);
    }
    const task = tasks.find((t) => t.id === body.task_id)!;
    const item = makeItem(70, day.id, task, body.scheduled_time, task.average_duration || 600);
    day.items.push(item);
    return item;
  });
  api.updateItem.mockImplementation(async (_sid: number, itemId: number, body: object) => {
    const item = schedules.flatMap((s) => s.items).find((i) => i.id === itemId)!;
    Object.assign(item, body);
    if (item.calendar_event_id && ('scheduled_time' in body || 'estimated_duration' in body)) {
      item.calendar_stale = true;
    }
    return item;
  });
  api.deleteItem.mockResolvedValue(undefined);
  api.removeItemFromCalendar.mockResolvedValue(undefined);
  api.clearDay.mockResolvedValue(undefined);
  api.removeFromCalendar.mockResolvedValue(undefined);
  api.pushToCalendar.mockImplementation(async (id: number) => {
    const s = schedules.find((x) => x.id === id)!;
    s.items.forEach((i, n) => {
      if (!i.calendar_event_id) Object.assign(i, { calendar_event_id: `evt-new-${n}` });
      i.calendar_stale = false;
    });
    return asSchedule(s);
  });
  window.confirm = vi.fn().mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CalendarView — navigation', () => {
  it('renders the Week / Day toggle and Today', async () => {
    await renderView();
    expect(screen.getByText('Week')).toBeInTheDocument();
    expect(screen.getByText('Day')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Today'));
    expect(screen.getByText('Week')).toBeInTheDocument();
  });

  it('loads the visible week with one getRange call on local dates', async () => {
    await renderView();
    expect(api.getRange).toHaveBeenCalledWith('2026-09-27', '2026-10-03');
    expect(screen.getByTestId('day-column-2026-09-27')).toBeInTheDocument();
    expect(screen.getByTestId('day-column-2026-10-03')).toBeInTheDocument();
  });
});

describe('CalendarView — Blocks and Bank', () => {
  it('renders Blocks from Schedule Items in their day column at the right offset and height', async () => {
    await renderView();
    const block = screen.getByTestId('item-block-11');
    expect(within(screen.getByTestId('day-column-2026-09-30')).getByTestId('item-block-11')).toBe(block);
    expect(within(block).getByText('Reading')).toBeInTheDocument();
    expect(block.style.top).toBe('120px');
    expect(block.style.height).toBe('45px');
    expect(within(screen.getByTestId('day-column-2026-10-01')).getByTestId('item-block-21')).toBeInTheDocument();
  });

  it('lists every Activity in the Bank, search narrows it, and no history is marked', async () => {
    await renderView();
    const bank = screen.getByTestId('bank-panel');
    for (const t of tasks) expect(within(bank).getByTestId(`bank-item-${t.id}`)).toBeInTheDocument();
    expect(within(bank).getByTestId('bank-item-2-no-history')).toBeInTheDocument();
    expect(within(bank).queryByTestId('bank-item-1-no-history')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('bank-search'), { target: { value: 'writ' } });
    expect(within(bank).getByTestId('bank-item-3')).toBeInTheDocument();
    expect(within(bank).queryByTestId('bank-item-1')).not.toBeInTheDocument();
    expect(within(bank).queryByTestId('bank-item-2')).not.toBeInTheDocument();
  });
});

describe('CalendarView — placing Activities', () => {
  it('a Bank drop places the Activity at the snapped local time, with no duration, and it stays in the Bank', async () => {
    await renderView();
    const callsBefore = api.getRange.mock.calls.length;
    await drag('activity-1', 'column-2026-10-02', 140); // 06:00 + 140 min = 08:20 → 08:15

    expect(api.placeActivity).toHaveBeenCalledTimes(1);
    const [date, body] = api.placeActivity.mock.calls[0];
    expect(date).toBe('2026-10-02');
    expect(body).toEqual({ task_id: 1, scheduled_time: expect.stringMatching(/Z$/) });
    expect('estimated_duration' in body).toBe(false);
    expect(new Date(body.scheduled_time).toISOString()).toBe(iso(2026, 9, 2, 8, 15));

    expect(await screen.findByTestId('item-block-70')).toBeInTheDocument();
    expect(api.getRange.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(screen.getByTestId('bank-item-1')).toBeInTheDocument();
    expect(sessions.create).not.toHaveBeenCalled();
    expect(api.pushToCalendar).not.toHaveBeenCalled();
  });

  it('clicking an empty slot opens an Activity picker that places the chosen Activity there', async () => {
    await renderView();
    fireEvent.click(screen.getByTestId('day-column-2026-09-30'), { clientY: 150 }); // 08:30
    const picker = await screen.findByTestId('activity-picker');

    fireEvent.change(within(picker).getByTestId('activity-picker-search'), { target: { value: 'run' } });
    expect(within(picker).queryByTestId('activity-picker-option-1')).not.toBeInTheDocument();
    fireEvent.click(within(picker).getByTestId('activity-picker-option-2'));

    await waitFor(() => expect(api.placeActivity).toHaveBeenCalledTimes(1));
    const [date, body] = api.placeActivity.mock.calls[0];
    expect(date).toBe('2026-09-30');
    expect(Object.keys(body).sort()).toEqual(['scheduled_time', 'task_id']);
    expect(body.task_id).toBe(2);
    expect(body.scheduled_time).toMatch(/Z$/);
    expect(new Date(body.scheduled_time).toISOString()).toBe(iso(2026, 8, 30, 8, 30));
    await waitFor(() => expect(screen.queryByTestId('activity-picker')).not.toBeInTheDocument());
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('clicking a Block does not open the picker', async () => {
    await renderView();
    fireEvent.click(screen.getByTestId('item-block-11'), { clientY: 130 });
    expect(screen.queryByTestId('activity-picker')).not.toBeInTheDocument();
  });
});

describe('CalendarView — moving and removing Blocks', () => {
  it('moving a Block within its day calls updateItem with the snapped time only', async () => {
    await renderView();
    await drag('block-11', 'column-2026-09-30', 187); // 06:00 + 187 min = 09:07 → 09:00

    expect(api.updateItem).toHaveBeenCalledTimes(1);
    const [sid, itemId, body] = api.updateItem.mock.calls[0];
    expect([sid, itemId]).toEqual([100, 11]);
    expect(Object.keys(body)).toEqual(['scheduled_time']);
    expect(body.scheduled_time).toMatch(/Z$/);
    expect(new Date(body.scheduled_time).toISOString()).toBe(iso(2026, 8, 30, 9, 0));
    expect(api.pushToCalendar).not.toHaveBeenCalled();
  });

  it('a drop in another day column makes no call', async () => {
    await renderView();
    await drag('block-11', 'column-2026-10-01', 187);
    await drag('block-21', 'column-2026-09-30', 60);
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(api.placeActivity).not.toHaveBeenCalled();
    expect(api.deleteItem).not.toHaveBeenCalled();
    expect(screen.getByTestId('item-block-11')).toBeInTheDocument();
  });

  it('a plain Block dropped on the Bank is deleted without a dialog', async () => {
    await renderView();
    await drag('block-12', 'bank');
    await waitFor(() => expect(api.deleteItem).toHaveBeenCalledWith(100, 12, false));
    expect(screen.queryByRole('button', { name: 'Also delete from Google' })).not.toBeInTheDocument();
  });

  it.each([
    ['Also delete from Google', true],
    ['Keep on Google', false],
  ])('an Exported Block dropped on the Bank asks first: "%s"', async (label, deleteEvent) => {
    await renderView();
    await drag('block-21', 'bank');
    expect(api.deleteItem).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: label }));
    await waitFor(() => expect(api.deleteItem).toHaveBeenCalledWith(101, 21, deleteEvent));
    expect(api.deleteItem).toHaveBeenCalledTimes(1);
  });

  it('an Exported Block dropped on the Bank, then Cancel, deletes nothing', async () => {
    await renderView();
    await drag('block-21', 'bank');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Keep on Google' })).not.toBeInTheDocument());
    expect(api.deleteItem).not.toHaveBeenCalled();
  });
});

describe('CalendarView — Block actions and edit mode', () => {
  it('Remove from Google is only on Exported Blocks and confirms first', async () => {
    await renderView();
    await selectBlock(11);
    expect(screen.queryByTestId('btn-remove-google-11')).not.toBeInTheDocument();

    await selectBlock(21);
    (window.confirm as Mock).mockReturnValueOnce(false);
    fireEvent.click(screen.getByTestId('btn-remove-google-21'));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(api.removeItemFromCalendar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('btn-remove-google-21'));
    await waitFor(() => expect(api.removeItemFromCalendar).toHaveBeenCalledWith(101, 21));
  });

  it('edit mode on: handle present, move ignored, resize snaps to 5 minutes', async () => {
    await renderView();
    expect(screen.queryByTestId('item-block-12-resize-handle')).not.toBeInTheDocument();
    await selectBlock(12);
    expect(screen.queryByTestId('item-block-12-resize-handle')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('btn-edit-block-12'));
    const handle = await screen.findByTestId('item-block-12-resize-handle');

    await drag('block-12', 'column-2026-09-30', 300);
    expect(api.updateItem).not.toHaveBeenCalled();

    fireEvent.mouseDown(handle, { clientY: 500 });
    fireEvent.mouseMove(document, { clientY: 537 });
    fireEvent.mouseUp(document, { clientY: 537 });
    // 1800 s + 37 min = 4020 s → 3900 s (13 × 5 min)
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(1));
    const [sid, itemId, body] = api.updateItem.mock.calls[0];
    expect([sid, itemId]).toEqual([100, 12]);
    expect(body).toEqual({ estimated_duration: 3900 });
    expect(api.pushToCalendar).not.toHaveBeenCalled();
  });

  it('a resize never goes below 5 minutes', async () => {
    await renderView();
    await selectBlock(12);
    fireEvent.click(screen.getByTestId('btn-edit-block-12'));
    const handle = await screen.findByTestId('item-block-12-resize-handle');
    fireEvent.mouseDown(handle, { clientY: 500 });
    fireEvent.mouseMove(document, { clientY: 380 });
    fireEvent.mouseUp(document, { clientY: 380 });
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith(100, 12, { estimated_duration: 300 }));
  });

  it('edit mode off: no handle and the Block moves again', async () => {
    await renderView();
    await selectBlock(12);
    fireEvent.click(screen.getByTestId('btn-edit-block-12'));
    await screen.findByTestId('item-block-12-resize-handle');

    fireEvent.click(screen.getByTestId('btn-edit-block-12'));
    await waitFor(() =>
      expect(screen.queryByTestId('item-block-12-resize-handle')).not.toBeInTheDocument());

    await drag('block-12', 'column-2026-09-30', 480); // 14:00
    expect(api.updateItem).toHaveBeenCalledTimes(1);
    const body = api.updateItem.mock.calls[0][2];
    expect(Object.keys(body)).toEqual(['scheduled_time']);
    expect(new Date(body.scheduled_time).toISOString()).toBe(iso(2026, 8, 30, 14, 0));
  });
});

// B15 contract: a Block renders at least 24 px tall; above that, height stays exactly
// `estimated_duration` in minutes. `style.top` is unchanged. A resize still computes from the
// Item's `estimated_duration`, not the rendered height.
describe('CalendarView — short Blocks', () => {
  function addShortBlock() {
    schedules.push({
      id: 102,
      target_date: '2026-10-02',
      items: [makeItem(31, 102, tasks[0], iso(2026, 9, 2, 7, 0), 300)],
    });
  }

  it('a 5-minute Block renders 24 px tall; a 45-minute Block still renders 45 px', async () => {
    addShortBlock();
    await renderView();
    const short = screen.getByTestId('item-block-31');
    expect(short.style.height).toBe('24px');
    expect(short.style.top).toBe('60px');
    expect(screen.getByTestId('item-block-11').style.height).toBe('45px');
  });

  it('a 5-minute Block can be selected by clicking it, and its actions show', async () => {
    addShortBlock();
    await renderView();
    fireEvent.click(screen.getByTestId('item-block-31'));
    expect(await screen.findByTestId('btn-edit-block-31')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-picker')).not.toBeInTheDocument();
  });

  it('resizing a 5-minute Block by +10 px sends estimated_duration 900', async () => {
    addShortBlock();
    await renderView();
    await selectBlock(31);
    fireEvent.click(screen.getByTestId('btn-edit-block-31'));
    const handle = await screen.findByTestId('item-block-31-resize-handle');
    fireEvent.mouseDown(handle, { clientY: 500 });
    fireEvent.mouseMove(document, { clientY: 510 });
    fireEvent.mouseUp(document, { clientY: 510 });
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith(102, 31, { estimated_duration: 900 }));
    expect(api.updateItem).toHaveBeenCalledTimes(1);
  });
});

describe('CalendarView — Push day and Remove day', () => {
  it('shows Push day only with a non-Exported Item, Remove day only with Items', async () => {
    await renderView();
    expect(screen.getByTestId('btn-push-day-2026-09-30')).toBeInTheDocument();
    expect(screen.getByTestId('btn-remove-day-2026-09-30')).toBeInTheDocument();
    expect(screen.queryByTestId('btn-push-day-2026-10-01')).not.toBeInTheDocument();
    expect(screen.getByTestId('btn-remove-day-2026-10-01')).toBeInTheDocument();
    expect(screen.queryByTestId('btn-push-day-2026-10-02')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-remove-day-2026-10-02')).not.toBeInTheDocument();
  });

  it('Push day shows working, then success with the event count', async () => {
    await renderView();
    const d = deferred<unknown>();
    const real = api.pushToCalendar.getMockImplementation()!;
    api.pushToCalendar.mockImplementationOnce((id: number) => d.promise.then(() => real(id)));

    fireEvent.click(screen.getByTestId('btn-push-day-2026-09-30'));
    expect(await screen.findByTestId('day-action-working')).toBeInTheDocument();
    expect(api.pushToCalendar).toHaveBeenCalledWith(100);

    await act(async () => { d.resolve(undefined); });
    const success = await screen.findByTestId('day-action-success');
    expect(success.textContent).toMatch(/\b2\b/);
    expect(screen.queryByTestId('day-action-working')).not.toBeInTheDocument();
  });

  it('a push failure is shown, without the laptop message for a 500', async () => {
    await renderView();
    api.pushToCalendar.mockRejectedValueOnce(httpError(500));
    fireEvent.click(screen.getByTestId('btn-push-day-2026-09-30'));
    expect(await screen.findByTestId('day-action-error')).toBeInTheDocument();
    expect(screen.queryByTestId('day-action-success')).not.toBeInTheDocument();
    expect(screen.queryByText(/authorize from a laptop/i)).not.toBeInTheDocument();
  });

  it('a 401 on push says to authorize from a laptop', async () => {
    await renderView();
    api.pushToCalendar.mockRejectedValueOnce(httpError(401));
    fireEvent.click(screen.getByTestId('btn-push-day-2026-09-30'));
    expect(await screen.findByTestId('day-action-error')).toBeInTheDocument();
    expect(screen.getAllByText(/authorize from a laptop/i).length).toBeGreaterThan(0);
  });

  it('Remove day → Clear all clears the day with its Google events', async () => {
    await renderView();
    fireEvent.click(screen.getByTestId('btn-remove-day-2026-10-01'));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(api.clearDay).toHaveBeenCalledWith(101, true));
    expect(api.removeFromCalendar).not.toHaveBeenCalled();
    expect(await screen.findByTestId('day-action-success')).toBeInTheDocument();
  });

  it('Remove day → Remove from Google only keeps the Items', async () => {
    await renderView();
    fireEvent.click(screen.getByTestId('btn-remove-day-2026-10-01'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from Google only' }));
    await waitFor(() => expect(api.removeFromCalendar).toHaveBeenCalledWith(101));
    expect(api.clearDay).not.toHaveBeenCalled();
    expect(await screen.findByTestId('day-action-success')).toBeInTheDocument();
  });

  it('Remove day → Cancel does nothing', async () => {
    await renderView();
    fireEvent.click(screen.getByTestId('btn-remove-day-2026-10-01'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument());
    expect(api.clearDay).not.toHaveBeenCalled();
    expect(api.removeFromCalendar).not.toHaveBeenCalled();
    expect(screen.queryByTestId('day-action-working')).not.toBeInTheDocument();
  });

  it('a failed Clear all is shown', async () => {
    await renderView();
    api.clearDay.mockRejectedValueOnce(httpError(500));
    fireEvent.click(screen.getByTestId('btn-remove-day-2026-10-01'));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear all' }));
    expect(await screen.findByTestId('day-action-error')).toBeInTheDocument();
  });
});

describe('CalendarView — changed marker and Push changes', () => {
  // Schedule 103 on Friday 2026-10-02; `items` picks which Items it holds.
  function addDay(items: ReturnType<typeof makeItem>[]) {
    schedules.push({ id: 103, target_date: '2026-10-02', items });
  }
  const at = (h: number) => iso(2026, 9, 2, h, 0);
  const stale = (id: number, h: number) => makeItem(id, 103, tasks[0], at(h), 1800, `evt-${id}`, true);
  const fresh = (id: number, h: number) => makeItem(id, 103, tasks[0], at(h), 1800, `evt-${id}`);
  const unpushed = (id: number, h: number) => makeItem(id, 103, tasks[2], at(h), 1800);

  it('a stale Block shows the marker; a fresh pushed Block and a new Block do not', async () => {
    addDay([stale(41, 8), fresh(42, 10), unpushed(43, 12)]);
    await renderView();
    const staleBlock = screen.getByTestId('item-block-41');
    expect(within(staleBlock).getByTestId('item-block-41-changed')).toBeInTheDocument();
    expect(screen.queryByTestId('item-block-42-changed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('item-block-43-changed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('item-block-21-changed')).not.toBeInTheDocument();
  });

  it('no push button when every Item is pushed and none is stale', async () => {
    addDay([fresh(42, 10), fresh(44, 14)]);
    await renderView();
    expect(screen.getByTestId('btn-remove-day-2026-10-02')).toBeInTheDocument();
    expect(screen.queryByTestId('btn-push-day-2026-10-02')).not.toBeInTheDocument();
  });

  it('reads "Push changes" when only stale Items need pushing, calls pushToCalendar once, and counts the update', async () => {
    addDay([stale(41, 8), fresh(42, 10), fresh(44, 14)]);
    await renderView();

    const button = screen.getByTestId('btn-push-day-2026-10-02');
    expect(button).toHaveTextContent(/push changes/i);
    expect(button).not.toHaveTextContent(/push day/i);

    fireEvent.click(button);
    await waitFor(() => expect(api.pushToCalendar).toHaveBeenCalledWith(103));
    expect(api.pushToCalendar).toHaveBeenCalledTimes(1);
    const success = await screen.findByTestId('day-action-success');
    expect(success.textContent).toMatch(/\b1\b/);
    expect(success.textContent).not.toMatch(/\b3\b/);

    await waitFor(() =>
      expect(screen.queryByTestId('btn-push-day-2026-10-02')).not.toBeInTheDocument());
    expect(screen.queryByTestId('item-block-41-changed')).not.toBeInTheDocument();
  });

  it('reads "Push day" when any Item is new, even with stale Items, and calls pushToCalendar once', async () => {
    addDay([stale(41, 8), unpushed(43, 10), unpushed(45, 12), fresh(44, 14)]);
    await renderView();

    const button = screen.getByTestId('btn-push-day-2026-10-02');
    expect(button).toHaveTextContent(/push day/i);
    expect(button).not.toHaveTextContent(/push changes/i);

    fireEvent.click(button);
    await waitFor(() => expect(api.pushToCalendar).toHaveBeenCalledWith(103));
    expect(api.pushToCalendar).toHaveBeenCalledTimes(1);
    const success = await screen.findByTestId('day-action-success');
    expect(success.textContent).toMatch(/\b2\b/);
    expect(success.textContent).toMatch(/\b1\b/);
    expect(success.textContent).not.toMatch(/\b4\b/);
  });

  it('the B10 day with only new Items still reads "Push day"', async () => {
    await renderView();
    expect(screen.getByTestId('btn-push-day-2026-09-30')).toHaveTextContent(/push day/i);
  });

  it('moving an Exported Block calls updateItem only, then the marker and Push changes appear', async () => {
    await renderView();
    expect(screen.queryByTestId('item-block-21-changed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-push-day-2026-10-01')).not.toBeInTheDocument();
    const callsBefore = api.getRange.mock.calls.length;

    await drag('block-21', 'column-2026-10-01', 240); // 10:00

    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(Object.keys(api.updateItem.mock.calls[0][2])).toEqual(['scheduled_time']);
    expect(await screen.findByTestId('item-block-21-changed')).toBeInTheDocument();
    expect(api.getRange.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(screen.getByTestId('btn-push-day-2026-10-01')).toHaveTextContent(/push changes/i);

    expect(api.pushToCalendar).not.toHaveBeenCalled();
    expect(api.removeItemFromCalendar).not.toHaveBeenCalled();
    expect(api.removeFromCalendar).not.toHaveBeenCalled();
    expect(api.clearDay).not.toHaveBeenCalled();
    expect(api.deleteItem).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.queryByTestId('day-action-error')).not.toBeInTheDocument();
  });

  it('resizing an Exported Block calls updateItem only, then the marker appears', async () => {
    await renderView();
    await selectBlock(21);
    fireEvent.click(screen.getByTestId('btn-edit-block-21'));
    const handle = await screen.findByTestId('item-block-21-resize-handle');
    fireEvent.mouseDown(handle, { clientY: 500 });
    fireEvent.mouseMove(document, { clientY: 515 });
    fireEvent.mouseUp(document, { clientY: 515 });

    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith(101, 21, { estimated_duration: 2700 }));
    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('item-block-21-changed')).toBeInTheDocument();

    expect(api.pushToCalendar).not.toHaveBeenCalled();
    expect(api.removeItemFromCalendar).not.toHaveBeenCalled();
    expect(api.removeFromCalendar).not.toHaveBeenCalled();
    expect(api.clearDay).not.toHaveBeenCalled();
    expect(api.deleteItem).not.toHaveBeenCalled();
    expect(screen.queryByTestId('day-action-error')).not.toBeInTheDocument();
  });
});
