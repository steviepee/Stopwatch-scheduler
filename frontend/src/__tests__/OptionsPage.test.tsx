import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import OptionsPage from '../components/OptionsPage';
import * as apiModule from '../services/api';
import { settingsAPI } from '../services/api';
import { DEFAULT_USER_OPTIONS } from '../types';

// B54 contract (D83), web parity with mobile's B50:
//   - OptionsPage gains a "Pomodoro" section with four number inputs,
//     `data-testid` `pomodoro-work`, `pomodoro-break`, `pomodoro-long-break`,
//     `pomodoro-long-every`, loaded on mount from `settingsAPI.getPomodoro()`
//     (OptionsPage fetches it itself; the web app has no react-query).
//   - A Save button (`data-testid="pomodoro-save"`) sends all four, as numbers,
//     through `settingsAPI.updatePomodoro({ work_minutes, break_minutes,
//     long_break_minutes, long_break_every })`.
//   - A minutes value outside 1–180 (1–12 for the count, or not a whole
//     number) disables Save and shows the range text `1–180` (`1–12`, en dash)
//     under that field; the text is absent while the value is in range.
//   - A failed load shows the defaults 25/5/15/4 (inputs disabled, greyed),
//     the text "Couldn't load", and Save stays disabled.
vi.mock('../services/api', () => ({
  settingsAPI: {
    getPomodoro: vi.fn(),
    updatePomodoro: vi.fn(),
    getCoach: vi.fn(),
    updateCoach: vi.fn(),
    getReminders: vi.fn(),
    updateReminders: vi.fn(),
    getDisplay: vi.fn(),
    updateDisplay: vi.fn(),
  },
  coachAPI: {
    getNotes: vi.fn(),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    getUsage: vi.fn(),
    getConversations: vi.fn(),
    getConversation: vi.fn(),
  },
}));

type Mocks = Record<string, Mock>;
// The B66 methods and `coachAPI` are B66.impl's additions to api.ts; reach them through the
// module namespace so tsc passes before they exist.
const settings = settingsAPI as unknown as Mocks;
const coach = (apiModule as unknown as { coachAPI: Mocks }).coachAPI;
const mockedGet = settings.getPomodoro;
const mockedUpdate = settings.updatePomodoro;

const SERVER_POMODORO = { work_minutes: 50, break_minutes: 10, long_break_minutes: 30, long_break_every: 3 };

const NOTES = [
  { id: 1, text: 'Mornings are for focus work', created_at: '2026-11-10T09:00:00Z', confirmed_at: '2026-11-10T09:00:00Z' },
  { id: 2, text: 'Runs take longer in the cold', created_at: '2026-11-11T09:00:00Z', confirmed_at: '2026-11-11T09:00:00Z' },
];

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    target_date: '2026-11-20',
    status: 'accepted',
    user_turns: 3,
    revision_turns: 1,
    call_count: 2,
    input_tokens: 5200,
    output_tokens: 900,
    cache_read_input_tokens: 3000,
    cache_creation_input_tokens: 3100,
    cost_usd: 0.0731,
    proposed_count: 4,
    accepted_count: 4,
    rating: null,
    created_at: '2026-11-19T15:00:00Z',
    closed_at: '2026-11-19T15:06:00Z',
    ...overrides,
  };
}

const DETAIL = {
  ...summary(),
  messages: [
    { role: 'assistant', visible_text: 'What matters most tomorrow?', created_at: '2026-11-19T15:00:01Z' },
    { role: 'user', visible_text: 'Two hours of focus work and a run.', created_at: '2026-11-19T15:01:00Z' },
  ],
  proposal: {
    summary: 'Focus first, run at lunch.',
    items: [
      { task_id: 7, new_activity_name: null, start: '09:00', duration_minutes: 120, is_frog: true, source: 'you_said', reason: 'You asked for two hours.', recording_count: 12, typical_seconds: 5400 },
    ],
  },
  calls: [
    { turn_index: 0, model: 'claude-sonnet-5-5', effort: 'medium', input_tokens: 3100, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 3100, stop_reason: 'end_turn', latency_ms: 2140, cost_usd: 0.0218, created_at: '2026-11-19T15:00:01Z' },
    { turn_index: 1, model: 'claude-sonnet-5-5', effort: 'medium', input_tokens: 2100, output_tokens: 500, cache_read_input_tokens: 3000, cache_creation_input_tokens: null, stop_reason: 'tool_use', latency_ms: 3870, cost_usd: 0.0513, created_at: '2026-11-19T15:01:04Z' },
  ],
};

function renderOptions() {
  return render(<OptionsPage options={DEFAULT_USER_OPTIONS} onChange={vi.fn()} />);
}

function field(testId: string) {
  return screen.getByTestId(testId) as HTMLInputElement;
}

async function loaded() {
  renderOptions();
  await waitFor(() => expect(field('pomodoro-work').value).toBe('50'));
}

let confirmMock: Mock;

beforeEach(() => {
  Object.values(settings).forEach((m) => m.mockReset());
  Object.values(coach).forEach((m) => m.mockReset());
  mockedGet.mockResolvedValue(SERVER_POMODORO);
  mockedUpdate.mockImplementation(async (s: unknown) => s);
  settings.getDisplay.mockResolvedValue({ clock_24h: false });
  settings.updateDisplay.mockImplementation(async (s: unknown) => s);
  settings.getCoach.mockResolvedValue({ notes_enabled: true });
  settings.updateCoach.mockImplementation(async (s: unknown) => s);
  settings.getReminders.mockResolvedValue({ enabled: true, minutes_before: 5 });
  settings.updateReminders.mockImplementation(async (s: unknown) => s);
  coach.getNotes.mockResolvedValue(NOTES);
  coach.createNote.mockImplementation(async ({ text }: { text: string }) => ({
    id: 3, text, created_at: '2026-11-19T10:00:00Z', confirmed_at: '2026-11-19T10:00:00Z',
  }));
  coach.updateNote.mockImplementation(async (id: number, { text }: { text: string }) => ({
    ...NOTES.find((n) => n.id === id), text,
  }));
  coach.deleteNote.mockResolvedValue(undefined);
  coach.getUsage.mockResolvedValue({ month: '2026-11', conversations: 3, accepted: 2, cost_usd: 0.4166 });
  coach.getConversations.mockResolvedValue([
    summary(),
    summary({ id: 40, target_date: '2026-11-18', status: 'rejected', cost_usd: 0.1 }),
  ]);
  coach.getConversation.mockResolvedValue(DETAIL);
  confirmMock = vi.fn(() => false);
  vi.stubGlobal('confirm', confirmMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Pomodoro lengths in Options (B54)', () => {
  it("fields show the server's values and Save sends the edited four", async () => {
    await loaded();
    expect(mockedGet).toHaveBeenCalled();
    expect(field('pomodoro-break').value).toBe('10');
    expect(field('pomodoro-long-break').value).toBe('30');
    expect(field('pomodoro-long-every').value).toBe('3');
    expect(screen.getByTestId('pomodoro-save')).not.toBeDisabled();

    fireEvent.change(field('pomodoro-work'), { target: { value: '40' } });
    fireEvent.change(field('pomodoro-long-every'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('pomodoro-save'));

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith({
        work_minutes: 40,
        break_minutes: 10,
        long_break_minutes: 30,
        long_break_every: 4,
      }),
    );
  });

  it('0 minutes disables Save and shows the range', async () => {
    await loaded();
    expect(screen.queryByText('1–180')).toBeNull();

    fireEvent.change(field('pomodoro-break'), { target: { value: '0' } });
    expect(screen.getByTestId('pomodoro-save')).toBeDisabled();
    expect(screen.getByText('1–180')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pomodoro-save'));
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('181 minutes disables Save; 180 enables it again', async () => {
    await loaded();
    fireEvent.change(field('pomodoro-long-break'), { target: { value: '181' } });
    expect(screen.getByTestId('pomodoro-save')).toBeDisabled();
    expect(screen.getByText('1–180')).toBeInTheDocument();

    fireEvent.change(field('pomodoro-long-break'), { target: { value: '180' } });
    expect(screen.getByTestId('pomodoro-save')).not.toBeDisabled();
    expect(screen.queryByText('1–180')).toBeNull();
  });

  it('long break every outside 1–12 disables Save and shows its range', async () => {
    await loaded();
    fireEvent.change(field('pomodoro-long-every'), { target: { value: '13' } });
    expect(screen.getByTestId('pomodoro-save')).toBeDisabled();
    expect(screen.getByText('1–12')).toBeInTheDocument();

    fireEvent.change(field('pomodoro-long-every'), { target: { value: '0' } });
    expect(screen.getByTestId('pomodoro-save')).toBeDisabled();

    fireEvent.change(field('pomodoro-long-every'), { target: { value: '12' } });
    expect(screen.getByTestId('pomodoro-save')).not.toBeDisabled();
  });

  it("load failure shows the defaults, \"Couldn't load\", and keeps Save disabled", async () => {
    mockedGet.mockRejectedValue(new Error('Network Error'));
    renderOptions();

    await screen.findByText("Couldn't load");
    expect(field('pomodoro-work').value).toBe('25');
    expect(field('pomodoro-break').value).toBe('5');
    expect(field('pomodoro-long-break').value).toBe('15');
    expect(field('pomodoro-long-every').value).toBe('4');
    expect(screen.getByTestId('pomodoro-save')).toBeDisabled();

    fireEvent.click(screen.getByTestId('pomodoro-save'));
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});

// B66 (D101, D104, D106, D107, D109, D113, D121), web parity with mobile's B64: three new
// sections on OptionsPage. Like the Pomodoro section, OptionsPage fetches each one itself on
// mount (the web app has no react-query). Mobile's testIDs are reused as `data-testid`.
//
// API methods (added to `src/services/api.ts`, same names and paths as mobile):
//   settingsAPI.getCoach()              GET  /settings/coach      -> { notes_enabled }
//   settingsAPI.updateCoach(body)       PUT  /settings/coach
//   settingsAPI.getReminders()          GET  /settings/reminders  -> { enabled, minutes_before }
//   settingsAPI.updateReminders(body)   PUT  /settings/reminders  (always both fields)
//   coachAPI.getNotes()                 GET  /coach/notes
//   coachAPI.createNote({ text })       POST /coach/notes
//   coachAPI.updateNote(id, { text })   PUT  /coach/notes/{id}
//   coachAPI.deleteNote(id)             DELETE /coach/notes/{id}
//   coachAPI.getUsage()                 GET  /coach/usage         -> { month, conversations, accepted, cost_usd }
//   coachAPI.getConversations()         GET  /coach/conversations (no trailing slash: 405, U15)
//   coachAPI.getConversation(id)        GET  /coach/conversations/{id}
// (The mock also carries `settingsAPI.getDisplay/updateDisplay` for B70's Clock switch.)
//
// Coach notes:
//   - Checkbox `toggle-coach-notes`, checked = `notes_enabled`; clicking calls
//     `updateCoach({ notes_enabled })` and the checkbox then shows the server's answer.
//   - One `coach-note-<id>` row per note showing its text. Edit: `coach-note-edit-<id>` reveals
//     `input-note-<id>` (prefilled) and `btn-note-save-<id>`, which calls
//     `updateNote(id, { text })` with the text trimmed.
//   - Add: `input-new-note` and `btn-add-note` ("Add note"). Calls `createNote({ text })`
//     trimmed; disabled while the trimmed text is empty. The field clears after the add.
//   - Delete: `coach-note-delete-<id>` asks first with `window.confirm('Delete this Coach note?')`,
//     the web's confirm pattern (TaskDetailModal's time log delete). Only true calls
//     `deleteNote(id)`, and the row then goes away.
// Start reminders:
//   - Checkbox `toggle-start-reminders`, checked = `enabled`; clicking saves at once with
//     `updateReminders({ enabled, minutes_before })` (the current stored minutes).
//   - Number input `input-reminder-minutes` prefilled with `minutes_before`, and
//     `reminders-save`, which sends `{ enabled, minutes_before: <typed, as a number> }`. Whole
//     minutes 1–120; outside that Save is disabled and `1–120` (en dash) shows, like Pomodoro.
//   - The text `Applies to Blocks pushed or changed from now on.` is shown.
// Coach usage:
//   - `usage-month` reads `<n> conversations` and the month's cost as `$x.xx` (2 decimals).
//   - One `usage-conversation-<id>` row (clickable) per conversation from `getConversations()`,
//     showing its `target_date`, `status`, and cost (`$x.xx`).
//   - Clicking a row calls `getConversation(id)` and shows `usage-detail` (read-only, no
//     inputs): each message's `visible_text`, the Proposal's `summary`, and one `usage-call-<i>`
//     row per call in the order given (i from 0). Each call row shows its input, output, cache
//     read and cache write tokens, `<latency_ms> ms`, and its cost as `$x.xxxx` (4 decimals).
function checkbox(testId: string) {
  return screen.getByTestId(testId) as HTMLInputElement;
}

describe('Coach notes setting (B66, D107)', () => {
  it('shows the stored value and the checkbox round-trips through updateCoach', async () => {
    settings.updateCoach.mockResolvedValue({ notes_enabled: false });
    renderOptions();

    await waitFor(() => expect(checkbox('toggle-coach-notes').checked).toBe(true));
    fireEvent.click(checkbox('toggle-coach-notes'));

    await waitFor(() => expect(settings.updateCoach).toHaveBeenCalledWith({ notes_enabled: false }));
    await waitFor(() => expect(checkbox('toggle-coach-notes').checked).toBe(false));
  });
});

describe('Coach notes list (B66, D101)', () => {
  it('lists every note', async () => {
    renderOptions();

    await waitFor(() => expect(screen.getByTestId('coach-note-1')).toHaveTextContent('Mornings are for focus work'));
    expect(screen.getByTestId('coach-note-2')).toHaveTextContent('Runs take longer in the cold');
  });

  it('Add note posts the trimmed text and clears the field', async () => {
    renderOptions();
    await screen.findByTestId('coach-note-1');

    expect(screen.getByTestId('btn-add-note')).toBeDisabled();
    expect(screen.getByTestId('btn-add-note')).toHaveTextContent('Add note');
    fireEvent.change(field('input-new-note'), { target: { value: '  Gym after work, not before  ' } });
    fireEvent.click(screen.getByTestId('btn-add-note'));

    await waitFor(() => expect(coach.createNote).toHaveBeenCalledWith({ text: 'Gym after work, not before' }));
    await waitFor(() => expect(field('input-new-note').value).toBe(''));
  });

  it('edit saves the new text for that note', async () => {
    renderOptions();
    await screen.findByTestId('coach-note-2');

    fireEvent.click(screen.getByTestId('coach-note-edit-2'));
    expect(field('input-note-2').value).toBe('Runs take longer in the cold');
    fireEvent.change(field('input-note-2'), { target: { value: 'Runs take 10 minutes longer in the cold ' } });
    fireEvent.click(screen.getByTestId('btn-note-save-2'));

    await waitFor(() =>
      expect(coach.updateNote).toHaveBeenCalledWith(2, { text: 'Runs take 10 minutes longer in the cold' }),
    );
  });

  it('delete asks first; cancel keeps the note and OK removes it', async () => {
    renderOptions();
    await screen.findByTestId('coach-note-1');

    fireEvent.click(screen.getByTestId('coach-note-delete-1'));
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenCalledWith('Delete this Coach note?');
    expect(coach.deleteNote).not.toHaveBeenCalled();
    expect(screen.getByTestId('coach-note-1')).toBeInTheDocument();

    confirmMock.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('coach-note-delete-1'));

    await waitFor(() => expect(coach.deleteNote).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByTestId('coach-note-1')).not.toBeInTheDocument());
    expect(screen.getByTestId('coach-note-2')).toBeInTheDocument();
  });
});

describe('Start reminders (B66, D109, D113)', () => {
  it('shows the stored values and the note about when changes apply', async () => {
    settings.getReminders.mockResolvedValue({ enabled: true, minutes_before: 10 });
    renderOptions();

    await waitFor(() => expect(field('input-reminder-minutes').value).toBe('10'));
    expect(checkbox('toggle-start-reminders').checked).toBe(true);
    expect(screen.getByText('Applies to Blocks pushed or changed from now on.')).toBeInTheDocument();
  });

  it('the checkbox round-trips through updateReminders with the stored minutes', async () => {
    settings.getReminders.mockResolvedValue({ enabled: true, minutes_before: 10 });
    renderOptions();
    await waitFor(() => expect(checkbox('toggle-start-reminders').checked).toBe(true));

    fireEvent.click(checkbox('toggle-start-reminders'));

    await waitFor(() =>
      expect(settings.updateReminders).toHaveBeenCalledWith({ enabled: false, minutes_before: 10 }),
    );
    await waitFor(() => expect(checkbox('toggle-start-reminders').checked).toBe(false));
  });

  it('Save sends the typed minutes', async () => {
    renderOptions();
    await waitFor(() => expect(field('input-reminder-minutes').value).toBe('5'));

    fireEvent.change(field('input-reminder-minutes'), { target: { value: '15' } });
    fireEvent.click(screen.getByTestId('reminders-save'));

    await waitFor(() =>
      expect(settings.updateReminders).toHaveBeenCalledWith({ enabled: true, minutes_before: 15 }),
    );
  });

  it('0 or 121 minutes disables Save and shows 1–120', async () => {
    renderOptions();
    await waitFor(() => expect(field('input-reminder-minutes').value).toBe('5'));
    expect(screen.queryByText('1–120')).toBeNull();

    fireEvent.change(field('input-reminder-minutes'), { target: { value: '0' } });
    expect(screen.getByTestId('reminders-save')).toBeDisabled();
    expect(screen.getByText('1–120')).toBeInTheDocument();

    fireEvent.change(field('input-reminder-minutes'), { target: { value: '121' } });
    expect(screen.getByTestId('reminders-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('reminders-save'));
    expect(settings.updateReminders).not.toHaveBeenCalled();

    fireEvent.change(field('input-reminder-minutes'), { target: { value: '120' } });
    expect(screen.getByTestId('reminders-save')).not.toBeDisabled();
    expect(screen.queryByText('1–120')).toBeNull();
  });
});

describe('Coach usage (B66, D104, D106)', () => {
  it("shows this month's conversations and cost", async () => {
    renderOptions();

    await waitFor(() => expect(screen.getByTestId('usage-month')).toHaveTextContent('3 conversations'));
    expect(screen.getByTestId('usage-month')).toHaveTextContent('$0.42');
    expect(coach.getUsage).toHaveBeenCalled();
  });

  it('lists conversations with date, status and cost', async () => {
    renderOptions();

    const first = await screen.findByTestId('usage-conversation-41');
    expect(first).toHaveTextContent('2026-11-20');
    expect(first).toHaveTextContent('accepted');
    expect(first).toHaveTextContent('$0.07');
    const second = screen.getByTestId('usage-conversation-40');
    expect(second).toHaveTextContent('2026-11-18');
    expect(second).toHaveTextContent('rejected');
    expect(second).toHaveTextContent('$0.10');
  });

  it('a conversation opens a read-only detail with its messages, Proposal, and call rows', async () => {
    renderOptions();
    fireEvent.click(await screen.findByTestId('usage-conversation-41'));

    await waitFor(() => expect(coach.getConversation).toHaveBeenCalledWith(41));
    const detail = await screen.findByTestId('usage-detail');
    const scoped = within(detail);
    await waitFor(() => expect(scoped.getByText('What matters most tomorrow?')).toBeInTheDocument());
    expect(scoped.getByText('Two hours of focus work and a run.')).toBeInTheDocument();
    expect(scoped.getByText(/Focus first, run at lunch\./)).toBeInTheDocument();
    expect(detail.querySelectorAll('input, textarea, select')).toHaveLength(0);

    const call0 = scoped.getByTestId('usage-call-0');
    expect(call0).toHaveTextContent('3100');
    expect(call0).toHaveTextContent('400');
    expect(call0).toHaveTextContent('2140 ms');
    expect(call0).toHaveTextContent('$0.0218');

    const call1 = scoped.getByTestId('usage-call-1');
    expect(call1).toHaveTextContent('2100');
    expect(call1).toHaveTextContent('500');
    expect(call1).toHaveTextContent('3000');
    expect(call1).toHaveTextContent('3870 ms');
    expect(call1).toHaveTextContent('$0.0513');
    expect(scoped.queryByTestId('usage-call-2')).toBeNull();
  });
});
