import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ScheduleScreen from '../app/(tabs)/schedule';
import { taskAPI, scheduleAPI } from '../services/api';
import type { GenerateResponse, Schedule, StrategyOption, Task } from '../types';

// P8d contract: src/app/(tabs)/schedule.tsx is a three-step flow on one screen.
//
// Step 1 (setup): activities come from `['tasks']`; each selected row gets an
// editable `input-duration-{id}` seeded from its average_duration (seconds,
// matching the unit `estimated_duration` sends). A single `picker-start-time`
// and `picker-day-end` (mocked datetime pickers, same convention as
// RecordingsScreen's date-range pickers) supply the request's `start_time`
// and `day_end`; this screen sends `day_start` equal to `start_time` since
// the contract exposes no separate day-start control. `btn-generate` posts
// `scheduleAPI.generate` with the four known strategies. A rejected generate
// renders `btn-retry-generate` instead of crashing, and retry re-calls
// generate with the same request.
//
// Step 2 (options): one `option-card-{strategy}` per response option;
// `btn-select-{strategy}` chooses it, which is what mounts `btn-save`
// (Step 3) — mirroring the "elements exist only when reachable" convention
// used by the other P8 screens instead of a disabled prop.
//
// Step 3 (save): `input-schedule-name` (default: the date — untested here,
// tests type an explicit name for determinism), `checkbox-regimen` toggles
// `is_regimen`, `btn-save` calls `scheduleAPI.create` then `scheduleAPI.addItem`
// once per timeline entry of the selected option, in order, with
// `task_id`/`position`/`scheduled_time` from that entry.
//
// Regimens section: `['regimens']` via `scheduleAPI.getAll(true)`; each row
// is `regimen-row-{id}`, `btn-apply-{id}` reveals `picker-apply-{id}`, whose
// (mocked) onChange calls `scheduleAPI.applyRegimen(id, { target_date })`
// directly — no separate confirm step, same reveal-then-fire pattern as the
// Recordings date-range pickers.
jest.mock('../services/api', () => ({
  taskAPI: { getAll: jest.fn() },
  scheduleAPI: {
    getAll: jest.fn(),
    generate: jest.fn(),
    create: jest.fn(),
    addItem: jest.fn(),
    applyRegimen: jest.fn(),
  },
}));

let mockPickerValue = new Date('2026-02-01T09:00:00.000Z');
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

const mockedTasksGetAll = taskAPI.getAll as jest.Mock;
const mockedSchedulesGetAll = scheduleAPI.getAll as jest.Mock;
const mockedGenerate = scheduleAPI.generate as jest.Mock;
const mockedCreate = scheduleAPI.create as jest.Mock;
const mockedAddItem = scheduleAPI.addItem as jest.Mock;
const mockedApplyRegimen = scheduleAPI.applyRegimen as jest.Mock;

const GYM: Task = {
  id: 7,
  name: 'Gym',
  average_duration: 1800,
  total_recordings: 3,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const READING: Task = { ...GYM, id: 8, name: 'Reading', average_duration: 900, total_recordings: 5 };

function option(overrides: Partial<StrategyOption>): StrategyOption {
  return {
    strategy: 'your-order',
    label: 'Your Order',
    description: 'Keeps the order you picked',
    timeline: [],
    flagged: [],
    excluded: [],
    ...overrides,
  };
}

const REGIMEN: Schedule = {
  id: 99,
  name: 'Morning Routine',
  schedule_type: 'day',
  is_regimen: true,
  items: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function renderScreen() {
  return render(
    <QueryClientProvider client={client()}>
      <ScheduleScreen />
    </QueryClientProvider>
  );
}

async function selectActivity(id: number) {
  await fireEvent.press(screen.getByTestId(`activity-row-${id}`));
}

beforeEach(() => {
  mockedTasksGetAll.mockReset();
  mockedSchedulesGetAll.mockReset();
  mockedGenerate.mockReset();
  mockedCreate.mockReset();
  mockedAddItem.mockReset();
  mockedApplyRegimen.mockReset();
  mockedTasksGetAll.mockResolvedValue([GYM, READING]);
  mockedSchedulesGetAll.mockResolvedValue([]);
  mockPickerValue = new Date('2026-02-01T09:00:00.000Z');
});

describe('setup step', () => {
  it('pre-fills duration from the average and respects an edit in the request', async () => {
    mockedGenerate.mockResolvedValue({ options: [] } as GenerateResponse);
    await renderScreen();

    await screen.findByTestId('activity-row-7');
    await selectActivity(7);
    expect(screen.getByTestId('input-duration-7')).toHaveProp('value', '1800');

    await fireEvent.changeText(screen.getByTestId('input-duration-7'), '2400');
    await fireEvent.press(screen.getByTestId('btn-generate'));

    await waitFor(() => expect(mockedGenerate).toHaveBeenCalledTimes(1));
    const request = mockedGenerate.mock.calls[0][0];
    expect(request.activities).toEqual([
      expect.objectContaining({ task_id: 7, name: 'Gym', estimated_duration: 2400 }),
    ]);
  });

  it('calls generate with the four known strategies and UTC Z datetimes', async () => {
    mockedGenerate.mockResolvedValue({ options: [] } as GenerateResponse);
    await renderScreen();

    await screen.findByTestId('activity-row-7');
    await selectActivity(7);

    mockPickerValue = new Date('2026-02-03T08:00:00.000Z');
    await fireEvent.press(screen.getByTestId('picker-start-time'));
    mockPickerValue = new Date('2026-02-03T23:00:00.000Z');
    await fireEvent.press(screen.getByTestId('picker-day-end'));

    await fireEvent.press(screen.getByTestId('btn-generate'));

    await waitFor(() => expect(mockedGenerate).toHaveBeenCalledTimes(1));
    const request = mockedGenerate.mock.calls[0][0];
    expect(request.strategies).toEqual(['your-order', 'shortest-first', 'longest-first', 'best-fit']);
    expect(request.start_time).toBe('2026-02-03T08:00:00.000Z');
    expect(request.day_start).toBe('2026-02-03T08:00:00.000Z');
    expect(request.day_end).toBe('2026-02-03T23:00:00.000Z');
  });

  it('renders a retry control instead of crashing when generate fails', async () => {
    mockedGenerate.mockRejectedValue(new Error('network down'));
    await renderScreen();

    await screen.findByTestId('activity-row-7');
    await selectActivity(7);
    await fireEvent.press(screen.getByTestId('btn-generate'));

    await screen.findByTestId('btn-retry-generate');
    expect(screen.queryByTestId('option-card-your-order')).toBeNull();

    mockedGenerate.mockResolvedValueOnce({ options: [option({})] });
    await fireEvent.press(screen.getByTestId('btn-retry-generate'));

    await screen.findByTestId('option-card-your-order');
    expect(mockedGenerate).toHaveBeenCalledTimes(2);
  });
});

describe('options step', () => {
  it('renders one card per option and enables Save once one is selected', async () => {
    mockedGenerate.mockResolvedValue({
      options: [
        option({ strategy: 'your-order', label: 'Your Order' }),
        option({ strategy: 'shortest-first', label: 'Shortest First' }),
      ],
    });
    await renderScreen();

    await screen.findByTestId('activity-row-7');
    await selectActivity(7);
    await fireEvent.press(screen.getByTestId('btn-generate'));

    await screen.findByTestId('option-card-your-order');
    expect(screen.getByTestId('option-card-shortest-first')).toBeTruthy();
    expect(screen.queryByTestId('btn-save')).toBeNull();

    await fireEvent.press(screen.getByTestId('btn-select-shortest-first'));

    expect(screen.getByTestId('btn-save')).toBeTruthy();
  });
});

describe('save step', () => {
  it('creates the schedule then one item per timeline entry, in order', async () => {
    const timeline = [
      { task_id: 7, name: 'Gym', start: '2026-02-03T08:00:00.000Z', end: '2026-02-03T08:30:00.000Z' },
      { task_id: 8, name: 'Reading', start: '2026-02-03T08:30:00.000Z', end: '2026-02-03T08:45:00.000Z' },
    ];
    mockedGenerate.mockResolvedValue({ options: [option({ strategy: 'your-order', timeline })] });
    mockedCreate.mockResolvedValue({ ...REGIMEN, id: 55, name: 'My Day', is_regimen: false, items: [] });
    mockedAddItem.mockResolvedValue({});
    await renderScreen();

    await screen.findByTestId('activity-row-7');
    await selectActivity(7);
    await fireEvent.press(screen.getByTestId('btn-generate'));

    await screen.findByTestId('option-card-your-order');
    await fireEvent.press(screen.getByTestId('btn-select-your-order'));
    await fireEvent.changeText(screen.getByTestId('input-schedule-name'), 'My Day');
    await fireEvent.press(screen.getByTestId('btn-save'));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Day' }));

    await waitFor(() => expect(mockedAddItem).toHaveBeenCalledTimes(2));
    expect(mockedAddItem.mock.calls[0]).toEqual([
      55,
      expect.objectContaining({ task_id: 7, position: 0, scheduled_time: timeline[0].start }),
    ]);
    expect(mockedAddItem.mock.calls[1]).toEqual([
      55,
      expect.objectContaining({ task_id: 8, position: 1, scheduled_time: timeline[1].start }),
    ]);
  });
});

describe('regimens', () => {
  it('applies a regimen to the picked date', async () => {
    mockedSchedulesGetAll.mockResolvedValue([REGIMEN]);
    mockedGenerate.mockResolvedValue({ options: [] });
    mockedApplyRegimen.mockResolvedValue({ ...REGIMEN, id: 200 });
    await renderScreen();

    await screen.findByTestId('regimen-row-99');
    await fireEvent.press(screen.getByTestId('btn-apply-99'));

    mockPickerValue = new Date('2026-03-01T00:00:00.000Z');
    await fireEvent.press(screen.getByTestId('picker-apply-99'));

    await waitFor(() => expect(mockedApplyRegimen).toHaveBeenCalledTimes(1));
    expect(mockedApplyRegimen).toHaveBeenCalledWith(99, { target_date: '2026-03-01T00:00:00.000Z' });
  });
});
