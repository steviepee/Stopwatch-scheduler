import type { ComponentType, ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi, type Mock, type MockInstance } from 'vitest';
import { CalendarView } from '../components/calendar';
import * as apiModule from '../services/api';
import type { Task } from '../types';

// B67 (D94, D100, D101, D103, D111, D117, D118, D121, D123, D127), web parity with mobile's
// B65 (mobile/src/__tests__/CoachScreen.test.tsx). Every test goes through CalendarView, so the
// panel's file and props are free (a `src/components/CoachPanel.tsx` taking the date, the
// `tasks`, a close callback and an accepted callback is the obvious shape).
//
// API methods (add to `coachAPI` in `src/services/api.ts`, same names and routes as mobile;
// types in `src/types/index.ts`):
//   coachAPI.openConversation({ target_date, tz_offset })  POST /coach/conversations  -> CoachConversation
//     (no trailing slash: `/coach/conversations/` is a 405, U15)
//   coachAPI.sendMessage(id, { text })                     POST /coach/conversations/{id}/messages
//   coachAPI.accept(id)                                    POST /coach/conversations/{id}/accept -> Schedule
//   coachAPI.reject(id)                                    POST /coach/conversations/{id}/reject
//   coachAPI.startOver(id)                                 POST /coach/conversations/{id}/start-over -> CoachConversation
//   coachAPI.rate(id, { rating })                          PUT  /coach/conversations/{id}/rating
//   coachAPI.createNote({ text })                          (exists, B66)
// `tz_offset` is `new Date().getTimezoneOffset()`. The conversation shape is mobile's
// `CoachConversation` (id, target_date, status, messages, proposal, changes_left,
// messages_left, day_items, note_suggestion). Proposal items carry no Activity name: the panel
// looks it up in CalendarView's `tasks` prop (no extra fetch).
//
// Calendar (`CalendarView.tsx`):
//   - In the DAY view only, `btn-plan-coach` ("Plan with Coach") shows for today and future
//     dates, never past ones, and never in the week view.
//   - Offline (`navigator.onLine === false`) it is disabled and `coach-offline` reads
//     `You're offline — the Coach needs a connection.` (em dash). Nothing is queued. Reading
//     `navigator.onLine` at render is enough for the test; listening for `online` / `offline`
//     is better for the real app.
//   - Clicking it opens a full-screen panel, `coach-panel`, for the shown LOCAL date.
//     `btn-coach-close` ("Close") closes it and shows the calendar again.
//
// Panel (same testIDs and texts as mobile unless said):
//   - On open calls `openConversation` once. Messages render as `coach-message-<i>` (index into
//     `messages`) showing `visible_text`.
//   - While open or a message is pending: `coach-thinking` reads `Coach is thinking…`, and the
//     input `coach-input` and the button `coach-send` are `disabled`. Send posts
//     `sendMessage(id, { text })` with the text trimmed, then shows the returned conversation
//     and clears the input.
//   - A Proposal renders the whole day in time order (D123): `proposal-item-<i>` (start through
//     `formatClock`, 12-hour here, the Activity name or `new_activity_name`,
//     `<duration_minutes> min`, `proposal-frog-<i>` when `is_frog`, `proposal-new-<i>` "New"),
//     each timed `day_items` entry as `day-item-<i>` (index into `day_items`, read-only, its
//     name), all-day entries inside `coach-all-day` above the list and with no `day-item-<i>`.
//     Styling by class on the testID'd element (the web has no inline colours to compare):
//     Proposal items have class `coach-row-proposal`, `on_google` day items `coach-row-google`,
//     other day items `coach-row-block`; each row has exactly one of the three.
//   - `btn-accept` ("Accept") and `btn-reject` ("Reject") below the Proposal.
//   - `btn-where-from` ("Where this came from") above it; CLICKING shows `where-from-list` with
//     one `where-from-<i>` per item: the name, the source label (`You said`, `Your history`,
//     `Coach's guess`, straight apostrophe), the `reason`, and for an item with a `task_id`
//     `<recording_count> Recordings, typical <round(typical_seconds / 60)> min`.
//   - From the first Proposal on, `coach-limits` reads
//     `<changes_left> plan changes left, <messages_left> messages left`. None before it.
//   - `note_suggestion` → `coach-note-suggestion` with `Save this note?` and the text, plus
//     `btn-note-yes` / `btn-note-no`. Yes calls `createNote({ text })`; both hide it.
//   - Accept calls `accept(id)`, then the calendar reloads its range (`scheduleAPI.getRange`
//     is called again) and the panel shows `coach-accepted` with `btn-coach-push-day`
//     ("Push day", `scheduleAPI.pushToCalendar(<returned schedule id>)`) and `btn-rate-up` /
//     `btn-rate-down` (`rate(id, { rating: 'up' | 'down' })`).
//   - Reject calls `reject(id)` and closes the panel (the web's `router.back()`).
//   - `btn-start-over` ("Start over") asks first with `window.confirm` (any text); only a true
//     answer calls `startOver(id)`, then the panel shows the returned conversation.
//   - A failed send shows `coach-error` with the server's `detail` (409:
//     `message limit reached`). Accept, Reject and Start over stay enabled.
//
// These tests run in America/Chicago with Date frozen at 10:00 local on Wed 2026-09-30.

process.env.TZ = 'America/Chicago';

vi.mock('../services/api', () => ({
  taskAPI: { getAll: vi.fn() },
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
  settingsAPI: { getDisplay: vi.fn() },
  googleCalendarAPI: { checkAuthStatus: vi.fn() },
  calendarImportAPI: { getEvents: vi.fn() },
  coachAPI: {
    openConversation: vi.fn(),
    sendMessage: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
    startOver: vi.fn(),
    rate: vi.fn(),
    createNote: vi.fn(),
  },
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
// The new coachAPI methods are B67.impl's additions; reach them through the module namespace
// so tsc passes before they exist.
const api = apiModule as unknown as Record<string, Mocks>;
const coach = api.coachAPI;
const schedule = api.scheduleAPI;

const View = CalendarView as unknown as ComponentType<{ tasks: Task[] }>;

const TODAY = '2026-09-30';
const TOMORROW = '2026-10-01';
const tomorrowAt = (h: number, min = 0) => new Date(2026, 9, 1, h, min).toISOString();

const FOCUS: Task = {
  id: 11, name: 'Focus work', average_duration: 5400, total_recordings: 12, created_at: '', updated_at: '',
};

const PROPOSAL = {
  summary: 'Focus first, tango in the evening.',
  items: [
    {
      task_id: 11,
      new_activity_name: null,
      start: '09:00',
      duration_minutes: 90,
      is_frog: true,
      source: 'history',
      reason: 'You usually do focus work in the morning.',
      recording_count: 12,
      typical_seconds: 5400,
    },
    {
      task_id: null,
      new_activity_name: 'Tango',
      start: '18:00',
      duration_minutes: 30,
      is_frog: false,
      source: 'you_said',
      reason: 'You asked for 30-minute sittings.',
    },
  ],
};

const DAY_ITEMS = [
  { kind: 'event', name: 'Holiday', start: TOMORROW, end: '2026-10-02', all_day: true, on_google: true },
  { kind: 'event', name: 'Standup', start: tomorrowAt(8), end: tomorrowAt(8, 30), all_day: false, on_google: true },
  { kind: 'block', name: 'Lunch', start: tomorrowAt(12), end: tomorrowAt(13), all_day: false, on_google: false },
  { kind: 'block', name: 'Gym', start: tomorrowAt(15), end: tomorrowAt(15, 30), all_day: false, on_google: true },
];

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    target_date: TOMORROW,
    status: 'open',
    messages: [{ role: 'assistant', visible_text: 'What matters most tomorrow?', created_at: '2026-09-30T15:00:00Z' }],
    proposal: null,
    changes_left: null,
    messages_left: null,
    day_items: [],
    note_suggestion: null,
    ...overrides,
  };
}

function withProposal(overrides: Record<string, unknown> = {}) {
  return conversation({ proposal: PROPOSAL, changes_left: 2, messages_left: 4, day_items: DAY_ITEMS, ...overrides });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const ROW_CLASSES = ['coach-row-proposal', 'coach-row-google', 'coach-row-block'];

function rowKind(testId: string): string[] {
  const el = screen.getByTestId(testId);
  return ROW_CLASSES.filter((c) => el.classList.contains(c));
}

let onLineSpy: MockInstance | null = null;
let confirmMock: Mock;

beforeEach(() => {
  Object.values(api).forEach((group) => Object.values(group).forEach((m) => m.mockReset()));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 30, 10, 0));
  schedule.getRange.mockResolvedValue([]);
  api.settingsAPI.getDisplay.mockResolvedValue({ clock_24h: false });
  api.googleCalendarAPI.checkAuthStatus.mockResolvedValue({ authenticated: true });
  api.calendarImportAPI.getEvents.mockResolvedValue([]);
  coach.openConversation.mockResolvedValue(conversation());
  confirmMock = vi.fn(() => false);
  vi.stubGlobal('confirm', confirmMock);
});

afterEach(() => {
  onLineSpy?.mockRestore();
  onLineSpy = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function navButtons(container: HTMLElement) {
  const [prev, next] = Array.from(container.querySelectorAll<HTMLButtonElement>('.nav-btn'));
  return { prev, next };
}

// Renders the calendar in the day view, `daysAhead` days from today.
async function renderDay(daysAhead = 0) {
  const utils = render(<View tasks={[FOCUS]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Day' }));
  const { prev, next } = navButtons(utils.container);
  for (let i = 0; i < Math.abs(daysAhead); i++) fireEvent.click(daysAhead > 0 ? next : prev);
  await waitFor(() => expect(schedule.getRange).toHaveBeenCalled());
  return utils;
}

async function openCoach() {
  const utils = await renderDay(1);
  fireEvent.click(await screen.findByTestId('btn-plan-coach'));
  await screen.findByTestId('coach-panel');
  return utils;
}

async function send(text: string) {
  fireEvent.change(screen.getByTestId('coach-input'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('coach-send'));
}

describe('Plan with Coach on the calendar day view', () => {
  it('shows for today and tomorrow, opening the Coach for that date, and is hidden for past dates and the week view', async () => {
    const { container } = render(<View tasks={[FOCUS]} />);
    await waitFor(() => expect(schedule.getRange).toHaveBeenCalled());
    expect(screen.queryByTestId('btn-plan-coach')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    const button = await screen.findByTestId('btn-plan-coach');
    expect(button).toHaveTextContent('Plan with Coach');
    fireEvent.click(button);
    await screen.findByTestId('coach-panel');
    await waitFor(() => expect(coach.openConversation).toHaveBeenCalledTimes(1));
    expect(coach.openConversation).toHaveBeenCalledWith({
      target_date: TODAY,
      tz_offset: new Date().getTimezoneOffset(),
    });

    fireEvent.click(screen.getByTestId('btn-coach-close'));
    await waitFor(() => expect(screen.queryByTestId('coach-panel')).toBeNull());

    const { prev, next } = navButtons(container);
    fireEvent.click(next);
    fireEvent.click(await screen.findByTestId('btn-plan-coach'));
    await screen.findByTestId('coach-panel');
    await waitFor(() => expect(coach.openConversation).toHaveBeenLastCalledWith({
      target_date: TOMORROW,
      tz_offset: new Date().getTimezoneOffset(),
    }));
    fireEvent.click(screen.getByTestId('btn-coach-close'));
    await waitFor(() => expect(screen.queryByTestId('coach-panel')).toBeNull());

    fireEvent.click(prev);
    fireEvent.click(prev);
    await waitFor(() => expect(screen.queryByTestId('btn-plan-coach')).toBeNull());
  });

  it('is disabled offline with the message', async () => {
    onLineSpy = vi.spyOn(Navigator.prototype, 'onLine', 'get').mockReturnValue(false);
    await renderDay(0);

    const button = await screen.findByTestId('btn-plan-coach');
    expect(button).toBeDisabled();
    expect(screen.getByTestId('coach-offline')).toHaveTextContent("You're offline — the Coach needs a connection.");
    fireEvent.click(button);
    expect(screen.queryByTestId('coach-panel')).toBeNull();
    expect(coach.openConversation).not.toHaveBeenCalled();
  });
});

describe('opening and the thinking state', () => {
  it('opens or resumes on open, thinking until the reply arrives', async () => {
    const open = deferred<ReturnType<typeof conversation>>();
    coach.openConversation.mockReturnValue(open.promise);
    await openCoach();

    await waitFor(() => expect(coach.openConversation).toHaveBeenCalledTimes(1));
    expect(coach.openConversation).toHaveBeenCalledWith({ target_date: TOMORROW, tz_offset: 300 });
    expect(screen.getByTestId('coach-thinking')).toHaveTextContent('Coach is thinking…');
    expect(screen.getByTestId('coach-input')).toBeDisabled();

    await act(async () => open.resolve(conversation()));

    expect(await screen.findByTestId('coach-message-0')).toHaveTextContent('What matters most tomorrow?');
    expect(screen.queryByTestId('coach-thinking')).toBeNull();
  });

  it('disables the input and Send while a reply is pending, then shows it and clears the input', async () => {
    await openCoach();
    await screen.findByTestId('coach-message-0');

    const reply = deferred<ReturnType<typeof conversation>>();
    coach.sendMessage.mockReturnValue(reply.promise);
    await send('  Two hours of focus work  ');

    expect(coach.sendMessage).toHaveBeenCalledWith(7, { text: 'Two hours of focus work' });
    expect(await screen.findByTestId('coach-thinking')).toHaveTextContent('Coach is thinking…');
    expect(screen.getByTestId('coach-input')).toBeDisabled();
    expect(screen.getByTestId('coach-send')).toBeDisabled();

    await act(async () =>
      reply.resolve(
        conversation({
          messages: [
            { role: 'assistant', visible_text: 'What matters most tomorrow?', created_at: '2026-09-30T15:00:00Z' },
            { role: 'user', visible_text: 'Two hours of focus work', created_at: '2026-09-30T15:01:00Z' },
            { role: 'assistant', visible_text: 'When does your day start?', created_at: '2026-09-30T15:01:05Z' },
          ],
        })
      )
    );

    expect(await screen.findByTestId('coach-message-2')).toHaveTextContent('When does your day start?');
    expect(screen.queryByTestId('coach-thinking')).toBeNull();
    expect(screen.getByTestId('coach-input')).not.toBeDisabled();
    expect((screen.getByTestId('coach-input') as HTMLInputElement).value).toBe('');
  });
});

describe('the Proposal', () => {
  it('renders the whole day in time order with each kind of item styled, the New tag, and the limits', async () => {
    coach.openConversation.mockResolvedValue(withProposal());
    const { container } = await openCoach();
    await screen.findByTestId('proposal-item-0');

    const order = Array.from(container.querySelectorAll('[data-testid]'))
      .map((el) => el.getAttribute('data-testid')!)
      .filter((id) => /^(proposal-item|day-item)-\d+$/.test(id));
    expect(order).toEqual(['day-item-1', 'proposal-item-0', 'day-item-2', 'day-item-3', 'proposal-item-1']);

    expect(screen.getByTestId('coach-all-day')).toHaveTextContent(/Holiday/);
    expect(screen.queryByTestId('day-item-0')).toBeNull();

    const focus = screen.getByTestId('proposal-item-0');
    expect(focus).toHaveTextContent(/Focus work/);
    expect(focus).toHaveTextContent(/9:00 AM/);
    expect(focus).toHaveTextContent(/90 min/);
    expect(screen.getByTestId('proposal-frog-0')).toBeInTheDocument();
    expect(screen.queryByTestId('proposal-new-0')).toBeNull();

    const tango = screen.getByTestId('proposal-item-1');
    expect(tango).toHaveTextContent(/Tango/);
    expect(tango).toHaveTextContent(/6:00 PM/);
    expect(screen.getByTestId('proposal-new-1')).toHaveTextContent('New');
    expect(screen.queryByTestId('proposal-frog-1')).toBeNull();

    expect(screen.getByTestId('day-item-1')).toHaveTextContent(/Standup/);
    expect(screen.getByTestId('day-item-2')).toHaveTextContent(/Lunch/);

    expect(rowKind('day-item-1')).toEqual(['coach-row-google']);
    expect(rowKind('day-item-3')).toEqual(['coach-row-google']);
    expect(rowKind('day-item-2')).toEqual(['coach-row-block']);
    expect(rowKind('proposal-item-0')).toEqual(['coach-row-proposal']);
    expect(rowKind('proposal-item-1')).toEqual(['coach-row-proposal']);

    expect(screen.getByTestId('coach-limits')).toHaveTextContent('2 plan changes left, 4 messages left');
    expect(screen.getByTestId('btn-accept')).toHaveTextContent('Accept');
    expect(screen.getByTestId('btn-reject')).toHaveTextContent('Reject');
  });

  it('shows no limits line before the first Proposal', async () => {
    await openCoach();
    await screen.findByTestId('coach-message-0');

    expect(screen.queryByTestId('coach-limits')).toBeNull();
    expect(screen.queryByTestId('btn-accept')).toBeNull();
  });

  it('Accept refreshes the day, then offers Push day and rating', async () => {
    coach.openConversation.mockResolvedValue(withProposal());
    coach.accept.mockResolvedValue({ id: 50, target_date: TOMORROW, is_regimen: false, items: [] });
    coach.rate.mockResolvedValue({});
    schedule.pushToCalendar.mockResolvedValue({ id: 50, items: [] });
    await openCoach();
    await screen.findByTestId('btn-accept');
    const loadsBefore = schedule.getRange.mock.calls.length;

    fireEvent.click(screen.getByTestId('btn-accept'));

    await screen.findByTestId('coach-accepted');
    expect(coach.accept).toHaveBeenCalledWith(7);
    await waitFor(() => expect(schedule.getRange.mock.calls.length).toBeGreaterThan(loadsBefore));

    expect(screen.getByTestId('btn-coach-push-day')).toHaveTextContent('Push day');
    fireEvent.click(screen.getByTestId('btn-coach-push-day'));
    await waitFor(() => expect(schedule.pushToCalendar).toHaveBeenCalledWith(50));

    fireEvent.click(screen.getByTestId('btn-rate-up'));
    await waitFor(() => expect(coach.rate).toHaveBeenCalledWith(7, { rating: 'up' }));
    expect(screen.getByTestId('btn-rate-down')).toBeInTheDocument();
  });

  it('Reject rejects and closes the panel', async () => {
    coach.openConversation.mockResolvedValue(withProposal());
    coach.reject.mockResolvedValue({});
    await openCoach();
    await screen.findByTestId('btn-reject');

    fireEvent.click(screen.getByTestId('btn-reject'));

    await waitFor(() => expect(coach.reject).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.queryByTestId('coach-panel')).toBeNull());
  });
});

describe('Where this came from', () => {
  it('lists each item’s source and reason, with Recordings and typical time on existing Activities only', async () => {
    coach.openConversation.mockResolvedValue(withProposal());
    await openCoach();
    await screen.findByTestId('proposal-item-0');

    expect(screen.queryByTestId('where-from-list')).toBeNull();
    expect(screen.getByTestId('btn-where-from')).toHaveTextContent('Where this came from');
    fireEvent.click(screen.getByTestId('btn-where-from'));

    await screen.findByTestId('where-from-list');
    const focus = screen.getByTestId('where-from-0');
    expect(focus).toHaveTextContent(/Focus work/);
    expect(focus).toHaveTextContent(/Your history/);
    expect(focus).toHaveTextContent(/You usually do focus work in the morning\./);
    expect(focus).toHaveTextContent(/12 Recordings, typical 90 min/);

    const tango = screen.getByTestId('where-from-1');
    expect(tango).toHaveTextContent(/Tango/);
    expect(tango).toHaveTextContent(/You said/);
    expect(tango).toHaveTextContent(/You asked for 30-minute sittings\./);
    expect(tango).not.toHaveTextContent(/Recordings/);
  });

  it("labels a guess as Coach's guess", async () => {
    coach.openConversation.mockResolvedValue(
      withProposal({
        proposal: { summary: '', items: [{ ...PROPOSAL.items[1], source: 'guess', reason: 'A first sitting is usually short.' }] },
      })
    );
    await openCoach();
    fireEvent.click(await screen.findByTestId('btn-where-from'));

    expect(await screen.findByTestId('where-from-0')).toHaveTextContent(/Coach's guess/);
  });
});

describe('note suggestions and Start over', () => {
  const NOTE = 'Mornings before 9 are for the kids.';

  async function renderWithSuggestion() {
    coach.sendMessage.mockResolvedValue(conversation({ note_suggestion: NOTE }));
    await openCoach();
    await screen.findByTestId('coach-message-0');
    await send('I drop the kids off at 9');
    await screen.findByTestId('coach-note-suggestion');
  }

  it('Yes posts the note and hides the suggestion', async () => {
    coach.createNote.mockResolvedValue({ id: 1, text: NOTE });
    await renderWithSuggestion();

    const suggestion = screen.getByTestId('coach-note-suggestion');
    expect(suggestion).toHaveTextContent(/Save this note\?/);
    expect(suggestion).toHaveTextContent(NOTE);

    fireEvent.click(screen.getByTestId('btn-note-yes'));

    await waitFor(() => expect(coach.createNote).toHaveBeenCalledWith({ text: NOTE }));
    await waitFor(() => expect(screen.queryByTestId('coach-note-suggestion')).toBeNull());
  });

  it('No posts nothing and hides the suggestion', async () => {
    await renderWithSuggestion();

    fireEvent.click(screen.getByTestId('btn-note-no'));

    await waitFor(() => expect(screen.queryByTestId('coach-note-suggestion')).toBeNull());
    expect(coach.createNote).not.toHaveBeenCalled();
  });

  it('Start over asks first, and only a yes starts over', async () => {
    coach.startOver.mockResolvedValue(
      conversation({ id: 8, messages: [{ role: 'assistant', visible_text: 'Fresh start. What is tomorrow for?', created_at: '2026-09-30T16:00:00Z' }] })
    );
    await openCoach();
    await screen.findByTestId('coach-message-0');

    expect(screen.getByTestId('btn-start-over')).toHaveTextContent('Start over');
    fireEvent.click(screen.getByTestId('btn-start-over'));
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(coach.startOver).not.toHaveBeenCalled();

    confirmMock.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('btn-start-over'));
    await waitFor(() => expect(coach.startOver).toHaveBeenCalledWith(7));
    expect(await screen.findByText(/Fresh start\. What is tomorrow for\?/)).toBeInTheDocument();
  });
});

describe('a 409 from the server', () => {
  it('shows its message and leaves Accept, Reject and Start over usable', async () => {
    coach.openConversation.mockResolvedValue(withProposal({ messages_left: 0 }));
    coach.sendMessage.mockRejectedValue({ response: { status: 409, data: { detail: 'message limit reached' } } });
    coach.accept.mockResolvedValue({ id: 50, target_date: TOMORROW, is_regimen: false, items: [] });
    await openCoach();
    await screen.findByTestId('btn-accept');

    await send('One more change');

    expect(await screen.findByTestId('coach-error')).toHaveTextContent(/message limit reached/);
    expect(screen.getByTestId('btn-accept')).not.toBeDisabled();
    expect(screen.getByTestId('btn-reject')).not.toBeDisabled();
    expect(screen.getByTestId('btn-start-over')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('btn-accept'));
    await waitFor(() => expect(coach.accept).toHaveBeenCalledWith(7));
  });
});

it('the panel uses the Activity names from the calendar, with no extra fetch', async () => {
  coach.openConversation.mockResolvedValue(withProposal());
  await openCoach();
  await screen.findByTestId('proposal-item-0');
  expect(within(screen.getByTestId('proposal-item-0')).getByText(/Focus work/)).toBeInTheDocument();
  expect(api.taskAPI.getAll).not.toHaveBeenCalled();
});
