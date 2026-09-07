import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import StopwatchScreen from '../app/(tabs)/index';
import type { FinishedRecording } from '../timer/core';
import { formatElapsed } from '../timer/format';
import { useTimer } from '../timer/store';
import { useCreateSession } from '../services/mutations';
import { taskAPI } from '../services/api';
import type { Task } from '../types';

// The screen composes the already-implemented timer store and mutation hook;
// this suite only specifies the screen's own behaviour, so both are mocked.
jest.mock('../timer/store', () => ({
  useTimer: jest.fn(),
}));

jest.mock('../services/mutations', () => ({
  useCreateSession: jest.fn(),
}));

jest.mock('../services/api', () => ({
  taskAPI: { getAll: jest.fn() },
}));

const mockedUseTimer = useTimer as jest.Mock;
const mockedUseCreateSession = useCreateSession as jest.Mock;
const mockedGetAll = taskAPI.getAll as jest.Mock;

const GYM: Task = {
  id: 7,
  name: 'Gym',
  average_duration: 1800,
  total_recordings: 3,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const READING: Task = {
  ...GYM,
  id: 8,
  name: 'Reading',
};

const FINISH_RESULT: FinishedRecording = {
  durationSeconds: 754.5,
  startUtc: '2026-09-06T12:00:00.000Z',
  endUtc: '2026-09-06T12:12:34.500Z',
  clockJumpDetected: false,
};

type TimerMock = ReturnType<typeof useTimer>;

function timerMock(overrides: Partial<TimerMock> = {}): TimerMock {
  return {
    status: 'idle',
    elapsedMs: 0,
    hydrated: true,
    start: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    reset: jest.fn(),
    finish: jest.fn(() => FINISH_RESULT),
    ...overrides,
  };
}

// RNTL v14's `render` is async, like `renderHook` (see timerStore.test.tsx) —
// callers must `await renderScreen()` before touching the `screen` singleton.
async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StopwatchScreen />
    </QueryClientProvider>
  );
}

function minDimension(style: unknown): number {
  const flat = (StyleSheet.flatten(style as never) ?? {}) as {
    minHeight?: number;
    height?: number;
  };
  const value = flat.minHeight ?? flat.height;
  return typeof value === 'number' ? value : 0;
}

beforeEach(() => {
  mockedGetAll.mockReset();
  mockedGetAll.mockResolvedValue([GYM]);
  mockedUseCreateSession.mockReturnValue({ mutate: jest.fn(), isPending: false });
});

describe('idle', () => {
  it('shows only Start', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'idle', elapsedMs: 0 }));
    await renderScreen();

    expect(screen.getByTestId('btn-start')).toBeTruthy();
    expect(screen.queryByTestId('btn-pause')).toBeNull();
    expect(screen.queryByTestId('btn-resume')).toBeNull();
    expect(screen.queryByTestId('btn-reset')).toBeNull();
    expect(screen.queryByTestId('btn-save-open')).toBeNull();
  });

  it('Start calls the hook', async () => {
    const timer = timerMock({ status: 'idle' });
    mockedUseTimer.mockReturnValue(timer);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-start'));
    expect(timer.start).toHaveBeenCalledTimes(1);
  });
});

describe('running', () => {
  it('shows the elapsed time and only Pause', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'running', elapsedMs: 65_000 }));
    await renderScreen();

    expect(screen.getByText(formatElapsed(65_000))).toBeTruthy();
    expect(screen.getByTestId('btn-pause')).toBeTruthy();
    expect(screen.queryByTestId('btn-start')).toBeNull();
    expect(screen.queryByTestId('btn-resume')).toBeNull();
    expect(screen.queryByTestId('btn-reset')).toBeNull();
    expect(screen.queryByTestId('btn-save-open')).toBeNull();
  });

  it('Pause calls the hook', async () => {
    const timer = timerMock({ status: 'running', elapsedMs: 5_000 });
    mockedUseTimer.mockReturnValue(timer);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-pause'));
    expect(timer.pause).toHaveBeenCalledTimes(1);
  });
});

describe('paused', () => {
  it('shows Resume and Reset but not Save when elapsed is zero', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 0 }));
    await renderScreen();

    expect(screen.getByTestId('btn-resume')).toBeTruthy();
    expect(screen.getByTestId('btn-reset')).toBeTruthy();
    expect(screen.queryByTestId('btn-save-open')).toBeNull();
    expect(screen.queryByTestId('btn-start')).toBeNull();
    expect(screen.queryByTestId('btn-pause')).toBeNull();
  });

  it('shows Save when elapsed is greater than zero', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    expect(screen.getByTestId('btn-save-open')).toBeTruthy();
  });

  it('Resume calls the hook', async () => {
    const timer = timerMock({ status: 'paused', elapsedMs: 1_000 });
    mockedUseTimer.mockReturnValue(timer);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-resume'));
    expect(timer.resume).toHaveBeenCalledTimes(1);
  });

  it('Reset calls the hook', async () => {
    const timer = timerMock({ status: 'paused', elapsedMs: 1_000 });
    mockedUseTimer.mockReturnValue(timer);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-reset'));
    expect(timer.reset).toHaveBeenCalledTimes(1);
  });
});

describe('accessibility', () => {
  it('every button has accessibilityRole="button" and a hit area of at least 44', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await screen.findByTestId('btn-save-confirm');

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((button) => {
      expect(button.props.accessibilityRole).toBe('button');
      expect(minDimension(button.props.style)).toBeGreaterThanOrEqual(44);
    });
  });
});

describe('save sheet', () => {
  it('opens with a name field and the Activity picker, "None" included', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));

    expect(screen.getByTestId('input-name')).toBeTruthy();
    expect(screen.getByTestId('activity-none')).toBeTruthy();
    await screen.findByText('Gym');
  });

  it('has no separate save-to-activity path', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await screen.findByText('Gym');

    expect(screen.queryByText(/add to activity/i)).toBeNull();
    expect(screen.queryByText(/save as recording/i)).toBeNull();
  });

  it('search narrows the Activity list', async () => {
    mockedGetAll.mockResolvedValue([GYM, READING]);
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await screen.findByText('Reading');

    await fireEvent.changeText(screen.getByTestId('activity-search'), 'gym');

    expect(screen.getByText('Gym')).toBeTruthy();
    expect(screen.queryByText('Reading')).toBeNull();
  });

  it('Cancel closes the sheet without saving', async () => {
    const timer = timerMock({ status: 'paused', elapsedMs: 1_000 });
    mockedUseTimer.mockReturnValue(timer);
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await screen.findByTestId('btn-cancel');
    await fireEvent.press(screen.getByTestId('btn-cancel'));

    expect(mutate).not.toHaveBeenCalled();
    expect(timer.finish).not.toHaveBeenCalled();
    expect(timer.reset).not.toHaveBeenCalled();
    expect(screen.queryByTestId('input-name')).toBeNull();
  });
});

describe('saving', () => {
  it('blank name + a chosen Activity saves with the Activity name and task_id', async () => {
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    const timer = timerMock({ status: 'paused', elapsedMs: 1_000 });
    mockedUseTimer.mockReturnValue(timer);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await screen.findByText('Gym');
    await fireEvent.press(screen.getByText('Gym'));
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    expect(timer.finish).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({
      name: 'Gym',
      task_id: GYM.id,
      duration: FINISH_RESULT.durationSeconds,
      start_time: FINISH_RESULT.startUtc,
      end_time: FINISH_RESULT.endUtc,
    });
  });

  it('blank name + no Activity saves with a date-time name and no task_id', async () => {
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    expect(mutate).toHaveBeenCalledTimes(1);
    const body = mutate.mock.calls[0][0];
    // Deterministic default name: the UTC startUtc as "YYYY-MM-DD HH:MM" (no locale APIs).
    expect(body.name).toBe('2026-09-06 12:00');
    expect(body.task_id).toBeUndefined();
  });

  it('a typed name overrides both defaults', async () => {
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await screen.findByText('Gym');
    await fireEvent.press(screen.getByText('Gym'));
    await fireEvent.changeText(screen.getByTestId('input-name'), 'Leg day');
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    const body = mutate.mock.calls[0][0];
    expect(body.name).toBe('Leg day');
    expect(body.task_id).toBe(GYM.id);
  });

  it('passes start_time, end_time and duration from finish() through unchanged', async () => {
    const finishResult: FinishedRecording = {
      durationSeconds: 42,
      startUtc: '2026-01-02T03:04:05.000Z',
      endUtc: '2026-01-02T03:04:47.000Z',
      clockJumpDetected: false,
    };
    const mutate = jest.fn();
    mockedUseCreateSession.mockReturnValue({ mutate, isPending: false });
    mockedUseTimer.mockReturnValue(
      timerMock({ status: 'paused', elapsedMs: 42_000, finish: jest.fn(() => finishResult) })
    );
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    const body = mutate.mock.calls[0][0];
    expect(body.start_time).toBe(finishResult.startUtc);
    expect(body.end_time).toBe(finishResult.endUtc);
    expect(body.duration).toBe(finishResult.durationSeconds);
  });

  it('resets the timer and closes the sheet after saving', async () => {
    const timer = timerMock({ status: 'paused', elapsedMs: 1_000 });
    mockedUseTimer.mockReturnValue(timer);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    expect(timer.reset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('input-name')).toBeNull());
  });
});

describe('save confirmation', () => {
  it('says "Saved" when there was no clock jump', async () => {
    mockedUseTimer.mockReturnValue(timerMock({ status: 'paused', elapsedMs: 1_000 }));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    await screen.findByTestId('save-confirmation');
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('mentions the clock moving when clockJumpDetected is true', async () => {
    mockedUseTimer.mockReturnValue(
      timerMock({
        status: 'paused',
        elapsedMs: 1_000,
        finish: jest.fn(() => ({ ...FINISH_RESULT, clockJumpDetected: true })),
      })
    );
    await renderScreen();

    await fireEvent.press(screen.getByTestId('btn-save-open'));
    await fireEvent.press(screen.getByTestId('btn-save-confirm'));

    await screen.findByTestId('save-confirmation');
    expect(screen.getByText(/clock moved/i)).toBeTruthy();
  });
});
