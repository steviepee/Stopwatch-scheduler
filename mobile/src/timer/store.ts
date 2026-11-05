import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import * as core from './core';
import type { Clocks, FinishedRecording, PersistedTimerState, TimerState } from './core';
import {
  addTimerActionListener,
  drainActions,
  elapsedRealtime,
  notifyPhaseDue,
  requestNotificationPermission,
  startForegroundService,
  stopForegroundService,
} from './native';
import * as pomodoro from './pomodoro';
import type {
  FinishedPomodoro,
  PomodoroActivity,
  PomodoroConfig,
  PomodoroPhase,
  PomodoroState,
} from './pomodoro';

export const TIMER_STORAGE_KEY = 'timer.state';
export const POMODORO_STORAGE_KEY = 'pomodoro.state';

const clocks: Clocks = {
  wall: () => Date.now(),
  mono: () => elapsedRealtime(),
};

function persist(state: TimerState): void {
  if (state.status === 'idle') {
    void AsyncStorage.removeItem(TIMER_STORAGE_KEY);
    return;
  }
  const persisted: PersistedTimerState = {
    status: state.status,
    wallStart: state.wallStart,
    monoStart: state.monoStart,
    accumulatedMs: state.accumulatedMs,
  };
  void AsyncStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(persisted));
}

function serviceAnchor(state: TimerState): number {
  return clocks.mono() - core.elapsedMs(state, clocks);
}

function syncService(state: TimerState): void {
  if (state.status === 'running') {
    void startForegroundService(serviceAnchor(state));
  } else if (state.status === 'paused') {
    void startForegroundService(serviceAnchor(state), { paused: true });
  }
}

function drainTimer(state: TimerState): TimerState {
  const actions = drainActions();
  return actions.reduce((current, { action, atElapsedMs }) => {
    const at: Clocks = { wall: clocks.wall, mono: () => atElapsedMs };
    if (action === 'pause' && current.status === 'running') return core.pause(current, at);
    if (action === 'resume' && current.status === 'paused') return core.resume(current, at);
    return current;
  }, state);
}

export function useTimer() {
  const [state, setState] = useState<TimerState>(core.IDLE_STATE);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const stateRef = useRef<TimerState>(core.IDLE_STATE);

  const apply = useCallback((next: TimerState) => {
    stateRef.current = next;
    setState(next);
    setElapsedMs(core.elapsedMs(next, clocks));
    persist(next);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void AsyncStorage.getItem(TIMER_STORAGE_KEY).then((raw) => {
      if (cancelled) return;
      if (raw) {
        const restored = core.restore(JSON.parse(raw) as PersistedTimerState, clocks);
        const next = restored.status === 'idle' ? restored : drainTimer(restored);
        if (next !== restored) {
          apply(next);
          syncService(next);
        } else {
          stateRef.current = restored;
          setState(restored);
          setElapsedMs(core.elapsedMs(restored, clocks));
          if (restored.status === 'running') {
            void startForegroundService(serviceAnchor(restored));
          }
        }
      }
      setHydrated(true);
    });

    const subscription = addTimerActionListener(() => {
      const current = stateRef.current;
      if (current.status === 'idle') return;
      const next = drainTimer(current);
      if (next === current) return;
      apply(next);
      syncService(next);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [apply]);

  useEffect(() => {
    if (state.status !== 'running') return;

    const id = setInterval(() => setElapsedMs(core.elapsedMs(state, clocks)), 1000);
    return () => clearInterval(id);
  }, [state]);

  const start = useCallback(() => {
    const next = core.start(state, clocks);
    apply(next);
    syncService(next);
    void requestNotificationPermission();
  }, [state, apply]);

  const pause = useCallback(() => {
    const next = core.pause(state, clocks);
    apply(next);
    syncService(next);
  }, [state, apply]);

  const resume = useCallback(() => {
    const next = core.resume(state, clocks);
    apply(next);
    syncService(next);
  }, [state, apply]);

  const reset = useCallback(() => {
    apply(core.reset(state, clocks));
    void stopForegroundService();
  }, [state, apply]);

  const finish = useCallback((): FinishedRecording => {
    const result = core.finish(state, clocks);
    apply(core.reset(state, clocks));
    void stopForegroundService();
    return result;
  }, [state, apply]);

  return { status: state.status, elapsedMs, hydrated, start, pause, resume, reset, finish };
}

function persistRun(run: PomodoroState | null): void {
  if (run === null) {
    void AsyncStorage.removeItem(POMODORO_STORAGE_KEY);
    return;
  }
  void AsyncStorage.setItem(POMODORO_STORAGE_KEY, JSON.stringify(run));
}

function drainInto(run: PomodoroState): PomodoroState {
  const actions = drainActions();
  if (actions.length === 0) return run;
  return pomodoro.applyActions(
    run,
    actions.map((a) => ({ type: a.action, atElapsedMs: a.atElapsedMs }))
  );
}

function syncRunService(run: PomodoroState | null): void {
  if (run === null) {
    void stopForegroundService();
    return;
  }
  const view = pomodoro.phaseView(run, clocks);
  const anchor = clocks.mono() - view.elapsedMs;
  const options = {
    pomodoro: {
      phase: run.phase,
      phaseStartedAtElapsedMs: run.monoStart ?? anchor,
      phaseAccumulatedMs: run.accumulatedMs,
      targetMs: view.targetMs,
    },
  };
  void startForegroundService(
    anchor,
    run.status === 'paused' ? { paused: true, ...options } : options
  );
}

export function usePomodoro() {
  const [run, setRun] = useState<PomodoroState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(() => clocks.mono());
  const runRef = useRef<PomodoroState | null>(null);

  const store = useCallback((next: PomodoroState | null) => {
    runRef.current = next;
    setRun(next);
    setNow(clocks.mono());
    persistRun(next);
  }, []);

  const apply = useCallback(
    (next: PomodoroState | null) => {
      store(next);
      syncRunService(next);
    },
    [store]
  );

  useEffect(() => {
    let cancelled = false;

    const drainCurrent = () => {
      const current = runRef.current;
      if (current === null) return;
      const next = drainInto(current);
      if (next !== current) apply(next);
    };

    void AsyncStorage.getItem(POMODORO_STORAGE_KEY).then((raw) => {
      if (cancelled) return;
      if (raw) {
        const restored = pomodoro.restoreRun(JSON.parse(raw) as PomodoroState, clocks);
        const next = drainInto(restored);
        if (next !== restored || next.status === 'running') {
          apply(next);
        } else {
          store(next);
        }
      }
      setHydrated(true);
    });

    const appStateSubscription = AppState.addEventListener('change', (appState) => {
      if (appState === 'active') drainCurrent();
    });
    const actionSubscription = addTimerActionListener(drainCurrent);

    return () => {
      cancelled = true;
      appStateSubscription.remove();
      actionSubscription.remove();
    };
  }, [apply, store]);

  useEffect(() => {
    if (run?.status !== 'running') return;

    const id = setInterval(() => {
      const current = runRef.current;
      if (current && pomodoro.reminderDue(current, clocks)) {
        notifyPhaseDue(current.phase);
        store(pomodoro.markReminded(current));
      } else {
        setNow(clocks.mono());
      }
    }, 1000);
    return () => clearInterval(id);
  }, [run, store]);

  const start = useCallback(
    (config: PomodoroConfig, activity: PomodoroActivity) => {
      apply(pomodoro.startRun(config, activity, clocks));
      void requestNotificationPermission();
    },
    [apply]
  );

  const pause = useCallback(() => {
    if (runRef.current) apply(pomodoro.pauseRun(runRef.current, clocks.mono()));
  }, [apply]);

  const resume = useCallback(() => {
    if (runRef.current) apply(pomodoro.resumeRun(runRef.current, clocks.mono()));
  }, [apply]);

  const switchPhase = useCallback(() => {
    if (runRef.current) apply(pomodoro.switchPhase(runRef.current, clocks.mono()));
  }, [apply]);

  const reset = useCallback(() => apply(null), [apply]);

  const finish = useCallback((): FinishedPomodoro => {
    const result = pomodoro.finishRun(runRef.current as PomodoroState, clocks);
    apply(null);
    return result;
  }, [apply]);

  // Read the clock through `now` so the React Compiler re-derives the view on each tick.
  const at: Clocks = { wall: clocks.wall, mono: () => now };
  const view = run ? pomodoro.phaseView(run, at) : null;
  const activity: PomodoroActivity | null = run
    ? run.taskId !== undefined
      ? { taskId: run.taskId }
      : { newActivityName: run.newActivityName ?? '' }
    : null;

  return {
    status: run ? run.status : ('idle' as const),
    hydrated,
    phase: run ? run.phase : ('work' as PomodoroPhase),
    remainingMs: view ? view.remainingMs : 0,
    overMs: view ? view.overMs : 0,
    totalWorkMs: run ? run.workMs + (run.phase === 'work' && view ? view.elapsedMs : 0) : 0,
    canFinish: run ? pomodoro.canFinish(run, at) : false,
    activity,
    start,
    pause,
    resume,
    switchPhase,
    reset,
    finish,
  };
}
