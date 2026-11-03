import { useState, useEffect } from 'react';

const STORAGE_KEY = 'stopwatch.state';

interface StoredState {
  startedAt: number | null;
  accumulatedMs: number;
  startTime: string | null;
}

const IDLE: StoredState = { startedAt: null, accumulatedMs: 0, startTime: null };

const loadState = (): StoredState => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return IDLE;
  try {
    return { ...IDLE, ...JSON.parse(raw) };
  } catch {
    return IDLE;
  }
};

export const useStopwatch = () => {
  const [state, setState] = useState<StoredState>(loadState);
  const [, setTick] = useState(0);
  const isRunning = state.startedAt !== null;

  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 10);
    return () => clearInterval(id);
  }, [isRunning]);

  const time = state.accumulatedMs + (state.startedAt !== null ? Date.now() - state.startedAt : 0);

  const save = (next: StoredState) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setState(next);
  };

  const start = () => {
    if (isRunning) return;
    save({
      startedAt: Date.now(),
      accumulatedMs: state.accumulatedMs,
      startTime: state.startTime ?? new Date().toISOString(),
    });
  };

  const pause = () => {
    if (!isRunning) return;
    save({ ...state, startedAt: null, accumulatedMs: time });
  };

  const reset = () => {
    localStorage.removeItem(STORAGE_KEY);
    setState(IDLE);
  };

  const formatTime = (milliseconds: number) => {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const ms = Math.floor((milliseconds % 1000) / 10);

    return {
      hours: hours.toString().padStart(2, '0'),
      minutes: minutes.toString().padStart(2, '0'),
      seconds: seconds.toString().padStart(2, '0'),
      milliseconds: ms.toString().padStart(2, '0'),
    };
  };

  return {
    time,
    isRunning,
    startTime: state.startTime,
    start,
    pause,
    reset,
    formatTime,
  };
};
