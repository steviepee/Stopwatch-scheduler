import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { CalendarView } from '../components/calendar';

vi.mock('../services/api', () => ({
  sessionAPI: {
    schedule: vi.fn(),
    unschedule: vi.fn(),
    create: vi.fn(),
    addToCalendar: vi.fn(),
  },
  googleCalendarAPI: {
    checkAuthStatus: vi.fn().mockResolvedValue({ authenticated: false }),
  },
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  }),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  pointerWithin: vi.fn(),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: { toString: vi.fn().mockReturnValue('') },
    Translate: { toString: vi.fn().mockReturnValue('') },
  },
}));

const onSessionUpdate = vi.fn();
const onSessionCreate = vi.fn();

describe('CalendarView', () => {
  it('renders week and day view toggle buttons', () => {
    render(
      <CalendarView
        scheduledSessions={[]}
        unscheduledSessions={[]}
        onSessionUpdate={onSessionUpdate}
        onSessionCreate={onSessionCreate}
      />
    );
    expect(screen.getByText('Week')).toBeInTheDocument();
    expect(screen.getByText('Day')).toBeInTheDocument();
  });

  it('shows Today navigation button', () => {
    render(
      <CalendarView
        scheduledSessions={[]}
        unscheduledSessions={[]}
        onSessionUpdate={onSessionUpdate}
        onSessionCreate={onSessionCreate}
      />
    );
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('clicking Today button does not crash', () => {
    render(
      <CalendarView
        scheduledSessions={[]}
        unscheduledSessions={[]}
        onSessionUpdate={onSessionUpdate}
        onSessionCreate={onSessionCreate}
      />
    );
    fireEvent.click(screen.getByText('Today'));
    // should still render week/day buttons
    expect(screen.getByText('Week')).toBeInTheDocument();
  });

  it('renders unscheduled sessions in session bank', () => {
    const sessions = [
      { id: 1, name: 'Study', duration: 3600, is_on_calendar: false, created_at: '', updated_at: '' },
    ];
    render(
      <CalendarView
        scheduledSessions={[]}
        unscheduledSessions={sessions}
        onSessionUpdate={onSessionUpdate}
        onSessionCreate={onSessionCreate}
      />
    );
    expect(screen.getByText('Study')).toBeInTheDocument();
  });

  it('switches to Day view mode on button click', () => {
    render(
      <CalendarView
        scheduledSessions={[]}
        unscheduledSessions={[]}
        onSessionUpdate={onSessionUpdate}
        onSessionCreate={onSessionCreate}
      />
    );
    fireEvent.click(screen.getByText('Day'));
    // In day view, date label changes format - both buttons still present
    expect(screen.getByText('Week')).toBeInTheDocument();
  });
});
