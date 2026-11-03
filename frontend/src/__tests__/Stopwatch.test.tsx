import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import Stopwatch from '../components/Stopwatch';
import { settingsAPI } from '../services/api';

vi.mock('../services/api', () => ({
  settingsAPI: {
    getPomodoro: vi.fn(),
  },
}));

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
    localStorage.clear();
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
    localStorage.clear();
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

// B53 contract (D87): `useStopwatch` keeps time from timestamps, not by counting 10 ms ticks.
// Running state is `{ startedAt, accumulatedMs }` and elapsed is
// `accumulatedMs + (Date.now() - startedAt)`; a paused stopwatch has `startedAt: null`. The tick
// interval only re-renders. The state is saved to localStorage under `stopwatch.state` on start,
// pause and reset (reset removes the key), and restored on mount, running or paused. The save
// modal's `start_time` (set on the first Start) is stored with it, so it survives a remount.
// The timer display's own text is `HH:MM:SS` (the `.cc` span is separate).
const STORAGE_KEY = 'stopwatch.state';
const T0 = new Date('2026-11-02T15:00:00.000Z');

function renderStopwatch(onSaveSession = vi.fn()) {
  const utils = render(<Stopwatch tasks={mockTasks} onSaveTime={vi.fn()} onSaveSession={onSaveSession} />);
  return { ...utils, onSaveSession };
}

async function jumpClock(ms: number) {
  vi.setSystemTime(Date.now() + ms);
  await act(async () => {
    vi.advanceTimersByTime(10);
  });
}

describe('stopwatch survives a reload (B53, D87)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('elapsed follows the clock, not the tick count', async () => {
    renderStopwatch();
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    // A throttled background tab: the clock moves a minute while almost no ticks fire.
    await jumpClock(60_000);
    expect(screen.getByText('00:01:00')).toBeInTheDocument();
  });

  it('pausing freezes elapsed and resuming adds to it', async () => {
    renderStopwatch();
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    await jumpClock(30_000);
    await act(async () => {
      fireEvent.click(screen.getByText('Stop'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await jumpClock(120_000);
    expect(screen.getByText('00:00:30')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    await jumpClock(15_000);
    expect(screen.getByText('00:00:45')).toBeInTheDocument();
  });

  it('start saves the state under stopwatch.state', async () => {
    renderStopwatch();
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('unmount while running and remount: still running with the elapsed time intact', async () => {
    const first = renderStopwatch();
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    await jumpClock(5_000);
    first.unmount();

    vi.setSystemTime(Date.now() + 10_000);
    renderStopwatch();
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect(screen.getByText('Stop')).toBeInTheDocument();
    expect(screen.getByText('00:00:15')).toBeInTheDocument();
  });

  it('unmount while paused and remount: paused at the same elapsed', async () => {
    const first = renderStopwatch();
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    await jumpClock(7_000);
    await act(async () => {
      fireEvent.click(screen.getByText('Stop'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    first.unmount();

    vi.setSystemTime(Date.now() + 60_000);
    renderStopwatch();
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('00:00:07')).toBeInTheDocument();
  });

  it("the save modal's start_time survives a remount", async () => {
    const first = renderStopwatch();
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    await jumpClock(5_000);
    first.unmount();

    const { onSaveSession } = renderStopwatch();
    await jumpClock(5_000);
    await act(async () => {
      fireEvent.click(screen.getByText('Stop'));
    });
    setRecordingName('Reading');
    saveRecording();

    expect(onSaveSession).toHaveBeenCalledTimes(1);
    const body = (onSaveSession as unknown as Mock).mock.calls[0][0];
    expect(body.start_time).toBe(T0.toISOString());
    expect(body.duration).toBeCloseTo(10, 1);
  });

  it('reset clears the stored state', async () => {
    renderStopwatch();
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    await jumpClock(3_000);
    await act(async () => {
      fireEvent.click(screen.getByText('Reset'));
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.getByText('00:00:00')).toBeInTheDocument();
  });

  it('saving a Recording clears the stored state', async () => {
    renderStopwatch();
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    await jumpClock(3_000);
    await act(async () => {
      fireEvent.click(screen.getByText('Stop'));
    });
    setRecordingName('Reading');
    saveRecording();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

// B55 contract (D81, D82, D84–D87; web parity with mobile's B51). The run logic is
// `utils/pomodoro.ts` (see pomodoroCore.test.ts). On the stopwatch card:
// - Mode switch: buttons `mode-stopwatch` / `mode-pomodoro` (text "Stopwatch" / "Pomodoro"),
//   both disabled while anything is not idle: the stopwatch running, or paused with time > 0, or
//   a Pomodoro run existing. Stopwatch is the default mode; a restored run opens in Pomodoro.
// - Pomodoro mode, no run: the card shows a "Start" button. Clicking it opens `pomodoro-picker`
//   and hides that card button, and calls `settingsAPI.getPomodoro()` (only here, never on
//   mount, so pages whose tests mock the api without settingsAPI are unaffected). The picker
//   lists `pomodoro-activity-<id>` per Activity and `pomodoro-activity-new` ("+ New Activity"),
//   which reveals a `pomodoro-new-name` text input. No "None" / "No activity linked" choice.
//   `pomodoro-cancel` closes it. `pomodoro-start` ("Start") is disabled until an Activity is
//   chosen (a new one needs a non-blank name). The run uses the loaded settings
//   (snake_case from the server → PomodoroConfig), or 25/5/15/4 if the call failed.
// - Notification permission: on `pomodoro-start`, if `Notification` exists and its permission
//   is 'default', `Notification.requestPermission()` is called. Never throws without it.
// - While a run exists: `pomodoro-phase` ("Work" / "Break" / "Long break"); `pomodoro-phase-time`
//   reads `m:ss left` before the target and `+m:ss over` after it (minutes not padded, seconds
//   padded: "25:00 left", "4:30 left", "+5:00 over"); `pomodoro-total-work` contains the run's
//   total work as `mm:ss` (an `h:` prefix past an hour is the impl's choice). Buttons:
//   `pomodoro-pause` "Pause" / `pomodoro-resume` "Resume"; `pomodoro-switch` "Start break" in Work,
//   "Start work" in a Break; `pomodoro-finish` "Finish", disabled with no work; `pomodoro-reset`
//   "Reset". The display re-renders at least once a second.
// - Reminder: when `reminderDue`, once per phase: `new Notification(...)` if permission is
//   'granted' (skipped silently otherwise or if `Notification` is absent) and a short tone via
//   `new AudioContext()` + `createOscillator()` ... `start()`; then `markReminded`.
// - Finish opens the existing save modal (Save as Recording) with the name defaulting to the
//   Activity's name (or the new Activity's name) and `select-activity` preselected to the
//   Activity's id (or `__new__`). "Save Recording" sends `onSaveSession` with duration = total
//   work seconds, `task_id` or `new_activity_name`, `start_time` = the run's start (ISO), an
//   `end_time`, and `pomodoro_work_intervals`, `pomodoro_breaks`, `pomodoro_break_seconds` from
//   `finishRun`; the run then ends and `pomodoro.state` is removed.
// - Reset with work logged asks `window.confirm('Discard this Pomodoro run?')`; false keeps the
//   run, true discards it. With no work it discards without asking.
// - Persistence: the run state is written to localStorage `pomodoro.state` on every transition
//   (start, pause, resume, switch, reminder) and restored on mount, running or paused. Reset and
//   save remove the key.
const RUN_KEY = 'pomodoro.state';
const MIN = 60_000;
const RUN_TASKS = [
  { id: 3, name: 'Scales', average_duration: 1500, total_recordings: 2, created_at: '', updated_at: '' },
  { id: 4, name: 'Reading', average_duration: 900, total_recordings: 1, created_at: '', updated_at: '' },
];
const SERVER_SETTINGS = { work_minutes: 25, break_minutes: 5, long_break_minutes: 15, long_break_every: 4 };

type MockNotificationClass = Mock & { permission: string; requestPermission: Mock };

function stubNotification(permission: string): MockNotificationClass {
  const ctor = vi.fn() as unknown as MockNotificationClass;
  ctor.permission = permission;
  ctor.requestPermission = vi.fn().mockResolvedValue(permission === 'default' ? 'granted' : permission);
  vi.stubGlobal('Notification', ctor);
  return ctor;
}

function stubAudio() {
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const oscillatorStart = vi.fn();
  const constructed = vi.fn();
  class MockAudioContext {
    currentTime = 0;
    destination = {};
    state = 'running';
    constructor() {
      constructed();
    }
    createOscillator() {
      return {
        type: 'sine',
        frequency: param(),
        connect: vi.fn((node: unknown) => node),
        disconnect: vi.fn(),
        start: oscillatorStart,
        stop: vi.fn(),
        onended: null,
      };
    }
    createGain() {
      return { gain: param(), connect: vi.fn((node: unknown) => node), disconnect: vi.fn() };
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  vi.stubGlobal('AudioContext', MockAudioContext);
  return { constructed, oscillatorStart };
}

function renderCard(onSaveSession = vi.fn()) {
  const utils = render(<Stopwatch tasks={RUN_TASKS} onSaveTime={vi.fn()} onSaveSession={onSaveSession} />);
  return { ...utils, onSaveSession };
}

async function passTime(ms: number) {
  vi.setSystemTime(Date.now() + ms - 1000);
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

async function openPicker() {
  fireEvent.click(screen.getByTestId('mode-pomodoro'));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  });
  await act(async () => {});
}

async function confirmStart() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('pomodoro-start'));
  });
}

async function startRunOn(taskId = 3) {
  await openPicker();
  fireEvent.click(screen.getByTestId(`pomodoro-activity-${taskId}`));
  await confirmStart();
}

async function clickSwitch() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('pomodoro-switch'));
  });
}

describe('Pomodoro on the stopwatch card (B55)', () => {
  const getPomodoro = settingsAPI.getPomodoro as unknown as Mock;
  let notification: MockNotificationClass;
  let audio: ReturnType<typeof stubAudio>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    getPomodoro.mockResolvedValue(SERVER_SETTINGS);
    notification = stubNotification('granted');
    audio = stubAudio();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('mode switch', () => {
    it('is locked while the stopwatch runs, and while it is paused with time on it', async () => {
      renderCard();
      expect(screen.getByTestId('mode-pomodoro')).not.toBeDisabled();

      await act(async () => {
        fireEvent.click(screen.getByText('Start'));
      });
      expect(screen.getByTestId('mode-pomodoro')).toBeDisabled();
      expect(screen.getByTestId('mode-stopwatch')).toBeDisabled();

      await passTime(5_000);
      await act(async () => {
        fireEvent.click(screen.getByText('Stop'));
      });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByTestId('mode-pomodoro')).toBeDisabled();

      await act(async () => {
        fireEvent.click(screen.getByText('Reset'));
      });
      expect(screen.getByTestId('mode-pomodoro')).not.toBeDisabled();
    });

    it('is locked while a run exists', async () => {
      renderCard();
      await startRunOn();

      expect(screen.getByTestId('mode-stopwatch')).toBeDisabled();
      expect(screen.getByTestId('mode-pomodoro')).toBeDisabled();
    });

    it('does not load the Pomodoro settings on mount', () => {
      renderCard();
      expect(getPomodoro).not.toHaveBeenCalled();
    });
  });

  describe('Activity picker', () => {
    it('Start is disabled until an Activity is chosen; "None" is not offered', async () => {
      renderCard();
      await openPicker();

      const picker = screen.getByTestId('pomodoro-picker');
      expect(getPomodoro).toHaveBeenCalledTimes(1);
      expect(within(picker).queryByText(/none|no activity/i)).not.toBeInTheDocument();
      expect(screen.getByTestId('pomodoro-activity-3')).toHaveTextContent('Scales');
      expect(screen.getByTestId('pomodoro-activity-4')).toHaveTextContent('Reading');
      expect(screen.getByTestId('pomodoro-start')).toBeDisabled();

      fireEvent.click(screen.getByTestId('pomodoro-activity-4'));
      expect(screen.getByTestId('pomodoro-start')).not.toBeDisabled();
    });

    it('a new Activity needs a non-blank name', async () => {
      renderCard();
      await openPicker();

      fireEvent.click(screen.getByTestId('pomodoro-activity-new'));
      expect(screen.getByTestId('pomodoro-start')).toBeDisabled();
      fireEvent.change(screen.getByTestId('pomodoro-new-name'), { target: { value: '   ' } });
      expect(screen.getByTestId('pomodoro-start')).toBeDisabled();
      fireEvent.change(screen.getByTestId('pomodoro-new-name'), { target: { value: 'Etudes' } });
      expect(screen.getByTestId('pomodoro-start')).not.toBeDisabled();
    });

    it('Cancel closes the picker without starting a run', async () => {
      renderCard();
      await openPicker();

      fireEvent.click(screen.getByTestId('pomodoro-cancel'));
      expect(screen.queryByTestId('pomodoro-picker')).not.toBeInTheDocument();
      expect(screen.queryByTestId('pomodoro-phase')).not.toBeInTheDocument();
      expect(localStorage.getItem(RUN_KEY)).toBeNull();
    });

    it("the run uses the server's lengths", async () => {
      getPomodoro.mockResolvedValue({ ...SERVER_SETTINGS, work_minutes: 1 });
      renderCard();
      await startRunOn();

      expect(screen.getByTestId('pomodoro-phase')).toHaveTextContent('Work');
      expect(screen.getByTestId('pomodoro-phase-time')).toHaveTextContent('1:00 left');
    });

    it('falls back to 25/5/15/4 when the settings cannot be loaded', async () => {
      getPomodoro.mockRejectedValue(new Error('offline'));
      renderCard();
      await startRunOn();

      expect(screen.getByTestId('pomodoro-phase-time')).toHaveTextContent('25:00 left');
    });

    it('asks for notification permission on Start when it has not been decided', async () => {
      notification = stubNotification('default');
      renderCard();
      await startRunOn();

      expect(notification.requestPermission).toHaveBeenCalledTimes(1);
    });
  });

  describe('a run', () => {
    it('counts down the Work interval, and Pause freezes it', async () => {
      renderCard();
      await startRunOn();

      await passTime(30_000);
      expect(screen.getByTestId('pomodoro-phase-time')).toHaveTextContent('24:30 left');

      await act(async () => {
        fireEvent.click(screen.getByTestId('pomodoro-pause'));
      });
      await passTime(5 * MIN);
      expect(screen.getByTestId('pomodoro-phase-time')).toHaveTextContent('24:30 left');

      await act(async () => {
        fireEvent.click(screen.getByTestId('pomodoro-resume'));
      });
      await passTime(30_000);
      expect(screen.getByTestId('pomodoro-phase-time')).toHaveTextContent('24:00 left');
    });

    it('Start break / Start work move through the phases; the 4th break is a Long break', async () => {
      renderCard();
      await startRunOn();

      const breaks: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        expect(screen.getByTestId('pomodoro-switch')).toHaveTextContent('Start break');
        await passTime(25 * MIN);
        await clickSwitch();
        breaks.push(screen.getByTestId('pomodoro-phase').textContent ?? '');
        expect(screen.getByTestId('pomodoro-switch')).toHaveTextContent('Start work');
        if (i < 3) {
          await passTime(5 * MIN);
          await clickSwitch();
          expect(screen.getByTestId('pomodoro-phase')).toHaveTextContent('Work');
        }
      }

      expect(breaks).toEqual(['Break', 'Break', 'Break', 'Long break']);
      expect(screen.getByTestId('pomodoro-phase-time')).toHaveTextContent('15:00 left');
      expect(screen.getByTestId('pomodoro-total-work')).toHaveTextContent('100:00');
    });

    it('past the target shows +m:ss over, and the reminder fires once per phase', async () => {
      renderCard();
      await startRunOn();

      await passTime(24 * MIN);
      expect(notification).not.toHaveBeenCalled();

      await passTime(6 * MIN);
      expect(screen.getByTestId('pomodoro-phase-time')).toHaveTextContent('+5:00 over');
      expect(notification).toHaveBeenCalledTimes(1);
      expect(audio.oscillatorStart).toHaveBeenCalledTimes(1);

      await passTime(2 * MIN);
      await passTime(2 * MIN);
      expect(screen.getByTestId('pomodoro-phase-time')).toHaveTextContent('+9:00 over');
      expect(notification).toHaveBeenCalledTimes(1);
      expect(audio.oscillatorStart).toHaveBeenCalledTimes(1);

      await clickSwitch();
      await passTime(5 * MIN);
      expect(notification).toHaveBeenCalledTimes(2);
    });

    it('with permission denied, no Notification is shown and the run carries on', async () => {
      notification = stubNotification('denied');
      renderCard();
      await startRunOn();

      await passTime(26 * MIN);
      expect(notification).not.toHaveBeenCalled();
      expect(screen.getByTestId('pomodoro-phase-time')).toHaveTextContent('+1:00 over');
    });

    it('works without the Notification API at all', async () => {
      vi.stubGlobal('Notification', undefined);
      renderCard();
      await startRunOn();

      await passTime(26 * MIN);
      expect(screen.getByTestId('pomodoro-phase-time')).toHaveTextContent('+1:00 over');
    });
  });

  describe('Finish', () => {
    it('is disabled until some work is logged', async () => {
      renderCard();
      await startRunOn();

      expect(screen.getByTestId('pomodoro-finish')).toBeDisabled();
      await passTime(2_000);
      expect(screen.getByTestId('pomodoro-finish')).not.toBeDisabled();
    });

    it('during a Break sends total work and the three fields with the chosen Activity', async () => {
      const { onSaveSession } = renderCard();
      await startRunOn(3);

      await passTime(25 * MIN);
      await clickSwitch();
      await passTime(5 * MIN);
      await clickSwitch();
      await passTime(20 * MIN);
      await clickSwitch();
      await passTime(3 * MIN);

      await act(async () => {
        fireEvent.click(screen.getByTestId('pomodoro-finish'));
      });
      expect(screen.getByPlaceholderText('Name this recording...')).toHaveValue('Scales');
      expect(screen.getByTestId('select-activity')).toHaveValue('3');
      saveRecording();

      expect(onSaveSession).toHaveBeenCalledTimes(1);
      const body = (onSaveSession as unknown as Mock).mock.calls[0][0];
      expect(body).toMatchObject({
        name: 'Scales',
        duration: 45 * 60,
        task_id: 3,
        start_time: T0.toISOString(),
        pomodoro_work_intervals: 2,
        pomodoro_breaks: 1,
        pomodoro_break_seconds: 5 * 60,
      });
      expect(typeof body.end_time).toBe('string');
      expect(body.new_activity_name).toBeUndefined();
      expect(localStorage.getItem(RUN_KEY)).toBeNull();
      expect(screen.queryByTestId('pomodoro-phase')).not.toBeInTheDocument();
    });

    it('during Work counts the open interval, and a new Activity is sent by name', async () => {
      const { onSaveSession } = renderCard();
      await openPicker();
      fireEvent.click(screen.getByTestId('pomodoro-activity-new'));
      fireEvent.change(screen.getByTestId('pomodoro-new-name'), { target: { value: 'Etudes' } });
      await confirmStart();

      await passTime(10 * MIN);
      await act(async () => {
        fireEvent.click(screen.getByTestId('pomodoro-finish'));
      });
      expect(screen.getByPlaceholderText('Name this recording...')).toHaveValue('Etudes');
      expect(screen.getByTestId('select-activity')).toHaveValue('__new__');
      saveRecording();

      const body = (onSaveSession as unknown as Mock).mock.calls[0][0];
      expect(body).toMatchObject({
        name: 'Etudes',
        duration: 10 * 60,
        new_activity_name: 'Etudes',
        pomodoro_work_intervals: 1,
        pomodoro_breaks: 0,
        pomodoro_break_seconds: 0,
      });
      expect(body.task_id).toBeUndefined();
    });
  });

  describe('Reset', () => {
    it('with work logged asks first; Cancel keeps the run, OK discards it', async () => {
      const confirm = vi.fn().mockReturnValue(false);
      vi.stubGlobal('confirm', confirm);
      renderCard();
      await startRunOn();
      await passTime(3 * MIN);

      await act(async () => {
        fireEvent.click(screen.getByTestId('pomodoro-reset'));
      });
      expect(confirm).toHaveBeenCalledWith('Discard this Pomodoro run?');
      expect(screen.getByTestId('pomodoro-phase')).toHaveTextContent('Work');
      expect(localStorage.getItem(RUN_KEY)).not.toBeNull();

      confirm.mockReturnValue(true);
      await act(async () => {
        fireEvent.click(screen.getByTestId('pomodoro-reset'));
      });
      expect(screen.queryByTestId('pomodoro-phase')).not.toBeInTheDocument();
      expect(localStorage.getItem(RUN_KEY)).toBeNull();
      expect(screen.getByTestId('mode-stopwatch')).not.toBeDisabled();
    });

    it('with no work discards without asking', async () => {
      const confirm = vi.fn().mockReturnValue(false);
      vi.stubGlobal('confirm', confirm);
      renderCard();
      await startRunOn();

      await act(async () => {
        fireEvent.click(screen.getByTestId('pomodoro-reset'));
      });
      expect(confirm).not.toHaveBeenCalled();
      expect(screen.queryByTestId('pomodoro-phase')).not.toBeInTheDocument();
    });
  });

  describe('survives a reload', () => {
    it('start saves the run under pomodoro.state', async () => {
      renderCard();
      await startRunOn();
      expect(localStorage.getItem(RUN_KEY)).not.toBeNull();
    });

    it('a stored running run restores on remount with its time intact', async () => {
      const first = renderCard();
      await startRunOn();
      await passTime(25 * MIN);
      await clickSwitch();
      await passTime(MIN);
      first.unmount();

      vi.setSystemTime(Date.now() + MIN);
      renderCard();
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(screen.getByTestId('pomodoro-phase')).toHaveTextContent('Break');
      expect(screen.getByTestId('pomodoro-phase-time')).toHaveTextContent('2:59 left');
      expect(screen.getByTestId('pomodoro-total-work')).toHaveTextContent('25:00');
      expect(screen.getByTestId('mode-stopwatch')).toBeDisabled();
    });

    it('a stored paused run restores paused', async () => {
      const first = renderCard();
      await startRunOn();
      await passTime(4 * MIN);
      await act(async () => {
        fireEvent.click(screen.getByTestId('pomodoro-pause'));
      });
      first.unmount();

      vi.setSystemTime(Date.now() + 30 * MIN);
      renderCard();
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(screen.getByTestId('pomodoro-phase-time')).toHaveTextContent('21:00 left');
      expect(screen.getByTestId('pomodoro-resume')).toBeInTheDocument();
    });
  });
});
