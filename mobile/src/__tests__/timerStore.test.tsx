import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { formatElapsed } from '../timer/format';
import { TIMER_STORAGE_KEY, useTimer } from '../timer/store';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../timer/native', () => ({
  isNativeAvailable: () => false,
  elapsedRealtime: () => mockClock.mono,
  startForegroundService: (startedAtElapsedMs: number) => mockStartService(startedAtElapsedMs),
  stopForegroundService: () => mockStopService(),
}));

const mockClock = { mono: 1_000_000 };
const mockStartService = jest.fn(async (startedAtElapsedMs: number) => {});
const mockStopService = jest.fn(async () => {});

async function mountTimer() {
  const view = await renderHook(() => useTimer());
  await waitFor(() => expect(view.result.current.hydrated).toBe(true));
  return view;
}

beforeEach(async () => {
  mockClock.mono = 1_000_000;
  mockStartService.mockClear();
  mockStopService.mockClear();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useTimer transitions', () => {
  it('starts, pauses and resumes, driving the foreground service', async () => {
    const view = await mountTimer();

    await act(async () => view.result.current.start());
    expect(view.result.current.status).toBe('running');
    expect(mockStartService).toHaveBeenCalledWith(1_000_000);

    mockClock.mono += 4_000;
    await act(async () => view.result.current.pause());
    expect(view.result.current.status).toBe('paused');
    expect(view.result.current.elapsedMs).toBe(4_000);
    expect(mockStopService).toHaveBeenCalledTimes(1);

    mockClock.mono += 10_000;
    await act(async () => view.result.current.resume());
    expect(view.result.current.status).toBe('running');
    expect(view.result.current.elapsedMs).toBe(4_000);
    expect(mockStartService).toHaveBeenLastCalledWith(1_010_000);
  });

  it('reset clears the stored state and stops the service', async () => {
    const view = await mountTimer();

    await act(async () => view.result.current.start());
    await waitFor(async () => expect(await AsyncStorage.getItem(TIMER_STORAGE_KEY)).not.toBeNull());

    await act(async () => view.result.current.reset());
    expect(view.result.current.status).toBe('idle');
    expect(view.result.current.elapsedMs).toBe(0);
    expect(mockStopService).toHaveBeenCalled();
    await waitFor(async () => expect(await AsyncStorage.getItem(TIMER_STORAGE_KEY)).toBeNull());
  });

  it('finish returns the recording and returns the timer to idle', async () => {
    const view = await mountTimer();

    await act(async () => view.result.current.start());
    mockClock.mono += 90_000;

    let recording: ReturnType<typeof view.result.current.finish> | undefined;
    await act(async () => {
      recording = view.result.current.finish();
    });

    expect(recording?.durationSeconds).toBe(90);
    expect(recording?.startUtc).toMatch(/Z$/);
    expect(view.result.current.status).toBe('idle');
  });
});

describe('useTimer persistence', () => {
  it('persists the four contract fields on every transition', async () => {
    const view = await mountTimer();

    await act(async () => view.result.current.start());
    await waitFor(async () => expect(await AsyncStorage.getItem(TIMER_STORAGE_KEY)).not.toBeNull());
    const running = JSON.parse((await AsyncStorage.getItem(TIMER_STORAGE_KEY)) as string);
    expect(Object.keys(running).sort()).toEqual([
      'accumulatedMs',
      'monoStart',
      'status',
      'wallStart',
    ]);
    expect(running.status).toBe('running');
    expect(running.monoStart).toBe(1_000_000);

    mockClock.mono += 7_000;
    await act(async () => view.result.current.pause());
    await waitFor(async () => {
      const raw = (await AsyncStorage.getItem(TIMER_STORAGE_KEY)) as string;
      expect(JSON.parse(raw).status).toBe('paused');
    });
    const paused = JSON.parse((await AsyncStorage.getItem(TIMER_STORAGE_KEY)) as string);
    expect(paused.accumulatedMs).toBe(7_000);
    expect(paused.monoStart).toBeNull();
  });

  it('restores a running timer after the hook remounts', async () => {
    const first = await mountTimer();
    await act(async () => first.result.current.start());
    await waitFor(async () => expect(await AsyncStorage.getItem(TIMER_STORAGE_KEY)).not.toBeNull());

    mockClock.mono += 5_000;
    await first.unmount();

    const second = await mountTimer();
    expect(second.result.current.status).toBe('running');
    expect(second.result.current.elapsedMs).toBe(5_000);

    mockClock.mono += 3_000;
    await act(async () => second.result.current.pause());
    expect(second.result.current.elapsedMs).toBe(8_000);
  });

  it('restores a paused timer as paused', async () => {
    const first = await mountTimer();
    await act(async () => first.result.current.start());
    mockClock.mono += 12_000;
    await act(async () => first.result.current.pause());
    await waitFor(async () => {
      const raw = (await AsyncStorage.getItem(TIMER_STORAGE_KEY)) as string;
      expect(JSON.parse(raw).status).toBe('paused');
    });
    await first.unmount();

    mockClock.mono += 60_000;
    const second = await mountTimer();
    expect(second.result.current.status).toBe('paused');
    expect(second.result.current.elapsedMs).toBe(12_000);
  });
});

describe('useTimer render interval', () => {
  it('ticks once per second while running and clears on pause and unmount', async () => {
    const view = await mountTimer();
    jest.useFakeTimers();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    await act(async () => view.result.current.start());
    expect(view.result.current.elapsedMs).toBe(0);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls[0][1]).toBe(1000);
    const runningInterval = setIntervalSpy.mock.results[0].value;

    mockClock.mono += 999;
    await act(async () => {
      jest.advanceTimersByTime(999);
    });
    expect(view.result.current.elapsedMs).toBe(0);

    mockClock.mono += 1;
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(view.result.current.elapsedMs).toBe(1_000);

    mockClock.mono += 1_000;
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(view.result.current.elapsedMs).toBe(2_000);

    await act(async () => view.result.current.pause());
    expect(clearIntervalSpy).toHaveBeenCalledWith(runningInterval);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    mockClock.mono += 5_000;
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(view.result.current.elapsedMs).toBe(2_000);

    await act(async () => view.result.current.resume());
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    const resumedInterval = setIntervalSpy.mock.results[1].value;

    await view.unmount();
    expect(clearIntervalSpy).toHaveBeenCalledWith(resumedInterval);
  });
});

describe('formatElapsed', () => {
  it('omits the hours below one hour', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9_400)).toBe('0:09');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_599_000)).toBe('59:59');
  });

  it('shows H:MM:SS from one hour', () => {
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
    expect(formatElapsed(36_000_000)).toBe('10:00:00');
  });
});
