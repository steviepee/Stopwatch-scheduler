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
});

describe('timer/native with the native module', () => {
  const nativeModule = {
    elapsedRealtime: jest.fn(() => 12345),
    startForegroundService: jest.fn(),
    stopForegroundService: jest.fn(),
    requestNotificationPermissionAsync: jest.fn(async () => true),
  };

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
    expect(nativeModule.startForegroundService).toHaveBeenCalledWith(999);

    await native.stopForegroundService();
    expect(nativeModule.stopForegroundService).toHaveBeenCalled();

    await expect(native.requestNotificationPermission()).resolves.toBe(true);
  });
});
