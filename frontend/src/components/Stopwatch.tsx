import { useState, useRef } from 'react';
import { useStopwatch } from '../hooks/useStopwatch';
import { Task, StopwatchSessionCreate } from '../types';

interface StopwatchProps {
  tasks: Task[];
  onSaveTime: (taskId: number, duration: number, notes?: string) => void;
  onSaveSession: (session: StopwatchSessionCreate) => void;
}

export default function Stopwatch({ tasks, onSaveTime, onSaveSession }: StopwatchProps) {
  const { time, isRunning, start, pause, reset, formatTime } = useStopwatch();
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveType, setSaveType] = useState<'session' | 'timelog'>('session');
  const startTimeRef = useRef<Date | null>(null);

  const timeDisplay = formatTime(time);

  const handleStart = () => {
    startTimeRef.current = new Date();
    start();
  };

  const handleStop = () => {
    pause();
    if (time > 0) {
      setShowSaveModal(true);
    }
  };

  const handleSaveSession = () => {
    if (!sessionName.trim()) return;

    const durationInSeconds = time / 1000;
    const endTime = new Date();

    const session: StopwatchSessionCreate = {
      name: sessionName.trim(),
      duration: durationInSeconds,
      task_id: selectedTaskId || undefined,
      notes: notes || undefined,
      start_time: startTimeRef.current?.toISOString(),
      end_time: endTime.toISOString(),
    };

    onSaveSession(session);
    handleReset();
  };

  const handleSaveTimeLog = () => {
    if (selectedTaskId) {
      const durationInSeconds = time / 1000;
      onSaveTime(selectedTaskId, durationInSeconds, notes);
      handleReset();
    }
  };

  const handleReset = () => {
    setShowSaveModal(false);
    reset();
    setNotes('');
    setSelectedTaskId(null);
    setSessionName('');
    startTimeRef.current = null;
  };

  const handleCancel = () => {
    setShowSaveModal(false);
  };

  return (
    <div className="glass-card rounded-2xl p-8 max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-center mb-6 text-white drop-shadow-lg">Stopwatch</h2>

      {/* Timer Display */}
      <div className="glass-inner rounded-xl p-6 mb-6">
        <div className="text-5xl font-mono text-center text-white drop-shadow-lg">
          {timeDisplay.hours}:{timeDisplay.minutes}:{timeDisplay.seconds}
          <span className="text-3xl text-white/70">.{timeDisplay.milliseconds}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-3 mb-6">
        {!isRunning ? (
          <button
            onClick={handleStart}
            className="flex-1 glass-button-green font-semibold py-3 px-6 rounded-xl transition-all duration-300"
          >
            Start
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex-1 glass-button-red font-semibold py-3 px-6 rounded-xl transition-all duration-300"
          >
            Stop
          </button>
        )}
        <button
          onClick={handleReset}
          className="flex-1 glass-button font-semibold py-3 px-6 rounded-xl transition-all duration-300"
        >
          Reset
        </button>
      </div>

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="glass-card rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4 text-white">Save Recording</h3>

            {/* Save Type Toggle */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setSaveType('session')}
                className={`flex-1 py-2 px-4 rounded-xl font-medium transition-all ${
                  saveType === 'session'
                    ? 'glass-button-primary'
                    : 'glass-button'
                }`}
              >
                Save as Session
              </button>
              <button
                onClick={() => setSaveType('timelog')}
                className={`flex-1 py-2 px-4 rounded-xl font-medium transition-all ${
                  saveType === 'timelog'
                    ? 'glass-button-primary'
                    : 'glass-button'
                }`}
              >
                Add to Task
              </button>
            </div>

            {saveType === 'session' ? (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-white/90 mb-2">
                    Session Name *
                  </label>
                  <input
                    type="text"
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                    className="glass-input w-full px-4 py-3 rounded-xl"
                    placeholder="Name this session..."
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-white/90 mb-2">
                    Link to Task (optional)
                  </label>
                  <select
                    value={selectedTaskId || ''}
                    onChange={(e) => setSelectedTaskId(e.target.value ? Number(e.target.value) : null)}
                    className="glass-input w-full px-4 py-3 rounded-xl"
                  >
                    <option value="">No task linked</option>
                    {tasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <div className="mb-4">
                <label className="block text-sm font-medium text-white/90 mb-2">
                  Select Task *
                </label>
                <select
                  value={selectedTaskId || ''}
                  onChange={(e) => setSelectedTaskId(Number(e.target.value))}
                  className="glass-input w-full px-4 py-3 rounded-xl"
                >
                  <option value="">Choose a task...</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-white/90 mb-2">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="glass-input w-full px-4 py-3 rounded-xl resize-none"
                rows={3}
                placeholder="Add any notes about this recording..."
              />
            </div>

            <div className="flex gap-3">
              {saveType === 'session' ? (
                <button
                  onClick={handleSaveSession}
                  disabled={!sessionName.trim()}
                  className="flex-1 glass-button-primary disabled:opacity-50 font-semibold py-3 px-4 rounded-xl transition-all"
                >
                  Save Session
                </button>
              ) : (
                <button
                  onClick={handleSaveTimeLog}
                  disabled={!selectedTaskId}
                  className="flex-1 glass-button-primary disabled:opacity-50 font-semibold py-3 px-4 rounded-xl transition-all"
                >
                  Save to Task
                </button>
              )}
              <button
                onClick={handleCancel}
                className="flex-1 glass-button font-semibold py-3 px-4 rounded-xl transition-all"
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
