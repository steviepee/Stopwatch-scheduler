import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import SettingsScreen from '../app/settings';

// B64 (D101, D104, D106, D107, D109, D113, D121): three new sections on `src/app/settings.tsx`.
// The PRD gives the sections in prose; this file pins the rest for B64.impl.
//
// API methods (added to `src/services/api.ts`, following the existing pattern):
//   settingsAPI.getCoach()              GET  /settings/coach      -> { notes_enabled }
//   settingsAPI.updateCoach(body)       PUT  /settings/coach
//   settingsAPI.getReminders()          GET  /settings/reminders  -> { enabled, minutes_before }
//   settingsAPI.updateReminders(body)   PUT  /settings/reminders  (always both fields)
//   coachAPI.getNotes()                 GET  /coach/notes
//   coachAPI.createNote({ text })       POST /coach/notes
//   coachAPI.updateNote(id, { text })   PUT  /coach/notes/{id}
//   coachAPI.deleteNote(id)             DELETE /coach/notes/{id}
//   coachAPI.getUsage()                 GET  /coach/usage         -> { month, conversations, accepted, cost_usd }
//   coachAPI.getConversations()         GET  /coach/conversations
//   coachAPI.getConversation(id)        GET  /coach/conversations/{id}
//
// Coach notes:
//   - Switch `toggle-coach-notes`, value = `notes_enabled`; toggling calls
//     `updateCoach({ notes_enabled })` and the switch then shows the server's answer.
//   - One `coach-note-<id>` row per note showing its text. Edit: `coach-note-edit-<id>` reveals
//     `input-note-<id>` (prefilled) and `btn-note-save-<id>`, which calls
//     `updateNote(id, { text })` with the text trimmed.
//   - Add: `input-new-note` and `btn-add-note` ("Add note"). Calls `createNote({ text })`
//     trimmed; disabled while the trimmed text is empty. The field clears after the add.
//   - Delete: `coach-note-delete-<id>` asks first with
//     `Alert.alert('Delete Coach note', <any>, [Cancel (cancel), Delete (destructive)])`,
//     like Recording delete. Only Delete calls `deleteNote(id)`.
// Start reminders:
//   - Switch `toggle-start-reminders`, value = `enabled`; toggling saves at once with
//     `updateReminders({ enabled, minutes_before })` (the current stored minutes).
//   - `input-reminder-minutes` prefilled with `minutes_before`, and `reminders-save`, which
//     sends `{ enabled, minutes_before: <typed> }`. Whole minutes 1–120; outside that Save is
//     disabled and `1–120` (en dash) shows, like the Pomodoro fields.
//   - The text `Applies to Blocks pushed or changed from now on.` is shown.
// Coach usage:
//   - `usage-month` reads `<n> conversations` and the month's cost as `$x.xx` (2 decimals).
//   - One `usage-conversation-<id>` row per conversation from `getConversations()`, showing its
//     `target_date`, `status`, and cost (`$x.xx`).
//   - Pressing a row calls `getConversation(id)` and shows `usage-detail` (read-only, no
//     inputs): each message's `visible_text`, the Proposal's `summary`, and one
//     `usage-call-<i>` row per call in the order given (i from 0). Each call row shows its
//     input, output, cache read and cache write tokens, `<latency_ms> ms`, and its cost as
//     `$x.xxxx` (4 decimals: a single call is usually under a cent).
// Every query and mutation goes through TanStack Query, like the Pomodoro section.
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

type Mocks = Record<string, jest.Mock>;
const apiModule = require('../services/api') as { settingsAPI: Mocks; coachAPI: Mocks };
const settings = apiModule.settingsAPI;
const coach = apiModule.coachAPI;

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

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function renderScreen() {
  return render(
    <QueryClientProvider client={client()}>
      <SettingsScreen />
    </QueryClientProvider>
  );
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  Object.values(settings).forEach((m) => m.mockReset());
  Object.values(coach).forEach((m) => m.mockReset());
  settings.getPomodoro.mockResolvedValue({ work_minutes: 25, break_minutes: 5, long_break_minutes: 15, long_break_every: 4 });
  settings.getDisplay.mockResolvedValue({ clock_24h: false });
  settings.getCoach.mockResolvedValue({ notes_enabled: true });
  settings.updateCoach.mockImplementation(async (body) => body);
  settings.getReminders.mockResolvedValue({ enabled: true, minutes_before: 5 });
  settings.updateReminders.mockImplementation(async (body) => body);
  coach.getNotes.mockResolvedValue(NOTES);
  coach.createNote.mockImplementation(async ({ text }) => ({ id: 3, text, created_at: '2026-11-19T10:00:00Z', confirmed_at: '2026-11-19T10:00:00Z' }));
  coach.updateNote.mockImplementation(async (id, { text }) => ({ ...NOTES.find((n) => n.id === id), text }));
  coach.deleteNote.mockResolvedValue(undefined);
  coach.getUsage.mockResolvedValue({ month: '2026-11', conversations: 3, accepted: 2, cost_usd: 0.4166 });
  coach.getConversations.mockResolvedValue([
    summary(),
    summary({ id: 40, target_date: '2026-11-18', status: 'rejected', cost_usd: 0.1 }),
  ]);
  coach.getConversation.mockResolvedValue(DETAIL);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('Coach notes setting (D107)', () => {
  it('shows the stored value and the switch round-trips through updateCoach', async () => {
    settings.updateCoach.mockResolvedValue({ notes_enabled: false });
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('toggle-coach-notes')).toHaveProp('value', true));
    await fireEvent(screen.getByTestId('toggle-coach-notes'), 'valueChange', false);

    await waitFor(() => expect(settings.updateCoach).toHaveBeenCalledWith({ notes_enabled: false }));
    await waitFor(() => expect(screen.getByTestId('toggle-coach-notes')).toHaveProp('value', false));
  });
});

describe('Coach notes list (D101)', () => {
  it('lists every note', async () => {
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('coach-note-1')).toHaveTextContent(/Mornings are for focus work/));
    expect(screen.getByTestId('coach-note-2')).toHaveTextContent(/Runs take longer in the cold/);
  });

  it('Add note posts the trimmed text and clears the field', async () => {
    await renderScreen();
    await screen.findByTestId('coach-note-1');

    expect(screen.getByTestId('btn-add-note')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('input-new-note'), '  Gym after work, not before  ');
    await fireEvent.press(screen.getByTestId('btn-add-note'));

    await waitFor(() => expect(coach.createNote).toHaveBeenCalledWith({ text: 'Gym after work, not before' }));
    await waitFor(() => expect(screen.getByTestId('input-new-note')).toHaveProp('value', ''));
  });

  it('edit saves the new text for that note', async () => {
    await renderScreen();
    await screen.findByTestId('coach-note-2');

    await fireEvent.press(screen.getByTestId('coach-note-edit-2'));
    expect(screen.getByTestId('input-note-2')).toHaveProp('value', 'Runs take longer in the cold');
    await fireEvent.changeText(screen.getByTestId('input-note-2'), 'Runs take 10 minutes longer in the cold ');
    await fireEvent.press(screen.getByTestId('btn-note-save-2'));

    await waitFor(() =>
      expect(coach.updateNote).toHaveBeenCalledWith(2, { text: 'Runs take 10 minutes longer in the cold' })
    );
  });

  it('delete asks first; Cancel keeps the note and Delete removes it', async () => {
    await renderScreen();
    await screen.findByTestId('coach-note-1');

    await fireEvent.press(screen.getByTestId('coach-note-delete-1'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(coach.deleteNote).not.toHaveBeenCalled();
    const [title, , buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('Delete Coach note');
    const cancel = buttons.find((b: { text: string }) => b.text === 'Cancel');
    const del = buttons.find((b: { text: string }) => b.text === 'Delete');
    expect(cancel.style).toBe('cancel');
    expect(del.style).toBe('destructive');

    cancel.onPress?.();
    expect(coach.deleteNote).not.toHaveBeenCalled();

    await act(async () => {
      del.onPress();
    });
    await waitFor(() => expect(coach.deleteNote).toHaveBeenCalledWith(1));
  });
});

describe('Start reminders (D109, D113)', () => {
  it('shows the stored values and the note about when changes apply', async () => {
    settings.getReminders.mockResolvedValue({ enabled: true, minutes_before: 10 });
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('input-reminder-minutes')).toHaveProp('value', '10'));
    expect(screen.getByTestId('toggle-start-reminders')).toHaveProp('value', true);
    expect(screen.getByText('Applies to Blocks pushed or changed from now on.')).toBeTruthy();
  });

  it('the switch round-trips through updateReminders with the stored minutes', async () => {
    settings.getReminders.mockResolvedValue({ enabled: true, minutes_before: 10 });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('toggle-start-reminders')).toHaveProp('value', true));

    await fireEvent(screen.getByTestId('toggle-start-reminders'), 'valueChange', false);

    await waitFor(() =>
      expect(settings.updateReminders).toHaveBeenCalledWith({ enabled: false, minutes_before: 10 })
    );
    await waitFor(() => expect(screen.getByTestId('toggle-start-reminders')).toHaveProp('value', false));
  });

  it('Save sends the typed minutes', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('input-reminder-minutes')).toHaveProp('value', '5'));

    await fireEvent.changeText(screen.getByTestId('input-reminder-minutes'), '15');
    await fireEvent.press(screen.getByTestId('reminders-save'));

    await waitFor(() =>
      expect(settings.updateReminders).toHaveBeenCalledWith({ enabled: true, minutes_before: 15 })
    );
  });

  it('0 or 121 minutes disables Save and shows 1–120', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('input-reminder-minutes')).toHaveProp('value', '5'));
    expect(screen.queryByText('1–120')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('input-reminder-minutes'), '0');
    expect(screen.getByTestId('reminders-save')).toBeDisabled();
    expect(screen.getByText('1–120')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('input-reminder-minutes'), '121');
    expect(screen.getByTestId('reminders-save')).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('input-reminder-minutes'), '120');
    expect(screen.getByTestId('reminders-save')).not.toBeDisabled();
    expect(screen.queryByText('1–120')).toBeNull();
  });
});

describe('Coach usage (D104, D106)', () => {
  it('shows this month\'s conversations and cost', async () => {
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('usage-month')).toHaveTextContent(/3 conversations/));
    expect(screen.getByTestId('usage-month')).toHaveTextContent(/\$0\.42/);
    expect(coach.getUsage).toHaveBeenCalled();
  });

  it('lists conversations with date, status and cost', async () => {
    await renderScreen();

    await screen.findByTestId('usage-conversation-41');
    const first = screen.getByTestId('usage-conversation-41');
    expect(first).toHaveTextContent(/2026-11-20/);
    expect(first).toHaveTextContent(/accepted/);
    expect(first).toHaveTextContent(/\$0\.07/);
    const second = screen.getByTestId('usage-conversation-40');
    expect(second).toHaveTextContent(/2026-11-18/);
    expect(second).toHaveTextContent(/rejected/);
    expect(second).toHaveTextContent(/\$0\.10/);
  });

  it('a conversation opens a read-only detail with its messages, Proposal, and call rows', async () => {
    await renderScreen();
    await screen.findByTestId('usage-conversation-41');

    await fireEvent.press(screen.getByTestId('usage-conversation-41'));

    await waitFor(() => expect(coach.getConversation).toHaveBeenCalledWith(41));
    const detail = await screen.findByTestId('usage-detail');
    const scoped = within(detail);
    await waitFor(() => expect(scoped.getByText('What matters most tomorrow?')).toBeTruthy());
    expect(scoped.getByText('Two hours of focus work and a run.')).toBeTruthy();
    expect(scoped.getByText(/Focus first, run at lunch\./)).toBeTruthy();

    const call0 = scoped.getByTestId('usage-call-0');
    expect(call0).toHaveTextContent(/3100/);
    expect(call0).toHaveTextContent(/400/);
    expect(call0).toHaveTextContent(/2140 ms/);
    expect(call0).toHaveTextContent(/\$0\.0218/);

    const call1 = scoped.getByTestId('usage-call-1');
    expect(call1).toHaveTextContent(/2100/);
    expect(call1).toHaveTextContent(/500/);
    expect(call1).toHaveTextContent(/3000/);
    expect(call1).toHaveTextContent(/3870 ms/);
    expect(call1).toHaveTextContent(/\$0\.0513/);
    expect(scoped.queryByTestId('usage-call-2')).toBeNull();
  });
});
