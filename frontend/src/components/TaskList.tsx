import { Task } from '../types';

interface TaskListProps {
  tasks: Task[];
  onDeleteTask: (taskId: number) => void;
  onSelectTask: (task: Task) => void;
}

export default function TaskList({ tasks, onDeleteTask, onSelectTask }: TaskListProps) {
  const dateStamp = () => new Date().toISOString().split('T')[0];

  const download = (filename: string, content: string, type: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportCSV = () => {
    const headers = ['id', 'name', 'average_duration_seconds', 'total_recordings', 'created_at'];
    const rows = tasks.map(t => [
      t.id,
      `"${t.name.replace(/"/g, '""')}"`,
      t.average_duration,
      t.total_recordings,
      t.created_at,
    ].join(','));
    download(`activities_${dateStamp()}.csv`, [headers.join(','), ...rows].join('\n'), 'text/csv');
  };

  const exportJSON = () => {
    download(`activities_${dateStamp()}.json`, JSON.stringify(tasks, null, 2), 'application/json');
  };

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
    <div className="glass-card rounded-2xl p-6 transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white drop-shadow-lg">Activities</h2>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="glass-button text-xs py-1 px-3 rounded-lg">
            CSV
          </button>
          <button onClick={exportJSON} className="glass-button text-xs py-1 px-3 rounded-lg">
            JSON
          </button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <p className="text-white/70 text-center py-8">
          No activities yet. Create your first activity to get started!
        </p>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="glass-inner rounded-xl p-4 transition-all duration-300 ease-out cursor-pointer hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm"
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
                  className="text-red-400 hover:text-red-300 font-semibold px-3 py-1 transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)]"
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
