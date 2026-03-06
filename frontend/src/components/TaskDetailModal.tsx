import { useState, useEffect } from 'react';
import { Task, TaskWithLogs, TimeLog } from '../types';
import { taskAPI, timeLogAPI } from '../services/api';

interface TaskDetailModalProps {
  task: Task;
  onClose: () => void;
  onTaskUpdated: (task: Task) => void;
}

export default function TaskDetailModal({ task, onClose, onTaskUpdated }: TaskDetailModalProps) {
  const [detail, setDetail] = useState<TaskWithLogs | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    taskAPI.getById(task.id).then(d => {
      setDetail(d as unknown as TaskWithLogs);
      setLoading(false);
    });
  }, [task.id]);

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleDeleteLog = async (log: TimeLog) => {
    if (!confirm('Delete this time log?')) return;
    await timeLogAPI.delete(log.id);
    const updated = await taskAPI.getById(task.id);
    setDetail(updated as unknown as TaskWithLogs);
    onTaskUpdated(updated);
  };

  const sorted = detail?.time_logs.slice().sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  ) ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="glass-card rounded-2xl p-6 w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-xl font-bold text-white">{task.name}</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white text-xl leading-none">✕</button>
        </div>

        {loading ? (
          <div className="text-white/70 text-center py-8">Loading...</div>
        ) : (
          <>
            {/* Summary */}
            <div className="glass-inner rounded-xl p-4 mb-4 flex gap-6">
              <div className="text-center">
                <p className="text-white/50 text-xs">Average</p>
                <p className="text-white font-mono font-semibold">{formatDuration(detail!.average_duration)}</p>
              </div>
              <div className="text-center">
                <p className="text-white/50 text-xs">Total Logs</p>
                <p className="text-white font-semibold">{detail!.total_recordings}</p>
              </div>
            </div>

            {/* Time Logs */}
            {sorted.length === 0 ? (
              <p className="text-white/70 text-center py-6">No time logs yet.</p>
            ) : (
              <div className="space-y-2 overflow-y-auto custom-scrollbar flex-1">
                {sorted.map(log => (
                  <div key={log.id} className="glass-inner rounded-xl p-3 flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-mono font-semibold">{formatDuration(log.duration)}</p>
                      <p className="text-white/50 text-xs">{formatDate(log.created_at)}</p>
                      {log.notes && (
                        <p className="text-white/70 text-sm italic mt-1 truncate" title={log.notes}>{log.notes}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteLog(log)}
                      className="text-red-400 hover:text-red-300 text-sm shrink-0"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
