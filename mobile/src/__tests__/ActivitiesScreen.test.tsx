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
jest.mock('../services/api', () => ({
  taskAPI: { getAll: jest.fn(), create: jest.fn(), getStats: jest.fn() },
  timeLogAPI: { getAll: jest.fn() },
}));

const mockPush = jest.fn();
let mockSearchParams: { id: string } = { id: '7' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => mockSearchParams,
}));

const mockedGetAll = taskAPI.getAll as jest.Mock;
const mockedCreate = taskAPI.create as jest.Mock;
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
  mockedCreate.mockReset();
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
