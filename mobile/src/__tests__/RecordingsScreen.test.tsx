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
jest.mock('../services/api', () => ({
  sessionAPI: { getAll: jest.fn(), delete: jest.fn() },
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
    is_on_calendar: false,
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
    await fireEvent.press(screen.getByTestId('picker-date-from'));
    mockPickerValue = new Date('2026-01-03T00:00:00.000Z');
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
});
