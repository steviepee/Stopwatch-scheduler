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
  startForegroundService: (...args: [number, ServiceOptions?]) => mockStartService(...args),
  stopForegroundService: () => mockStopService(),
  notifyPhaseDue: (phase: string) => mockNotifyPhaseDue(phase),
  drainActions: () => mockDrainActions(),
  requestNotificationPermission: () => mockRequestPermission(),
  addTimerActionListener: (listener: () => void) => {
    mockActionListeners.push(listener);
    return {
      remove: () => {
        const index = mockActionListeners.indexOf(listener);
        if (index >= 0) mockActionListeners.splice(index, 1);
      },
    };
  },
}));

type ServiceOptions = {
  paused?: boolean;
  pomodoro?: {
    phase: string;
    phaseStartedAtElapsedMs: number;
    phaseAccumulatedMs: number;
    targetMs: number;
  };
};

const mockClock = { mono: 1_000_000 };
const mockActionListeners: (() => void)[] = [];
const mockStartService = jest.fn(
  async (startedAtElapsedMs: number, options?: ServiceOptions) => {}
);
const mockStopService = jest.fn(async () => {});
const mockNotifyPhaseDue = jest.fn((phase: string) => {});
const mockDrainActions = jest.fn(
  (): { action: 'pause' | 'resume' | 'switch'; atElapsedMs: number }[] => []
);
const mockRequestPermission = jest.fn(async () => true);

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
  mockRequestPermission.mockClear();
  mockActionListeners.length = 0;
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

// B57: Android 13+ shows no notification until the app asks. Each start asks; the OS only
// prompts while the permission is undecided, and a denial does not stop the timer.
describe('starting asks for the notification permission', () => {
  it('the stopwatch start asks once and runs', async () => {
    const view = await mountTimer();
    expect(mockRequestPermission).not.toHaveBeenCalled();
    await act(async () => view.result.current.start());
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(view.result.current.status).toBe('running');
  });

  it('a Pomodoro start asks once and runs, even when denied', async () => {
    mockRequestPermission.mockResolvedValueOnce(false);
    const view = await mountPomodoro();
    expect(mockRequestPermission).not.toHaveBeenCalled();
    await act(async () =>
      view.result.current.start(
        { workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 },
        { taskId: 7 }
      )
    );
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(view.result.current.status).toBe('running');
  });

  it('pause, resume and a phase switch do not ask', async () => {
    const view = await mountPomodoro();
    await act(async () =>
      view.result.current.start(
        { workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 },
        { taskId: 7 }
      )
    );
    mockRequestPermission.mockClear();
    await act(async () => view.result.current.pause());
    await act(async () => view.result.current.resume());
    await act(async () => view.result.current.switchPhase());
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });
});

describe('useTimer transitions', () => {
  // B52 (D88): pause keeps the notification. It re-calls the service with `{ paused: true }`
  // and the same anchor (mono - elapsed); a running stopwatch passes the anchor alone.
  it('starts, pauses and resumes, driving the foreground service', async () => {
    const view = await mountTimer();

    await act(async () => view.result.current.start());
    expect(view.result.current.status).toBe('running');
    expect(mockStartService).toHaveBeenCalledWith(1_000_000);

    mockClock.mono += 4_000;
    await act(async () => view.result.current.pause());
    expect(view.result.current.status).toBe('paused');
    expect(view.result.current.elapsedMs).toBe(4_000);
    expect(mockStartService).toHaveBeenLastCalledWith(1_000_000, { paused: true });
    expect(mockStopService).not.toHaveBeenCalled();

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
    expect(mockStopService).toHaveBeenCalledTimes(1);
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

  // B56: under the React Compiler the view must follow the clock on every tick, not only
  // when the run changes. The suite runs with the compiler on (package.json jest transform).
  it('each tick moves the remaining time, before and after a pause', async () => {
    const view = await mountPomodoro();
    jest.useFakeTimers();
    await act(async () => view.result.current.start(CONFIG, { taskId: 7 }));
    expect(view.result.current.remainingMs).toBe(25 * MIN);

    for (const expected of [25 * MIN - 1_000, 25 * MIN - 2_000]) {
      mockClock.mono += 1_000;
      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      expect(view.result.current.remainingMs).toBe(expected);
    }

    await act(async () => view.result.current.pause());
    mockClock.mono += 30_000;
    await act(async () => view.result.current.resume());
    expect(view.result.current.remainingMs).toBe(25 * MIN - 2_000);

    mockClock.mono += 1_000;
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(view.result.current.remainingMs).toBe(25 * MIN - 3_000);
  });

  // B58: a 250 ms tick, so one slow tick cannot hold a stale second on screen for long.
  it('the view refreshes within 250 ms', async () => {
    const view = await mountPomodoro();
    jest.useFakeTimers();
    await act(async () => view.result.current.start(CONFIG, { taskId: 7 }));

    mockClock.mono += 250;
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(view.result.current.remainingMs).toBe(25 * MIN - 250);
  });

  it('canFinish turns true once work has ticked, with no other change to the run', async () => {
    const view = await mountPomodoro();
    jest.useFakeTimers();
    await act(async () => view.result.current.start(CONFIG, { taskId: 7 }));
    expect(view.result.current.canFinish).toBe(false);

    mockClock.mono += 1_000;
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(view.result.current.canFinish).toBe(true);
    expect(view.result.current.totalWorkMs).toBe(1_000);
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
    // The preset's AppState.addEventListener is already a jest.fn, so mockRestore would strip
    // its implementation (later mounts get `undefined` back); put the original back instead.
    const original = (AppState.addEventListener as jest.Mock).getMockImplementation();
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
      spy.mockImplementation(original as never);
    }
  });
});

// B52 (D84, D88): the notification follows every transition of either hook.
// - `startForegroundService(anchor, options?)` from `timer/native`; anchor = mono - the elapsed
//   the notification shows (the stopwatch's elapsed, or the run's current-phase elapsed).
//   During a run, `options.pomodoro` = { phase, phaseStartedAtElapsedMs (the phase's
//   monoStart while running), phaseAccumulatedMs, targetMs }; `options.paused` is true only
//   when paused. Called on start, pause, resume and every phase switch, and when a running
//   run is restored. `stopForegroundService()` only on reset and finish.
// - `addTimerActionListener(listener)` from `timer/native` returns `{ remove() }`. Each hook
//   subscribes on mount; on the event, a hook that is not idle drains (`drainActions()`) and
//   applies the actions at their own times. An idle hook does not drain, so it cannot eat the
//   other hook's actions. The stopwatch applies pause/resume and ignores `switch`. The
//   stopwatch also drains when it restores a non-idle timer.
function lastServiceCall(): [number, ServiceOptions] {
  const calls = mockStartService.mock.calls;
  const [anchor, options] = calls[calls.length - 1];
  return [anchor, options ?? {}];
}

async function fireTimerAction() {
  await act(async () => [...mockActionListeners].forEach((listener) => listener()));
}

describe('usePomodoro drives the foreground service', () => {
  it('start, pause, resume and each switch re-call the service with the run', async () => {
    const view = await mountPomodoro();

    await act(async () => view.result.current.start(CONFIG, { taskId: 7 }));
    let [anchor, options] = lastServiceCall();
    expect(anchor).toBe(1_000_000);
    expect(options.paused).toBeFalsy();
    expect(options.pomodoro).toEqual({
      phase: 'work',
      phaseStartedAtElapsedMs: 1_000_000,
      phaseAccumulatedMs: 0,
      targetMs: 25 * MIN,
    });

    mockClock.mono += 27 * MIN;
    const switchedAt = mockClock.mono;
    await act(async () => view.result.current.switchPhase());
    [anchor, options] = lastServiceCall();
    expect(anchor).toBe(switchedAt);
    expect(options.paused).toBeFalsy();
    expect(options.pomodoro).toEqual({
      phase: 'break',
      phaseStartedAtElapsedMs: switchedAt,
      phaseAccumulatedMs: 0,
      targetMs: 5 * MIN,
    });

    mockClock.mono += 2 * MIN;
    await act(async () => view.result.current.pause());
    [anchor, options] = lastServiceCall();
    expect(anchor).toBe(mockClock.mono - 2 * MIN);
    expect(options.paused).toBe(true);
    expect(options.pomodoro).toEqual(
      expect.objectContaining({ phase: 'break', phaseAccumulatedMs: 2 * MIN, targetMs: 5 * MIN })
    );
    expect(mockStopService).not.toHaveBeenCalled();

    mockClock.mono += 10 * MIN;
    const resumedAt = mockClock.mono;
    await act(async () => view.result.current.resume());
    [anchor, options] = lastServiceCall();
    expect(anchor).toBe(resumedAt - 2 * MIN);
    expect(options.paused).toBeFalsy();
    expect(options.pomodoro).toEqual({
      phase: 'break',
      phaseStartedAtElapsedMs: resumedAt,
      phaseAccumulatedMs: 2 * MIN,
      targetMs: 5 * MIN,
    });

    mockClock.mono += MIN;
    await act(async () => view.result.current.switchPhase());
    expect(lastServiceCall()[1].pomodoro).toEqual(
      expect.objectContaining({ phase: 'work', phaseAccumulatedMs: 0, targetMs: 25 * MIN })
    );

    for (let i = 0; i < 5; i += 1) {
      mockClock.mono += MIN;
      await act(async () => view.result.current.switchPhase());
    }
    expect(view.result.current.phase).toBe('longBreak');
    expect(lastServiceCall()[1].pomodoro).toEqual({
      phase: 'longBreak',
      phaseStartedAtElapsedMs: mockClock.mono,
      phaseAccumulatedMs: 0,
      targetMs: 15 * MIN,
    });
    expect(mockStopService).not.toHaveBeenCalled();
  });

  it('reset stops the service', async () => {
    const view = await mountPomodoro();
    await act(async () => view.result.current.start(CONFIG, { taskId: 7 }));

    await act(async () => view.result.current.reset());

    expect(mockStopService).toHaveBeenCalledTimes(1);
  });

  it('finish stops the service', async () => {
    const view = await mountPomodoro();
    await act(async () => view.result.current.start(CONFIG, { taskId: 7 }));
    mockClock.mono += 10 * MIN;

    await act(async () => {
      view.result.current.finish();
    });

    expect(mockStopService).toHaveBeenCalledTimes(1);
  });

  it('a restored running run re-arms the service with its phase', async () => {
    await AsyncStorage.setItem(
      POMODORO_STORAGE_KEY,
      JSON.stringify({
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
      } satisfies PomodoroState)
    );
    mockClock.mono = 1_000_000 + 22 * MIN;

    await mountPomodoro();

    await waitFor(() => expect(mockStartService).toHaveBeenCalled());
    const [anchor, options] = lastServiceCall();
    expect(anchor).toBe(1_000_000);
    expect(options.paused).toBeFalsy();
    expect(options.pomodoro).toEqual({
      phase: 'work',
      phaseStartedAtElapsedMs: 1_000_000,
      phaseAccumulatedMs: 0,
      targetMs: 25 * MIN,
    });
    expect(mockStopService).not.toHaveBeenCalled();
  });
});

describe('onTimerAction drains and applies the notification taps', () => {
  it('usePomodoro applies a tapped switch and pause; the view matches', async () => {
    const view = await mountPomodoro();
    await act(async () => view.result.current.start(CONFIG, { taskId: 7 }));
    expect(mockActionListeners.length).toBeGreaterThan(0);

    mockDrainActions.mockReturnValueOnce([
      { action: 'switch', atElapsedMs: 1_000_000 + 25 * MIN },
      { action: 'pause', atElapsedMs: 1_000_000 + 26 * MIN },
    ]);
    mockClock.mono = 1_000_000 + 30 * MIN;
    await fireTimerAction();

    expect(mockDrainActions).toHaveBeenCalled();
    expect(view.result.current.status).toBe('paused');
    expect(view.result.current.phase).toBe('break');
    expect(view.result.current.totalWorkMs).toBe(25 * MIN);
    expect(view.result.current.remainingMs).toBe(4 * MIN);
    await waitFor(async () => expect((await storedRun())?.status).toBe('paused'));

    mockDrainActions.mockReturnValueOnce([{ action: 'resume', atElapsedMs: 1_000_000 + 31 * MIN }]);
    mockClock.mono = 1_000_000 + 32 * MIN;
    await fireTimerAction();

    expect(view.result.current.status).toBe('running');
    expect(view.result.current.remainingMs).toBe(3 * MIN);
  });

  it('useTimer applies tapped pause and resume at their own times and ignores switch', async () => {
    const view = await mountTimer();
    await act(async () => view.result.current.start());
    expect(mockActionListeners.length).toBeGreaterThan(0);

    mockDrainActions.mockReturnValueOnce([{ action: 'pause', atElapsedMs: 1_004_000 }]);
    mockClock.mono = 1_010_000;
    await fireTimerAction();
    expect(view.result.current.status).toBe('paused');
    expect(view.result.current.elapsedMs).toBe(4_000);
    await waitFor(async () => {
      const raw = (await AsyncStorage.getItem(TIMER_STORAGE_KEY)) as string;
      expect(JSON.parse(raw).status).toBe('paused');
    });

    mockDrainActions.mockReturnValueOnce([
      { action: 'resume', atElapsedMs: 1_012_000 },
      { action: 'switch', atElapsedMs: 1_013_000 },
    ]);
    mockClock.mono = 1_015_000;
    await fireTimerAction();
    expect(view.result.current.status).toBe('running');
    expect(view.result.current.elapsedMs).toBe(7_000);
  });

  it('useTimer drains when it restores a running timer', async () => {
    await AsyncStorage.setItem(
      TIMER_STORAGE_KEY,
      JSON.stringify({
        status: 'running',
        wallStart: Date.now() - 9_000,
        monoStart: 1_000_000,
        accumulatedMs: 0,
      } satisfies PersistedTimerState)
    );
    mockClock.mono = 1_009_000;
    mockDrainActions.mockReturnValueOnce([{ action: 'pause', atElapsedMs: 1_003_000 }]);

    const view = await mountTimer();

    expect(mockDrainActions).toHaveBeenCalled();
    expect(view.result.current.status).toBe('paused');
    expect(view.result.current.elapsedMs).toBe(3_000);
  });

  it('idle hooks do not drain the queue', async () => {
    await mountTimer();
    await mountPomodoro();
    expect(mockActionListeners.length).toBeGreaterThanOrEqual(2);

    await fireTimerAction();

    expect(mockDrainActions).not.toHaveBeenCalled();
  });

  it('unmounting removes the listeners', async () => {
    const timer = await mountTimer();
    const run = await mountPomodoro();
    expect(mockActionListeners.length).toBeGreaterThanOrEqual(2);

    await timer.unmount();
    await run.unmount();

    expect(mockActionListeners).toHaveLength(0);
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
