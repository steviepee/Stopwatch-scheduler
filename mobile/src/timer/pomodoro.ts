import type { Clocks, FinishedRecording } from './core';

export type PomodoroConfig = {
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
};

export type PomodoroPhase = 'work' | 'break' | 'longBreak';

export type PomodoroState = {
  status: 'running' | 'paused';
  phase: PomodoroPhase;
  monoStart: number | null;
  accumulatedMs: number;
  workMs: number;
  breakMs: number;
  workIntervals: number;
  breaks: number;
  wallStart: number;
  taskId?: number;
  newActivityName?: string;
  config: PomodoroConfig;
  reminded: boolean;
  clockJumpDetected?: boolean;
};

export type PomodoroActivity = { taskId: number } | { newActivityName: string };

export type PomodoroAction = {
  type: 'pause' | 'resume' | 'switch';
  atElapsedMs: number;
};

export type PhaseView = {
  phase: PomodoroPhase;
  elapsedMs: number;
  targetMs: number;
  remainingMs: number;
  overMs: number;
};

export type FinishedPomodoro = FinishedRecording & {
  pomodoroWorkIntervals: number;
  pomodoroBreaks: number;
  pomodoroBreakSeconds: number;
};

function phaseElapsed(state: PomodoroState, at: number): number {
  if (state.status === 'running' && state.monoStart !== null) {
    return state.accumulatedMs + (at - state.monoStart);
  }
  return state.accumulatedMs;
}

function targetMs(state: PomodoroState): number {
  const { config } = state;
  const minutes =
    state.phase === 'work'
      ? config.workMinutes
      : state.phase === 'break'
        ? config.breakMinutes
        : config.longBreakMinutes;
  return minutes * 60_000;
}

function totalWorkMs(state: PomodoroState, clocks: Clocks): number {
  return state.phase === 'work' ? state.workMs + phaseElapsed(state, clocks.mono()) : state.workMs;
}

export function startRun(
  config: PomodoroConfig,
  activity: PomodoroActivity,
  clocks: Clocks
): PomodoroState {
  return {
    status: 'running',
    phase: 'work',
    monoStart: clocks.mono(),
    accumulatedMs: 0,
    workMs: 0,
    breakMs: 0,
    workIntervals: 0,
    breaks: 0,
    wallStart: clocks.wall(),
    ...activity,
    config,
    reminded: false,
  };
}

export function switchPhase(state: PomodoroState, at: number): PomodoroState {
  const elapsed = phaseElapsed(state, at);
  const next = { ...state, status: 'running' as const, monoStart: at, accumulatedMs: 0, reminded: false };

  if (state.phase === 'work') {
    const workIntervals = state.workIntervals + 1;
    return {
      ...next,
      phase: workIntervals % state.config.longBreakEvery === 0 ? 'longBreak' : 'break',
      workMs: state.workMs + elapsed,
      workIntervals,
    };
  }
  return {
    ...next,
    phase: 'work',
    breakMs: state.breakMs + elapsed,
    breaks: state.breaks + 1,
  };
}

export function pauseRun(state: PomodoroState, at: number): PomodoroState {
  return {
    ...state,
    status: 'paused',
    monoStart: null,
    accumulatedMs: phaseElapsed(state, at),
  };
}

export function resumeRun(state: PomodoroState, at: number): PomodoroState {
  if (state.status === 'running') return state;
  return { ...state, status: 'running', monoStart: at };
}

export function phaseView(state: PomodoroState, clocks: Clocks): PhaseView {
  const elapsedMs = phaseElapsed(state, clocks.mono());
  const target = targetMs(state);
  return {
    phase: state.phase,
    elapsedMs,
    targetMs: target,
    remainingMs: Math.max(0, target - elapsedMs),
    overMs: Math.max(0, elapsedMs - target),
  };
}

export function reminderDue(state: PomodoroState, clocks: Clocks): boolean {
  return !state.reminded && phaseElapsed(state, clocks.mono()) >= targetMs(state);
}

export function markReminded(state: PomodoroState): PomodoroState {
  return { ...state, reminded: true };
}

export function canFinish(state: PomodoroState, clocks: Clocks): boolean {
  return totalWorkMs(state, clocks) > 0;
}

export function finishRun(state: PomodoroState, clocks: Clocks): FinishedPomodoro {
  const openWorkMs = state.phase === 'work' ? phaseElapsed(state, clocks.mono()) : 0;
  const wallEnd = clocks.wall();

  return {
    durationSeconds: (state.workMs + openWorkMs) / 1000,
    startUtc: new Date(state.wallStart).toISOString(),
    endUtc: new Date(wallEnd).toISOString(),
    clockJumpDetected: state.clockJumpDetected === true,
    pomodoroWorkIntervals: state.workIntervals + (openWorkMs > 0 ? 1 : 0),
    pomodoroBreaks: state.breaks,
    pomodoroBreakSeconds: state.breakMs / 1000,
  };
}

export function applyActions(state: PomodoroState, actions: PomodoroAction[]): PomodoroState {
  return actions.reduce((current, action) => {
    if (action.type === 'pause') return pauseRun(current, action.atElapsedMs);
    if (action.type === 'resume') return resumeRun(current, action.atElapsedMs);
    return switchPhase(current, action.atElapsedMs);
  }, state);
}

export function restoreRun(persisted: PomodoroState, clocks: Clocks): PomodoroState {
  if (persisted.status !== 'running' || persisted.monoStart === null) {
    return { ...persisted };
  }

  if (clocks.mono() >= persisted.monoStart) {
    return { ...persisted };
  }

  // The monotonic clock went backwards: the device rebooted mid-run, so the current
  // phase's elapsed is whatever wall time the closed intervals do not account for.
  return {
    ...persisted,
    monoStart: clocks.mono(),
    accumulatedMs: clocks.wall() - persisted.wallStart - persisted.workMs - persisted.breakMs,
    clockJumpDetected: true,
  };
}
