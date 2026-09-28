import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ScheduleScreen from '../app/(tabs)/schedule';
import { scheduleAPI, taskAPI } from '../services/api';
import type { Schedule, StrategyOption, Task } from '../types';

// P17 contract: pushes to Google Calendar are explicit-only (D35) — nothing
// pushes as a side effect of dragging, resizing, or saving.
//
// Schedule tab (`src/app/(tabs)/schedule.tsx`): the schedule just saved in
// Step 3 gets a `btn-push-schedule` button calling the new
// `scheduleAPI.pushToCalendar(id)` (P13's route); its response's items are
// used to render `text-events-pushed` (count of items carrying a
// `calendar_event_id`) and flip the control to `btn-remove-schedule-calendar`
// (`scheduleAPI.removeFromCalendar`). Each row in the Regimens list gets the
// identical push/remove pair keyed by id: `btn-push-{id}` / `btn-remove-calendar-{id}`.
// This requires adding `calendar_event_id?: string` to `ScheduleItem` in
// `types/index.ts` — P17.impl's job, not this file's.
//
// B6 (D46) removed Recording push: the Calendar-tab tests that lived here are
// gone. B7 rewrites this file for Block and day push on the Calendar tab.
jest.mock('../services/api', () => ({
  taskAPI: { getAll: jest.fn() },
  scheduleAPI: {
    getAll: jest.fn(),
    generate: jest.fn(),
    create: jest.fn(),
    addItem: jest.fn(),
    applyRegimen: jest.fn(),
    pushToCalendar: jest.fn(),
    removeFromCalendar: jest.fn(),
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
const mockedPushToCalendar = (scheduleAPI as unknown as { pushToCalendar: jest.Mock }).pushToCalendar;
const mockedRemoveScheduleCalendar = (scheduleAPI as unknown as { removeFromCalendar: jest.Mock }).removeFromCalendar;

const GYM: Task = {
  id: 7,
  name: 'Gym',
  average_duration: 1800,
  total_recordings: 3,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

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

async function renderSchedule() {
  return render(
    <QueryClientProvider client={client()}>
      <ScheduleScreen />
    </QueryClientProvider>
  );
}

async function saveAScheduleAndReachSavedCard() {
  mockedTasksGetAll.mockResolvedValue([GYM]);
  mockedSchedulesGetAll.mockResolvedValue([]);
  const timeline = [{ task_id: 7, name: 'Gym', start: '2026-02-03T08:00:00.000Z', end: '2026-02-03T08:30:00.000Z' }];
  mockedGenerate.mockResolvedValue({ options: [option({ strategy: 'your-order', timeline })] });
  mockedCreate.mockResolvedValue({ ...REGIMEN, id: 55, name: 'My Day', is_regimen: false, items: [] });
  mockedAddItem.mockResolvedValue({});

  await renderSchedule();
  await screen.findByTestId('activity-row-7');
  await fireEvent.press(screen.getByTestId('activity-row-7'));
  await fireEvent.press(screen.getByTestId('btn-generate'));
  await screen.findByTestId('option-card-your-order');
  await fireEvent.press(screen.getByTestId('btn-select-your-order'));
  await fireEvent.press(screen.getByTestId('btn-save'));
  await waitFor(() => expect(mockedAddItem).toHaveBeenCalledTimes(1));
  await screen.findByTestId('btn-push-schedule');
}

beforeEach(() => {
  mockedTasksGetAll.mockReset();
  mockedSchedulesGetAll.mockReset();
  mockedGenerate.mockReset();
  mockedCreate.mockReset();
  mockedAddItem.mockReset();
  mockedPushToCalendar.mockReset();
  mockedRemoveScheduleCalendar.mockReset();

  mockPickerValue = new Date('2026-02-01T09:00:00.000Z');
});

describe('pushing a schedule', () => {
  it('calls the schedules calendar route once and reports the events pushed', async () => {
    await saveAScheduleAndReachSavedCard();
    mockedPushToCalendar.mockResolvedValue({
      id: 55,
      items: [
        { id: 1, calendar_event_id: 'evt1' },
        { id: 2, calendar_event_id: 'evt2' },
      ],
    });

    await fireEvent.press(screen.getByTestId('btn-push-schedule'));

    await waitFor(() => expect(mockedPushToCalendar).toHaveBeenCalledTimes(1));
    expect(mockedPushToCalendar).toHaveBeenCalledWith(55);
    await screen.findByTestId('text-events-pushed');
    expect(screen.getByTestId('text-events-pushed')).toHaveTextContent('2');
  });
});

describe('a second push is offered as remove', () => {
  it('flips a pushed regimen row to remove instead of another push', async () => {
    mockedGenerate.mockResolvedValue({ options: [] });
    mockedSchedulesGetAll
      .mockResolvedValueOnce([REGIMEN])
      .mockResolvedValueOnce([{ ...REGIMEN, items: [{ id: 1, calendar_event_id: 'evt1' }] as any }]);
    mockedPushToCalendar.mockResolvedValue({
      ...REGIMEN,
      items: [{ id: 1, calendar_event_id: 'evt1' }],
    });
    await renderSchedule();

    await screen.findByTestId('btn-push-99');
    await fireEvent.press(screen.getByTestId('btn-push-99'));

    await waitFor(() => expect(mockedPushToCalendar).toHaveBeenCalledTimes(1));
    await screen.findByTestId('btn-remove-calendar-99');
    expect(screen.queryByTestId('btn-push-99')).toBeNull();

    await fireEvent.press(screen.getByTestId('btn-remove-calendar-99'));

    await waitFor(() => expect(mockedRemoveScheduleCalendar).toHaveBeenCalledWith(99));
    expect(mockedPushToCalendar).toHaveBeenCalledTimes(1);
  });
});

describe('explicit pushes only', () => {
  it('saving a schedule calls no calendar route until the push button is pressed', async () => {
    await saveAScheduleAndReachSavedCard();

    expect(mockedPushToCalendar).not.toHaveBeenCalled();
    expect(mockedRemoveScheduleCalendar).not.toHaveBeenCalled();
  });
});
