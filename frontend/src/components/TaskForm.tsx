import { useState } from 'react';

interface TaskFormProps {
  onCreateTask: (name: string) => void;
}

export default function TaskForm({ onCreateTask }: TaskFormProps) {
  const [taskName, setTaskName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (taskName.trim()) {
      onCreateTask(taskName.trim());
      setTaskName('');
    }
  };

  return (
    <div className="glass-card rounded-2xl p-8 max-w-md mx-auto h-fit transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm">
      <h2 className="text-2xl font-bold mb-6 text-white drop-shadow-lg text-center">New Activity</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          placeholder="e.g. Go for a run, Band practice..."
          className="glass-input w-full px-4 py-3 rounded-xl"
        />
        <button
          type="submit"
          disabled={!taskName.trim()}
          className="glass-button-primary w-full font-semibold py-3 px-6 rounded-xl transition-all disabled:opacity-50"
        >
          Add Activity
        </button>
      </form>

      <div className="mt-6 pt-6 border-t border-white/10">
        <p className="text-white/60 text-sm text-center">
          Activities track how long things take you. The more you record, the smarter your schedule suggestions become.
        </p>
      </div>
    </div>
  );
}
