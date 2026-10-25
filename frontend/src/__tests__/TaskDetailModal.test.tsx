import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import TaskDetailModal from '../components/TaskDetailModal';
import TaskList from '../components/TaskList';
import { taskAPI } from '../services/api';
import type { TaskWithLogs } from '../types';

// B40 (D70), web parity with mobile's B39. The PRD gives this in prose only,
// so this session chose and documents the contract here for B40.impl:
//   - TaskDetailModal renders a 2x2 grid, testIDs (`data-testid`)
//     `quadrant-q1`..`quadrant-q4`, in D70's order: Q1 "Urgent & Important",
//     Q2 "Important" (top row), Q3 "Urgent", Q4 "Neither" (bottom row), read
//     straight off the `task` prop's `is_urgent`/`is_important` — no extra
//     fetch, since (unlike mobile's route-param screen) the prop already
//     carries them. The cell matching the current flags gets a trailing
//     " (current)" marker, the convention SessionList's picker already uses
//     (B38).
//   - Clicking a cell calls `taskAPI.update(task.id, { is_urgent, is_important })`
//     with the pair for that quadrant (Q1 true/true, Q2 false/true, Q3
//     true/false, Q4 false/false), then highlights the new quadrant locally
//     on success and calls `onTaskUpdated` with the response (the prop
//     HomePage already wires to update its task list).
//   - TaskList gets an `activity-quadrant-<id>` badge, text "Q1"/"Q2"/"Q3"; a
//     Q4 Activity (both flags false, including missing/undefined) renders no
//     such node at all.
vi.mock('../services/api', () => ({
  taskAPI: { getById: vi.fn(), update: vi.fn() },
  timeLogAPI: { delete: vi.fn() },
}));

const mockedGetById = taskAPI.getById as Mock;
// `update` is B40.impl's addition to taskAPI; it doesn't exist on the real
// module's type yet, so go through `unknown` rather than widen the import.
const mockedUpdate = (taskAPI as unknown as { update: Mock }).update;

const GYM = {
  id: 7,
  name: 'Gym',
  average_duration: 1800,
  total_recordings: 3,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const DETAIL: TaskWithLogs = { ...GYM, time_logs: [] };

describe('quadrant picker (B40, D70)', () => {
  // No `: Task` annotation — `is_urgent`/`is_important` aren't on the type
  // yet (B40.impl's job), and annotating these literals would trip the
  // excess-property check. Passed by reference below, so no check applies.
  const NEITHER = { ...GYM, is_urgent: false, is_important: false };
  const IMPORTANT = { ...GYM, is_urgent: false, is_important: true };
  const URGENT_AND_IMPORTANT = { ...GYM, is_urgent: true, is_important: true };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetById.mockResolvedValue(DETAIL);
  });

  it("highlights the current quadrant from the task prop's flags", async () => {
    render(<TaskDetailModal task={IMPORTANT} onClose={vi.fn()} onTaskUpdated={vi.fn()} />);

    await screen.findByText('Important (current)');
    expect(screen.queryByText('Urgent & Important (current)')).not.toBeInTheDocument();
    expect(screen.queryByText('Urgent (current)')).not.toBeInTheDocument();
    expect(screen.queryByText('Neither (current)')).not.toBeInTheDocument();
    expect(screen.getByTestId('quadrant-q1')).toBeInTheDocument();
    expect(screen.getByTestId('quadrant-q3')).toBeInTheDocument();
    expect(screen.getByTestId('quadrant-q4')).toBeInTheDocument();
  });

  it('sends the right flag pair for each cell', async () => {
    mockedUpdate.mockResolvedValue(NEITHER);
    render(<TaskDetailModal task={NEITHER} onClose={vi.fn()} onTaskUpdated={vi.fn()} />);

    await screen.findByTestId('quadrant-q1');
    fireEvent.click(screen.getByTestId('quadrant-q1'));
    fireEvent.click(screen.getByTestId('quadrant-q2'));
    fireEvent.click(screen.getByTestId('quadrant-q3'));
    fireEvent.click(screen.getByTestId('quadrant-q4'));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(4));
    expect(mockedUpdate).toHaveBeenNthCalledWith(1, 7, { is_urgent: true, is_important: true });
    expect(mockedUpdate).toHaveBeenNthCalledWith(2, 7, { is_urgent: false, is_important: true });
    expect(mockedUpdate).toHaveBeenNthCalledWith(3, 7, { is_urgent: true, is_important: false });
    expect(mockedUpdate).toHaveBeenNthCalledWith(4, 7, { is_urgent: false, is_important: false });
  });

  it('highlights the new quadrant after a successful click and notifies the parent', async () => {
    mockedUpdate.mockResolvedValue(URGENT_AND_IMPORTANT);
    const onTaskUpdated = vi.fn();
    render(<TaskDetailModal task={NEITHER} onClose={vi.fn()} onTaskUpdated={onTaskUpdated} />);

    await screen.findByText('Neither (current)');
    fireEvent.click(screen.getByTestId('quadrant-q1'));

    await screen.findByText('Urgent & Important (current)');
    expect(screen.queryByText('Neither (current)')).not.toBeInTheDocument();
    expect(onTaskUpdated).toHaveBeenCalledWith(URGENT_AND_IMPORTANT);
  });
});

describe('quadrant badges (B40, D70)', () => {
  const Q1_TASK = { ...GYM, id: 10, name: 'Taxes', is_urgent: true, is_important: true };
  const Q2_TASK = { ...GYM, id: 11, name: 'Study', is_urgent: false, is_important: true };
  const Q3_TASK = { ...GYM, id: 12, name: 'Email', is_urgent: true, is_important: false };
  const Q4_TASK = { ...GYM, id: 13, name: 'Doodle', is_urgent: false, is_important: false };

  it('shows Q1-Q3 badges and no badge for Q4', () => {
    render(
      <TaskList
        tasks={[Q1_TASK, Q2_TASK, Q3_TASK, Q4_TASK]}
        onDeleteTask={vi.fn()}
        onSelectTask={vi.fn()}
      />
    );

    expect(screen.getByTestId('activity-quadrant-10')).toHaveTextContent('Q1');
    expect(screen.getByTestId('activity-quadrant-11')).toHaveTextContent('Q2');
    expect(screen.getByTestId('activity-quadrant-12')).toHaveTextContent('Q3');
    expect(screen.queryByTestId('activity-quadrant-13')).not.toBeInTheDocument();
  });

  it('shows no badge for an Activity with neither flag set (the default)', () => {
    render(<TaskList tasks={[GYM]} onDeleteTask={vi.fn()} onSelectTask={vi.fn()} />);
    expect(screen.queryByTestId('activity-quadrant-7')).not.toBeInTheDocument();
  });
});
