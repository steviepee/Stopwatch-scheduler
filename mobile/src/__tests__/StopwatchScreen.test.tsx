import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';

import StopwatchScreen from '../app/(tabs)/index';
import type { FinishedRecording } from '../timer/core';
import { formatElapsed } from '../timer/format';
import type { FinishedPomodoro } from '../timer/pomodoro';
import { usePomodoro, useTimer } from '../timer/store';
import { useCreateSession } from '../services/mutations';
import { settingsAPI, taskAPI } from '../services/api';
import type { Task } from '../types';

// The screen composes the already-implemented timer store and mutation hook;
// this suite only specifies the screen's own behaviour, so both are mocked.
jest.mock('../timer/store', () => ({
  useTimer: jest.fn(),
  usePomodoro: jest.fn(),
}));

jest.mock('../services/mutations', () => ({
  useCreateSession: jest.fn(),
}));

jest.mock('../services/api', () => ({
  taskAPI: { getAll: jest.fn() },
  settingsAPI: { getPomodoro: jest.fn() },
}));

// B64 (D109, D110): the Stopwatch tab reads `start` from `useLocalSearchParams` and clears it
// with `router.setParams({ start: undefined })` (either the `router` export or `useRouter()`).
let mockSearchParams: { start?: string } = {};
const mockSetParams = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useGlobalSearchParams: () => mockSearchParams,
  useRouter: () => ({ setParams: mockSetParams }),
  router: { setParams: (params: unknown) => mockSetParams(params) },
}));

const mockedUseTimer = useTimer as jest.Mock;
const mockedUsePomodoro = usePomodoro as jest.Mock;
const mockedGetPomodoro = settingsAPI.getPomodoro as jest.Mock;
const mockedUseCreateSession = useCreateSession as jest.Mock;
const mockedGetAll = taskAPI.getAll as jest.Mock;

const GYM: Task = {
  id: 7,
  name: 'Gym',
  average_duration: 1800,
  total_recordings: 3,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const READING: Task = {
  ...GYM,
  id: 8,
  name: 'Reading',
};

const LAUNDRY: Task = {
  ...GYM,
  id: 9,
  name: 'Laundry',
};

const FINISH_RESULT: FinishedRecording = {
  durationSeconds: 754.5,
  startUtc: '2026-09-06T12:00:00.000Z',
  endUtc: '2026-09-06T12:12:34.500Z',
  clockJumpDetected: false,
};

type TimerMock = ReturnType<typeof useTimer>;

function timerMock(overrides: Partial<TimerMock> = {}): TimerMock {
  return {
    status: 'idle',
    elapsedMs: 0,
    hydrated: true,
    start: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    reset: jest.fn(),
    finish: jest.fn(() => FINISH_RESULT),
    ...overrides,
  };
}

// B51 (D81, D82, D84-D87): `usePomodoro()` lives beside `useTimer` in `timer/store.ts` and is
// mocked here like `useTimer`. Its return shape (pinned for the impl):
//   { status: 'idle' | 'running' | 'paused', hydrated, phase: PomodoroPhase ('work' when idle),
//     remainingMs, overMs, totalWorkMs, canFinish, activity: PomodoroActivity | null,
//     start(config: PomodoroConfig, activity: PomodoroActivity), pause(), resume(),
//     switchPhase(), reset(), finish(): FinishedPomodoro }
// Screen contract:
//   - `mode-stopwatch` / `mode-pomodoro` above the timer; both disabled while either the
//     stopwatch or a run is not idle. A run that is not idle (e.g. restored) shows Pomodoro mode.
//   - Pomodoro mode, idle: `btn-start` opens the Activity picker (`pomodoro-picker`) instead of
//     starting the stopwatch: one `pomodoro-activity-<id>` row per Activity and
//     `pomodoro-activity-new` ("+ New Activity"), which reveals a name field `pomodoro-new-name`.
//     No "None". `pomodoro-start` is disabled until an Activity (or a non-blank new name) is
//     chosen, and calls `start(config, { taskId } | { newActivityName })` (name trimmed).
//     `config` maps the `['settings', 'pomodoro']` query (`settingsAPI.getPomodoro`) to
//     camelCase; 25/5/15/4 if the load failed.
//   - Running/paused: `pomodoro-phase` reads `Work` / `Break` / `Long break`;
//     `pomodoro-phase-time` reads `m:ss left` (formatElapsed(remainingMs)) or `+m:ss over`
//     (formatElapsed(overMs)) once overMs > 0; `pomodoro-total-work` reads
//     formatElapsed(totalWorkMs). Buttons: `pomodoro-pause` (running) / `pomodoro-resume`
//     (paused), `pomodoro-switch` (`Start break` in work, `Start work` in a break),
//     `pomodoro-finish` (disabled unless canFinish), `pomodoro-reset`.
//   - Finish opens the existing save sheet (`input-name`, `btn-save-confirm`). Saving calls the
//     run's `finish()` (not the stopwatch's) and `useCreateSession().mutate` with name = typed
//     name or the Activity's name, `task_id` or `new_activity_name` from the run's Activity,
//     duration/start/end from the result, and `pomodoro_work_intervals`, `pomodoro_breaks`,
//     `pomodoro_break_seconds`.
//   - Reset with canFinish asks `Alert.alert('Discard this Pomodoro run?', <any>, [Cancel
//     (cancel), Discard (destructive)])`; only Discard calls `reset()`. Without work it resets
//     at once.
const SERVER_POMODORO = {
  work_minutes: 50,
  break_minutes: 10,
  long_break_minutes: 30,
  long_break_every: 3,
};

const POMODORO_FINISH: FinishedPomodoro = {
  durationSeconds: 3000,
  startUtc: '2026-11-02T09:00:00.000Z',
  endUtc: '2026-11-02T10:05:00.000Z',
  clockJumpDetected: false,
  pomodoroWorkIntervals: 2,
  pomodoroBreaks: 1,
  pomodoroBreakSeconds: 300,
};

type PomodoroMock = ReturnType<typeof usePomodoro>;

function pomodoroMock(overrides: Partial<PomodoroMock> = {}): PomodoroMock {
  return {
    status: 'idle',
    hydrated: true,
    phase: 'work',
    remainingMs: 0,
    overMs: 0,
    totalWorkMs: 0,
    canFinish: false,
    activity: null,
    start: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    switchPhase: jest.fn(),
    reset: jest.fn(),
    finish: jest.fn(() => POMODORO_FINISH),
    ...overrides,
  };
}

// RNTL v14's `render` is async, like `renderHook` (see timerStore.test.tsx) —
// callers must `await renderScreen()` before touching the `screen` singleton.
async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StopwatchScreen />
    </QueryClientProvider>
  );
}

function minDimension(style: unknown): number {
  const flat = (StyleSheet.flatten(style as never) ?? {}) as {
    minHeight?: number;
    height?: number;
  };
  const value = flat.minHeight ?? flat.height;
  return typeof value === 'number' ? value : 0;
}

beforeEach(() => {
  mockSearchParams = {};
  mockSetParams.mockReset();
  mockedGetAll.mockReset();
  mockedGetAll.mockResolvedValue([GYM]);
  mockedGetPomodoro.mockReset();
  mockedGetPomodoro.mockResolvedValue(SERVER_POMODORO);
  mockedUseCreateSession.mockReturnValue({ mutate: jest.fn(), isPending: false });
  mockedUsePomodoro.mockReturnValue(pomodoroMock());
});

describe('idle', () => {
  it('shows only Start', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'idle', elapsedMs: 0 }));
    await renderScreen();

    expect(screen.getByTestId('btn-start')).toBeTruthy();
    expect(screen.queryByTestId('btn-pause')).toBeNull();
    expect(screen.queryByTestId('btn-resume')).toBeNull();
    expect(screen.queryByTestId('btn-reset')).toBeNull();
    expect(screen.queryByTestId('btn-save-open')).toBeNull();
  });

  it('Start calls the hook', async () => {
    const timer = timerMock({ status: 'idle' });
    mockedUseTimer.mockReturnValue(timer);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-start'));
    expect(timer.start).toHaveBeenCalledTimes(1);
  });
});

describe('running', () => {
  it('shows the elapsed time and only Pause', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'running', elapsedMs: 65_000 }));
    await renderScreen();

    expect(screen.getByText(formatElapsed(65_000))).toBeTruthy();
    expect(screen.getByTestId('btn-pause')).toBeTruthy();
    expect(screen.queryByTestId('btn-start')).toBeNull();
    expect(screen.queryByTestId('btn-resume')).toBeNull();
    expect(screen.queryByTestId('btn-reset')).toBeNull();
    expect(screen.queryByTestId('btn-save-open')).toBeNull();
  });

  it('Pause calls the hook', async () => {
    const timer = timerMock({ status: 'running', elapsedMs: 5_000 });
    mockedUseTimer.mockReturnValue(timer);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-pause'));
    expect(timer.pause).toHaveBeenCalledTimes(1);
  });
});

describe('paused', () => {
  it('shows Resume and Reset but not Save when elapsed is zero', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 0 }));
    await renderScreen();

    expect(screen.getByTestId('btn-resume')).toBeTruthy();
    expect(screen.getByTestId('btn-reset')).toBeTruthy();
    expect(screen.queryByTestId('btn-save-open')).toBeNull();
    expect(screen.queryByTestId('btn-start')).toBeNull();
    expect(screen.queryByTestId('btn-pause')).toBeNull();
  });

  it('shows Save when elapsed is greater than zero', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    expect(screen.getByTestId('btn-save-open')).toBeTruthy();
  });

  it('Resume calls the hook', async () => {
    const timer = timerMock({ status: 'paused', elapsedMs: 1_000 });
    mockedUseTimer.mockReturnValue(timer);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-resume'));
    expect(timer.resume).toHaveBeenCalledTimes(1);
  });

  it('Reset calls the hook', async () => {
    const timer = timerMock({ status: 'paused', elapsedMs: 1_000 });
    mockedUseTimer.mockReturnValue(timer);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-reset'));
    expect(timer.reset).toHaveBeenCalledTimes(1);
  });
});

describe('accessibility', () => {
  it('every button has accessibilityRole="button" and a hit area of at least 44', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await screen.findByTestId('btn-save-confirm');

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((button) => {
      expect(button.props.accessibilityRole).toBe('button');
      expect(minDimension(button.props.style)).toBeGreaterThanOrEqual(44);
    });
  });
});

describe('save sheet', () => {
  it('opens with a name field and the Activity picker, "None" included', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));

    expect(screen.getByTestId('input-name')).toBeTruthy();
    expect(screen.getByTestId('activity-none')).toBeTruthy();
    await screen.findByText('Gym');
  });

  it('has no separate save-to-activity path', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await screen.findByText('Gym');

    expect(screen.queryByText(/add to activity/i)).toBeNull();
    expect(screen.queryByText(/save as recording/i)).toBeNull();
  });

  it('search narrows the Activity list', async () => {
    mockedGetAll.mockResolvedValue([GYM, READING]);
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await screen.findByText('Reading');

    await fireEvent.changeText(screen.getByTestId('activity-search'), 'gym');

    expect(screen.getByText('Gym')).toBeTruthy();
    expect(screen.queryByText('Reading')).toBeNull();
  });

  it('Cancel closes the sheet without saving', async () => {
    const timer = timerMock({ status: 'paused', elapsedMs: 1_000 });
    mockedUseTimer.mockReturnValue(timer);
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await screen.findByTestId('btn-cancel');
    await fireEvent.press(screen.getByTestId('btn-cancel'));

    expect(mutate).not.toHaveBeenCalled();
    expect(timer.finish).not.toHaveBeenCalled();
    expect(timer.reset).not.toHaveBeenCalled();
    expect(screen.queryByTestId('input-name')).toBeNull();
  });
});

describe('saving', () => {
  it('blank name + a chosen Activity saves with the Activity name and task_id', async () => {
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    const timer = timerMock({ status: 'paused', elapsedMs: 1_000 });
    mockedUseTimer.mockReturnValue(timer);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await screen.findByText('Gym');
    await fireEvent.press(screen.getByText('Gym'));
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    expect(timer.finish).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({
      name: 'Gym',
      task_id: GYM.id,
      duration: FINISH_RESULT.durationSeconds,
      start_time: FINISH_RESULT.startUtc,
      end_time: FINISH_RESULT.endUtc,
    });
  });

  it('blank name + no Activity saves with a date-time name and no task_id', async () => {
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    expect(mutate).toHaveBeenCalledTimes(1);
    const body = mutate.mock.calls[0][0];
    // Deterministic default name: the UTC startUtc as "YYYY-MM-DD HH:MM" (no locale APIs).
    expect(body.name).toBe('2026-09-06 12:00');
    expect(body.task_id).toBeUndefined();
  });

  it('a typed name overrides both defaults', async () => {
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await screen.findByText('Gym');
    await fireEvent.press(screen.getByText('Gym'));
    await fireEvent.changeText(screen.getByTestId('input-name'), 'Leg day');
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    const body = mutate.mock.calls[0][0];
    expect(body.name).toBe('Leg day');
    expect(body.task_id).toBe(GYM.id);
  });

  it('passes start_time, end_time and duration from finish() through unchanged', async () => {
    const finishResult: FinishedRecording = {
      durationSeconds: 42,
      startUtc: '2026-01-02T03:04:05.000Z',
      endUtc: '2026-01-02T03:04:47.000Z',
      clockJumpDetected: false,
    };
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    mockedUseTimer.mockReturnValue(
      timerMock({ status: 'paused', elapsedMs: 42_000, finish: jest.fn(() => finishResult) })
    );
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    const body = mutate.mock.calls[0][0];
    expect(body.start_time).toBe(finishResult.startUtc);
    expect(body.end_time).toBe(finishResult.endUtc);
    expect(body.duration).toBe(finishResult.durationSeconds);
  });

  it('resets the timer and closes the sheet after saving', async () => {
    const timer = timerMock({ status: 'paused', elapsedMs: 1_000 });
    mockedUseTimer.mockReturnValue(timer);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    expect(timer.reset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('input-name')).toBeNull());
  });
});

describe('new Activity row (B36, D76, D77)', () => {
  it('shows "+ New Activity: \'Laundry\'" when the typed name matches no Activity, and selecting it sends new_activity_name with no task_id', async () => {
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await screen.findByText('Gym');
    await fireEvent.changeText(screen.getByTestId('input-name'), 'Laundry');
    await screen.findByText("+ New Activity: 'Laundry'");

    await fireEvent.press(screen.getByTestId('activity-new'));
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    expect(mutate).toHaveBeenCalledTimes(1);
    const body = mutate.mock.calls[0][0];
    expect(body.new_activity_name).toBe('Laundry');
    expect(body.task_id).toBeUndefined();
  });

  it('shows no new-Activity row for a blank name', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await screen.findByText('Gym');

    expect(screen.queryByTestId('activity-new')).toBeNull();
  });

  it('name "laundry " with Activity "Laundry" present shows no new row, and offers "Attach to Laundry"', async () => {
    mockedGetAll.mockResolvedValue([GYM, LAUNDRY]);
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await screen.findByText('Gym');
    await fireEvent.changeText(screen.getByTestId('input-name'), 'laundry ');

    expect(screen.queryByTestId('activity-new')).toBeNull();
    await screen.findByText('Attach to Laundry');
    expect(screen.queryByText('Laundry')).toBeNull();
  });

  it('selecting "Attach to <name>" sends task_id and no new_activity_name, as today', async () => {
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    mockedGetAll.mockResolvedValue([GYM, LAUNDRY]);
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await screen.findByText('Gym');
    await fireEvent.changeText(screen.getByTestId('input-name'), 'laundry ');
    await fireEvent.press(await screen.findByText('Attach to Laundry'));
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    const body = mutate.mock.calls[0][0];
    expect(body.task_id).toBe(LAUNDRY.id);
    expect(body.new_activity_name).toBeUndefined();
  });

  it('default selection is None; saving without touching the picker sends neither field', async () => {
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    expect(mutate).toHaveBeenCalledTimes(1);
    const body = mutate.mock.calls[0][0];
    expect(body.task_id).toBeUndefined();
    expect(body.new_activity_name).toBeUndefined();
  });
});

describe('save confirmation', () => {
  it('says "Saved" when there was no clock jump', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    await screen.findByTestId('save-confirmation');
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('mentions the clock moving when clockJumpDetected is true', async () => {
    mockedUseTimer.mockReturnValue(
      timerMock({
        status: 'paused',
        elapsedMs: 1_000,
        finish: jest.fn(() => ({ ...FINISH_RESULT, clockJumpDetected: true })),
      })
    );
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    await screen.findByTestId('save-confirmation');
    expect(screen.getByText(/clock moved/i)).toBeTruthy();
  });
});

describe('Pomodoro mode switch (B51, D86)', () => {
  it('both sides are enabled while everything is idle', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'idle' }));
    await renderScreen();

    expect(screen.getByTestId('mode-stopwatch')).toBeEnabled();
    expect(screen.getByTestId('mode-pomodoro')).toBeEnabled();
  });

  it('is disabled while the stopwatch runs', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'running', elapsedMs: 5_000 }));
    await renderScreen();

    expect(screen.getByTestId('mode-stopwatch')).toBeDisabled();
    expect(screen.getByTestId('mode-pomodoro')).toBeDisabled();
  });

  it('is disabled while the stopwatch is paused', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 5_000 }));
    await renderScreen();

    expect(screen.getByTestId('mode-pomodoro')).toBeDisabled();
  });

  it('is disabled during a run, and a run in progress shows the Pomodoro view', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'idle' }));
    mockedUsePomodoro.mockReturnValue(
      pomodoroMock({ status: 'running', activity: { taskId: GYM.id }, remainingMs: 60_000 })
    );
    await renderScreen();

    expect(screen.getByTestId('mode-stopwatch')).toBeDisabled();
    expect(screen.getByTestId('mode-pomodoro')).toBeDisabled();
    expect(screen.getByTestId('pomodoro-phase')).toBeTruthy();
  });

  // B58: time left rounds up, so 60 s shows 1:00 and any part-second shows the whole second.
  it.each([
    [60_000, '1:00 left'],
    [59_001, '1:00 left'],
    [58_999, '0:59 left'],
    [58_000, '0:58 left'],
    [1, '0:01 left'],
  ])('time left %d ms reads %s', async (remainingMs, text) => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'idle' }));
    mockedUsePomodoro.mockReturnValue(
      pomodoroMock({ status: 'running', activity: { taskId: GYM.id }, remainingMs })
    );
    await renderScreen();

    expect(screen.getByTestId('pomodoro-phase-time')).toHaveTextContent(text);
  });

  it('every Pomodoro button has a hit area of at least 44', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'idle' }));
    mockedUsePomodoro.mockReturnValue(
      pomodoroMock({ status: 'running', canFinish: true, activity: { taskId: GYM.id } })
    );
    await renderScreen();

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((button) => {
      expect(minDimension(button.props.style)).toBeGreaterThanOrEqual(44);
    });
  });
});

describe('Pomodoro start (B51, D82)', () => {
  async function openPicker() {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('mode-pomodoro'));
    await fireEvent.press(screen.getByTestId('btn-start'));
    await screen.findByTestId('pomodoro-picker');
  }

  beforeEach(() => {
    mockedGetAll.mockResolvedValue([GYM, READING]);
    mockedUseTimer.mockReturnValue(timerMock({ status: 'idle' }));
  });

  it('Start opens the Activity picker instead of starting the stopwatch; no "None"', async () => {
    const timer = timerMock({ status: 'idle' });
    mockedUseTimer.mockReturnValue(timer);
    await openPicker();

    expect(timer.start).not.toHaveBeenCalled();
    await screen.findByTestId(`pomodoro-activity-${GYM.id}`);
    expect(screen.getByTestId(`pomodoro-activity-${READING.id}`)).toBeTruthy();
    expect(screen.getByTestId('pomodoro-activity-new')).toBeTruthy();
    expect(screen.queryByTestId('activity-none')).toBeNull();
    expect(screen.queryByText('None')).toBeNull();
  });

  it('Start is disabled until an Activity is chosen', async () => {
    const pomodoro = pomodoroMock();
    mockedUsePomodoro.mockReturnValue(pomodoro);
    await openPicker();

    expect(screen.getByTestId('pomodoro-start')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('pomodoro-start'));
    expect(pomodoro.start).not.toHaveBeenCalled();

    await fireEvent.press(await screen.findByTestId(`pomodoro-activity-${GYM.id}`));
    expect(screen.getByTestId('pomodoro-start')).toBeEnabled();
  });

  it('starts with the chosen Activity and the server settings', async () => {
    const pomodoro = pomodoroMock();
    mockedUsePomodoro.mockReturnValue(pomodoro);
    await openPicker();
    await waitFor(() => expect(mockedGetPomodoro).toHaveBeenCalled());
    await act(async () => {});

    await fireEvent.press(await screen.findByTestId(`pomodoro-activity-${GYM.id}`));
    await fireEvent.press(screen.getByTestId('pomodoro-start'));

    expect(pomodoro.start).toHaveBeenCalledTimes(1);
    expect(pomodoro.start).toHaveBeenCalledWith(
      { workMinutes: 50, breakMinutes: 10, longBreakMinutes: 30, longBreakEvery: 3 },
      { taskId: GYM.id }
    );
  });

  it('uses the defaults when the settings cannot be loaded', async () => {
    mockedGetPomodoro.mockRejectedValue(new Error('offline'));
    const pomodoro = pomodoroMock();
    mockedUsePomodoro.mockReturnValue(pomodoro);
    await openPicker();
    await waitFor(() => expect(mockedGetPomodoro).toHaveBeenCalled());
    await act(async () => {});

    await fireEvent.press(await screen.findByTestId(`pomodoro-activity-${GYM.id}`));
    await fireEvent.press(screen.getByTestId('pomodoro-start'));

    expect(pomodoro.start).toHaveBeenCalledWith(
      { workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 },
      { taskId: GYM.id }
    );
  });

  it('"+ New Activity" needs a name, then starts with newActivityName', async () => {
    const pomodoro = pomodoroMock();
    mockedUsePomodoro.mockReturnValue(pomodoro);
    await openPicker();

    await fireEvent.press(screen.getByTestId('pomodoro-activity-new'));
    expect(screen.getByTestId('pomodoro-start')).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('pomodoro-new-name'), '  Laundry ');
    expect(screen.getByTestId('pomodoro-start')).toBeEnabled();
    await fireEvent.press(screen.getByTestId('pomodoro-start'));

    expect(pomodoro.start).toHaveBeenCalledTimes(1);
    expect((pomodoro.start as jest.Mock).mock.calls[0][1]).toEqual({ newActivityName: 'Laundry' });
  });
});

describe('Pomodoro run view (B51, D84)', () => {
  beforeEach(() => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'idle' }));
  });

  it('Work: label, time left, total work, Pause and Start break', async () => {
    const pomodoro = pomodoroMock({
      status: 'running',
      phase: 'work',
      remainingMs: 754_000,
      totalWorkMs: 1_800_000,
      canFinish: true,
      activity: { taskId: GYM.id },
    });
    mockedUsePomodoro.mockReturnValue(pomodoro);
    await renderScreen();

    expect(screen.getByTestId('pomodoro-phase')).toHaveTextContent('Work');
    expect(screen.getByTestId('pomodoro-phase-time')).toHaveTextContent('12:34 left');
    expect(screen.getByTestId('pomodoro-total-work')).toHaveTextContent(formatElapsed(1_800_000));
    expect(screen.getByTestId('pomodoro-switch')).toHaveTextContent('Start break');
    expect(screen.queryByTestId('pomodoro-resume')).toBeNull();
    expect(screen.queryByTestId('btn-start')).toBeNull();

    await fireEvent.press(screen.getByTestId('pomodoro-pause'));
    expect(pomodoro.pause).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('pomodoro-switch'));
    expect(pomodoro.switchPhase).toHaveBeenCalledTimes(1);
  });

  it('a Break reads "Break" and offers Start work', async () => {
    mockedUsePomodoro.mockReturnValue(
      pomodoroMock({ status: 'running', phase: 'break', remainingMs: 120_000, canFinish: true, activity: { taskId: GYM.id } })
    );
    await renderScreen();

    expect(screen.getByTestId('pomodoro-phase')).toHaveTextContent('Break');
    expect(screen.getByTestId('pomodoro-switch')).toHaveTextContent('Start work');
  });

  it('a long break reads "Long break" and offers Start work', async () => {
    mockedUsePomodoro.mockReturnValue(
      pomodoroMock({ status: 'running', phase: 'longBreak', remainingMs: 120_000, canFinish: true, activity: { taskId: GYM.id } })
    );
    await renderScreen();

    expect(screen.getByTestId('pomodoro-phase')).toHaveTextContent('Long break');
    expect(screen.getByTestId('pomodoro-switch')).toHaveTextContent('Start work');
  });

  it('past the target the phase time reads "+m:ss over"', async () => {
    mockedUsePomodoro.mockReturnValue(
      pomodoroMock({ status: 'running', phase: 'work', remainingMs: 0, overMs: 300_000, canFinish: true, activity: { taskId: GYM.id } })
    );
    await renderScreen();

    expect(screen.getByTestId('pomodoro-phase-time')).toHaveTextContent('+5:00 over');
  });

  it('paused shows Resume', async () => {
    const pomodoro = pomodoroMock({ status: 'paused', phase: 'work', remainingMs: 60_000, canFinish: true, activity: { taskId: GYM.id } });
    mockedUsePomodoro.mockReturnValue(pomodoro);
    await renderScreen();

    expect(screen.queryByTestId('pomodoro-pause')).toBeNull();
    await fireEvent.press(screen.getByTestId('pomodoro-resume'));
    expect(pomodoro.resume).toHaveBeenCalledTimes(1);
  });

  it('Finish is disabled with no work logged', async () => {
    mockedUsePomodoro.mockReturnValue(
      pomodoroMock({ status: 'running', phase: 'work', remainingMs: 1_500_000, canFinish: false, activity: { taskId: GYM.id } })
    );
    await renderScreen();

    expect(screen.getByTestId('pomodoro-finish')).toBeDisabled();
  });
});

describe('Pomodoro finish (B51, D81, D85)', () => {
  beforeEach(() => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'idle' }));
    mockedGetAll.mockResolvedValue([GYM, READING]);
  });

  async function renderLoaded() {
    await renderScreen();
    await waitFor(() => expect(mockedGetAll).toHaveBeenCalled());
    await act(async () => {});
  }

  it('Finish opens the save sheet; saving sends total work and the three fields with the Activity', async () => {
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    const timer = timerMock({ status: 'idle' });
    mockedUseTimer.mockReturnValue(timer);
    const pomodoro = pomodoroMock({
      status: 'running',
      phase: 'work',
      totalWorkMs: 3_000_000,
      canFinish: true,
      activity: { taskId: GYM.id },
    });
    mockedUsePomodoro.mockReturnValue(pomodoro);
    await renderLoaded();

    await fireEvent.press(screen.getByTestId('pomodoro-finish'));
    await screen.findByTestId('input-name');
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    expect(pomodoro.finish).toHaveBeenCalledTimes(1);
    expect(timer.finish).not.toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledTimes(1);
    const body = mutate.mock.calls[0][0];
    expect(body).toMatchObject({
      name: 'Gym',
      task_id: GYM.id,
      duration: 3000,
      start_time: POMODORO_FINISH.startUtc,
      end_time: POMODORO_FINISH.endUtc,
      pomodoro_work_intervals: 2,
      pomodoro_breaks: 1,
      pomodoro_break_seconds: 300,
    });
    expect(body.new_activity_name).toBeUndefined();
  });

  it('a typed name overrides the Activity name and keeps the Activity', async () => {
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    mockedUsePomodoro.mockReturnValue(
      pomodoroMock({ status: 'paused', totalWorkMs: 3_000_000, canFinish: true, activity: { taskId: GYM.id } })
    );
    await renderLoaded();

    await fireEvent.press(screen.getByTestId('pomodoro-finish'));
    await fireEvent.changeText(await screen.findByTestId('input-name'), 'Deep work');
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    const body = mutate.mock.calls[0][0];
    expect(body.name).toBe('Deep work');
    expect(body.task_id).toBe(GYM.id);
  });

  it('a run on a new Activity saves with new_activity_name and no task_id', async () => {
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    mockedUsePomodoro.mockReturnValue(
      pomodoroMock({ status: 'running', phase: 'break', totalWorkMs: 3_000_000, canFinish: true, activity: { newActivityName: 'Laundry' } })
    );
    await renderLoaded();

    await fireEvent.press(screen.getByTestId('pomodoro-finish'));
    await screen.findByTestId('input-name');
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    const body = mutate.mock.calls[0][0];
    expect(body.name).toBe('Laundry');
    expect(body.new_activity_name).toBe('Laundry');
    expect(body.task_id).toBeUndefined();
    expect(body.pomodoro_work_intervals).toBe(2);
  });
});

describe('Pomodoro reset (B51, D85)', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'idle' }));
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  function alertButtons(): { text: string; style?: string; onPress?: () => void }[] {
    return alertSpy.mock.calls[0][2];
  }

  function pressAlertButton(text: string) {
    const button = alertButtons().find((b) => b.text === text);
    if (!button) throw new Error(`No "${text}" button`);
    button.onPress?.();
  }

  it('with work logged asks first; Cancel keeps the run', async () => {
    const pomodoro = pomodoroMock({ status: 'running', totalWorkMs: 60_000, canFinish: true, activity: { taskId: GYM.id } });
    mockedUsePomodoro.mockReturnValue(pomodoro);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('pomodoro-reset'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe('Discard this Pomodoro run?');
    expect(alertButtons().map((b) => [b.text, b.style])).toEqual([
      ['Cancel', 'cancel'],
      ['Discard', 'destructive'],
    ]);

    pressAlertButton('Cancel');
    expect(pomodoro.reset).not.toHaveBeenCalled();
  });

  it('Discard resets the run', async () => {
    const pomodoro = pomodoroMock({ status: 'paused', totalWorkMs: 60_000, canFinish: true, activity: { taskId: GYM.id } });
    mockedUsePomodoro.mockReturnValue(pomodoro);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('pomodoro-reset'));
    pressAlertButton('Discard');

    expect(pomodoro.reset).toHaveBeenCalledTimes(1);
  });

  it('with no work logged resets without asking', async () => {
    const pomodoro = pomodoroMock({ status: 'running', totalWorkMs: 0, canFinish: false, activity: { taskId: GYM.id } });
    mockedUsePomodoro.mockReturnValue(pomodoro);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('pomodoro-reset'));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(pomodoro.reset).toHaveBeenCalledTimes(1);
  });
});

// B64 (D109, D110): a Start link opens the Stopwatch tab with `?start=<task_id>`.
// Contract pinned here (choices the PRD leaves open):
//   - Once the Activities have loaded, if the stopwatch is idle (and no Pomodoro run is in
//     progress) and the id matches an Activity, that Activity becomes the selected Activity for
//     the next Recording: the save sheet opens with it chosen, so Save with no picker change
//     sends its `task_id` and name. Nothing is started.
//   - The screen shows the choice as `selected-activity`, text containing the Activity's name.
//   - The param is then cleared with `setParams({ start: undefined })`.
//   - "Running" means the stopwatch is not idle (running or paused): a paused Recording is still
//     in progress, so the link is ignored then too. An unknown id is ignored.
describe('start link (B64, D109, D110)', () => {
  const READING_LINK = { start: String(READING.id) };

  async function renderWithClient() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const element = () => (
      <QueryClientProvider client={client}>
        <StopwatchScreen />
      </QueryClientProvider>
    );
    const view = await render(element());
    return { rerender: () => view.rerender(element()) };
  }

  beforeEach(() => {
    mockedGetAll.mockResolvedValue([GYM, READING]);
    mockSetParams.mockImplementation(() => {
      mockSearchParams = {};
    });
  });

  async function saveAfterPausing(rerender: () => unknown) {
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await act(async () => {
      rerender();
    });
    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));
    expect(mutate).toHaveBeenCalledTimes(1);
    return mutate.mock.calls[0][0];
  }

  it('selects the Activity without starting, and clears the param', async () => {
    mockSearchParams = { ...READING_LINK };
    const timer = timerMock({ status: 'idle' });
    mockedUseTimer.mockReturnValue(timer);
    const pomodoro = pomodoroMock();
    mockedUsePomodoro.mockReturnValue(pomodoro);
    const { rerender } = await renderWithClient();

    await waitFor(() => expect(screen.getByTestId('selected-activity')).toHaveTextContent(/Reading/));
    await waitFor(() => expect(mockSetParams).toHaveBeenCalledWith({ start: undefined }));
    expect(timer.start).not.toHaveBeenCalled();
    expect(pomodoro.start).not.toHaveBeenCalled();
    expect(screen.getByTestId('btn-start')).toBeTruthy();

    const body = await saveAfterPausing(rerender);
    expect(body).toMatchObject({ name: 'Reading', task_id: READING.id });
  });

  it('is ignored while the stopwatch is running', async () => {
    mockSearchParams = { ...READING_LINK };
    const timer = timerMock({ status: 'running', elapsedMs: 5_000 });
    mockedUseTimer.mockReturnValue(timer);
    const { rerender } = await renderWithClient();

    await waitFor(() => expect(mockedGetAll).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('selected-activity')).toBeNull();
    expect(timer.start).not.toHaveBeenCalled();

    const body = await saveAfterPausing(rerender);
    expect(body.task_id).toBeUndefined();
  });

  it('is ignored for an unknown id', async () => {
    mockSearchParams = { start: '999' };
    mockedUseTimer.mockReturnValue(timerMock({ status: 'idle' }));
    const { rerender } = await renderWithClient();

    await waitFor(() => expect(mockedGetAll).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('selected-activity')).toBeNull();

    const body = await saveAfterPausing(rerender);
    expect(body.task_id).toBeUndefined();
  });
});
