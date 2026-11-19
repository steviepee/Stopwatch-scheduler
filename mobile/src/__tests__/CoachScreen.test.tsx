import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';

import CalendarDayScreen from '../app/(tabs)/calendar';
import { coachAPI, scheduleAPI, settingsAPI, taskAPI, calendarImportAPI } from '../services/api';
import type { Task } from '../types';

// B65 (D94, D100, D101, D103, D111, D117, D118, D121, D123, D127). The PRD gives the screen in
// prose; this file pins the rest for B65.impl.
//
// API methods (add to `coachAPI` in `src/services/api.ts`; types in `src/types/index.ts`):
//   coachAPI.openConversation({ target_date, tz_offset })  POST /coach/conversations  -> CoachConversation
//   coachAPI.sendMessage(id, { text })                     POST /coach/conversations/{id}/messages
//   coachAPI.accept(id)                                    POST /coach/conversations/{id}/accept -> Schedule
//   coachAPI.reject(id)                                    POST /coach/conversations/{id}/reject
//   coachAPI.startOver(id)                                 POST /coach/conversations/{id}/start-over -> CoachConversation
//   coachAPI.rate(id, { rating })                          PUT  /coach/conversations/{id}/rating
//   coachAPI.createNote({ text })                          (exists, B64)
// `tz_offset` is `new Date().getTimezoneOffset()`. The conversation shape is the backend's
// `CoachConversation` (id, target_date, status, messages, proposal, changes_left,
// messages_left, day_items, note_suggestion). Proposal items carry `task_id` or
// `new_activity_name`, `start` (local `HH:MM`), `duration_minutes`, `is_frog`, `source`,
// `reason`, and for an existing Activity `recording_count` and `typical_seconds`. Items carry no
// Activity name: the screen looks it up from `taskAPI.getAll()`.
//
// Calendar day view (`(tabs)/calendar.tsx`):
//   - `btn-plan-coach` ("Plan with Coach") shows for today and future dates, never past ones.
//     Pressing it calls `router.push('/coach/<YYYY-MM-DD>')` (the `router` export of
//     expo-router, the shown LOCAL date).
//   - Offline (`onlineManager.isOnline() === false`) the button is disabled and `coach-offline`
//     reads `You're offline — the Coach needs a connection.` (em dash). Nothing is queued.
//
// Coach screen (`src/app/coach/[date].tsx`, `date` from `useLocalSearchParams`):
//   - On mount calls `openConversation` once. Visible messages render as `coach-message-<i>`
//     (index into `messages`) showing `visible_text`.
//   - While open or a message is pending: `coach-thinking` reads `Coach is thinking…`, the
//     TextInput `coach-input` has `editable={false}`, and `coach-send` is disabled. Send posts
//     `sendMessage(id, { text })` with the text trimmed, then shows the returned conversation
//     and clears the input.
//   - A Proposal (`proposal` not null) renders the whole day in time order (D123). Each
//     Proposal item is `proposal-item-<i>` (index into `proposal.items`) showing its start
//     through `formatClock` (12-hour here: `9:00 AM`), the Activity name (or
//     `new_activity_name`), `<duration_minutes> min`, `proposal-frog-<i>` when `is_frog`, and
//     `proposal-new-<i>` ("New") for a new Activity. Each timed `day_items` entry is
//     `day-item-<i>` (index into `day_items`), read-only, showing its name. All-day entries sit
//     in `coach-all-day` above the list. Styling, on the testID'd element's own style:
//     every `on_google` day item shares one backgroundColor; a Block without `on_google` has a
//     different one (grey); Proposal items have a third (highlighted).
//   - `btn-accept` ("Accept") and `btn-reject` ("Reject") sit below the Proposal.
//   - `btn-where-from` ("Where this came from") above the Proposal; pressing it shows
//     `where-from-list` with one `where-from-<i>` per item: the name, the source label
//     (`you_said` → `You said`, `history` → `Your history`, `guess` → `Coach's guess`, straight
//     apostrophe), the `reason`, and for an item with a `task_id`
//     `<recording_count> Recordings, typical <round(typical_seconds / 60)> min`. A new
//     Activity's row has no Recordings line.
//   - From the first Proposal on, `coach-limits` reads
//     `<changes_left> plan changes left, <messages_left> messages left`. None before it.
//   - A `note_suggestion` on a response shows `coach-note-suggestion` with `Save this note?`
//     and the text, plus `btn-note-yes` / `btn-note-no`. Yes calls `createNote({ text })`; both
//     hide it; No calls nothing.
//   - Accept calls `accept(id)`, then invalidates the `['schedules']` queries (so the date's
//     Blocks refresh) and shows `coach-accepted` with `btn-coach-push-day` ("Push day", calls
//     `scheduleAPI.pushToCalendar(<returned schedule id>)`) and `btn-rate-up` / `btn-rate-down`
//     (call `rate(id, { rating: 'up' | 'down' })`).
//   - `btn-start-over` ("Start over"), in the screen's own header row, asks first with
//     `Alert.alert('Start over', <any>, [Cancel (cancel), Start over (destructive)])`. Only the
//     destructive button calls `startOver(id)`; the screen then shows the returned conversation.
//   - A failed send shows `coach-error` with the server's `detail` (for a 409:
//     `message limit reached`). Accept, Reject and Start over stay enabled.

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
  settingsAPI: { getDisplay: jest.fn(), updateDisplay: jest.fn() },
  coachAPI: {
    openConversation: jest.fn(),
    sendMessage: jest.fn(),
    accept: jest.fn(),
    reject: jest.fn(),
    startOver: jest.fn(),
    rate: jest.fn(),
    createNote: jest.fn(),
  },
}));

let mockSearchParams: Record<string, string> = {};
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useGlobalSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: mockPush, back: jest.fn(), setParams: jest.fn() }),
  router: { push: (...args: unknown[]) => mockPush(...args), back: jest.fn(), setParams: jest.fn() },
  Stack: { Screen: () => null },
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

// The route file and the new coachAPI methods do not exist until B65.impl.
function CoachScreen() {
  const Screen = require('../app/coach/[date]').default;
  return <Screen />;
}

const mockedCoach = coachAPI as unknown as Record<string, jest.Mock>;
const mockedSchedule = scheduleAPI as unknown as Record<string, jest.Mock>;
const mockedSettings = settingsAPI as unknown as Record<string, jest.Mock>;
const mockedTasksGetAll = taskAPI.getAll as jest.Mock;
const mockedGetEvents = calendarImportAPI.getEvents as jest.Mock;

function localKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

const TOMORROW = localKey(daysFromNow(1));

function tomorrowAt(hour: number, minute = 0): string {
  const d = daysFromNow(1);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const FOCUS: Task = {
  id: 11,
  name: 'Focus work',
  average_duration: 5400,
  total_recordings: 12,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
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
  { kind: 'event', name: 'Holiday', start: TOMORROW, end: localKey(daysFromNow(2)), all_day: true, on_google: true },
  { kind: 'event', name: 'Standup', start: tomorrowAt(8), end: tomorrowAt(8, 30), all_day: false, on_google: true },
  { kind: 'block', name: 'Lunch', start: tomorrowAt(12), end: tomorrowAt(13), all_day: false, on_google: false },
  { kind: 'block', name: 'Gym', start: tomorrowAt(15), end: tomorrowAt(15, 30), all_day: false, on_google: true },
];

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    target_date: TOMORROW,
    status: 'open',
    messages: [{ role: 'assistant', visible_text: 'What matters most tomorrow?', created_at: '2026-11-19T10:00:00Z' }],
    proposal: null,
    changes_left: null,
    messages_left: null,
    day_items: [],
    note_suggestion: null,
    ...overrides,
  };
}

function withProposal(overrides: Record<string, unknown> = {}) {
  return conversation({
    proposal: PROPOSAL,
    changes_left: 2,
    messages_left: 4,
    day_items: DAY_ITEMS,
    ...overrides,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function bg(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style)?.backgroundColor;
}

let queryClient: QueryClient;

async function renderWithClient(ui: React.ReactElement) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  for (const mock of Object.values(mockedCoach)) mock.mockReset();
  for (const mock of Object.values(mockedSchedule)) mock.mockReset();
  mockedSettings.getDisplay.mockReset();
  mockedTasksGetAll.mockReset();
  mockedGetEvents.mockReset();
  mockPush.mockReset();
  mockSearchParams = { date: TOMORROW };
  mockedSettings.getDisplay.mockResolvedValue({ clock_24h: false });
  mockedTasksGetAll.mockResolvedValue([FOCUS]);
  mockedGetEvents.mockResolvedValue([]);
  mockedSchedule.getRange.mockResolvedValue([]);
  mockedCoach.openConversation.mockResolvedValue(conversation());
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
  onlineManager.setOnline(true);
});

describe('Plan with Coach on the calendar day view', () => {
  it('shows for today and tomorrow, opening the Coach for that date, and is hidden for past dates', async () => {
    await renderWithClient(<CalendarDayScreen />);

    await screen.findByTestId('btn-plan-coach');
    expect(within(screen.getByTestId('btn-plan-coach')).getByText('Plan with Coach')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('btn-plan-coach'));
    expect(mockPush).toHaveBeenCalledWith(`/coach/${localKey(new Date())}`);

    await fireEvent.press(screen.getByTestId('day-nav-next'));
    await fireEvent.press(screen.getByTestId('btn-plan-coach'));
    expect(mockPush).toHaveBeenLastCalledWith(`/coach/${TOMORROW}`);

    await fireEvent.press(screen.getByTestId('day-nav-prev'));
    await fireEvent.press(screen.getByTestId('day-nav-prev'));
    await screen.findByTestId('day-label');
    expect(screen.queryByTestId('btn-plan-coach')).toBeNull();
  });

  it('is disabled offline with the message', async () => {
    onlineManager.setOnline(false);
    await renderWithClient(<CalendarDayScreen />);

    const button = await screen.findByTestId('btn-plan-coach');
    expect(button).toBeDisabled();
    expect(screen.getByTestId('coach-offline')).toHaveTextContent("You're offline — the Coach needs a connection.");
    await fireEvent.press(button);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('opening and the thinking state', () => {
  it('opens or resumes on mount for the date, thinking until the reply arrives', async () => {
    const open = deferred<ReturnType<typeof conversation>>();
    mockedCoach.openConversation.mockReturnValue(open.promise);
    await renderWithClient(<CoachScreen />);

    await waitFor(() => expect(mockedCoach.openConversation).toHaveBeenCalledTimes(1));
    expect(mockedCoach.openConversation).toHaveBeenCalledWith({
      target_date: TOMORROW,
      tz_offset: new Date().getTimezoneOffset(),
    });
    expect(screen.getByTestId('coach-thinking')).toHaveTextContent('Coach is thinking…');

    await act(async () => open.resolve(conversation()));

    expect(await screen.findByTestId('coach-message-0')).toHaveTextContent('What matters most tomorrow?');
    expect(screen.queryByTestId('coach-thinking')).toBeNull();
  });

  it('disables the input and Send while a reply is pending, then shows it and clears the input', async () => {
    await renderWithClient(<CoachScreen />);
    await screen.findByTestId('coach-message-0');

    const reply = deferred<ReturnType<typeof conversation>>();
    mockedCoach.sendMessage.mockReturnValue(reply.promise);
    await fireEvent.changeText(screen.getByTestId('coach-input'), '  Two hours of focus work  ');
    await fireEvent.press(screen.getByTestId('coach-send'));

    expect(mockedCoach.sendMessage).toHaveBeenCalledWith(7, { text: 'Two hours of focus work' });
    expect(await screen.findByTestId('coach-thinking')).toHaveTextContent('Coach is thinking…');
    expect(screen.getByTestId('coach-input').props.editable).toBe(false);
    expect(screen.getByTestId('coach-send')).toBeDisabled();

    await act(async () =>
      reply.resolve(
        conversation({
          messages: [
            { role: 'assistant', visible_text: 'What matters most tomorrow?', created_at: '2026-11-19T10:00:00Z' },
            { role: 'user', visible_text: 'Two hours of focus work', created_at: '2026-11-19T10:01:00Z' },
            { role: 'assistant', visible_text: 'When does your day start?', created_at: '2026-11-19T10:01:05Z' },
          ],
        })
      )
    );

    expect(await screen.findByTestId('coach-message-2')).toHaveTextContent('When does your day start?');
    expect(screen.queryByTestId('coach-thinking')).toBeNull();
    expect(screen.getByTestId('coach-input').props.editable).not.toBe(false);
    expect(screen.getByTestId('coach-input').props.value ?? '').toBe('');
  });
});

describe('the Proposal', () => {
  it('renders the whole day in time order with each kind of item styled, the New tag, and the limits', async () => {
    mockedCoach.openConversation.mockResolvedValue(withProposal());
    await renderWithClient(<CoachScreen />);

    await screen.findByTestId('proposal-item-0');

    const order = screen
      .getAllByTestId(/^(proposal-item|day-item)-\d+$/)
      .map((el) => el.props.testID);
    expect(order).toEqual(['day-item-1', 'proposal-item-0', 'day-item-2', 'day-item-3', 'proposal-item-1']);

    expect(within(screen.getByTestId('coach-all-day')).getByText(/Holiday/)).toBeTruthy();
    expect(screen.queryByTestId('day-item-0')).toBeNull();

    const focus = within(screen.getByTestId('proposal-item-0'));
    expect(await focus.findByText(/Focus work/)).toBeTruthy();
    expect(focus.getByText(/9:00 AM/)).toBeTruthy();
    expect(focus.getByText(/90 min/)).toBeTruthy();
    expect(screen.getByTestId('proposal-frog-0')).toBeTruthy();
    expect(screen.queryByTestId('proposal-new-0')).toBeNull();

    const tango = within(screen.getByTestId('proposal-item-1'));
    expect(tango.getByText(/Tango/)).toBeTruthy();
    expect(tango.getByText(/6:00 PM/)).toBeTruthy();
    expect(screen.getByTestId('proposal-new-1')).toHaveTextContent('New');
    expect(screen.queryByTestId('proposal-frog-1')).toBeNull();

    expect(within(screen.getByTestId('day-item-1')).getByText(/Standup/)).toBeTruthy();
    expect(within(screen.getByTestId('day-item-2')).getByText(/Lunch/)).toBeTruthy();

    const google = bg('day-item-1');
    expect(google).toBeDefined();
    expect(bg('day-item-3')).toBe(google);
    expect(bg('day-item-2')).toBeDefined();
    expect(bg('day-item-2')).not.toBe(google);
    expect(bg('proposal-item-0')).toBeDefined();
    expect(bg('proposal-item-0')).not.toBe(google);
    expect(bg('proposal-item-0')).not.toBe(bg('day-item-2'));
    expect(bg('proposal-item-1')).toBe(bg('proposal-item-0'));

    expect(screen.getByTestId('coach-limits')).toHaveTextContent('2 plan changes left, 4 messages left');
    expect(within(screen.getByTestId('btn-accept')).getByText('Accept')).toBeTruthy();
    expect(within(screen.getByTestId('btn-reject')).getByText('Reject')).toBeTruthy();
  });

  it('shows no limits line before the first Proposal', async () => {
    await renderWithClient(<CoachScreen />);
    await screen.findByTestId('coach-message-0');

    expect(screen.queryByTestId('coach-limits')).toBeNull();
    expect(screen.queryByTestId('btn-accept')).toBeNull();
  });

  it('Accept refreshes the day, then offers Push day and rating', async () => {
    mockedCoach.openConversation.mockResolvedValue(withProposal());
    mockedCoach.accept.mockResolvedValue({ id: 50, target_date: TOMORROW, is_regimen: false, items: [] });
    mockedCoach.rate.mockResolvedValue({});
    mockedSchedule.pushToCalendar.mockResolvedValue({ id: 50 });
    await renderWithClient(<CoachScreen />);
    await screen.findByTestId('btn-accept');
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');

    await fireEvent.press(screen.getByTestId('btn-accept'));

    await screen.findByTestId('coach-accepted');
    expect(mockedCoach.accept).toHaveBeenCalledWith(7);
    expect(invalidate.mock.calls.some(([filters]) => (filters as { queryKey?: unknown[] })?.queryKey?.[0] === 'schedules')).toBe(true);

    expect(within(screen.getByTestId('btn-coach-push-day')).getByText('Push day')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('btn-coach-push-day'));
    await waitFor(() => expect(mockedSchedule.pushToCalendar).toHaveBeenCalledWith(50));

    await fireEvent.press(screen.getByTestId('btn-rate-up'));
    await waitFor(() => expect(mockedCoach.rate).toHaveBeenCalledWith(7, { rating: 'up' }));
    expect(screen.getByTestId('btn-rate-down')).toBeTruthy();
  });
});

describe('Where this came from', () => {
  it('lists each item’s source and reason, with Recordings and typical time on existing Activities only', async () => {
    mockedCoach.openConversation.mockResolvedValue(withProposal());
    await renderWithClient(<CoachScreen />);
    await screen.findByTestId('proposal-item-0');

    expect(screen.queryByTestId('where-from-list')).toBeNull();
    expect(within(screen.getByTestId('btn-where-from')).getByText('Where this came from')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('btn-where-from'));

    await screen.findByTestId('where-from-list');
    const focus = within(screen.getByTestId('where-from-0'));
    expect(await focus.findByText(/Focus work/)).toBeTruthy();
    expect(focus.getByText(/Your history/)).toBeTruthy();
    expect(focus.getByText(/You usually do focus work in the morning\./)).toBeTruthy();
    expect(focus.getByText(/12 Recordings, typical 90 min/)).toBeTruthy();

    const tango = within(screen.getByTestId('where-from-1'));
    expect(tango.getByText(/Tango/)).toBeTruthy();
    expect(tango.getByText(/You said/)).toBeTruthy();
    expect(tango.getByText(/You asked for 30-minute sittings\./)).toBeTruthy();
    expect(tango.queryByText(/Recordings/)).toBeNull();
  });

  it("labels a guess as Coach's guess", async () => {
    mockedCoach.openConversation.mockResolvedValue(
      withProposal({
        proposal: { summary: '', items: [{ ...PROPOSAL.items[1], source: 'guess', reason: 'A first sitting is usually short.' }] },
      })
    );
    await renderWithClient(<CoachScreen />);
    await screen.findByTestId('btn-where-from');
    await fireEvent.press(screen.getByTestId('btn-where-from'));

    expect(await within(screen.getByTestId('where-from-0')).findByText(/Coach's guess/)).toBeTruthy();
  });
});

describe('note suggestions and Start over', () => {
  const NOTE = 'Mornings before 9 are for the kids.';

  async function renderWithSuggestion() {
    mockedCoach.sendMessage.mockResolvedValue(conversation({ note_suggestion: NOTE }));
    await renderWithClient(<CoachScreen />);
    await screen.findByTestId('coach-message-0');
    await fireEvent.changeText(screen.getByTestId('coach-input'), 'I drop the kids off at 9');
    await fireEvent.press(screen.getByTestId('coach-send'));
    await screen.findByTestId('coach-note-suggestion');
  }

  it('Yes posts the note and hides the suggestion', async () => {
    mockedCoach.createNote.mockResolvedValue({ id: 1, text: NOTE });
    await renderWithSuggestion();

    const suggestion = within(screen.getByTestId('coach-note-suggestion'));
    expect(suggestion.getByText(/Save this note\?/)).toBeTruthy();
    expect(suggestion.getByText(new RegExp(NOTE))).toBeTruthy();

    await fireEvent.press(screen.getByTestId('btn-note-yes'));

    await waitFor(() => expect(mockedCoach.createNote).toHaveBeenCalledWith({ text: NOTE }));
    await waitFor(() => expect(screen.queryByTestId('coach-note-suggestion')).toBeNull());
  });

  it('No posts nothing and hides the suggestion', async () => {
    await renderWithSuggestion();

    await fireEvent.press(screen.getByTestId('btn-note-no'));

    await waitFor(() => expect(screen.queryByTestId('coach-note-suggestion')).toBeNull());
    expect(mockedCoach.createNote).not.toHaveBeenCalled();
  });

  it('Start over asks first, and only the confirm button starts over', async () => {
    mockedCoach.startOver.mockResolvedValue(
      conversation({ id: 8, messages: [{ role: 'assistant', visible_text: 'Fresh start. What is tomorrow for?', created_at: '2026-11-19T11:00:00Z' }] })
    );
    await renderWithClient(<CoachScreen />);
    await screen.findByTestId('coach-message-0');

    await fireEvent.press(screen.getByTestId('btn-start-over'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, , buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('Start over');
    expect(mockedCoach.startOver).not.toHaveBeenCalled();

    const cancel = buttons.find((b: { style?: string }) => b.style === 'cancel');
    const confirm = buttons.find((b: { style?: string }) => b.style === 'destructive');
    expect(cancel).toBeDefined();
    expect(confirm.text).toBe('Start over');

    await act(async () => cancel.onPress?.());
    expect(mockedCoach.startOver).not.toHaveBeenCalled();

    await act(async () => confirm.onPress());
    await waitFor(() => expect(mockedCoach.startOver).toHaveBeenCalledWith(7));
    expect(await screen.findByText(/Fresh start\. What is tomorrow for\?/)).toBeTruthy();
  });
});

describe('a 409 from the server', () => {
  it('shows its message and leaves Accept, Reject and Start over usable', async () => {
    mockedCoach.openConversation.mockResolvedValue(withProposal({ messages_left: 0 }));
    mockedCoach.sendMessage.mockRejectedValue({ response: { status: 409, data: { detail: 'message limit reached' } } });
    mockedCoach.accept.mockResolvedValue({ id: 50, target_date: TOMORROW, is_regimen: false, items: [] });
    await renderWithClient(<CoachScreen />);
    await screen.findByTestId('btn-accept');

    await fireEvent.changeText(screen.getByTestId('coach-input'), 'One more change');
    await fireEvent.press(screen.getByTestId('coach-send'));

    expect(await screen.findByTestId('coach-error')).toHaveTextContent(/message limit reached/);
    expect(screen.getByTestId('btn-accept')).not.toBeDisabled();
    expect(screen.getByTestId('btn-reject')).not.toBeDisabled();
    expect(screen.getByTestId('btn-start-over')).not.toBeDisabled();

    await fireEvent.press(screen.getByTestId('btn-accept'));
    await waitFor(() => expect(mockedCoach.accept).toHaveBeenCalledWith(7));
  });
});
