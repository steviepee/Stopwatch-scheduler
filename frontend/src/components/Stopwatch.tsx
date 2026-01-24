import { useState } from 'react';
import { useStopwatch } from '../hooks/useStopwatch';
import { Task } from '../types';

interface StopwatchProps {
  tasks: Task[];
  onSaveTime: (taskId: number, duration: number, notes?: string) => void;
}

export default function Stopwatch({ tasks, onSaveTime }: StopwatchProps) {
  const { time, isRunning, start, pause, reset, formatTime } = useStopwatch();
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);

  const timeDisplay = formatTime(time);

  const handleStop = () => {
    pause();
    if (time > 0) {
      setShowSaveModal(true);
    }
  };

  const handleSave = () => {
    if (selectedTaskId) {
      const durationInSeconds = time / 1000;
      onSaveTime(selectedTaskId, durationInSeconds, notes);
      setShowSaveModal(false);
      reset();
      setNotes('');
      setSelectedTaskId(null);
    }
  };

  const handleCancel = () => {
    setShowSaveModal(false);
    reset();
    setNotes('');
    setSelectedTaskId(null);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-8 max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-center mb-6">Stopwatch</h2>

      {/* Timer Display */}
      <div className="bg-gray-100 rounded-lg p-6 mb-6">
        <div className="text-5xl font-mono text-center text-gray-800">
          {timeDisplay.hours}:{timeDisplay.minutes}:{timeDisplay.seconds}
          <span className="text-3xl text-gray-500">.{timeDisplay.milliseconds}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-3 mb-6">
        {!isRunning ? (
          <button
            onClick={start}
            className="flex-1 bg-green-500 hover:bg-green-600 text-white font-semibold py-3 px-6 rounded-lg transition"
          >
            Start
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white font-semibold py-3 px-6 rounded-lg transition"
          >
            Stop
          </button>
        )}
        <button
          onClick={reset}
          className="flex-1 bg-gray-500 hover:bg-gray-600 text-white font-semibold py-3 px-6 rounded-lg transition"
        >
          Reset
        </button>
      </div>

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Save Time Log</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Task
              </label>
              <select
                value={selectedTaskId || ''}
                onChange={(e) => setSelectedTaskId(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Choose a task...</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={3}
                placeholder="Add any notes about this session..."
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={!selectedTaskId}
                className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white font-semibold py-2 px-4 rounded-lg transition"
              >
                Save
              </button>
              <button
                onClick={handleCancel}
                className="flex-1 bg-gray-500 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
