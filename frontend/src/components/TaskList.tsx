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
    <div className="glass-card rounded-2xl p-6">
      <h2 className="text-2xl font-bold mb-6 text-white drop-shadow-lg">Tasks</h2>

      {tasks.length === 0 ? (
        <p className="text-white/70 text-center py-8">
          No tasks yet. Create your first task to get started!
        </p>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="glass-inner rounded-xl p-4 hover:bg-white/20 transition-all duration-300 cursor-pointer"
              onClick={() => onSelectTask(task)}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg text-white">{task.name}</h3>
                  <div className="text-sm text-white/70 mt-1 space-y-1">
                    <p className="flex items-center gap-2">
                      <span className="text-white/50">Average:</span>
                      <span className="font-mono">{formatDuration(task.average_duration)}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <span className="text-white/50">Recordings:</span>
                      {task.total_recordings}
                    </p>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteTask(task.id);
                  }}
                  className="text-red-400 hover:text-red-300 font-semibold px-3 py-1 transition-colors"
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
