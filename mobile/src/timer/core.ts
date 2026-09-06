export type TimerStatus = 'idle' | 'running' | 'paused';

export type TimerState = {
  status: TimerStatus;
  wallStart: number | null;
  monoStart: number | null;
  accumulatedMs: number;
  clockJumpDetected?: boolean;
};

export type PersistedTimerState = {
  status: TimerStatus;
  wallStart: number | null;
  monoStart: number | null;
  accumulatedMs: number;
};

export type Clocks = {
  wall: () => number;
  mono: () => number;
};

export type FinishedRecording = {
  durationSeconds: number;
  startUtc: string;
  endUtc: string;
  clockJumpDetected: boolean;
};

const JUMP_TOLERANCE_MS = 2000;

export const IDLE_STATE: TimerState = {
  status: 'idle',
  wallStart: null,
  monoStart: null,
  accumulatedMs: 0,
};

export function elapsedMs(state: TimerState, clocks: Clocks): number {
  if (state.status === 'running' && state.monoStart !== null) {
    return state.accumulatedMs + (clocks.mono() - state.monoStart);
  }
  return state.accumulatedMs;
}

export function start(state: TimerState, clocks: Clocks): TimerState {
  return {
    status: 'running',
    wallStart: clocks.wall(),
    monoStart: clocks.mono(),
    accumulatedMs: 0,
    clockJumpDetected: false,
  };
}

export function pause(state: TimerState, clocks: Clocks): TimerState {
  return {
    ...state,
    status: 'paused',
    monoStart: null,
    accumulatedMs: elapsedMs(state, clocks),
  };
}

export function resume(state: TimerState, clocks: Clocks): TimerState {
  return {
    ...state,
    status: 'running',
    monoStart: clocks.mono(),
  };
}

export function reset(state: TimerState, clocks: Clocks): TimerState {
  return { ...IDLE_STATE };
}

export function finish(state: TimerState, clocks: Clocks): FinishedRecording {
  const durationMs = elapsedMs(state, clocks);
  const wallStart = state.wallStart ?? clocks.wall();
  const wallEnd = clocks.wall();
  const wallDelta = wallEnd - wallStart;

  return {
    durationSeconds: durationMs / 1000,
    startUtc: new Date(wallStart).toISOString(),
    endUtc: new Date(wallEnd).toISOString(),
    clockJumpDetected:
      state.clockJumpDetected === true || Math.abs(wallDelta - durationMs) > JUMP_TOLERANCE_MS,
  };
}

export function restore(persisted: PersistedTimerState, clocks: Clocks): TimerState {
  if (persisted.status !== 'running' || persisted.monoStart === null) {
    return { ...persisted };
  }

  if (clocks.mono() >= persisted.monoStart) {
    return { ...persisted };
  }

  // The monotonic clock went backwards: the device rebooted while the recording
  // was running, so the wall clock is the only record of how long it has been.
  const wallStart = persisted.wallStart ?? clocks.wall();
  return {
    status: 'running',
    wallStart,
    monoStart: clocks.mono(),
    accumulatedMs: clocks.wall() - wallStart,
    clockJumpDetected: true,
  };
}
