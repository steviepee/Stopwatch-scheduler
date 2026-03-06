import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import SessionList from '../components/SessionList';

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
    is_on_calendar: false,
    created_at: '2026-03-06T08:00:00',
    updated_at: '2026-03-06T08:00:00',
  },
  {
    id: 2,
    name: 'Evening Read',
    duration: 1800,
    is_on_calendar: true,
    created_at: '2026-03-06T20:00:00',
    updated_at: '2026-03-06T20:00:00',
  },
];

describe('SessionList', () => {
  const onDeleteSession = vi.fn();
  const onUpdateSession = vi.fn();
  const onAddToCalendar = vi.fn();
  const onRemoveFromCalendar = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders session names', async () => {
    render(
      <SessionList
        sessions={mockSessions}
        onDeleteSession={onDeleteSession}
        onUpdateSession={onUpdateSession}
        onAddToCalendar={onAddToCalendar}
        onRemoveFromCalendar={onRemoveFromCalendar}
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
        onAddToCalendar={onAddToCalendar}
        onRemoveFromCalendar={onRemoveFromCalendar}
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
        onAddToCalendar={onAddToCalendar}
        onRemoveFromCalendar={onRemoveFromCalendar}
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
        onAddToCalendar={onAddToCalendar}
        onRemoveFromCalendar={onRemoveFromCalendar}
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
        onAddToCalendar={onAddToCalendar}
        onRemoveFromCalendar={onRemoveFromCalendar}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('Search by name...'), { target: { value: 'morning' } });
    expect(screen.getByText('Morning Run')).toBeInTheDocument();
    expect(screen.queryByText('Evening Read')).not.toBeInTheDocument();
  });
});
