// B49 contract for mobile/src/timer/pomodoro.ts (pure: no React, no I/O).
// Shapes pinned here beyond the PRD text:
// - startRun(config, activity, clocks); activity is { taskId } or { newActivityName }.
// - State fields: status, phase, monoStart, accumulatedMs (current phase), workMs, breakMs,
//   workIntervals, breaks, wallStart, taskId?, newActivityName?, config, reminded,
//   clockJumpDetected?. The persisted form is the state itself.
// - switchPhase / pauseRun / resumeRun take an explicit monotonic `at` (ms).
// - A switch always starts the new phase running (the taps are "Start break" / "Start work").
// - canFinish(state, clocks) is a function.
// - applyActions(state, actions): actions are { type: 'pause' | 'resume' | 'switch', atElapsedMs }.
// - restoreRun(persisted, clocks): after a reboot the current phase's elapsed is
//   wall now - wallStart - workMs - breakMs.
// - finishRun flags a clock jump only when the state carries one (breaks and pauses make the
//   wall span longer than the work, so core's wall-vs-duration check does not apply).
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  applyActions,
  canFinish,
  finishRun,
  markReminded,
  pauseRun,
  phaseView,
  reminderDue,
  restoreRun,
  resumeRun,
  startRun,
  switchPhase,
  type PomodoroConfig,
  type PomodoroState,
} from '../timer/pomodoro';

const WALL0 = Date.UTC(2026, 10, 2, 9, 0, 0);
const MONO0 = 5_000_000;
const MIN = 60_000;

const CONFIG: PomodoroConfig = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
};

function makeClocks(wallNow = WALL0, monoNow = MONO0) {
  const clocks = {
    wallNow,
    monoNow,
    wall: () => clocks.wallNow,
    mono: () => clocks.monoNow,
    advance(ms: number) {
      clocks.wallNow += ms;
      clocks.monoNow += ms;
    },
  };
  return clocks;
}

type TestClocks = ReturnType<typeof makeClocks>;

function begin(clocks: TestClocks, config = CONFIG): PomodoroState {
  return startRun(config, { taskId: 7 }, clocks);
}

function advanceAndSwitch(state: PomodoroState, clocks: TestClocks, ms: number): PomodoroState {
  clocks.advance(ms);
  return switchPhase(state, clocks.mono());
}

describe('timer/pomodoro startRun', () => {
  it('starts running in a Work interval with nothing closed yet', () => {
    const clocks = makeClocks();
    const state = begin(clocks);

    expect(state.status).toBe('running');
    expect(state.phase).toBe('work');
    expect(state.wallStart).toBe(WALL0);
    expect(state.monoStart).toBe(MONO0);
    expect(state.accumulatedMs).toBe(0);
    expect(state.workMs).toBe(0);
    expect(state.breakMs).toBe(0);
    expect(state.workIntervals).toBe(0);
    expect(state.breaks).toBe(0);
    expect(state.taskId).toBe(7);
    expect(state.config).toEqual(CONFIG);
  });

  it('carries a new Activity name instead of a task id', () => {
    const clocks = makeClocks();
    const state = startRun(CONFIG, { newActivityName: 'Scales' }, clocks);

    expect(state.newActivityName).toBe('Scales');
    expect(state.taskId).toBeUndefined();
  });
});

describe('timer/pomodoro switchPhase', () => {
  it('closes a 27-minute Work interval and enters a Break', () => {
    const clocks = makeClocks();
    const state = advanceAndSwitch(begin(clocks), clocks, 27 * MIN);

    expect(state.workIntervals).toBe(1);
    expect(state.workMs).toBe(27 * MIN);
    expect(state.phase).toBe('break');
    expect(state.status).toBe('running');
    expect(phaseView(state, clocks).elapsedMs).toBe(0);
  });

  it('closes a Break and goes back to work', () => {
    const clocks = makeClocks();
    let state = advanceAndSwitch(begin(clocks), clocks, 25 * MIN);
    state = advanceAndSwitch(state, clocks, 6 * MIN);

    expect(state.phase).toBe('work');
    expect(state.breaks).toBe(1);
    expect(state.breakMs).toBe(6 * MIN);
    expect(state.workMs).toBe(25 * MIN);
  });

  it('enters a long break on the 4th switch from work with longBreakEvery 4', () => {
    const clocks = makeClocks();
    let state = begin(clocks);
    const phasesAfterWork: string[] = [];

    for (let i = 0; i < 4; i += 1) {
      state = advanceAndSwitch(state, clocks, 25 * MIN);
      phasesAfterWork.push(state.phase);
      if (i < 3) state = advanceAndSwitch(state, clocks, 5 * MIN);
    }

    expect(phasesAfterWork).toEqual(['break', 'break', 'break', 'longBreak']);
    expect(state.workIntervals).toBe(4);
    expect(state.breaks).toBe(3);

    state = advanceAndSwitch(state, clocks, 15 * MIN);
    expect(state.phase).toBe('work');
    expect(state.breaks).toBe(4);
    expect(state.breakMs).toBe(3 * 5 * MIN + 15 * MIN);
  });

  it('follows longBreakEvery from the config', () => {
    const clocks = makeClocks();
    let state = begin(clocks, { ...CONFIG, longBreakEvery: 2 });

    state = advanceAndSwitch(state, clocks, MIN);
    expect(state.phase).toBe('break');
    state = advanceAndSwitch(state, clocks, MIN);
    state = advanceAndSwitch(state, clocks, MIN);
    expect(state.phase).toBe('longBreak');
  });

  it('closes a paused interval at its accumulated time and starts the next one running', () => {
    const clocks = makeClocks();
    let state = begin(clocks);
    clocks.advance(20 * MIN);
    state = pauseRun(state, clocks.mono());
    clocks.advance(10 * MIN);

    state = switchPhase(state, clocks.mono());
    expect(state.workMs).toBe(20 * MIN);
    expect(state.workIntervals).toBe(1);
    expect(state.phase).toBe('break');
    expect(state.status).toBe('running');

    clocks.advance(2 * MIN);
    expect(phaseView(state, clocks).elapsedMs).toBe(2 * MIN);
  });

  it('never mutates the state it is given', () => {
    const clocks = makeClocks();
    const state = begin(clocks);
    const before = JSON.parse(JSON.stringify(state));

    clocks.advance(MIN);
    switchPhase(state, clocks.mono());
    pauseRun(state, clocks.mono());
    markReminded(state);

    expect(state).toEqual(before);
  });
});

describe('timer/pomodoro pause and resume', () => {
  it('paused time counts toward neither work nor break', () => {
    const clocks = makeClocks();
    let state = begin(clocks);

    clocks.advance(10 * MIN);
    state = pauseRun(state, clocks.mono());
    expect(state.status).toBe('paused');
    clocks.advance(30 * MIN);
    state = resumeRun(state, clocks.mono());
    expect(state.status).toBe('running');
    expect(phaseView(state, clocks).elapsedMs).toBe(10 * MIN);

    state = advanceAndSwitch(state, clocks, 5 * MIN);
    expect(state.workMs).toBe(15 * MIN);

    clocks.advance(2 * MIN);
    state = pauseRun(state, clocks.mono());
    clocks.advance(20 * MIN);
    state = resumeRun(state, clocks.mono());
    state = advanceAndSwitch(state, clocks, 3 * MIN);
    expect(state.breakMs).toBe(5 * MIN);

    clocks.advance(4 * MIN);
    const result = finishRun(state, clocks);
    expect(result.durationSeconds).toBe((15 + 4) * 60);
    expect(result.pomodoroBreakSeconds).toBe(5 * 60);
  });

  it('pause freezes the phase view', () => {
    const clocks = makeClocks();
    let state = begin(clocks);
    clocks.advance(3 * MIN);
    state = pauseRun(state, clocks.mono());
    clocks.advance(10 * MIN);

    expect(phaseView(state, clocks).elapsedMs).toBe(3 * MIN);
  });
});

describe('timer/pomodoro phaseView and reminders', () => {
  it('reports remaining 0 and 5 minutes over at 30 min of a 25-min Work interval', () => {
    const clocks = makeClocks();
    const state = begin(clocks);
    clocks.advance(30 * MIN);

    expect(phaseView(state, clocks)).toEqual({
      phase: 'work',
      elapsedMs: 30 * MIN,
      targetMs: 25 * MIN,
      remainingMs: 0,
      overMs: 5 * MIN,
    });
  });

  it('reports time remaining before the target', () => {
    const clocks = makeClocks();
    const state = begin(clocks);
    clocks.advance(10 * MIN);

    const view = phaseView(state, clocks);
    expect(view.remainingMs).toBe(15 * MIN);
    expect(view.overMs).toBe(0);
  });

  it('takes each phase target from the config', () => {
    const clocks = makeClocks();
    let state = begin(clocks, { ...CONFIG, longBreakEvery: 1 });
    state = advanceAndSwitch(state, clocks, MIN);
    expect(phaseView(state, clocks).targetMs).toBe(15 * MIN);

    const clocks2 = makeClocks();
    let state2 = begin(clocks2);
    state2 = advanceAndSwitch(state2, clocks2, MIN);
    expect(phaseView(state2, clocks2).targetMs).toBe(5 * MIN);
  });

  it('is due once per phase: true at the target, false after markReminded until the next phase', () => {
    const clocks = makeClocks();
    let state = begin(clocks);

    clocks.advance(24 * MIN);
    expect(reminderDue(state, clocks)).toBe(false);

    clocks.advance(MIN);
    expect(reminderDue(state, clocks)).toBe(true);

    clocks.advance(5 * MIN);
    expect(reminderDue(state, clocks)).toBe(true);
    state = markReminded(state);
    expect(reminderDue(state, clocks)).toBe(false);
    clocks.advance(10 * MIN);
    expect(reminderDue(state, clocks)).toBe(false);

    state = switchPhase(state, clocks.mono());
    expect(reminderDue(state, clocks)).toBe(false);
    clocks.advance(5 * MIN);
    expect(reminderDue(state, clocks)).toBe(true);
  });
});

describe('timer/pomodoro finishRun', () => {
  it('counts an open Work interval', () => {
    const clocks = makeClocks();
    let state = advanceAndSwitch(begin(clocks), clocks, 25 * MIN);
    state = advanceAndSwitch(state, clocks, 5 * MIN);
    clocks.advance(10 * MIN);

    const result = finishRun(state, clocks);
    expect(result.durationSeconds).toBe(35 * 60);
    expect(result.pomodoroWorkIntervals).toBe(2);
    expect(result.pomodoroBreaks).toBe(1);
    expect(result.pomodoroBreakSeconds).toBe(5 * 60);
    expect(result.startUtc).toBe(new Date(WALL0).toISOString());
    expect(result.endUtc).toBe(new Date(WALL0 + 40 * MIN).toISOString());
    expect(result.clockJumpDetected).toBe(false);
  });

  it('drops an open Break', () => {
    const clocks = makeClocks();
    let state = advanceAndSwitch(begin(clocks), clocks, 25 * MIN);
    clocks.advance(3 * MIN);

    const result = finishRun(state, clocks);
    expect(result.durationSeconds).toBe(25 * 60);
    expect(result.pomodoroWorkIntervals).toBe(1);
    expect(result.pomodoroBreaks).toBe(0);
    expect(result.pomodoroBreakSeconds).toBe(0);
  });

  it('reports seconds as floats', () => {
    const clocks = makeClocks();
    const state = begin(clocks);
    clocks.advance(1_500);

    expect(finishRun(state, clocks).durationSeconds).toBe(1.5);
  });

  it('canFinish is false with no work and true once work is logged', () => {
    const clocks = makeClocks();
    const state = begin(clocks);
    expect(canFinish(state, clocks)).toBe(false);

    clocks.advance(1_000);
    expect(canFinish(state, clocks)).toBe(true);
  });

  it('canFinish stays true during a Break after closed work, and false for a zero-length Work interval', () => {
    const clocks = makeClocks();
    const zeroWork = switchPhase(begin(clocks), clocks.mono());
    clocks.advance(MIN);
    expect(canFinish(zeroWork, clocks)).toBe(false);

    const clocks2 = makeClocks();
    const onBreak = advanceAndSwitch(begin(clocks2), clocks2, MIN);
    clocks2.advance(MIN);
    expect(canFinish(onBreak, clocks2)).toBe(true);
  });
});

describe('timer/pomodoro applyActions', () => {
  it('applies pause/resume/switch at their own times, matching direct calls', () => {
    const clocks = makeClocks();
    const state = begin(clocks);

    const t1 = MONO0 + 10 * MIN;
    const t2 = MONO0 + 15 * MIN;
    const t3 = MONO0 + 30 * MIN;
    const t4 = MONO0 + 36 * MIN;

    const direct = switchPhase(
      switchPhase(resumeRun(pauseRun(state, t1), t2), t3),
      t4
    );

    clocks.monoNow = MONO0 + 50 * MIN;
    clocks.wallNow = WALL0 + 50 * MIN;
    const applied = applyActions(state, [
      { type: 'pause', atElapsedMs: t1 },
      { type: 'resume', atElapsedMs: t2 },
      { type: 'switch', atElapsedMs: t3 },
      { type: 'switch', atElapsedMs: t4 },
    ]);

    expect(applied).toEqual(direct);
    expect(applied.workMs).toBe(25 * MIN);
    expect(applied.breakMs).toBe(6 * MIN);
    expect(applied.phase).toBe('work');
    expect(phaseView(applied, clocks).elapsedMs).toBe(14 * MIN);
  });

  it('returns the state unchanged for no actions', () => {
    const clocks = makeClocks();
    const state = begin(clocks);

    expect(applyActions(state, [])).toEqual(state);
  });
});

describe('timer/pomodoro restoreRun', () => {
  it('restores a running run whose monotonic clock kept going', () => {
    const clocks = makeClocks();
    let state = advanceAndSwitch(begin(clocks), clocks, 25 * MIN);
    clocks.advance(2 * MIN);
    const persisted = JSON.parse(JSON.stringify(state)) as PomodoroState;

    clocks.advance(MIN);
    const restored = restoreRun(persisted, clocks);

    expect(restored.status).toBe('running');
    expect(restored.phase).toBe('break');
    expect(phaseView(restored, clocks).elapsedMs).toBe(3 * MIN);
    expect(restored.clockJumpDetected).toBeFalsy();
  });

  it('restores a paused run without restarting it', () => {
    const clocks = makeClocks();
    let state = begin(clocks);
    clocks.advance(7 * MIN);
    state = pauseRun(state, clocks.mono());
    const persisted = JSON.parse(JSON.stringify(state)) as PomodoroState;

    const later = makeClocks(WALL0 + 60 * MIN, 50_000);
    const restored = restoreRun(persisted, later);

    expect(restored.status).toBe('paused');
    expect(phaseView(restored, later).elapsedMs).toBe(7 * MIN);
  });

  it('after a reboot keeps closed totals, takes the phase from the wall clock, and flags a clock jump', () => {
    const clocks = makeClocks();
    let state = advanceAndSwitch(begin(clocks), clocks, 25 * MIN);
    state = advanceAndSwitch(state, clocks, 5 * MIN);
    clocks.advance(4 * MIN);
    const persisted = JSON.parse(JSON.stringify(state)) as PomodoroState;

    // 45 wall-minutes into the run; the device rebooted, so the monotonic clock is far behind.
    const rebooted = makeClocks(WALL0 + 45 * MIN, 120_000);
    const restored = restoreRun(persisted, rebooted);

    expect(restored.status).toBe('running');
    expect(restored.phase).toBe('work');
    expect(restored.wallStart).toBe(WALL0);
    expect(restored.workMs).toBe(25 * MIN);
    expect(restored.breakMs).toBe(5 * MIN);
    expect(restored.workIntervals).toBe(1);
    expect(restored.breaks).toBe(1);
    expect(restored.clockJumpDetected).toBe(true);
    expect(phaseView(restored, rebooted).elapsedMs).toBe(15 * MIN);

    rebooted.advance(MIN);
    const result = finishRun(restored, rebooted);
    expect(result.durationSeconds).toBe(41 * 60);
    expect(result.pomodoroWorkIntervals).toBe(2);
    expect(result.clockJumpDetected).toBe(true);
  });
});

describe('timer/pomodoro purity', () => {
  it('imports nothing from react, react-native, or the native module', () => {
    const source = readFileSync(join(__dirname, '..', 'timer', 'pomodoro.ts'), 'utf8');

    expect(source).not.toMatch(/from\s+['"]react['"]/);
    expect(source).not.toMatch(/from\s+['"]react-native/);
    expect(source).not.toMatch(/from\s+['"][^'"]*native/i);
    expect(source).not.toMatch(/require\(\s*['"](react|react-native)/);
  });
});
