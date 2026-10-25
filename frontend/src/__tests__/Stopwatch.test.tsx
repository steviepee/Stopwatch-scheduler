import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import Stopwatch from '../components/Stopwatch';

// B38 contract (D76, D77, web parity with mobile's B36): the "Link to Activity (optional)"
// select in the save-as-Recording modal gains `data-testid="select-activity"` on the <select>
// itself. Its options stay "No activity linked" (value "") plus one per Activity (value = id),
// except:
//   - when the typed Recording name (trimmed) matches no Activity's name case-insensitively and
//     is non-blank, an extra option is appended: value "__new__", text
//     `+ New Activity: '<name>'`, `data-testid="option-activity-new"`;
//   - when it matches one, that Activity's option text reads `Attach to <name>` instead of the
//     plain name (no new-Activity option in that case).
// Selecting `__new__` and saving sends `new_activity_name` (the trimmed name) and no `task_id`.
// Selecting a real option sends `task_id` as today. Leaving the select untouched sends neither
// field (unchanged default behaviour). This only applies to the "Save as Recording" (session)
// save type; "Add to Activity" (timelog) keeps its own mandatory-Activity select unchanged.
const mockTasks = [
  { id: 1, name: 'Work', average_duration: 3600, total_recordings: 5, created_at: '', updated_at: '' },
];

async function openSaveModal(tasks = mockTasks) {
  const onSaveSession = vi.fn();
  render(<Stopwatch tasks={tasks} onSaveTime={vi.fn()} onSaveSession={onSaveSession} />);
  await act(async () => {
    fireEvent.click(screen.getByText('Start'));
  });
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  await act(async () => {
    fireEvent.click(screen.getByText('Stop'));
  });
  return { onSaveSession };
}

function setRecordingName(name: string) {
  fireEvent.change(screen.getByPlaceholderText('Name this recording...'), { target: { value: name } });
}

function saveRecording() {
  fireEvent.click(screen.getByRole('button', { name: 'Save Recording' }));
}

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

describe('new Activity row (B38, D76, D77)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows "+ New Activity: \'Laundry\'" when the name matches no Activity, and selecting it sends new_activity_name with no task_id', async () => {
    const { onSaveSession } = await openSaveModal();
    setRecordingName('Laundry');

    const option = screen.getByTestId('option-activity-new');
    expect(option).toHaveTextContent("+ New Activity: 'Laundry'");

    fireEvent.change(screen.getByTestId('select-activity'), { target: { value: '__new__' } });
    saveRecording();

    expect(onSaveSession).toHaveBeenCalledTimes(1);
    const body = (onSaveSession as unknown as Mock).mock.calls[0][0];
    expect(body.new_activity_name).toBe('Laundry');
    expect(body.task_id).toBeUndefined();
  });

  it('shows no new-Activity row for a blank name', async () => {
    await openSaveModal();
    expect(screen.queryByTestId('option-activity-new')).not.toBeInTheDocument();
  });

  it('name "laundry " with Activity "Laundry" present shows no new row, and offers "Attach to Laundry"', async () => {
    await openSaveModal([
      { id: 2, name: 'Laundry', average_duration: 600, total_recordings: 1, created_at: '', updated_at: '' },
    ]);
    setRecordingName('laundry ');

    expect(screen.queryByTestId('option-activity-new')).not.toBeInTheDocument();
    expect(screen.getByText('Attach to Laundry')).toBeInTheDocument();
    expect(screen.queryByText('Laundry')).not.toBeInTheDocument();
  });

  it('selecting "Attach to Laundry" sends task_id and no new_activity_name', async () => {
    const { onSaveSession } = await openSaveModal([
      { id: 2, name: 'Laundry', average_duration: 600, total_recordings: 1, created_at: '', updated_at: '' },
    ]);
    setRecordingName('laundry ');
    fireEvent.change(screen.getByTestId('select-activity'), { target: { value: '2' } });
    saveRecording();

    const body = (onSaveSession as unknown as Mock).mock.calls[0][0];
    expect(body.task_id).toBe(2);
    expect(body.new_activity_name).toBeUndefined();
  });

  it('default selection is None; saving without touching the select sends neither field', async () => {
    const { onSaveSession } = await openSaveModal();
    setRecordingName('Something unmatched');
    saveRecording();

    const body = (onSaveSession as unknown as Mock).mock.calls[0][0];
    expect(body.task_id).toBeUndefined();
    expect(body.new_activity_name).toBeUndefined();
  });
});
