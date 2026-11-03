// B55 contract for frontend/src/utils/pomodoro.ts: mobile's B49 core (mobile/src/timer/pomodoro.ts)
// copied and adapted for the web. Pure: no React, no I/O, no localStorage.
// Adaptations pinned here:
// - `Date.now()` is the only clock. No function takes `Clocks` or an `at`; each reads Date.now().
//   Tests move it with `vi.setSystemTime`.
// - startRun(config, activity); config is { workMinutes, breakMinutes, longBreakMinutes,
//   longBreakEvery } and activity is { taskId } or { newActivityName }.
// - State fields asserted here: status, phase, workMs, breakMs, workIntervals, breaks, wallStart,
//   taskId?, newActivityName?, config. The current phase's start and accumulated ms are the
//   implementation's to name. The state is plain JSON (it is what goes to localStorage).
// - switchPhase(state), pauseRun(state), resumeRun(state), phaseView(state), reminderDue(state),
//   markReminded(state), canFinish(state), finishRun(state). Same rules as B49: a switch starts
//   the next phase running, closes a paused interval at its accumulated time, and enters
//   `longBreak` when workIntervals % longBreakEvery === 0.
// - finishRun returns { durationSeconds, startTime, endTime, pomodoroWorkIntervals,
//   pomodoroBreaks, pomodoroBreakSeconds }; startTime/endTime are ISO strings (UTC, `Z`).
// - No applyActions and no reboot restore: those are phone-only (native taps, monotonic clock).
import { readFileSync } from 'fs';
import { join } from 'path';
import { vi } from 'vitest';

import {
  canFinish,
  finishRun,
  markReminded,
  pauseRun,
  phaseView,
  reminderDue,
  resumeRun,
  startRun,
  switchPhase,
  type PomodoroConfig,
  type PomodoroState,
} from '../utils/pomodoro';

const T0 = Date.UTC(2026, 10, 3, 9, 0, 0);
const MIN = 60_000;

const CONFIG: PomodoroConfig = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
};

function advance(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

function begin(config = CONFIG): PomodoroState {
  return startRun(config, { taskId: 7 });
}

function advanceAndSwitch(state: PomodoroState, ms: number): PomodoroState {
  advance(ms);
  return switchPhase(state);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('utils/pomodoro startRun', () => {
  it('starts running in a Work interval with nothing closed yet', () => {
    const state = begin();

    expect(state.status).toBe('running');
    expect(state.phase).toBe('work');
    expect(state.wallStart).toBe(T0);
    expect(state.workMs).toBe(0);
    expect(state.breakMs).toBe(0);
    expect(state.workIntervals).toBe(0);
    expect(state.breaks).toBe(0);
    expect(state.taskId).toBe(7);
    expect(state.config).toEqual(CONFIG);
    expect(phaseView(state).elapsedMs).toBe(0);
  });

  it('carries a new Activity name instead of a task id', () => {
    const state = startRun(CONFIG, { newActivityName: 'Scales' });

    expect(state.newActivityName).toBe('Scales');
    expect(state.taskId).toBeUndefined();
  });

  it('is plain JSON: a round trip through JSON keeps it working', () => {
    let state = begin();
    advance(3 * MIN);
    state = JSON.parse(JSON.stringify(state)) as PomodoroState;

    expect(phaseView(state).elapsedMs).toBe(3 * MIN);
  });
});

describe('utils/pomodoro switchPhase', () => {
  it('closes a 27-minute Work interval and enters a Break', () => {
    const state = advanceAndSwitch(begin(), 27 * MIN);

    expect(state.workIntervals).toBe(1);
    expect(state.workMs).toBe(27 * MIN);
    expect(state.phase).toBe('break');
    expect(state.status).toBe('running');
    expect(phaseView(state).elapsedMs).toBe(0);
  });

  it('closes a Break and goes back to work', () => {
    let state = advanceAndSwitch(begin(), 25 * MIN);
    state = advanceAndSwitch(state, 6 * MIN);

    expect(state.phase).toBe('work');
    expect(state.breaks).toBe(1);
    expect(state.breakMs).toBe(6 * MIN);
    expect(state.workMs).toBe(25 * MIN);
  });

  it('enters a long break on the 4th switch from work with longBreakEvery 4', () => {
    let state = begin();
    const phasesAfterWork: string[] = [];

    for (let i = 0; i < 4; i += 1) {
      state = advanceAndSwitch(state, 25 * MIN);
      phasesAfterWork.push(state.phase);
      if (i < 3) state = advanceAndSwitch(state, 5 * MIN);
    }

    expect(phasesAfterWork).toEqual(['break', 'break', 'break', 'longBreak']);
    expect(state.workIntervals).toBe(4);
    expect(state.breaks).toBe(3);

    state = advanceAndSwitch(state, 15 * MIN);
    expect(state.phase).toBe('work');
    expect(state.breaks).toBe(4);
    expect(state.breakMs).toBe(3 * 5 * MIN + 15 * MIN);
  });

  it('follows longBreakEvery from the config', () => {
    let state = begin({ ...CONFIG, longBreakEvery: 2 });

    state = advanceAndSwitch(state, MIN);
    expect(state.phase).toBe('break');
    state = advanceAndSwitch(state, MIN);
    state = advanceAndSwitch(state, MIN);
    expect(state.phase).toBe('longBreak');
  });

  it('closes a paused interval at its accumulated time and starts the next one running', () => {
    let state = begin();
    advance(20 * MIN);
    state = pauseRun(state);
    advance(10 * MIN);

    state = switchPhase(state);
    expect(state.workMs).toBe(20 * MIN);
    expect(state.workIntervals).toBe(1);
    expect(state.phase).toBe('break');
    expect(state.status).toBe('running');

    advance(2 * MIN);
    expect(phaseView(state).elapsedMs).toBe(2 * MIN);
  });

  it('never mutates the state it is given', () => {
    const state = begin();
    const before = JSON.parse(JSON.stringify(state));

    advance(MIN);
    switchPhase(state);
    pauseRun(state);
    markReminded(state);

    expect(state).toEqual(before);
  });
});

describe('utils/pomodoro pause and resume', () => {
  it('paused time counts toward neither work nor break', () => {
    let state = begin();

    advance(10 * MIN);
    state = pauseRun(state);
    expect(state.status).toBe('paused');
    advance(30 * MIN);
    state = resumeRun(state);
    expect(state.status).toBe('running');
    expect(phaseView(state).elapsedMs).toBe(10 * MIN);

    state = advanceAndSwitch(state, 5 * MIN);
    expect(state.workMs).toBe(15 * MIN);

    advance(2 * MIN);
    state = pauseRun(state);
    advance(20 * MIN);
    state = resumeRun(state);
    state = advanceAndSwitch(state, 3 * MIN);
    expect(state.breakMs).toBe(5 * MIN);

    advance(4 * MIN);
    const result = finishRun(state);
    expect(result.durationSeconds).toBe((15 + 4) * 60);
    expect(result.pomodoroBreakSeconds).toBe(5 * 60);
  });

  it('pause freezes the phase view', () => {
    let state = begin();
    advance(3 * MIN);
    state = pauseRun(state);
    advance(10 * MIN);

    expect(phaseView(state).elapsedMs).toBe(3 * MIN);
  });

  it('resume on a running run changes nothing', () => {
    const state = begin();
    advance(MIN);

    expect(resumeRun(state)).toEqual(state);
  });
});

describe('utils/pomodoro phaseView and reminders', () => {
  it('reports remaining 0 and 5 minutes over at 30 min of a 25-min Work interval', () => {
    const state = begin();
    advance(30 * MIN);

    expect(phaseView(state)).toEqual({
      phase: 'work',
      elapsedMs: 30 * MIN,
      targetMs: 25 * MIN,
      remainingMs: 0,
      overMs: 5 * MIN,
    });
  });

  it('reports time remaining before the target', () => {
    const state = begin();
    advance(10 * MIN);

    const view = phaseView(state);
    expect(view.remainingMs).toBe(15 * MIN);
    expect(view.overMs).toBe(0);
  });

  it('takes each phase target from the config', () => {
    let state = begin({ ...CONFIG, longBreakEvery: 1 });
    state = advanceAndSwitch(state, MIN);
    expect(phaseView(state).targetMs).toBe(15 * MIN);

    let state2 = begin();
    state2 = advanceAndSwitch(state2, MIN);
    expect(phaseView(state2).targetMs).toBe(5 * MIN);
  });

  it('is due once per phase: true at the target, false after markReminded until the next phase', () => {
    let state = begin();

    advance(24 * MIN);
    expect(reminderDue(state)).toBe(false);

    advance(MIN);
    expect(reminderDue(state)).toBe(true);

    advance(5 * MIN);
    expect(reminderDue(state)).toBe(true);
    state = markReminded(state);
    expect(reminderDue(state)).toBe(false);
    advance(10 * MIN);
    expect(reminderDue(state)).toBe(false);

    state = switchPhase(state);
    expect(reminderDue(state)).toBe(false);
    advance(5 * MIN);
    expect(reminderDue(state)).toBe(true);
  });
});

describe('utils/pomodoro finishRun', () => {
  it('counts an open Work interval', () => {
    let state = advanceAndSwitch(begin(), 25 * MIN);
    state = advanceAndSwitch(state, 5 * MIN);
    advance(10 * MIN);

    const result = finishRun(state);
    expect(result.durationSeconds).toBe(35 * 60);
    expect(result.pomodoroWorkIntervals).toBe(2);
    expect(result.pomodoroBreaks).toBe(1);
    expect(result.pomodoroBreakSeconds).toBe(5 * 60);
    expect(result.startTime).toBe(new Date(T0).toISOString());
    expect(result.endTime).toBe(new Date(T0 + 40 * MIN).toISOString());
  });

  it('drops an open Break', () => {
    const state = advanceAndSwitch(begin(), 25 * MIN);
    advance(3 * MIN);

    const result = finishRun(state);
    expect(result.durationSeconds).toBe(25 * 60);
    expect(result.pomodoroWorkIntervals).toBe(1);
    expect(result.pomodoroBreaks).toBe(0);
    expect(result.pomodoroBreakSeconds).toBe(0);
  });

  it('reports seconds as floats', () => {
    const state = begin();
    advance(1_500);

    expect(finishRun(state).durationSeconds).toBe(1.5);
  });

  it('canFinish is false with no work and true once work is logged', () => {
    const state = begin();
    expect(canFinish(state)).toBe(false);

    advance(1_000);
    expect(canFinish(state)).toBe(true);
  });

  it('canFinish stays true during a Break after closed work, and false for a zero-length Work interval', () => {
    const zeroWork = switchPhase(begin());
    advance(MIN);
    expect(canFinish(zeroWork)).toBe(false);

    const onBreak = advanceAndSwitch(begin(), MIN);
    advance(MIN);
    expect(canFinish(onBreak)).toBe(true);
  });
});

describe('utils/pomodoro purity', () => {
  it('imports nothing from react and touches no storage', () => {
    const source = readFileSync(join(__dirname, '..', 'utils', 'pomodoro.ts'), 'utf8');

    expect(source).not.toMatch(/from\s+['"]react/);
    expect(source).not.toMatch(/localStorage/);
    expect(source).not.toMatch(/from\s+['"][^'"]*services/);
  });
});
