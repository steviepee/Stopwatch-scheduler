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
  startedAt: number | null;
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
};

export type PomodoroActivity = { taskId: number } | { newActivityName: string };

export type PhaseView = {
  phase: PomodoroPhase;
  elapsedMs: number;
  targetMs: number;
  remainingMs: number;
  overMs: number;
};

export type FinishedPomodoro = {
  durationSeconds: number;
  startTime: string;
  endTime: string;
  pomodoroWorkIntervals: number;
  pomodoroBreaks: number;
  pomodoroBreakSeconds: number;
};

function phaseElapsed(state: PomodoroState): number {
  if (state.status === 'running' && state.startedAt !== null) {
    return state.accumulatedMs + (Date.now() - state.startedAt);
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

export function totalWorkMs(state: PomodoroState): number {
  return state.phase === 'work' ? state.workMs + phaseElapsed(state) : state.workMs;
}

export function startRun(config: PomodoroConfig, activity: PomodoroActivity): PomodoroState {
  const now = Date.now();
  return {
    status: 'running',
    phase: 'work',
    startedAt: now,
    accumulatedMs: 0,
    workMs: 0,
    breakMs: 0,
    workIntervals: 0,
    breaks: 0,
    wallStart: now,
    ...activity,
    config,
    reminded: false,
  };
}

export function switchPhase(state: PomodoroState): PomodoroState {
  const elapsed = phaseElapsed(state);
  const next = {
    ...state,
    status: 'running' as const,
    startedAt: Date.now(),
    accumulatedMs: 0,
    reminded: false,
  };

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

export function pauseRun(state: PomodoroState): PomodoroState {
  return {
    ...state,
    status: 'paused',
    startedAt: null,
    accumulatedMs: phaseElapsed(state),
  };
}

export function resumeRun(state: PomodoroState): PomodoroState {
  if (state.status === 'running') return state;
  return { ...state, status: 'running', startedAt: Date.now() };
}

export function phaseView(state: PomodoroState): PhaseView {
  const elapsedMs = phaseElapsed(state);
  const target = targetMs(state);
  return {
    phase: state.phase,
    elapsedMs,
    targetMs: target,
    remainingMs: Math.max(0, target - elapsedMs),
    overMs: Math.max(0, elapsedMs - target),
  };
}

export function reminderDue(state: PomodoroState): boolean {
  return !state.reminded && phaseElapsed(state) >= targetMs(state);
}

export function markReminded(state: PomodoroState): PomodoroState {
  return { ...state, reminded: true };
}

export function canFinish(state: PomodoroState): boolean {
  return totalWorkMs(state) > 0;
}

export function finishRun(state: PomodoroState): FinishedPomodoro {
  const openWorkMs = state.phase === 'work' ? phaseElapsed(state) : 0;

  return {
    durationSeconds: (state.workMs + openWorkMs) / 1000,
    startTime: new Date(state.wallStart).toISOString(),
    endTime: new Date(Date.now()).toISOString(),
    pomodoroWorkIntervals: state.workIntervals + (openWorkMs > 0 ? 1 : 0),
    pomodoroBreaks: state.breaks,
    pomodoroBreakSeconds: state.breakMs / 1000,
  };
}
