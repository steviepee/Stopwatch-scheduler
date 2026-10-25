import type { ComponentType } from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import SessionListComponent from '../components/SessionList';
import { googleCalendarAPI, sessionAPI } from '../services/api';
import type { StopwatchSession, Task } from '../types';

// B10 (D46): Recordings are history only. SessionList takes no calendar callbacks and shows no
// Recording push/remove button, badge or calendar filter, even when Google is authorized.
const SessionList = SessionListComponent as unknown as ComponentType<{
  sessions: StopwatchSession[];
  onDeleteSession: (sessionId: number) => void;
  onUpdateSession: (sessionId: number, name: string) => void;
}>;

// B38 contract (D78, web parity with mobile's B37): every row gets `session-activity-<id>`
// text, the linked Activity's name or "—" with none, plus a toggle `btn-session-actions-<id>`
// that opens a `session-actions-<id>` panel. With no Activity: `action-attach-<id>` ("Attach to
// Activity") and `action-make-activity-<id>` ("Make it an Activity", or "Attach to <name>" when
// the Recording's trimmed name matches an Activity case-insensitively, in which case it sends
// `task_id` instead of `new_activity_name`). With an Activity: `action-change-<id>` ("Change
// Activity") and `action-detach-<id>` ("Detach", sends `task_id: null`). `action-attach-<id>`
// and `action-change-<id>` open a shared picker: `action-picker-search-<id>` filters
// `action-picker-<id>-<task_id>` rows by substring, case-insensitive; when changing, the
// current Activity's row reads "<name> (current)". Picking a row sends `PUT { task_id }`. Every
// action calls `sessionAPI.update(id, body)` itself and, on success, calls the new
// `onSessionUpdated(session)` prop with the response and closes the panel. The row's own
// `session-activity-<id>` label updates from that response right away (SessionList keeps a
// small local override keyed by session id, the same way `ManualForm` holds its own save state),
// since in this component `sessions` is a prop and nothing guarantees the parent re-renders with
// a fresh `task_id` inside the same test.
const SessionListWithActions = SessionListComponent as unknown as ComponentType<{
  sessions: StopwatchSession[];
  tasks: Task[];
  onDeleteSession: (sessionId: number) => void;
  onUpdateSession: (sessionId: number, name: string) => void;
  onSessionCreated: (session: StopwatchSession) => void;
  onSessionUpdated: (session: StopwatchSession) => void;
}>;

vi.mock('../services/api', () => ({
  googleCalendarAPI: {
    checkAuthStatus: vi.fn().mockResolvedValue({ authenticated: false }),
    login: vi.fn(),
  },
  sessionAPI: {
    update: vi.fn(),
  },
}));

const mockSessions = [
  {
    id: 1,
    name: 'Morning Run',
    duration: 3600,
    created_at: '2026-03-06T08:00:00',
    updated_at: '2026-03-06T08:00:00',
  },
  {
    id: 2,
    name: 'Evening Read',
    duration: 1800,
    created_at: '2026-03-06T20:00:00',
    updated_at: '2026-03-06T20:00:00',
  },
] as StopwatchSession[];

describe('SessionList', () => {
  const onDeleteSession = vi.fn();
  const onUpdateSession = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders session names', async () => {
    render(
      <SessionList
        sessions={mockSessions}
        onDeleteSession={onDeleteSession}
        onUpdateSession={onUpdateSession}
      />
    );
    expect(screen.getByText('Morning Run')).toBeInTheDocument();
    expect(screen.getByText('Evening Read')).toBeInTheDocument();
  });

  it('shows empty state when no sessions', () => {
    render(
      <SessionList
        sessions={[]}
        onDeleteSession={onDeleteSession}
        onUpdateSession={onUpdateSession}
      />
    );
    expect(screen.getByText(/No sessions yet/i)).toBeInTheDocument();
  });

  it('calls onDeleteSession when delete is clicked', () => {
    window.confirm = vi.fn().mockReturnValue(true);
    render(
      <SessionList
        sessions={mockSessions}
        onDeleteSession={onDeleteSession}
        onUpdateSession={onUpdateSession}
      />
    );
    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);
    expect(onDeleteSession).toHaveBeenCalledWith(1);
  });

  it('enters edit mode when session name is clicked', () => {
    render(
      <SessionList
        sessions={mockSessions}
        onDeleteSession={onDeleteSession}
        onUpdateSession={onUpdateSession}
      />
    );
    fireEvent.click(screen.getByText('Morning Run'));
    expect(screen.getByDisplayValue('Morning Run')).toBeInTheDocument();
  });

  it('filters sessions by search query', () => {
    render(
      <SessionList
        sessions={mockSessions}
        onDeleteSession={onDeleteSession}
        onUpdateSession={onUpdateSession}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('Search by name...'), { target: { value: 'morning' } });
    expect(screen.getByText('Morning Run')).toBeInTheDocument();
    expect(screen.queryByText('Evening Read')).not.toBeInTheDocument();
  });

  it('has no Recording calendar push, remove, badge or filter, even when Google is authorized', async () => {
    (googleCalendarAPI.checkAuthStatus as Mock).mockResolvedValue({ authenticated: true });
    render(
      <SessionList
        sessions={mockSessions}
        onDeleteSession={onDeleteSession}
        onUpdateSession={onUpdateSession}
      />
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByTitle('Add to calendar')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Remove from calendar')).not.toBeInTheDocument();
    expect(screen.queryByText(/📅/)).not.toBeInTheDocument();
    expect(screen.queryByText('On Calendar')).not.toBeInTheDocument();
    expect(screen.queryByText('Not on Calendar')).not.toBeInTheDocument();
  });
});

describe('recording actions (B38, D78)', () => {
  const update = sessionAPI.update as unknown as Mock;

  const ACTION_TASKS: Task[] = [
    { id: 20, name: 'Gym', average_duration: 1800, total_recordings: 3, created_at: '', updated_at: '' },
    { id: 21, name: 'Reading', average_duration: 900, total_recordings: 2, created_at: '', updated_at: '' },
  ];

  const ATTACHED_SESSION = {
    id: 10,
    name: 'Workout',
    duration: 1800,
    task_id: 20,
    created_at: '2026-03-06T08:00:00',
    updated_at: '2026-03-06T08:00:00',
  } as StopwatchSession;

  const UNATTACHED_MATCHING_SESSION = {
    id: 11,
    name: 'Gym',
    duration: 1800,
    created_at: '2026-03-06T09:00:00',
    updated_at: '2026-03-06T09:00:00',
  } as StopwatchSession;

  const UNATTACHED_NO_MATCH_SESSION = {
    id: 12,
    name: 'Mystery',
    duration: 600,
    created_at: '2026-03-06T10:00:00',
    updated_at: '2026-03-06T10:00:00',
  } as StopwatchSession;

  function renderActions(sessions: StopwatchSession[]) {
    const onSessionUpdated = vi.fn();
    render(
      <SessionListWithActions
        sessions={sessions}
        tasks={ACTION_TASKS}
        onDeleteSession={vi.fn()}
        onUpdateSession={vi.fn()}
        onSessionCreated={vi.fn()}
        onSessionUpdated={onSessionUpdated}
      />
    );
    return { onSessionUpdated };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows each row\'s linked Activity name, or "—" with none', () => {
    renderActions([ATTACHED_SESSION, UNATTACHED_NO_MATCH_SESSION]);
    expect(screen.getByTestId('session-activity-10')).toHaveTextContent('Gym');
    expect(screen.getByTestId('session-activity-12')).toHaveTextContent('—');
  });

  it('a no-Activity Recording offers Attach to Activity and Make it an Activity; an attached one offers Change Activity and Detach', async () => {
    renderActions([ATTACHED_SESSION, UNATTACHED_NO_MATCH_SESSION]);

    fireEvent.click(screen.getByTestId('btn-session-actions-10'));
    await screen.findByTestId('session-actions-10');
    expect(screen.getByTestId('action-change-10')).toBeInTheDocument();
    expect(screen.getByTestId('action-detach-10')).toBeInTheDocument();
    expect(screen.queryByTestId('action-attach-10')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-make-activity-10')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('btn-session-actions-12'));
    await screen.findByTestId('session-actions-12');
    expect(screen.getByTestId('action-attach-12')).toBeInTheDocument();
    expect(screen.getByTestId('action-make-activity-12')).toBeInTheDocument();
    expect(screen.queryByTestId('action-change-12')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-detach-12')).not.toBeInTheDocument();
  });

  it('Make it an Activity reads "Attach to Gym" and sends task_id when the name matches', async () => {
    update.mockResolvedValue({ ...UNATTACHED_MATCHING_SESSION, task_id: 20 });
    const { onSessionUpdated } = renderActions([UNATTACHED_MATCHING_SESSION]);

    fireEvent.click(screen.getByTestId('btn-session-actions-11'));
    const makeActivity = await screen.findByTestId('action-make-activity-11');
    expect(makeActivity).toHaveTextContent('Attach to Gym');
    fireEvent.click(makeActivity);

    await waitFor(() => expect(update).toHaveBeenCalledWith(11, { task_id: 20 }));
    await waitFor(() => expect(onSessionUpdated).toHaveBeenCalledWith({ ...UNATTACHED_MATCHING_SESSION, task_id: 20 }));
    await waitFor(() => expect(screen.queryByTestId('session-actions-11')).not.toBeInTheDocument());
  });

  it('Make it an Activity reads "Make it an Activity" and sends new_activity_name when nothing matches', async () => {
    update.mockResolvedValue({ ...UNATTACHED_NO_MATCH_SESSION, task_id: 99 });
    renderActions([UNATTACHED_NO_MATCH_SESSION]);

    fireEvent.click(screen.getByTestId('btn-session-actions-12'));
    const makeActivity = await screen.findByTestId('action-make-activity-12');
    expect(makeActivity).toHaveTextContent('Make it an Activity');
    fireEvent.click(makeActivity);

    await waitFor(() => expect(update).toHaveBeenCalledWith(12, { new_activity_name: 'Mystery' }));
  });

  it('Attach to Activity opens a search picker that filters, and sends task_id', async () => {
    update.mockResolvedValue({ ...UNATTACHED_NO_MATCH_SESSION, task_id: 21 });
    renderActions([UNATTACHED_NO_MATCH_SESSION]);

    fireEvent.click(screen.getByTestId('btn-session-actions-12'));
    fireEvent.click(await screen.findByTestId('action-attach-12'));
    fireEvent.change(await screen.findByTestId('action-picker-search-12'), { target: { value: 'read' } });

    await screen.findByTestId('action-picker-12-21');
    expect(screen.queryByTestId('action-picker-12-20')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('action-picker-12-21'));

    await waitFor(() => expect(update).toHaveBeenCalledWith(12, { task_id: 21 }));
  });

  it('Change Activity opens the same picker with the current Activity marked, and sends task_id', async () => {
    update.mockResolvedValue({ ...ATTACHED_SESSION, task_id: 21 });
    renderActions([ATTACHED_SESSION]);

    fireEvent.click(screen.getByTestId('btn-session-actions-10'));
    fireEvent.click(await screen.findByTestId('action-change-10'));

    const current = await screen.findByTestId('action-picker-10-20');
    expect(current).toHaveTextContent('Gym (current)');
    fireEvent.click(screen.getByTestId('action-picker-10-21'));

    await waitFor(() => expect(update).toHaveBeenCalledWith(10, { task_id: 21 }));
  });

  it('Detach sends task_id: null', async () => {
    update.mockResolvedValue({ ...ATTACHED_SESSION, task_id: undefined });
    renderActions([ATTACHED_SESSION]);

    fireEvent.click(screen.getByTestId('btn-session-actions-10'));
    fireEvent.click(await screen.findByTestId('action-detach-10'));

    await waitFor(() => expect(update).toHaveBeenCalledWith(10, { task_id: null }));
  });

  it('after a successful action the row\'s Activity label updates', async () => {
    update.mockResolvedValue({ ...UNATTACHED_NO_MATCH_SESSION, task_id: 21 });
    renderActions([UNATTACHED_NO_MATCH_SESSION]);

    expect(screen.getByTestId('session-activity-12')).toHaveTextContent('—');
    fireEvent.click(screen.getByTestId('btn-session-actions-12'));
    fireEvent.click(await screen.findByTestId('action-attach-12'));
    fireEvent.click(await screen.findByTestId('action-picker-12-21'));

    await waitFor(() => expect(screen.getByTestId('session-activity-12')).toHaveTextContent('Reading'));
  });
});
