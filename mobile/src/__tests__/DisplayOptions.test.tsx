import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SettingsScreen from '../app/settings';
import ActivitiesScreen from '../app/(tabs)/activities';
import ActivityDetailScreen from '../app/activity/[id]';
import ScheduleScreen from '../app/(tabs)/schedule';
import { formatElapsed } from '../timer/format';
import { taskAPI, timeLogAPI, scheduleAPI } from '../services/api';
import { USER_OPTIONS_KEY } from '../services/options';
import type { Task, TaskStats } from '../types';

// P20 contract: three Settings toggles (average/median/previous), persisted
// under the literal AsyncStorage key `userOptions` (`services/options.ts`'s
// `USER_OPTIONS_KEY`), defaulting to `{ showAverage: true, showMedian:
// false, showPrevious: false }`. They gate what activities.tsx's list row,
// activity/[id].tsx's three stat cards, and schedule.tsx's
// per-selected-activity duration hints render. Nothing server-side.
//
// activities.tsx already only ever rendered the average (no median/previous
// existed there before this task), so gating it there is a no-op in
// practice; included for completeness against the acceptance wording.
//
// activity/[id].tsx already renders all three stat cards unconditionally
// from one `taskAPI.getStats` call (P8b) — that single fetch stays
// unconditional here (it's one request either way), only the three cards'
// rendering is gated per toggle. NOTE for P20.impl: ActivitiesScreen.test.tsx's
// "activity detail" describe block never seeds `userOptions` and asserts all
// three stat testIDs render — under the new default (median/previous off)
// those assertions will fail unless that file's "activity detail" tests seed
// AsyncStorage with all three enabled first. That edit belongs to P20.impl
// (this is a `.tests`-only session for the new file), flagged in
// progress.md.
//
// schedule.tsx never had duration hints before this task — it only
// prefilled `input-duration-{id}` from `task.average_duration` once, on
// selection. This task adds `hint-average-{id}` / `hint-median-{id}` /
// `hint-previous-{id}` Text nodes under each selected row's duration input:
// the average hint reads the already-loaded `Task.average_duration`, no
// extra request; median/previous require `taskAPI.getStats(task.id)`,
// fetched only when at least one of those two is enabled — so the default
// (both off) makes no extra request, which is also why the existing
// ScheduleScreen.test.tsx's `taskAPI` mock (no `getStats`) stays valid
// unmodified.
jest.mock('../services/api', () => ({
  taskAPI: { getAll: jest.fn(), create: jest.fn(), getStats: jest.fn() },
  timeLogAPI: { getAll: jest.fn() },
  scheduleAPI: {
    getAll: jest.fn(),
    generate: jest.fn(),
    create: jest.fn(),
    addItem: jest.fn(),
    applyRegimen: jest.fn(),
  },
}));

jest.mock('../services/auth', () => ({
  getApiUrl: jest.fn().mockResolvedValue('http://192.168.0.5:8000/api'),
  setApiUrl: jest.fn(),
  getToken: jest.fn().mockResolvedValue('token'),
  setToken: jest.fn(),
}));

jest.mock('axios', () => {
  const instance = {
    interceptors: { request: { use: jest.fn() } },
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    defaults: {},
  };
  return { __esModule: true, default: { get: jest.fn(), create: () => instance } };
});

const mockPush = jest.fn();
let mockSearchParams: { id: string } = { id: '7' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('@react-native-community/datetimepicker', () => {
  const RN = require('react-native');
  const ReactLib = require('react');
  return {
    __esModule: true,
    default: ({ testID, onChange }: { testID: string; onChange: (e: unknown, d: Date) => void }) =>
      ReactLib.createElement(RN.Pressable, {
        testID,
        accessibilityRole: 'button',
        onPress: () => onChange({ type: 'set' }, new Date('2026-02-01T09:00:00.000Z')),
      }),
  };
});

const mockedGetAll = taskAPI.getAll as jest.Mock;
const mockedGetStats = taskAPI.getStats as jest.Mock;
const mockedLogsGetAll = timeLogAPI.getAll as jest.Mock;
const mockedSchedulesGetAll = scheduleAPI.getAll as jest.Mock;

const GYM: Task = {
  id: 7,
  name: 'Gym',
  average_duration: 1800,
  total_recordings: 3,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const STATS: TaskStats = { average: 1800, median: 900, previous: 1200 };

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderSettings(qc: QueryClient = client()) {
  return render(
    <QueryClientProvider client={qc}>
      <SettingsScreen />
    </QueryClientProvider>
  );
}

function renderActivities() {
  return render(
    <QueryClientProvider client={client()}>
      <ActivitiesScreen />
    </QueryClientProvider>
  );
}

function renderDetail() {
  return render(
    <QueryClientProvider client={client()}>
      <ActivityDetailScreen />
    </QueryClientProvider>
  );
}

function renderSchedule() {
  return render(
    <QueryClientProvider client={client()}>
      <ScheduleScreen />
    </QueryClientProvider>
  );
}

async function seedOptions(overrides: Partial<{ showAverage: boolean; showMedian: boolean; showPrevious: boolean }>) {
  await AsyncStorage.setItem(
    USER_OPTIONS_KEY,
    JSON.stringify({ showAverage: true, showMedian: false, showPrevious: false, ...overrides })
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockedGetAll.mockReset();
  mockedGetStats.mockReset();
  mockedLogsGetAll.mockReset();
  mockedSchedulesGetAll.mockReset();
  mockedGetAll.mockResolvedValue([GYM]);
  mockedGetStats.mockResolvedValue(STATS);
  mockedLogsGetAll.mockResolvedValue([]);
  mockedSchedulesGetAll.mockResolvedValue([]);
  mockPush.mockReset();
  mockSearchParams = { id: '7' };
});

describe('Settings toggle defaults', () => {
  it('defaults to average on, median and previous off when nothing is stored', async () => {
    await renderSettings();

    await waitFor(() => expect(screen.getByTestId('toggle-show-average')).toHaveProp('value', true));
    expect(screen.getByTestId('toggle-show-median')).toHaveProp('value', false);
    expect(screen.getByTestId('toggle-show-previous')).toHaveProp('value', false);
  });

  it('reads a previously stored preference instead of the default', async () => {
    await seedOptions({ showAverage: false, showMedian: true, showPrevious: true });
    await renderSettings();

    await waitFor(() => expect(screen.getByTestId('toggle-show-average')).toHaveProp('value', false));
    expect(screen.getByTestId('toggle-show-median')).toHaveProp('value', true);
    expect(screen.getByTestId('toggle-show-previous')).toHaveProp('value', true);
  });
});

describe('Settings toggle persistence', () => {
  it('persists a toggle change to AsyncStorage and survives a remount', async () => {
    const { unmount } = await renderSettings();
    await waitFor(() => expect(screen.getByTestId('toggle-show-median')).toHaveProp('value', false));

    fireEvent(screen.getByTestId('toggle-show-median'), 'valueChange', true);

    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(USER_OPTIONS_KEY);
      expect(raw && JSON.parse(raw).showMedian).toBe(true);
    });

    unmount();
    await renderSettings();

    await waitFor(() => expect(screen.getByTestId('toggle-show-median')).toHaveProp('value', true));
  });
});

describe('Activities list respects the average toggle', () => {
  it('shows the average by default', async () => {
    await renderActivities();

    await screen.findByText('Gym');
    expect(screen.getByTestId('activity-average-7')).toHaveTextContent(formatElapsed(1800_000));
  });

  it('hides the average when showAverage is off', async () => {
    await seedOptions({ showAverage: false });
    await renderActivities();

    await screen.findByText('Gym');
    expect(screen.queryByTestId('activity-average-7')).toBeNull();
  });
});

describe('Activity detail respects all three toggles', () => {
  it('shows only the enabled stat cards by default', async () => {
    await renderDetail();

    await screen.findByTestId('stat-average');
    expect(screen.queryByTestId('stat-median')).toBeNull();
    expect(screen.queryByTestId('stat-previous')).toBeNull();
  });

  it('shows all three when all three are enabled', async () => {
    await seedOptions({ showAverage: true, showMedian: true, showPrevious: true });
    await renderDetail();

    await screen.findByTestId('stat-average');
    expect(screen.getByTestId('stat-median')).toHaveTextContent(formatElapsed(900_000));
    expect(screen.getByTestId('stat-previous')).toHaveTextContent(formatElapsed(1200_000));
  });

  it('hides the average card when only median is enabled', async () => {
    await seedOptions({ showAverage: false, showMedian: true, showPrevious: false });
    await renderDetail();

    await screen.findByTestId('stat-median');
    expect(screen.queryByTestId('stat-average')).toBeNull();
  });
});

describe('Schedule tab duration hints follow the same setting', () => {
  it('shows only the average hint by default and requests no stats', async () => {
    await renderSchedule();
    await screen.findByText('Gym');

    fireEvent.press(screen.getByTestId('activity-row-7'));

    await waitFor(() => expect(screen.getByTestId('hint-average-7')).toHaveTextContent(formatElapsed(1800_000)));
    expect(screen.queryByTestId('hint-median-7')).toBeNull();
    expect(screen.queryByTestId('hint-previous-7')).toBeNull();
    expect(mockedGetStats).not.toHaveBeenCalled();
  });

  it('fetches and shows median and previous hints when enabled', async () => {
    await seedOptions({ showMedian: true, showPrevious: true });
    await renderSchedule();
    await screen.findByText('Gym');

    fireEvent.press(screen.getByTestId('activity-row-7'));

    await waitFor(() => expect(mockedGetStats).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.getByTestId('hint-median-7')).toHaveTextContent(formatElapsed(900_000)));
    expect(screen.getByTestId('hint-previous-7')).toHaveTextContent(formatElapsed(1200_000));
  });

  it('removes the hints when the activity is deselected', async () => {
    await seedOptions({ showMedian: true });
    await renderSchedule();
    await screen.findByText('Gym');

    fireEvent.press(screen.getByTestId('activity-row-7'));
    await waitFor(() => expect(screen.getByTestId('hint-median-7')).toBeTruthy());

    fireEvent.press(screen.getByTestId('activity-row-7'));
    expect(screen.queryByTestId('hint-median-7')).toBeNull();
  });
});
