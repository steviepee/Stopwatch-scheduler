import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import * as core from './core';
import type { Clocks, FinishedRecording, PersistedTimerState, TimerState } from './core';
import { elapsedRealtime, startForegroundService, stopForegroundService } from './native';

export const TIMER_STORAGE_KEY = 'timer.state';

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
