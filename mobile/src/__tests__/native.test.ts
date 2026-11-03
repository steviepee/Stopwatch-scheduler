import { act, renderHook, waitFor } from '@testing-library/react-native';

import { usePomodoro, useTimer } from '../timer/store';

// Loaded once at the top, before any doMock below: the store runs on the real wrapper with no
// native module, so every native call is a no-op and the timers must still work.
describe('the timers without the native module', () => {
  const CONFIG = { workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 };

  it('useTimer starts, pauses, resumes and finishes', async () => {
    const view = await renderHook(() => useTimer());
    await waitFor(() => expect(view.result.current.hydrated).toBe(true));

    await act(async () => view.result.current.start());
    expect(view.result.current.status).toBe('running');
    await act(async () => view.result.current.pause());
    expect(view.result.current.status).toBe('paused');
    await act(async () => view.result.current.resume());
    expect(view.result.current.status).toBe('running');
    await act(async () => {
      view.result.current.finish();
    });
    expect(view.result.current.status).toBe('idle');
    await view.unmount();
  });

  it('usePomodoro starts, switches, pauses and resets', async () => {
    const view = await renderHook(() => usePomodoro());
    await waitFor(() => expect(view.result.current.hydrated).toBe(true));

    await act(async () => view.result.current.start(CONFIG, { taskId: 1 }));
    expect(view.result.current.phase).toBe('work');
    await act(async () => view.result.current.switchPhase());
    expect(view.result.current.phase).toBe('break');
    await act(async () => view.result.current.pause());
    expect(view.result.current.status).toBe('paused');
    await act(async () => view.result.current.resume());
    expect(view.result.current.status).toBe('running');
    await act(async () => view.result.current.reset());
    expect(view.result.current.status).toBe('idle');
    await view.unmount();
  });
});

describe('timer/native without the native module', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function loadWrapper() {
    return require('../timer/native') as typeof import('../timer/native');
  }

  it('reports the native module as unavailable', () => {
    expect(loadWrapper().isNativeAvailable()).toBe(false);
  });

  it('falls back to Date.now() for elapsedRealtime', () => {
    const before = Date.now();
    const value = loadWrapper().elapsedRealtime();
    const after = Date.now();

    expect(typeof value).toBe('number');
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });

  it('resolves the service calls without throwing', async () => {
    const native = loadWrapper();

    await expect(native.startForegroundService(native.elapsedRealtime())).resolves.toBeUndefined();
    await expect(native.stopForegroundService()).resolves.toBeUndefined();
  });

  it('reports no notification permission', async () => {
    await expect(loadWrapper().requestNotificationPermission()).resolves.toBe(false);
  });

  it('treats the B52 calls as no-ops', async () => {
    const native = loadWrapper();

    await expect(
      native.startForegroundService(native.elapsedRealtime(), {
        paused: true,
        pomodoro: { phase: 'work', phaseStartedAtElapsedMs: 0, phaseAccumulatedMs: 0, targetMs: 1 },
      })
    ).resolves.toBeUndefined();
    expect(native.drainActions()).toEqual([]);
    expect(() => native.notifyPhaseDue('work')).not.toThrow();
    const subscription = native.addTimerActionListener(() => {});
    expect(() => subscription.remove()).not.toThrow();
  });
});

// B52 (D88): the wrapper passes the service options through, drains the tapped actions, posts
// the reminder, and subscribes to the module's `onTimerAction` event with `addListener`.
// `addTimerActionListener(listener)` returns the module's subscription, or a no-op `{ remove }`
// when the module is absent or predates B52.
describe('timer/native with an older native module', () => {
  const olderModule = {
    elapsedRealtime: jest.fn(() => 12345),
    startForegroundService: jest.fn(),
    stopForegroundService: jest.fn(),
    requestNotificationPermissionAsync: jest.fn(async () => true),
  };

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../modules/timer-native/src/TimerNativeModule', () => ({
      __esModule: true,
      default: olderModule,
    }));
  });

  afterEach(() => {
    jest.dontMock('../../modules/timer-native/src/TimerNativeModule');
  });

  it('treats the calls it lacks as no-ops', () => {
    const native = require('../timer/native') as typeof import('../timer/native');

    expect(native.drainActions()).toEqual([]);
    expect(() => native.notifyPhaseDue('break')).not.toThrow();
    const subscription = native.addTimerActionListener(() => {});
    expect(() => subscription.remove()).not.toThrow();
  });
});

describe('timer/native with the native module', () => {
  const nativeModule = {
    elapsedRealtime: jest.fn(() => 12345),
    startForegroundService: jest.fn(),
    stopForegroundService: jest.fn(),
    requestNotificationPermissionAsync: jest.fn(async () => true),
    drainActions: jest.fn(() => [{ action: 'pause', atElapsedMs: 500 }]),
    notifyPhaseDue: jest.fn(),
    addListener: jest.fn((eventName: string, listener: () => void) => subscription),
  };
  const subscription = { remove: jest.fn() };

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../modules/timer-native/src/TimerNativeModule', () => ({
      __esModule: true,
      default: nativeModule,
    }));
  });

  afterEach(() => {
    jest.dontMock('../../modules/timer-native/src/TimerNativeModule');
  });

  function loadWrapper() {
    return require('../timer/native') as typeof import('../timer/native');
  }

  it('reports the native module as available', () => {
    expect(loadWrapper().isNativeAvailable()).toBe(true);
  });

  it('delegates to the native clock and service functions', async () => {
    const native = loadWrapper();

    expect(native.elapsedRealtime()).toBe(12345);

    await native.startForegroundService(999);
    expect(nativeModule.startForegroundService.mock.calls[0][0]).toBe(999);

    await native.stopForegroundService();
    expect(nativeModule.stopForegroundService).toHaveBeenCalled();

    await expect(native.requestNotificationPermission()).resolves.toBe(true);
  });

  it('passes the service options through', async () => {
    const native = loadWrapper();
    const options = {
      paused: true,
      pomodoro: {
        phase: 'break' as const,
        phaseStartedAtElapsedMs: 2_000,
        phaseAccumulatedMs: 60_000,
        targetMs: 300_000,
      },
    };

    await native.startForegroundService(1_000, options);

    expect(nativeModule.startForegroundService).toHaveBeenLastCalledWith(1_000, options);
  });

  it('delegates drainActions, notifyPhaseDue and the onTimerAction subscription', () => {
    const native = loadWrapper();
    const listener = jest.fn();

    expect(native.drainActions()).toEqual([{ action: 'pause', atElapsedMs: 500 }]);
    native.notifyPhaseDue('longBreak');
    expect(nativeModule.notifyPhaseDue).toHaveBeenCalledWith('longBreak');

    const result = native.addTimerActionListener(listener);
    expect(nativeModule.addListener).toHaveBeenCalledWith('onTimerAction', listener);
    result.remove();
    expect(subscription.remove).toHaveBeenCalled();
  });
});
