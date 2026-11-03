import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import * as core from './core';
import type { Clocks, FinishedRecording, PersistedTimerState, TimerState } from './core';
import {
  drainActions,
  elapsedRealtime,
  notifyPhaseDue,
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

export function useTimer() {
  const [state, setState] = useState<TimerState>(core.IDLE_STATE);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void AsyncStorage.getItem(TIMER_STORAGE_KEY).then((raw) => {
      if (cancelled) return;
      if (raw) {
        const restored = core.restore(JSON.parse(raw) as PersistedTimerState, clocks);
        setState(restored);
        setElapsedMs(core.elapsedMs(restored, clocks));
        if (restored.status === 'running') {
          void startForegroundService(serviceAnchor(restored));
        }
      }
      setHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.status !== 'running') return;

    const id = setInterval(() => setElapsedMs(core.elapsedMs(state, clocks)), 1000);
    return () => clearInterval(id);
  }, [state]);

  const apply = useCallback((next: TimerState) => {
    setState(next);
    setElapsedMs(core.elapsedMs(next, clocks));
    persist(next);
  }, []);

  const start = useCallback(() => {
    const next = core.start(state, clocks);
    apply(next);
    void startForegroundService(serviceAnchor(next));
  }, [state, apply]);

  const pause = useCallback(() => {
    apply(core.pause(state, clocks));
    void stopForegroundService();
  }, [state, apply]);

  const resume = useCallback(() => {
    const next = core.resume(state, clocks);
    apply(next);
    void startForegroundService(serviceAnchor(next));
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

export function usePomodoro() {
  const [run, setRun] = useState<PomodoroState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [, setTick] = useState(0);
  const runRef = useRef<PomodoroState | null>(null);

  const apply = useCallback((next: PomodoroState | null) => {
    runRef.current = next;
    setRun(next);
    persistRun(next);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void AsyncStorage.getItem(POMODORO_STORAGE_KEY).then((raw) => {
      if (cancelled) return;
      if (raw) {
        apply(drainInto(pomodoro.restoreRun(JSON.parse(raw) as PomodoroState, clocks)));
      }
      setHydrated(true);
    });

    const subscription = AppState.addEventListener('change', (appState) => {
      const current = runRef.current;
      if (appState !== 'active' || current === null) return;
      const next = drainInto(current);
      if (next !== current) apply(next);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [apply]);

  useEffect(() => {
    if (run?.status !== 'running') return;

    const id = setInterval(() => {
      const current = runRef.current;
      if (current && pomodoro.reminderDue(current, clocks)) {
        notifyPhaseDue(current.phase);
        apply(pomodoro.markReminded(current));
      } else {
        setTick((tick) => tick + 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [run, apply]);

  const start = useCallback(
    (config: PomodoroConfig, activity: PomodoroActivity) => {
      apply(pomodoro.startRun(config, activity, clocks));
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

  const view = run ? pomodoro.phaseView(run, clocks) : null;
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
    canFinish: run ? pomodoro.canFinish(run, clocks) : false,
    activity,
    start,
    pause,
    resume,
    switchPhase,
    reset,
    finish,
  };
}
