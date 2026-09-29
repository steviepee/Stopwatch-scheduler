import type { ComponentType } from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import SessionListComponent from '../components/SessionList';
import { googleCalendarAPI } from '../services/api';
import type { StopwatchSession } from '../types';

// B10 (D46): Recordings are history only. SessionList takes no calendar callbacks and shows no
// Recording push/remove button, badge or calendar filter, even when Google is authorized.
const SessionList = SessionListComponent as unknown as ComponentType<{
  sessions: StopwatchSession[];
  onDeleteSession: (sessionId: number) => void;
  onUpdateSession: (sessionId: number, name: string) => void;
}>;

vi.mock('../services/api', () => ({
  googleCalendarAPI: {
    checkAuthStatus: vi.fn().mockResolvedValue({ authenticated: false }),
    login: vi.fn(),
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
