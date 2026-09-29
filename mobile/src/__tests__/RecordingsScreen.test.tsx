import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';

import RecordingsScreen from '../app/(tabs)/recordings';
import { createQueryClient } from '../services/queryClient';
import { useCreateSession } from '../services/mutations';
import { sessionAPI, taskAPI } from '../services/api';
import type { StopwatchSession, Task } from '../types';

// P8c contract: `src/app/(tabs)/recordings.tsx` lists sessions newest first
// with name/duration/date/activity name, a client-side search filter, a
// client-side date-range filter, long-press delete, and "pending" rows
// sourced from the mutation cache (not only optimistic `['sessions']` rows,
// since a mutation restored after process death carries no optimistic row).
//
// B9 contract (hand-entered Recording, D47): an "Add manually" button
// (`btn-add-manual`) opens a form (`manual-form`) with a name (`manual-name`),
// an optional Activity picker like the stopwatch save's (`manual-activity-search`,
// `manual-activity-none`, one `manual-activity-{id}` row per Activity), a
// duration in hours and minutes (`manual-hours`, `manual-minutes`), and a start
// date and time (PickerFields `manual-start-date` and `manual-start-time`). The
// start prefills to now minus the duration and follows the duration until the
// user picks a start date or time; after that it stays put. Save
// (`btn-manual-save`) calls `sessionAPI.create` directly (not the offline queue,
// so a failure is visible) with `name`, `duration` in seconds, `start_time`,
// `end_time` = start + duration, both UTC `Z`, and `task_id` only when an
// Activity is chosen. Save is disabled at zero duration. A failed save shows
// `manual-save-error` and keeps the form and its values.
jest.mock('../services/api', () => ({
  sessionAPI: { getAll: jest.fn(), delete: jest.fn(), create: jest.fn() },
  taskAPI: { getAll: jest.fn() },
}));

let mockPickerValue = new Date('2026-01-01T00:00:00.000Z');
jest.mock('@react-native-community/datetimepicker', () => {
  const RN = require('react-native');
  const ReactLib = require('react');
  return {
    __esModule: true,
    default: ({ testID, onChange }: { testID: string; onChange: (e: unknown, d: Date) => void }) =>
      ReactLib.createElement(RN.Pressable, {
        testID,
        accessibilityRole: 'button',
        onPress: () => onChange({ type: 'set' }, mockPickerValue),
      }),
  };
});

const mockedGetAll = sessionAPI.getAll as jest.Mock;
const mockedDelete = sessionAPI.delete as jest.Mock;
const mockedCreate = sessionAPI.create as jest.Mock;
const mockedTasksGetAll = taskAPI.getAll as jest.Mock;

const GYM: Task = {
  id: 7,
  name: 'Gym',
  average_duration: 1800,
  total_recordings: 3,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const READING: Task = { ...GYM, id: 8, name: 'Reading', average_duration: 900, total_recordings: 5 };

function session(overrides: Partial<StopwatchSession>): StopwatchSession {
  return {
    id: 1,
    name: 'Session',
    duration: 300,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const READING_SESSION = session({ id: 1, name: 'Reading', duration: 900, task_id: 8, created_at: '2026-01-01T10:00:00.000Z' });
const GYM_SESSION = session({ id: 2, name: 'Gym', duration: 1800, task_id: 7, created_at: '2026-01-03T10:00:00.000Z' });
const BREAK_SESSION = session({ id: 3, name: 'Quick Break', duration: 300, created_at: '2026-01-02T10:00:00.000Z' });

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function renderScreen(queryClient: QueryClient = client()) {
  const view = await render(
    <QueryClientProvider client={queryClient}>
      <RecordingsScreen />
    </QueryClientProvider>
  );
  return { view, queryClient };
}

beforeEach(() => {
  mockedGetAll.mockReset();
  mockedDelete.mockReset();
  mockedCreate.mockReset();
  mockedTasksGetAll.mockReset();
  mockedTasksGetAll.mockResolvedValue([GYM, READING]);
  mockPickerValue = new Date('2026-01-01T00:00:00.000Z');
  onlineManager.setOnline(true);
});

describe('recordings list', () => {
  it('renders newest first with name, duration, date, and activity name', async () => {
    mockedGetAll.mockResolvedValue([READING_SESSION, GYM_SESSION, BREAK_SESSION]);
    await renderScreen();

    await screen.findByTestId('session-row-2');
    const rows = screen.getAllByTestId(/^session-row-\d+$/);
    expect(rows.map((r) => r.props.testID)).toEqual(['session-row-2', 'session-row-3', 'session-row-1']);

    expect(screen.getByTestId('session-name-2')).toHaveTextContent('Gym');
    expect(screen.getByTestId('session-duration-2')).toHaveTextContent('30:00');
    expect(screen.getByTestId('session-date-2')).toHaveTextContent('2026-01-03');
    expect(screen.getByTestId('session-activity-2')).toHaveTextContent('Gym');

    expect(screen.getByTestId('session-activity-3')).toHaveTextContent('—');
  });
});

describe('recordings search', () => {
  it('narrows the list by name and clearing restores it', async () => {
    mockedGetAll.mockResolvedValue([READING_SESSION, GYM_SESSION, BREAK_SESSION]);
    await renderScreen();

    await screen.findByTestId('session-row-2');
    await fireEvent.changeText(screen.getByTestId('input-search'), 'gym');

    expect(screen.getByTestId('session-row-2')).toBeTruthy();
    expect(screen.queryByTestId('session-row-1')).toBeNull();
    expect(screen.queryByTestId('session-row-3')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('input-search'), '');

    expect(screen.getAllByTestId(/^session-row-\d+$/)).toHaveLength(3);
  });
});

describe('recordings date range', () => {
  it('excludes items outside the selected date range', async () => {
    mockedGetAll.mockResolvedValue([READING_SESSION, GYM_SESSION, BREAK_SESSION]);
    await renderScreen();

    await screen.findByTestId('session-row-2');

    mockPickerValue = new Date('2026-01-02T00:00:00.000Z');
    await fireEvent.press(screen.getByTestId('picker-date-from-open'));
    await fireEvent.press(screen.getByTestId('picker-date-from'));
    mockPickerValue = new Date('2026-01-03T00:00:00.000Z');
    await fireEvent.press(screen.getByTestId('picker-date-to-open'));
    await fireEvent.press(screen.getByTestId('picker-date-to'));

    expect(screen.getByTestId('session-row-2')).toBeTruthy();
    expect(screen.getByTestId('session-row-3')).toBeTruthy();
    expect(screen.queryByTestId('session-row-1')).toBeNull();
  });
});

describe('recordings delete', () => {
  it('long-press deletes via the API and removes the row', async () => {
    mockedGetAll.mockResolvedValueOnce([READING_SESSION, GYM_SESSION, BREAK_SESSION]);
    mockedGetAll.mockResolvedValueOnce([READING_SESSION, BREAK_SESSION]);
    mockedDelete.mockResolvedValue(undefined);
    await renderScreen();

    await screen.findByTestId('session-row-2');
    await fireEvent(screen.getByTestId('session-row-2'), 'longPress');

    expect(mockedDelete).toHaveBeenCalledWith(2);
    await waitFor(() => expect(screen.queryByTestId('session-row-2')).toBeNull());
  });
});

describe('recordings pending marker', () => {
  const wrapper = ({ children, queryClient }: { children: React.ReactNode; queryClient: QueryClient }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it('shows a paused createSession mutation as a pending row even with no optimistic row in the sessions cache', async () => {
    const qc = createQueryClient();
    mockedGetAll.mockResolvedValue([]);

    const hook = await renderHook(() => useCreateSession(), {
      wrapper: ({ children }) => wrapper({ children, queryClient: qc }),
    });
    onlineManager.setOnline(false);

    await act(async () => {
      hook.result.current.mutate({
        name: 'Yoga',
        duration: 600,
        start_time: '2026-01-04T08:00:00.000Z',
        end_time: '2026-01-04T08:10:00.000Z',
      });
    });
    await waitFor(() => expect(hook.result.current.isPaused).toBe(true));

    // Simulate a mutation restored after process death: no optimistic row.
    qc.setQueryData(['sessions'], []);

    await renderScreen(qc);

    await screen.findByText('Yoga');
    expect(screen.getByTestId(/^session-pending-/)).toBeTruthy();

    qc.getMutationCache().getAll().forEach((m) => m.destroy());
    qc.clear();
  });

  it('renders a live offline save once and does not crash on it', async () => {
    const qc = createQueryClient();
    mockedGetAll.mockResolvedValue([GYM_SESSION]);

    const hook = await renderHook(() => useCreateSession(), {
      wrapper: ({ children }) => wrapper({ children, queryClient: qc }),
    });
    onlineManager.setOnline(false);

    await act(async () => {
      hook.result.current.mutate({
        name: 'Deep work',
        duration: 600,
        start_time: '2026-09-08T08:00:00.000Z',
        end_time: '2026-09-08T08:10:00.000Z',
      });
    });
    await waitFor(() => expect(hook.result.current.isPaused).toBe(true));

    // The live offline state, left exactly as the mutation leaves it. An earlier
    // version wrote a partial row into ['sessions'] here, which crashed this
    // render on `created_at` and showed the recording twice.
    await renderScreen(qc);

    await screen.findByText('Deep work');
    expect(screen.getAllByText('Deep work')).toHaveLength(1);
    expect(screen.getAllByTestId(/^session-pending-/)).toHaveLength(1);

    qc.getMutationCache().getAll().forEach((m) => m.destroy());
    qc.clear();
  });
});

describe('hand-entered recording', () => {
  function manualClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  }

  async function openForm() {
    mockedGetAll.mockResolvedValue([]);
    await renderScreen(manualClient());
    await fireEvent.press(await screen.findByTestId('btn-add-manual'));
    await screen.findByTestId('manual-form');
  }

  async function setDuration(hours: string, minutes: string) {
    await fireEvent.changeText(screen.getByTestId('manual-hours'), hours);
    await fireEvent.changeText(screen.getByTestId('manual-minutes'), minutes);
  }

  async function pickStart(local: Date) {
    mockPickerValue = local;
    await fireEvent.press(screen.getByTestId('manual-start-date-open'));
    await fireEvent.press(screen.getByTestId('manual-start-date'));
    await fireEvent.press(screen.getByTestId('manual-start-time-open'));
    await fireEvent.press(screen.getByTestId('manual-start-time'));
  }

  function sentBody() {
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    return mockedCreate.mock.calls[0][0];
  }

  it('prefills the start to now minus the duration and tracks duration changes', async () => {
    mockedCreate.mockResolvedValue(session({ id: 50 }));
    const before = Date.now();
    await openForm();

    await fireEvent.changeText(screen.getByTestId('manual-name'), 'Run');
    await setDuration('1', '30');
    await fireEvent.changeText(screen.getByTestId('manual-minutes'), '45');
    const after = Date.now();
    await fireEvent.press(screen.getByTestId('btn-manual-save'));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
    const body = sentBody();
    const durationMs = (1 * 3600 + 45 * 60) * 1000;
    expect(body.duration).toBe(6300);
    expect(body.start_time).toMatch(/Z$/);
    expect(body.end_time).toMatch(/Z$/);
    const start = new Date(body.start_time).getTime();
    // The start may be truncated to the minute.
    expect(start).toBeGreaterThanOrEqual(before - durationMs - 60_000);
    expect(start).toBeLessThanOrEqual(after - durationMs);
    expect(new Date(body.end_time).getTime() - start).toBe(durationMs);
  });

  it('stops tracking the duration once the user edits the start', async () => {
    mockedCreate.mockResolvedValue(session({ id: 51 }));
    await openForm();

    await fireEvent.changeText(screen.getByTestId('manual-name'), 'Run');
    await setDuration('0', '20');
    const picked = new Date(2026, 8, 27, 6, 15);
    await pickStart(picked);
    await setDuration('1', '0');
    await fireEvent.press(screen.getByTestId('btn-manual-save'));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
    const body = sentBody();
    expect(body.duration).toBe(3600);
    expect(body.start_time).toBe(picked.toISOString());
    expect(body.end_time).toBe(new Date(picked.getTime() + 3600_000).toISOString());
  });

  it('sends task_id when an Activity is chosen', async () => {
    mockedCreate.mockResolvedValue(session({ id: 52 }));
    await openForm();

    await fireEvent.changeText(screen.getByTestId('manual-name'), 'Leg day');
    await fireEvent.press(await screen.findByTestId('manual-activity-7'));
    await setDuration('0', '40');
    const picked = new Date(2026, 8, 28, 7, 0);
    await pickStart(picked);
    await fireEvent.press(screen.getByTestId('btn-manual-save'));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
    expect(sentBody()).toEqual({
      name: 'Leg day',
      duration: 2400,
      start_time: picked.toISOString(),
      end_time: new Date(picked.getTime() + 2400_000).toISOString(),
      task_id: 7,
    });
  });

  it('sends no task_id without an Activity', async () => {
    mockedCreate.mockResolvedValue(session({ id: 53 }));
    await openForm();

    await fireEvent.changeText(screen.getByTestId('manual-name'), 'Walk');
    await fireEvent.press(await screen.findByTestId('manual-activity-7'));
    await fireEvent.press(screen.getByTestId('manual-activity-none'));
    await setDuration('0', '15');
    const picked = new Date(2026, 8, 28, 12, 30);
    await pickStart(picked);
    await fireEvent.press(screen.getByTestId('btn-manual-save'));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
    const body = sentBody();
    expect(body).toEqual({
      name: 'Walk',
      duration: 900,
      start_time: picked.toISOString(),
      end_time: new Date(picked.getTime() + 900_000).toISOString(),
    });
    expect('task_id' in body).toBe(false);
  });

  it('disables Save at zero duration', async () => {
    await openForm();

    await fireEvent.changeText(screen.getByTestId('manual-name'), 'Nothing');
    await setDuration('0', '0');

    expect(screen.getByTestId('btn-manual-save')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('btn-manual-save'));
    expect(mockedCreate).not.toHaveBeenCalled();

    await setDuration('0', '5');
    expect(screen.getByTestId('btn-manual-save')).toBeEnabled();
  });

  it('shows an error on a failed save and keeps the form', async () => {
    mockedCreate.mockRejectedValue(new Error('Network Error'));
    await openForm();

    await fireEvent.changeText(screen.getByTestId('manual-name'), 'Swim');
    await setDuration('0', '30');
    await fireEvent.press(screen.getByTestId('btn-manual-save'));

    await screen.findByTestId('manual-save-error');
    expect(screen.getByTestId('manual-form')).toBeTruthy();
    expect(screen.getByTestId('manual-name').props.value).toBe('Swim');
    expect(screen.getByTestId('manual-minutes').props.value).toBe('30');
    expect(screen.getByTestId('btn-manual-save')).toBeEnabled();
  });
});
