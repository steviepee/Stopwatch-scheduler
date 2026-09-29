import type { ComponentType } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import SessionListComponent from '../components/SessionList';
import { sessionAPI } from '../services/api';
import type { StopwatchSession, Task } from '../types';

// B11 contract (Build 2a, D47, B9 on the web): a Recording entered by hand on the Recordings list.
//
// Props. `SessionList` gains `tasks: Task[]` (every Activity) and
// `onSessionCreated(session)`; HomePage passes its task list and adds the returned Recording to
// its state. The form calls `sessionAPI.create` itself, so it can show a failure.
//
// Form. `btn-add-manual` opens `manual-form` with:
//   - `manual-name` text input;
//   - `manual-activity` `<select>`: an option with value "" (no Activity) plus one option per
//     Activity, value = its id;
//   - `manual-hours` and `manual-minutes` number inputs;
//   - `manual-start` `<input type="datetime-local">`, value `YYYY-MM-DDTHH:mm` in LOCAL time,
//     prefilled to (the time the form opened, to the minute) minus the duration, and following
//     duration changes until the user edits it;
//   - `btn-manual-save`, disabled while the duration is zero or a save is in flight.
// Save calls `sessionAPI.create({ name, duration, start_time, end_time })`, `duration` in
// seconds, `start_time` the start as UTC `Z`, `end_time` = start + duration, plus `task_id` only
// when an Activity is chosen. Success calls `onSessionCreated` with the response and closes the
// form. Failure shows `manual-save-error` and keeps the form, its values and an enabled Save.
//
// These tests run in America/Chicago with the clock frozen at 10:00:30 local on 2026-09-29.

process.env.TZ = 'America/Chicago';

vi.mock('../services/api', () => ({
  sessionAPI: { create: vi.fn() },
  googleCalendarAPI: {
    checkAuthStatus: vi.fn().mockResolvedValue({ authenticated: false }),
    login: vi.fn(),
  },
}));

const SessionList = SessionListComponent as unknown as ComponentType<{
  sessions: StopwatchSession[];
  tasks: Task[];
  onDeleteSession: (sessionId: number) => void;
  onUpdateSession: (sessionId: number, name: string) => void;
  onSessionCreated: (session: StopwatchSession) => void;
}>;

const create = sessionAPI.create as unknown as Mock;

const TASKS: Task[] = [
  { id: 1, name: 'Gym', average_duration: 1800, total_recordings: 3, created_at: '', updated_at: '' },
  { id: 2, name: 'Run', average_duration: 2400, total_recordings: 5, created_at: '', updated_at: '' },
];

const CREATED = {
  id: 99,
  name: 'Walk',
  duration: 2700,
  created_at: '2026-09-29T15:00:30Z',
  updated_at: '2026-09-29T15:00:30Z',
} as StopwatchSession;

function renderList() {
  const onSessionCreated = vi.fn();
  render(
    <SessionList
      sessions={[]}
      tasks={TASKS}
      onDeleteSession={vi.fn()}
      onUpdateSession={vi.fn()}
      onSessionCreated={onSessionCreated}
    />
  );
  fireEvent.click(screen.getByTestId('btn-add-manual'));
  expect(screen.getByTestId('manual-form')).toBeInTheDocument();
  return { onSessionCreated };
}

function setDuration(hours: string, minutes: string) {
  fireEvent.change(screen.getByTestId('manual-hours'), { target: { value: hours } });
  fireEvent.change(screen.getByTestId('manual-minutes'), { target: { value: minutes } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 29, 10, 0, 30));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('hand-entered Recording', () => {
  it('prefills the start to now minus the duration and follows the duration until edited', () => {
    renderList();

    setDuration('0', '45');
    expect(screen.getByTestId('manual-start')).toHaveValue('2026-09-29T09:15');
    setDuration('1', '45');
    expect(screen.getByTestId('manual-start')).toHaveValue('2026-09-29T08:15');

    fireEvent.change(screen.getByTestId('manual-start'), { target: { value: '2026-09-27T06:15' } });
    setDuration('0', '30');
    expect(screen.getByTestId('manual-start')).toHaveValue('2026-09-27T06:15');
  });

  it('saves without an Activity: no task_id, end = start + duration', async () => {
    create.mockResolvedValue(CREATED);
    const { onSessionCreated } = renderList();

    fireEvent.change(screen.getByTestId('manual-name'), { target: { value: 'Walk' } });
    setDuration('0', '45');
    fireEvent.click(screen.getByTestId('btn-manual-save'));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const body = create.mock.calls[0][0];
    expect(body).toEqual({
      name: 'Walk',
      duration: 2700,
      start_time: new Date(2026, 8, 29, 9, 15).toISOString(),
      end_time: new Date(2026, 8, 29, 10, 0).toISOString(),
    });
    expect('task_id' in body).toBe(false);
    expect(body.start_time).toMatch(/Z$/);

    await waitFor(() => expect(onSessionCreated).toHaveBeenCalledWith(CREATED));
    await waitFor(() => expect(screen.queryByTestId('manual-form')).not.toBeInTheDocument());
  });

  it('saves with an Activity and an edited start', async () => {
    create.mockResolvedValue({ ...CREATED, task_id: 2 });
    renderList();

    fireEvent.change(screen.getByTestId('manual-name'), { target: { value: 'Long run' } });
    fireEvent.change(screen.getByTestId('manual-activity'), { target: { value: '2' } });
    setDuration('1', '30');
    fireEvent.change(screen.getByTestId('manual-start'), { target: { value: '2026-09-27T06:15' } });
    fireEvent.click(screen.getByTestId('btn-manual-save'));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toEqual({
      name: 'Long run',
      duration: 5400,
      task_id: 2,
      start_time: new Date(2026, 8, 27, 6, 15).toISOString(),
      end_time: new Date(2026, 8, 27, 7, 45).toISOString(),
    });
  });

  it('cannot save a zero duration', () => {
    renderList();
    fireEvent.change(screen.getByTestId('manual-name'), { target: { value: 'Nothing' } });
    setDuration('0', '0');
    expect(screen.getByTestId('btn-manual-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('btn-manual-save'));
    expect(create).not.toHaveBeenCalled();

    setDuration('0', '30');
    expect(screen.getByTestId('btn-manual-save')).toBeEnabled();
  });

  it('a failed save shows an error and keeps the form and its values', async () => {
    create.mockRejectedValue({ response: { status: 500 } });
    const { onSessionCreated } = renderList();

    fireEvent.change(screen.getByTestId('manual-name'), { target: { value: 'Swim' } });
    setDuration('0', '30');
    fireEvent.click(screen.getByTestId('btn-manual-save'));

    expect(await screen.findByTestId('manual-save-error')).toBeInTheDocument();
    expect(screen.getByTestId('manual-form')).toBeInTheDocument();
    expect(screen.getByTestId('manual-name')).toHaveValue('Swim');
    expect(screen.getByTestId('manual-minutes')).toHaveValue(30);
    expect(screen.getByTestId('btn-manual-save')).toBeEnabled();
    expect(onSessionCreated).not.toHaveBeenCalled();
  });
});
