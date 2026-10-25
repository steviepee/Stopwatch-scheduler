import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ActivitiesScreen from '../app/(tabs)/activities';
import ActivityDetailScreen from '../app/activity/[id]';
import { formatElapsed } from '../timer/format';
import { taskAPI, timeLogAPI } from '../services/api';
import { USER_OPTIONS_KEY } from '../services/options';
import type { Task, TaskStats, TimeLog } from '../types';

// Both screens are exercised through the P8b contract: the tab list (name,
// average, count per row, "+" to create, tap to navigate, offline message on
// query error) and the activity/[id] detail route (the three taskAPI.getStats
// figures plus the last ten time logs). Navigation and data are mocked.
//
// B39 (D70) adds the quadrant picker and badge. The PRD gives this in prose
// only, so this session chose and documents the contract here for B39.impl:
//   - The detail screen fetches the Activity itself via `taskAPI.getById`
//     (query key ['task', id]) to read its current `is_urgent`/`is_important`,
//     alongside the existing stats/logs queries. It must tolerate that query
//     still being pending (the existing stats/logs-only tests below never
//     mock `getById`, so it resolves to `undefined`).
//   - A 2x2 grid, testIDs `quadrant-q1`..`quadrant-q4`, in D70's order: Q1
//     "Urgent & Important", Q2 "Important" (top row), Q3 "Urgent", Q4
//     "Neither" (bottom row). The cell matching the Activity's current flags
//     renders its label with a trailing " (current)" marker, following the
//     " (current)" convention B37 used for the active Activity in its picker.
//   - Tapping a cell calls `taskAPI.update(id, { is_urgent, is_important })`
//     with the pair for that quadrant (Q1 true/true, Q2 false/true, Q3
//     true/false, Q4 false/false).
//   - The list's badge is `activity-quadrant-<id>`, text "Q1"/"Q2"/"Q3"; a Q4
//     Activity (both flags false, including the default/missing case) renders
//     no such node at all.
jest.mock('../services/api', () => ({
  taskAPI: { getAll: jest.fn(), getById: jest.fn(), create: jest.fn(), update: jest.fn(), getStats: jest.fn() },
  timeLogAPI: { getAll: jest.fn() },
}));

const mockPush = jest.fn();
let mockSearchParams: { id: string } = { id: '7' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => mockSearchParams,
}));

const mockedGetAll = taskAPI.getAll as jest.Mock;
const mockedGetById = taskAPI.getById as jest.Mock;
const mockedCreate = taskAPI.create as jest.Mock;
// `update` is B39.impl's addition to taskAPI; it doesn't exist on the real
// module's type yet, so go through `unknown` rather than widen the import.
const mockedUpdate = (taskAPI as unknown as { update: jest.Mock }).update;
const mockedGetStats = taskAPI.getStats as jest.Mock;
const mockedLogsGetAll = timeLogAPI.getAll as jest.Mock;

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
  average_duration: 654,
  total_recordings: 5,
};

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function renderList() {
  return render(
    <QueryClientProvider client={client()}>
      <ActivitiesScreen />
    </QueryClientProvider>
  );
}

async function renderDetail() {
  return render(
    <QueryClientProvider client={client()}>
      <ActivityDetailScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockPush.mockReset();
  mockedGetAll.mockReset();
  mockedGetById.mockReset();
  mockedCreate.mockReset();
  mockedUpdate.mockReset();
  mockedGetStats.mockReset();
  mockedLogsGetAll.mockReset();
  mockSearchParams = { id: '7' };
});

describe('activities list', () => {
  it('renders name, formatted average, and recording count per row', async () => {
    mockedGetAll.mockResolvedValue([GYM, READING]);
    await renderList();

    await screen.findByText('Gym');
    expect(screen.getByText('Reading')).toBeTruthy();
    expect(screen.getByTestId('activity-average-7')).toHaveTextContent(formatElapsed(1800_000));
    expect(screen.getByTestId('activity-average-8')).toHaveTextContent(formatElapsed(654_000));
    expect(screen.getByTestId('activity-count-7')).toHaveTextContent('3');
    expect(screen.getByTestId('activity-count-8')).toHaveTextContent('5');
  });

  it('tapping a row navigates to the activity detail route', async () => {
    mockedGetAll.mockResolvedValue([GYM]);
    await renderList();

    await screen.findByText('Gym');
    await fireEvent.press(screen.getByTestId('activity-row-7'));

    expect(mockPush).toHaveBeenCalledWith('/activity/7');
  });

  it('shows the offline message instead of crashing when the query errors', async () => {
    mockedGetAll.mockRejectedValue(new Error('network down'));
    await renderList();

    await screen.findByText('Offline — showing nothing');
    expect(screen.queryByTestId('activity-row-7')).toBeNull();
  });
});

describe('quadrant badges (B39, D70)', () => {
  const Q1_TASK = { ...GYM, id: 10, name: 'Taxes', is_urgent: true, is_important: true };
  const Q2_TASK = { ...GYM, id: 11, name: 'Study', is_urgent: false, is_important: true };
  const Q3_TASK = { ...GYM, id: 12, name: 'Email', is_urgent: true, is_important: false };
  const Q4_TASK = { ...GYM, id: 13, name: 'Doodle', is_urgent: false, is_important: false };

  it('shows Q1-Q3 badges and no badge for Q4', async () => {
    mockedGetAll.mockResolvedValue([Q1_TASK, Q2_TASK, Q3_TASK, Q4_TASK]);
    await renderList();

    await screen.findByText('Taxes');
    expect(screen.getByTestId('activity-quadrant-10')).toHaveTextContent('Q1');
    expect(screen.getByTestId('activity-quadrant-11')).toHaveTextContent('Q2');
    expect(screen.getByTestId('activity-quadrant-12')).toHaveTextContent('Q3');
    expect(screen.queryByTestId('activity-quadrant-13')).toBeNull();
  });

  it('shows no badge for an Activity with neither flag set (the default)', async () => {
    mockedGetAll.mockResolvedValue([GYM]);
    await renderList();

    await screen.findByText('Gym');
    expect(screen.queryByTestId('activity-quadrant-7')).toBeNull();
  });
});

describe('create activity', () => {
  it('posts the typed name and refetches the list', async () => {
    mockedGetAll.mockResolvedValue([GYM]);
    mockedCreate.mockResolvedValue({ ...GYM, id: 9, name: 'Yoga', total_recordings: 0 });
    await renderList();

    await screen.findByText('Gym');
    await fireEvent.press(screen.getByTestId('btn-add-activity'));
    await fireEvent.changeText(screen.getByTestId('input-activity-name'), 'Yoga');
    await fireEvent.press(screen.getByTestId('btn-activity-save'));

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(mockedCreate).toHaveBeenCalledWith({ name: 'Yoga' });
    await waitFor(() => expect(mockedGetAll).toHaveBeenCalledTimes(2));
  });

  it('cancel closes the sheet without creating', async () => {
    mockedGetAll.mockResolvedValue([GYM]);
    await renderList();

    await screen.findByText('Gym');
    await fireEvent.press(screen.getByTestId('btn-add-activity'));
    await fireEvent.press(screen.getByTestId('btn-activity-cancel'));

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('input-activity-name')).toBeNull();
  });
});

describe('activity detail', () => {
  const STATS: TaskStats = { average: 1800, median: 900, previous: 1200 };

  function logAt(id: number, isoDate: string, duration = 300): TimeLog {
    return { id, task_id: 7, duration, created_at: isoDate };
  }

  beforeEach(async () => {
    // P20 defaults hide median/previous; this block predates that toggle and
    // asserts all three stat cards, so seed all three on for these tests.
    await AsyncStorage.setItem(
      USER_OPTIONS_KEY,
      JSON.stringify({ showAverage: true, showMedian: true, showPrevious: true })
    );
  });

  it('shows the three stats and the time logs', async () => {
    mockedGetStats.mockResolvedValue(STATS);
    mockedLogsGetAll.mockResolvedValue([
      logAt(1, '2026-01-01T00:00:00.000Z'),
      logAt(2, '2026-01-02T00:00:00.000Z'),
    ]);
    await renderDetail();

    await screen.findByTestId('stat-average');
    expect(mockedGetStats).toHaveBeenCalledWith(7);
    expect(mockedLogsGetAll).toHaveBeenCalledWith(7);
    expect(screen.getByTestId('stat-average')).toHaveTextContent(formatElapsed(1800_000));
    expect(screen.getByTestId('stat-median')).toHaveTextContent(formatElapsed(900_000));
    expect(screen.getByTestId('stat-previous')).toHaveTextContent(formatElapsed(1200_000));
    expect(screen.getByTestId('time-log-1')).toBeTruthy();
    expect(screen.getByTestId('time-log-2')).toBeTruthy();
  });

  it('renders a placeholder when median and previous are null', async () => {
    mockedGetStats.mockResolvedValue({ average: 1800, median: null, previous: null });
    mockedLogsGetAll.mockResolvedValue([]);
    await renderDetail();

    await screen.findByTestId('stat-average');
    expect(screen.getByTestId('stat-median')).toHaveTextContent('—');
    expect(screen.getByTestId('stat-previous')).toHaveTextContent('—');
  });

  it('shows only the ten most recent time logs', async () => {
    mockedGetStats.mockResolvedValue(STATS);
    const logs = Array.from({ length: 12 }, (_, i) =>
      logAt(i + 1, `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`)
    );
    mockedLogsGetAll.mockResolvedValue(logs);
    await renderDetail();

    await screen.findByTestId('time-log-12');
    for (let id = 3; id <= 12; id++) {
      expect(screen.getByTestId(`time-log-${id}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('time-log-1')).toBeNull();
    expect(screen.queryByTestId('time-log-2')).toBeNull();
  });

  it('reads the id from the route params', async () => {
    mockSearchParams = { id: '8' };
    mockedGetStats.mockResolvedValue(STATS);
    mockedLogsGetAll.mockResolvedValue([]);
    await renderDetail();

    await screen.findByTestId('stat-average');
    expect(mockedGetStats).toHaveBeenCalledWith(8);
    expect(mockedLogsGetAll).toHaveBeenCalledWith(8);
  });
});

describe('quadrant picker (B39, D70)', () => {
  const NEITHER = { ...GYM, is_urgent: false, is_important: false };
  const URGENT_AND_IMPORTANT = { ...GYM, is_urgent: true, is_important: true };
  const IMPORTANT = { ...GYM, is_urgent: false, is_important: true };

  beforeEach(() => {
    mockedGetStats.mockResolvedValue({ average: 1800, median: null, previous: null });
    mockedLogsGetAll.mockResolvedValue([]);
  });

  it('highlights the current quadrant from the Activity\'s flags', async () => {
    mockedGetById.mockResolvedValue(IMPORTANT);
    await renderDetail();

    await screen.findByText('Important (current)');
    expect(screen.queryByText('Urgent & Important (current)')).toBeNull();
    expect(screen.queryByText('Urgent (current)')).toBeNull();
    expect(screen.queryByText('Neither (current)')).toBeNull();
    expect(screen.getByTestId('quadrant-q1')).toBeTruthy();
    expect(screen.getByTestId('quadrant-q3')).toBeTruthy();
    expect(screen.getByTestId('quadrant-q4')).toBeTruthy();
  });

  it('sends the right flag pair for each cell', async () => {
    mockedGetById.mockResolvedValue(NEITHER);
    mockedUpdate.mockResolvedValue(NEITHER);
    await renderDetail();

    await screen.findByTestId('quadrant-q1');
    await fireEvent.press(screen.getByTestId('quadrant-q1'));
    await fireEvent.press(screen.getByTestId('quadrant-q2'));
    await fireEvent.press(screen.getByTestId('quadrant-q3'));
    await fireEvent.press(screen.getByTestId('quadrant-q4'));

    expect(mockedUpdate).toHaveBeenNthCalledWith(1, 7, { is_urgent: true, is_important: true });
    expect(mockedUpdate).toHaveBeenNthCalledWith(2, 7, { is_urgent: false, is_important: true });
    expect(mockedUpdate).toHaveBeenNthCalledWith(3, 7, { is_urgent: true, is_important: false });
    expect(mockedUpdate).toHaveBeenNthCalledWith(4, 7, { is_urgent: false, is_important: false });
  });

  it('highlights the new quadrant after a successful tap', async () => {
    mockedGetById.mockResolvedValueOnce(NEITHER).mockResolvedValueOnce(URGENT_AND_IMPORTANT);
    mockedUpdate.mockResolvedValue(URGENT_AND_IMPORTANT);
    await renderDetail();

    await screen.findByText('Neither (current)');
    await fireEvent.press(screen.getByTestId('quadrant-q1'));

    await screen.findByText('Urgent & Important (current)');
    expect(screen.queryByText('Neither (current)')).toBeNull();
  });
});
