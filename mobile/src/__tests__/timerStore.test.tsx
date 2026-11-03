import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import type { PersistedTimerState } from '../timer/core';
import { formatElapsed } from '../timer/format';
import type { PomodoroConfig, PomodoroState } from '../timer/pomodoro';
import { POMODORO_STORAGE_KEY, TIMER_STORAGE_KEY, usePomodoro, useTimer } from '../timer/store';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../timer/native', () => ({
  isNativeAvailable: () => false,
  elapsedRealtime: () => mockClock.mono,
  startForegroundService: (startedAtElapsedMs: number) => mockStartService(startedAtElapsedMs),
  stopForegroundService: () => mockStopService(),
  notifyPhaseDue: (phase: string) => mockNotifyPhaseDue(phase),
  drainActions: () => mockDrainActions(),
}));

const mockClock = { mono: 1_000_000 };
const mockStartService = jest.fn(async (startedAtElapsedMs: number) => {});
const mockStopService = jest.fn(async () => {});
const mockNotifyPhaseDue = jest.fn((phase: string) => {});
const mockDrainActions = jest.fn(
  (): { action: 'pause' | 'resume' | 'switch'; atElapsedMs: number }[] => []
);

async function mountTimer() {
  const view = await renderHook(() => useTimer());
  await waitFor(() => expect(view.result.current.hydrated).toBe(true));
  return view;
}

beforeEach(async () => {
  mockClock.mono = 1_000_000;
  mockStartService.mockClear();
  mockStopService.mockClear();
  mockNotifyPhaseDue.mockClear();
  mockDrainActions.mockReset();
  mockDrainActions.mockReturnValue([]);
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useTimer transitions', () => {
  it('starts, pauses and resumes, driving the foreground service', async () => {
    const view = await mountTimer();

    await act(async () => view.result.current.start());
    expect(view.result.current.status).toBe('running');
    expect(mockStartService).toHaveBeenCalledWith(1_000_000);

    mockClock.mono += 4_000;
    await act(async () => view.result.current.pause());
    expect(view.result.current.status).toBe('paused');
    expect(view.result.current.elapsedMs).toBe(4_000);
    expect(mockStopService).toHaveBeenCalledTimes(1);

    mockClock.mono += 10_000;
    await act(async () => view.result.current.resume());
    expect(view.result.current.status).toBe('running');
    expect(view.result.current.elapsedMs).toBe(4_000);
    expect(mockStartService).toHaveBeenLastCalledWith(1_010_000);
  });

  it('reset clears the stored state and stops the service', async () => {
    const view = await mountTimer();

    await act(async () => view.result.current.start());
    await waitFor(async () => expect(await AsyncStorage.getItem(TIMER_STORAGE_KEY)).not.toBeNull());

    await act(async () => view.result.current.reset());
    expect(view.result.current.status).toBe('idle');
    expect(view.result.current.elapsedMs).toBe(0);
    expect(mockStopService).toHaveBeenCalled();
    await waitFor(async () => expect(await AsyncStorage.getItem(TIMER_STORAGE_KEY)).toBeNull());
  });

  it('finish returns the recording and returns the timer to idle', async () => {
    const view = await mountTimer();

    await act(async () => view.result.current.start());
    mockClock.mono += 90_000;

    let recording: ReturnType<typeof view.result.current.finish> | undefined;
    await act(async () => {
      recording = view.result.current.finish();
    });

    expect(recording?.durationSeconds).toBe(90);
    expect(recording?.startUtc).toMatch(/Z$/);
    expect(view.result.current.status).toBe('idle');
  });
});

describe('useTimer persistence', () => {
  it('persists the four contract fields on every transition', async () => {
    const view = await mountTimer();

    await act(async () => view.result.current.start());
    await waitFor(async () => expect(await AsyncStorage.getItem(TIMER_STORAGE_KEY)).not.toBeNull());
    const running = JSON.parse((await AsyncStorage.getItem(TIMER_STORAGE_KEY)) as string);
    expect(Object.keys(running).sort()).toEqual([
      'accumulatedMs',
      'monoStart',
      'status',
      'wallStart',
    ]);
    expect(running.status).toBe('running');
    expect(running.monoStart).toBe(1_000_000);

    mockClock.mono += 7_000;
    await act(async () => view.result.current.pause());
    await waitFor(async () => {
      const raw = (await AsyncStorage.getItem(TIMER_STORAGE_KEY)) as string;
      expect(JSON.parse(raw).status).toBe('paused');
    });
    const paused = JSON.parse((await AsyncStorage.getItem(TIMER_STORAGE_KEY)) as string);
    expect(paused.accumulatedMs).toBe(7_000);
    expect(paused.monoStart).toBeNull();
  });

  it('restores a running timer after the hook remounts', async () => {
    const first = await mountTimer();
    await act(async () => first.result.current.start());
    await waitFor(async () => expect(await AsyncStorage.getItem(TIMER_STORAGE_KEY)).not.toBeNull());

    mockClock.mono += 5_000;
    await first.unmount();

    const second = await mountTimer();
    expect(second.result.current.status).toBe('running');
    expect(second.result.current.elapsedMs).toBe(5_000);

    mockClock.mono += 3_000;
    await act(async () => second.result.current.pause());
    expect(second.result.current.elapsedMs).toBe(8_000);
  });

  it('restores a paused timer as paused', async () => {
    const first = await mountTimer();
    await act(async () => first.result.current.start());
    mockClock.mono += 12_000;
    await act(async () => first.result.current.pause());
    await waitFor(async () => {
      const raw = (await AsyncStorage.getItem(TIMER_STORAGE_KEY)) as string;
      expect(JSON.parse(raw).status).toBe('paused');
    });
    await first.unmount();

    mockClock.mono += 60_000;
    const second = await mountTimer();
    expect(second.result.current.status).toBe('paused');
    expect(second.result.current.elapsedMs).toBe(12_000);
  });
});

describe('useTimer re-arms the notification on restore', () => {
  async function seed(persisted: PersistedTimerState) {
    await AsyncStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(persisted));
  }

  it('starts the foreground service once when it hydrates a running timer', async () => {
    await seed({
      status: 'running',
      wallStart: Date.now() - 5_000,
      monoStart: 1_000_000,
      accumulatedMs: 0,
    });
    mockClock.mono = 1_005_000;

    const view = await mountTimer();

    expect(view.result.current.status).toBe('running');
    expect(view.result.current.elapsedMs).toBe(5_000);
    await waitFor(() => expect(mockStartService).toHaveBeenCalledTimes(1));
  });

  it('re-arms with the anchor resume would have used', async () => {
    await seed({
      status: 'running',
      wallStart: Date.now() - 45_000,
      monoStart: 1_000_000,
      accumulatedMs: 20_000,
    });
    mockClock.mono = 1_005_000;

    const view = await mountTimer();

    expect(view.result.current.elapsedMs).toBe(25_000);
    await waitFor(() => expect(mockStartService).toHaveBeenCalledTimes(1));
    expect(mockStartService).toHaveBeenCalledWith(980_000);
    expect(mockStartService).toHaveBeenCalledWith(
      mockClock.mono - view.result.current.elapsedMs
    );
  });

  it('does not stop the service when it hydrates a running timer', async () => {
    await seed({
      status: 'running',
      wallStart: Date.now() - 5_000,
      monoStart: 1_000_000,
      accumulatedMs: 0,
    });
    mockClock.mono = 1_005_000;

    const view = await mountTimer();

    expect(view.result.current.status).toBe('running');
    await waitFor(() => expect(mockStartService).toHaveBeenCalledTimes(1));
    expect(mockStopService).not.toHaveBeenCalled();
  });

  it('leaves the service alone for a persisted paused timer', async () => {
    await seed({
      status: 'paused',
      wallStart: Date.now() - 30_000,
      monoStart: null,
      accumulatedMs: 12_000,
    });
    mockClock.mono = 1_005_000;

    const view = await mountTimer();

    expect(view.result.current.status).toBe('paused');
    expect(view.result.current.elapsedMs).toBe(12_000);
    expect(mockStartService).not.toHaveBeenCalled();
    expect(mockStopService).not.toHaveBeenCalled();
  });

  it('leaves the service alone for a persisted idle timer', async () => {
    await seed({ status: 'idle', wallStart: null, monoStart: null, accumulatedMs: 0 });

    const view = await mountTimer();

    expect(view.result.current.status).toBe('idle');
    expect(mockStartService).not.toHaveBeenCalled();
    expect(mockStopService).not.toHaveBeenCalled();
  });

  it('leaves the service alone when nothing is persisted', async () => {
    const view = await mountTimer();

    expect(view.result.current.status).toBe('idle');
    expect(mockStartService).not.toHaveBeenCalled();
    expect(mockStopService).not.toHaveBeenCalled();
  });
});

describe('useTimer render interval', () => {
  it('ticks once per second while running and clears on pause and unmount', async () => {
    const view = await mountTimer();
    jest.useFakeTimers();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    await act(async () => view.result.current.start());
    expect(view.result.current.elapsedMs).toBe(0);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls[0][1]).toBe(1000);
    const runningInterval = setIntervalSpy.mock.results[0].value;

    mockClock.mono += 999;
    await act(async () => {
      jest.advanceTimersByTime(999);
    });
    expect(view.result.current.elapsedMs).toBe(0);

    mockClock.mono += 1;
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(view.result.current.elapsedMs).toBe(1_000);

    mockClock.mono += 1_000;
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(view.result.current.elapsedMs).toBe(2_000);

    await act(async () => view.result.current.pause());
    expect(clearIntervalSpy).toHaveBeenCalledWith(runningInterval);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    mockClock.mono += 5_000;
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(view.result.current.elapsedMs).toBe(2_000);

    await act(async () => view.result.current.resume());
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    const resumedInterval = setIntervalSpy.mock.results[1].value;

    await view.unmount();
    expect(clearIntervalSpy).toHaveBeenCalledWith(resumedInterval);
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});

// B51 (D84, D85, D87): `usePomodoro()` beside `useTimer`, built on `timer/pomodoro.ts`.
// Return shape: { status: 'idle' | 'running' | 'paused', hydrated, phase ('work' when idle),
// remainingMs, overMs, totalWorkMs, canFinish, activity: { taskId } | { newActivityName } | null,
// start(config, activity), pause(), resume(), switchPhase(), reset(), finish(): FinishedPomodoro }.
// The view fields are recomputed on every transition and on a 1 s tick while running.
// - The run is stored as the PomodoroState JSON under `POMODORO_STORAGE_KEY` ('pomodoro.state'),
//   removed when the run ends (reset/finish); restored on mount with `restoreRun`.
// - Reminder: on a tick where `reminderDue`, the store calls `notifyPhaseDue(phase)` from
//   `timer/native` once and stores `markReminded`.
// - Native actions: on restore, and on every AppState 'change' to 'active', the store calls
//   `drainActions()` from `timer/native` (sync; `{ action, atElapsedMs }[]`, [] without the
//   module), maps each to `{ type: action, atElapsedMs }`, applies them with `applyActions`
//   and persists the result.
const CONFIG: PomodoroConfig = { workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 };
const MIN = 60_000;

async function mountPomodoro() {
  const view = await renderHook(() => usePomodoro());
  await waitFor(() => expect(view.result.current.hydrated).toBe(true));
  return view;
}

async function storedRun(): Promise<PomodoroState | null> {
  const raw = await AsyncStorage.getItem(POMODORO_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as PomodoroState) : null;
}

describe('usePomodoro transitions', () => {
  it('is idle with nothing stored', async () => {
    const view = await mountPomodoro();

    expect(view.result.current.status).toBe('idle');
    expect(view.result.current.activity).toBeNull();
    expect(view.result.current.canFinish).toBe(false);
  });

  it('start begins a Work interval on the chosen Activity and stores it under its own key', async () => {
    const view = await mountPomodoro();

    await act(async () => view.result.current.start(CONFIG, { taskId: 7 }));

    expect(view.result.current.status).toBe('running');
    expect(view.result.current.phase).toBe('work');
    expect(view.result.current.activity).toEqual({ taskId: 7 });
    expect(view.result.current.remainingMs).toBe(25 * MIN);
    expect(view.result.current.canFinish).toBe(false);
    await waitFor(async () => expect((await storedRun())?.phase).toBe('work'));
    expect(await AsyncStorage.getItem(TIMER_STORAGE_KEY)).toBeNull();
  });

  it('Start break / Start work move through the phases; the 4th break is a Long break', async () => {
    const view = await mountPomodoro();
    await act(async () => view.result.current.start(CONFIG, { newActivityName: 'Laundry' }));

    const phases: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      mockClock.mono += MIN;
      await act(async () => view.result.current.switchPhase());
      phases.push(view.result.current.phase);
    }

    expect(phases).toEqual(['break', 'work', 'break', 'work', 'break', 'work', 'longBreak', 'work']);
    expect(view.result.current.totalWorkMs).toBe(4 * MIN);
    expect(view.result.current.activity).toEqual({ newActivityName: 'Laundry' });
  });

  it('paused time counts toward no work', async () => {
    const view = await mountPomodoro();
    await act(async () => view.result.current.start(CONFIG, { taskId: 7 }));

    mockClock.mono += 10 * MIN;
    await act(async () => view.result.current.pause());
    expect(view.result.current.status).toBe('paused');
    mockClock.mono += 30 * MIN;
    await act(async () => view.result.current.resume());
    mockClock.mono += 5 * MIN;
    await act(async () => view.result.current.pause());

    expect(view.result.current.totalWorkMs).toBe(15 * MIN);
    expect(view.result.current.remainingMs).toBe(10 * MIN);
    expect(view.result.current.canFinish).toBe(true);
  });

  it('finish returns the run summary, goes idle and clears the stored run', async () => {
    const view = await mountPomodoro();
    await act(async () => view.result.current.start(CONFIG, { taskId: 7 }));
    mockClock.mono += 25 * MIN;
    await act(async () => view.result.current.switchPhase());
    mockClock.mono += 5 * MIN;
    await act(async () => view.result.current.switchPhase());
    mockClock.mono += 10 * MIN;
    await waitFor(async () => expect(await storedRun()).not.toBeNull());

    let result: ReturnType<typeof view.result.current.finish> | undefined;
    await act(async () => {
      result = view.result.current.finish();
    });

    expect(result).toMatchObject({
      durationSeconds: 35 * 60,
      pomodoroWorkIntervals: 2,
      pomodoroBreaks: 1,
      pomodoroBreakSeconds: 5 * 60,
    });
    expect(view.result.current.status).toBe('idle');
    await waitFor(async () => expect(await storedRun()).toBeNull());
  });

  it('reset discards the run and clears the stored run', async () => {
    const view = await mountPomodoro();
    await act(async () => view.result.current.start(CONFIG, { taskId: 7 }));
    await waitFor(async () => expect(await storedRun()).not.toBeNull());

    await act(async () => view.result.current.reset());

    expect(view.result.current.status).toBe('idle');
    await waitFor(async () => expect(await storedRun()).toBeNull());
  });
});

describe('usePomodoro reminder', () => {
  it('past the target, ticks report the overrun and notifyPhaseDue fires once per phase', async () => {
    const view = await mountPomodoro();
    jest.useFakeTimers();
    await act(async () => view.result.current.start(CONFIG, { taskId: 7 }));

    mockClock.mono += 24 * MIN;
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(mockNotifyPhaseDue).not.toHaveBeenCalled();
    expect(view.result.current.remainingMs).toBe(MIN);

    mockClock.mono += MIN;
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(mockNotifyPhaseDue).toHaveBeenCalledTimes(1);
    expect(mockNotifyPhaseDue).toHaveBeenCalledWith('work');

    mockClock.mono += 3 * MIN + 10_000;
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });
    expect(view.result.current.overMs).toBe(3 * MIN + 10_000);
    expect(view.result.current.remainingMs).toBe(0);
    expect(mockNotifyPhaseDue).toHaveBeenCalledTimes(1);

    await act(async () => view.result.current.switchPhase());
    mockClock.mono += 5 * MIN;
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(mockNotifyPhaseDue).toHaveBeenCalledTimes(2);
    expect(mockNotifyPhaseDue).toHaveBeenLastCalledWith('break');
  });
});

describe('usePomodoro restore and native actions', () => {
  function seededRun(overrides: Partial<PomodoroState> = {}): PomodoroState {
    return {
      status: 'running',
      phase: 'work',
      monoStart: 1_000_000,
      accumulatedMs: 0,
      workMs: 0,
      breakMs: 0,
      workIntervals: 0,
      breaks: 0,
      wallStart: Date.now() - 22 * MIN,
      taskId: 7,
      config: CONFIG,
      reminded: false,
      ...overrides,
    };
  }

  it('a stored run restores on mount', async () => {
    await AsyncStorage.setItem(POMODORO_STORAGE_KEY, JSON.stringify(seededRun()));
    mockClock.mono = 1_000_000 + 22 * MIN;

    const view = await mountPomodoro();

    expect(view.result.current.status).toBe('running');
    expect(view.result.current.phase).toBe('work');
    expect(view.result.current.totalWorkMs).toBe(22 * MIN);
    expect(view.result.current.activity).toEqual({ taskId: 7 });
  });

  it('a stored paused run restores as paused', async () => {
    await AsyncStorage.setItem(
      POMODORO_STORAGE_KEY,
      JSON.stringify(seededRun({ status: 'paused', monoStart: null, accumulatedMs: 8 * MIN }))
    );
    mockClock.mono = 1_000_000 + 60 * MIN;

    const view = await mountPomodoro();

    expect(view.result.current.status).toBe('paused');
    expect(view.result.current.totalWorkMs).toBe(8 * MIN);
  });

  it('queued native actions are applied on restore, at their own times, and persisted', async () => {
    await AsyncStorage.setItem(POMODORO_STORAGE_KEY, JSON.stringify(seededRun()));
    mockClock.mono = 1_000_000 + 22 * MIN;
    mockDrainActions.mockReturnValueOnce([
      { action: 'switch', atElapsedMs: 1_000_000 + 20 * MIN },
      { action: 'pause', atElapsedMs: 1_000_000 + 21 * MIN },
    ]);

    const view = await mountPomodoro();

    expect(mockDrainActions).toHaveBeenCalled();
    expect(view.result.current.status).toBe('paused');
    expect(view.result.current.phase).toBe('break');
    expect(view.result.current.totalWorkMs).toBe(20 * MIN);
    expect(view.result.current.remainingMs).toBe(4 * MIN);
    await waitFor(async () => expect((await storedRun())?.phase).toBe('break'));
    expect((await storedRun())?.workIntervals).toBe(1);
  });

  it('drains and applies queued actions when the app becomes active', async () => {
    const handlers: ((state: string) => void)[] = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((type, handler) => {
      if (type === 'change') handlers.push(handler as (state: string) => void);
      return { remove: jest.fn() } as never;
    });

    try {
      const view = await mountPomodoro();
      await act(async () => view.result.current.start(CONFIG, { taskId: 7 }));
      expect(handlers.length).toBeGreaterThan(0);

      mockDrainActions.mockReturnValueOnce([{ action: 'switch', atElapsedMs: 1_000_000 + 25 * MIN }]);
      mockClock.mono = 1_000_000 + 27 * MIN;
      await act(async () => handlers.forEach((handler) => handler('active')));

      expect(view.result.current.phase).toBe('break');
      expect(view.result.current.totalWorkMs).toBe(25 * MIN);
      expect(view.result.current.remainingMs).toBe(3 * MIN);
      await waitFor(async () => expect((await storedRun())?.phase).toBe('break'));
    } finally {
      spy.mockRestore();
    }
  });
});

describe('formatElapsed', () => {
  it('omits the hours below one hour', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9_400)).toBe('0:09');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_599_000)).toBe('59:59');
  });

  it('shows H:MM:SS from one hour', () => {
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
    expect(formatElapsed(36_000_000)).toBe('10:00:00');
  });
});
