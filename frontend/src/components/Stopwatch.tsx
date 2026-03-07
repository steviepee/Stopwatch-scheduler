import { useState, useRef } from 'react';
import { useStopwatch } from '../hooks/useStopwatch';
import { Task, StopwatchSessionCreate } from '../types';

interface StopwatchProps {
  tasks: Task[];
  onSaveTime: (taskId: number, duration: number, notes?: string) => void;
  onSaveSession: (session: StopwatchSessionCreate) => void;
  onModalChange?: (isOpen: boolean) => void;
}

export default function Stopwatch({ tasks, onSaveTime, onSaveSession, onModalChange }: StopwatchProps) {
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
      onModalChange?.(true);
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
    onModalChange?.(false);
    reset();
    setNotes('');
    setSelectedTaskId(null);
    setSessionName('');
    startTimeRef.current = null;
  };

  const handleCancel = () => {
    setShowSaveModal(false);
    onModalChange?.(false);
  };

  return (
    <div className="glass-card rounded-2xl p-8 max-w-md mx-auto transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm">
      <h2 className="text-2xl font-bold text-center mb-6 text-white drop-shadow-lg">Stopwatch</h2>

      {/* Timer Display */}
      <div className="glass-inner rounded-xl p-6 mb-6 transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm">
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
            className="flex-1 glass-button-green font-semibold py-3 px-6 rounded-xl transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm"
          >
            Start
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex-1 glass-button-red font-semibold py-3 px-6 rounded-xl transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm"
          >
            Stop
          </button>
        )}
        <button
          onClick={handleReset}
          className="flex-1 glass-button font-semibold py-3 px-6 rounded-xl transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm"
        >
          Reset
        </button>
      </div>

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-gradient-to-br from-slate-200/70 to-slate-400/5 border border-white/40 shadow-2xl rounded-2xl p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-slate-800">Save Recording</h3>
              <span className="font-mono text-lg text-slate-600">
                {timeDisplay.hours}:{timeDisplay.minutes}:{timeDisplay.seconds}
              </span>
            </div>

            {/* Save Type Toggle */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setSaveType('session')}
                className={`flex-1 py-2 px-4 rounded-xl font-medium transition-all ${
                  saveType === 'session'
                    ? 'bg-slate-700 text-white shadow-md'
                    : 'bg-white/50 text-slate-700 hover:bg-white/70'
                }`}
              >
                Save as Recording
              </button>
              <button
                onClick={() => setSaveType('timelog')}
                className={`flex-1 py-2 px-4 rounded-xl font-medium transition-all ${
                  saveType === 'timelog'
                    ? 'bg-slate-700 text-white shadow-md'
                    : 'bg-white/50 text-slate-700 hover:bg-white/70'
                }`}
              >
                Add to Activity
              </button>
            </div>

            {saveType === 'session' ? (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Recording Name *
                  </label>
                  <input
                    type="text"
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                    className="bg-white/60 border border-slate-300 text-slate-800 placeholder-slate-500 w-full px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-400"
                    placeholder="Name this recording..."
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Link to Activity (optional)
                  </label>
                  <select
                    value={selectedTaskId || ''}
                    onChange={(e) => setSelectedTaskId(e.target.value ? Number(e.target.value) : null)}
                    className="bg-white/60 border border-slate-300 text-slate-800 placeholder-slate-500 w-full px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-400"
                  >
                    <option value="">No activity linked</option>
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
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Select Activity *
                </label>
                <select
                  value={selectedTaskId || ''}
                  onChange={(e) => setSelectedTaskId(Number(e.target.value))}
                  className="bg-white/60 border border-slate-300 text-slate-800 placeholder-slate-500 w-full px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-400"
                >
                  <option value="">Choose an activity...</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="bg-white/60 border border-slate-300 text-slate-800 placeholder-slate-500 w-full px-4 py-3 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-slate-400"
                rows={3}
                placeholder="Add any notes about this recording..."
              />
            </div>

            <div className="flex gap-3">
              {saveType === 'session' ? (
                <button
                  onClick={handleSaveSession}
                  disabled={!sessionName.trim()}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:hover:bg-emerald-600 font-semibold py-3 px-4 rounded-xl transition-all shadow-md"
                >
                  Save Recording
                </button>
              ) : (
                <button
                  onClick={handleSaveTimeLog}
                  disabled={!selectedTaskId}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:hover:bg-emerald-600 font-semibold py-3 px-4 rounded-xl transition-all shadow-md"
                >
                  Save to Activity
                </button>
              )}
              <button
                onClick={handleCancel}
                className="flex-1 bg-slate-500 hover:bg-slate-600 text-white font-semibold py-3 px-4 rounded-xl transition-all shadow-md"
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
