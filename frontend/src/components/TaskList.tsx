import { Task } from '../types';

interface TaskListProps {
  tasks: Task[];
  onDeleteTask: (taskId: number) => void;
  onSelectTask: (task: Task) => void;
}

export default function TaskList({ tasks, onDeleteTask, onSelectTask }: TaskListProps) {
  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold mb-4">Tasks</h2>

      {tasks.length === 0 ? (
        <p className="text-gray-500 text-center py-8">
          No tasks yet. Create your first task to get started!
        </p>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition cursor-pointer"
              onClick={() => onSelectTask(task)}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{task.name}</h3>
                  <div className="text-sm text-gray-600 mt-1">
                    <p>Average Duration: {formatDuration(task.average_duration)}</p>
                    <p>Recordings: {task.total_recordings}</p>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteTask(task.id);
                  }}
                  className="text-red-500 hover:text-red-700 font-semibold px-3 py-1"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
