import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';
import Stopwatch from '../components/Stopwatch';

const mockTasks = [
  { id: 1, name: 'Work', average_duration: 3600, total_recordings: 5, created_at: '', updated_at: '' },
];

describe('Stopwatch', () => {
  const onSaveTime = vi.fn();
  const onSaveSession = vi.fn();
  const onModalChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders Start button and timer initially', () => {
    render(<Stopwatch tasks={mockTasks} onSaveTime={onSaveTime} onSaveSession={onSaveSession} />);
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('Reset')).toBeInTheDocument();
  });

  it('switches to Stop button after clicking Start', async () => {
    render(<Stopwatch tasks={mockTasks} onSaveTime={onSaveTime} onSaveSession={onSaveSession} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    expect(screen.getByText('Stop')).toBeInTheDocument();
  });

  it('shows Start again after clicking Reset', async () => {
    render(<Stopwatch tasks={mockTasks} onSaveTime={onSaveTime} onSaveSession={onSaveSession} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Reset'));
    });
    expect(screen.getByText('Start')).toBeInTheDocument();
  });

  it('shows save modal when Stop clicked after time has elapsed', async () => {
    render(
      <Stopwatch
        tasks={mockTasks}
        onSaveTime={onSaveTime}
        onSaveSession={onSaveSession}
        onModalChange={onModalChange}
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Stop'));
    });
    expect(onModalChange).toHaveBeenCalledWith(true);
    expect(screen.getAllByText('Save Recording').length).toBeGreaterThan(0);
  });

  it('does not show modal when Stop clicked immediately (time = 0)', async () => {
    render(
      <Stopwatch
        tasks={mockTasks}
        onSaveTime={onSaveTime}
        onSaveSession={onSaveSession}
        onModalChange={onModalChange}
      />
    );
    // Click Start then immediately Stop before any time elapses
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Stop'));
    });
    // time is effectively 0 since no time has passed with fake timers
    expect(screen.queryByText('Save Recording')).not.toBeInTheDocument();
  });
});
