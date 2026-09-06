import { readFileSync } from 'fs';
import { join } from 'path';

import {
  elapsedMs,
  finish,
  pause,
  reset,
  restore,
  resume,
  start,
  type TimerState,
} from '../timer/core';

const WALL0 = Date.UTC(2026, 8, 6, 12, 0, 0);
const MONO0 = 5_000_000;

const IDLE: TimerState = {
  status: 'idle',
  wallStart: null,
  monoStart: null,
  accumulatedMs: 0,
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

describe('timer/core state machine', () => {
  it('start puts an idle timer into running and anchors both clocks', () => {
    const clocks = makeClocks();
    const running = start(IDLE, clocks);

    expect(running.status).toBe('running');
    expect(running.wallStart).toBe(WALL0);
    expect(running.monoStart).toBe(MONO0);
    expect(running.accumulatedMs).toBe(0);
    expect(elapsedMs(running, clocks)).toBe(0);
  });

  it('never mutates the state it is given', () => {
    const clocks = makeClocks();
    const before = { ...IDLE };

    const running = start(IDLE, clocks);
    expect(IDLE).toEqual(before);
    expect(running).not.toBe(IDLE);

    const runningBefore = { ...running };
    clocks.advance(1000);
    const paused = pause(running, clocks);
    expect(running).toEqual(runningBefore);
    expect(paused).not.toBe(running);

    const pausedBefore = { ...paused };
    resume(paused, clocks);
    reset(paused, clocks);
    expect(paused).toEqual(pausedBefore);
  });

  it('elapsed grows with the monotonic clock, not the wall clock', () => {
    const clocks = makeClocks();
    const running = start(IDLE, clocks);

    clocks.monoNow += 5_000;
    clocks.wallNow += 60_000;

    expect(elapsedMs(running, clocks)).toBe(5_000);
  });

  it('pause freezes elapsed', () => {
    const clocks = makeClocks();
    const running = start(IDLE, clocks);
    clocks.advance(3_000);

    const paused = pause(running, clocks);
    expect(paused.status).toBe('paused');
    expect(elapsedMs(paused, clocks)).toBe(3_000);

    clocks.advance(10_000);
    expect(elapsedMs(paused, clocks)).toBe(3_000);
  });

  it('resume continues from where the pause left off', () => {
    const clocks = makeClocks();
    const running = start(IDLE, clocks);
    clocks.advance(3_000);
    const paused = pause(running, clocks);

    clocks.advance(10_000);
    const resumed = resume(paused, clocks);
    expect(resumed.status).toBe('running');
    expect(elapsedMs(resumed, clocks)).toBe(3_000);

    clocks.advance(2_000);
    expect(elapsedMs(resumed, clocks)).toBe(5_000);
  });

  it('resume keeps the original wall start so the recording keeps one start time', () => {
    const clocks = makeClocks();
    const running = start(IDLE, clocks);
    clocks.advance(3_000);
    const resumed = resume(pause(running, clocks), clocks);

    expect(resumed.wallStart).toBe(WALL0);
  });

  it('reset returns to idle', () => {
    const clocks = makeClocks();
    const running = start(IDLE, clocks);
    clocks.advance(9_000);

    const idle = reset(running, clocks);
    expect(idle.status).toBe('idle');
    expect(idle.wallStart).toBeNull();
    expect(idle.monoStart).toBeNull();
    expect(idle.accumulatedMs).toBe(0);
    expect(elapsedMs(idle, clocks)).toBe(0);
  });
});

describe('timer/core finish', () => {
  it('reports the duration in seconds as a float, not milliseconds', () => {
    const clocks = makeClocks();
    const running = start(IDLE, clocks);
    clocks.advance(1_500);

    expect(finish(running, clocks).durationSeconds).toBe(1.5);

    clocks.advance(88_500);
    expect(finish(running, clocks).durationSeconds).toBe(90);
  });

  it('finishes a paused recording with the elapsed it froze at', () => {
    const clocks = makeClocks();
    const running = start(IDLE, clocks);
    clocks.advance(45_000);
    const paused = pause(running, clocks);

    const result = finish(paused, clocks);
    expect(result.durationSeconds).toBe(45);
    expect(result.clockJumpDetected).toBe(false);
  });

  it('produces UTC ISO strings ending in Z', () => {
    const clocks = makeClocks();
    const running = start(IDLE, clocks);
    clocks.advance(60_000);

    const result = finish(running, clocks);
    expect(result.startUtc).toMatch(/Z$/);
    expect(result.endUtc).toMatch(/Z$/);
    expect(result.startUtc).toBe(new Date(WALL0).toISOString());
    expect(result.endUtc).toBe(new Date(WALL0 + 60_000).toISOString());
  });

  it('spans startUtc to endUtc by wall elapsed, not monotonic elapsed', () => {
    const clocks = makeClocks();
    const running = start(IDLE, clocks);

    clocks.monoNow += 60_000;
    clocks.wallNow += 3_600_000;

    const result = finish(running, clocks);
    expect(Date.parse(result.endUtc) - Date.parse(result.startUtc)).toBe(3_600_000);
    expect(result.durationSeconds).toBe(60);
  });

  it('does not flag a recording whose clocks agree', () => {
    const clocks = makeClocks();
    const running = start(IDLE, clocks);
    clocks.advance(600_000);

    expect(finish(running, clocks).clockJumpDetected).toBe(false);
  });

  it('keeps the duration when the wall clock jumps forward an hour mid-recording', () => {
    const clocks = makeClocks();
    const running = start(IDLE, clocks);
    clocks.advance(60_000);

    const withoutJump = finish(running, clocks);
    clocks.wallNow += 3_600_000;
    const withJump = finish(running, clocks);

    expect(withJump.durationSeconds).toBe(withoutJump.durationSeconds);
    expect(withJump.durationSeconds).toBe(60);
    expect(withJump.clockJumpDetected).toBe(true);
  });

  it('keeps the duration when the wall clock jumps backwards mid-recording', () => {
    const clocks = makeClocks();
    const running = start(IDLE, clocks);
    clocks.advance(120_000);

    clocks.wallNow -= 3_600_000;
    const result = finish(running, clocks);

    expect(result.durationSeconds).toBe(120);
    expect(result.durationSeconds).toBeGreaterThan(0);
    expect(result.clockJumpDetected).toBe(true);
  });

  it('tolerates drift of up to two seconds without flagging', () => {
    const clocks = makeClocks();
    const running = start(IDLE, clocks);
    clocks.advance(300_000);

    clocks.wallNow += 1_500;
    expect(finish(running, clocks).clockJumpDetected).toBe(false);

    clocks.wallNow += 2_000;
    expect(finish(running, clocks).clockJumpDetected).toBe(true);
  });
});

describe('timer/core restore', () => {
  it('restores a running timer whose monotonic clock kept going', () => {
    const clocks = makeClocks(WALL0 + 600_000, MONO0 + 600_000);

    const restored = restore(
      { status: 'running', wallStart: WALL0, monoStart: MONO0, accumulatedMs: 0 },
      clocks
    );

    expect(restored.status).toBe('running');
    expect(restored.wallStart).toBe(WALL0);
    expect(elapsedMs(restored, clocks)).toBe(600_000);
    expect(restored.clockJumpDetected).toBeFalsy();

    clocks.advance(5_000);
    expect(elapsedMs(restored, clocks)).toBe(605_000);
  });

  it('restores a paused timer without restarting it', () => {
    const clocks = makeClocks(WALL0 + 600_000, MONO0 + 600_000);

    const restored = restore(
      { status: 'paused', wallStart: WALL0, monoStart: null, accumulatedMs: 42_000 },
      clocks
    );

    expect(restored.status).toBe('paused');
    expect(elapsedMs(restored, clocks)).toBe(42_000);
  });

  it('falls back to the wall clock and flags the jump after a reboot', () => {
    // The recording started 15 wall-minutes ago; the device rebooted 2 minutes ago,
    // so the monotonic clock is now far behind the value it was anchored at.
    const clocks = makeClocks(WALL0 + 900_000, 120_000);

    const restored = restore(
      { status: 'running', wallStart: WALL0, monoStart: MONO0, accumulatedMs: 0 },
      clocks
    );

    expect(restored.status).toBe('running');
    expect(restored.wallStart).toBe(WALL0);
    expect(restored.clockJumpDetected).toBe(true);
    expect(elapsedMs(restored, clocks)).toBe(900_000);

    clocks.advance(30_000);
    expect(elapsedMs(restored, clocks)).toBe(930_000);
  });

  it('carries the reboot jump flag through to finish', () => {
    const clocks = makeClocks(WALL0 + 900_000, 120_000);

    const restored = restore(
      { status: 'running', wallStart: WALL0, monoStart: MONO0, accumulatedMs: 0 },
      clocks
    );
    const result = finish(restored, clocks);

    expect(result.durationSeconds).toBe(900);
    expect(result.startUtc).toBe(new Date(WALL0).toISOString());
    expect(result.clockJumpDetected).toBe(true);
  });
});

describe('timer/core purity', () => {
  it('imports nothing from react, react-native, or the native module', () => {
    const source = readFileSync(join(__dirname, '..', 'timer', 'core.ts'), 'utf8');

    expect(source).not.toMatch(/from\s+['"]react['"]/);
    expect(source).not.toMatch(/from\s+['"]react-native/);
    expect(source).not.toMatch(/from\s+['"][^'"]*native/i);
    expect(source).not.toMatch(/require\(\s*['"](react|react-native)/);
  });
});
