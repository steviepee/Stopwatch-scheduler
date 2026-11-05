import { useState, useEffect, useRef } from 'react';
import { useStopwatch } from '../hooks/useStopwatch';
import { Task, StopwatchSessionCreate } from '../types';
import { settingsAPI } from '../services/api';
import {
  canFinish,
  finishRun,
  markReminded,
  pauseRun,
  phaseView,
  reminderDue,
  resumeRun,
  startRun,
  switchPhase,
  totalWorkMs,
  type FinishedPomodoro,
  type PomodoroConfig,
  type PomodoroPhase,
  type PomodoroState,
} from '../utils/pomodoro';

const RUN_KEY = 'pomodoro.state';
const DEFAULT_CONFIG: PomodoroConfig = { workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 };
const PHASE_LABELS: Record<PomodoroPhase, string> = { work: 'Work', break: 'Break', longBreak: 'Long break' };

const loadRun = (): PomodoroState | null => {
  const raw = localStorage.getItem(RUN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PomodoroState;
  } catch {
    return null;
  }
};

const formatMinSec = (ms: number, roundUp = false) => {
  const totalSeconds = roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
};

const playReminder = (phase: PomodoroPhase, audio: { current: AudioContext | null }) => {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(phase === 'work' ? 'Time for a break' : 'Time to get back to work', {
      body: `${PHASE_LABELS[phase]} target reached`,
    });
  }
  if (typeof AudioContext !== 'undefined') {
    const ctx = audio.current ?? (audio.current = new AudioContext());
    void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.1;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  }
};

interface StopwatchProps {
  tasks: Task[];
  onSaveTime: (taskId: number, duration: number, notes?: string) => void;
  onSaveSession: (session: StopwatchSessionCreate) => void;
  onModalChange?: (isOpen: boolean) => void;
}

export default function Stopwatch({ tasks, onSaveTime, onSaveSession, onModalChange }: StopwatchProps) {
  const { time, isRunning, startTime, start, pause, reset, formatTime } = useStopwatch();
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [sessionActivityChoice, setSessionActivityChoice] = useState('');
  const [notes, setNotes] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveType, setSaveType] = useState<'session' | 'timelog'>('session');
  const [run, setRun] = useState<PomodoroState | null>(loadRun);
  const [mode, setMode] = useState<'stopwatch' | 'pomodoro'>(() => (run ? 'pomodoro' : 'stopwatch'));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerChoice, setPickerChoice] = useState('');
  const [pickerNewName, setPickerNewName] = useState('');
  const [config, setConfig] = useState<PomodoroConfig>(DEFAULT_CONFIG);
  const [finished, setFinished] = useState<FinishedPomodoro | null>(null);
  const [, setTick] = useState(0);
  const runRef = useRef(run);
  const audioRef = useRef<AudioContext | null>(null);
  runRef.current = run;

  const persistRun = (next: PomodoroState | null) => {
    if (next) localStorage.setItem(RUN_KEY, JSON.stringify(next));
    else localStorage.removeItem(RUN_KEY);
    runRef.current = next;
    setRun(next);
  };

  const runActive = run?.status === 'running';
  useEffect(() => {
    if (!runActive) return;
    const id = window.setInterval(() => {
      const current = runRef.current;
      if (current && reminderDue(current)) {
        playReminder(current.phase, audioRef);
        persistRun(markReminded(current));
      }
      setTick((t) => t + 1);
    }, 250);
    return () => clearInterval(id);
  }, [runActive]);

  const modeLocked = isRunning || time > 0 || run !== null;

  const openPicker = () => {
    setPickerOpen(true);
    setPickerChoice('');
    setPickerNewName('');
    settingsAPI
      .getPomodoro()
      .then((s) =>
        setConfig({
          workMinutes: s.work_minutes,
          breakMinutes: s.break_minutes,
          longBreakMinutes: s.long_break_minutes,
          longBreakEvery: s.long_break_every,
        })
      )
      .catch(() => setConfig(DEFAULT_CONFIG));
  };

  const pickerReady = pickerChoice === '__new__' ? pickerNewName.trim() !== '' : pickerChoice !== '';

  const handleRunStart = () => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    // A click may start audio; a context made later without one can stay suspended (silent).
    if (typeof AudioContext !== 'undefined') {
      audioRef.current ??= new AudioContext();
      void audioRef.current.resume();
    }
    const activity =
      pickerChoice === '__new__' ? { newActivityName: pickerNewName.trim() } : { taskId: Number(pickerChoice) };
    persistRun(startRun(config, activity));
    setPickerOpen(false);
  };

  const handleRunFinish = () => {
    if (!run) return;
    setFinished(finishRun(run));
    setSessionName(run.newActivityName ?? tasks.find((t) => t.id === run.taskId)?.name ?? '');
    setSessionActivityChoice(run.newActivityName ? '__new__' : String(run.taskId));
    setSaveType('session');
    setShowSaveModal(true);
    onModalChange?.(true);
  };

  const handleRunReset = () => {
    if (run && canFinish(run) && !window.confirm('Discard this Pomodoro run?')) return;
    persistRun(null);
  };

  const view = run ? phaseView(run) : null;
  const saveDisplay = formatTime(finished ? finished.durationSeconds * 1000 : time);

  const timeDisplay = formatTime(time);
  const trimmedSessionName = sessionName.trim();
  const matchedActivity = trimmedSessionName
    ? tasks.find((t) => t.name.toLowerCase() === trimmedSessionName.toLowerCase())
    : undefined;

  const handleStart = () => {
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

    const durationInSeconds = finished ? finished.durationSeconds : time / 1000;
    const endTime = new Date();

    const session: StopwatchSessionCreate = {
      name: sessionName.trim(),
      duration: durationInSeconds,
      ...(sessionActivityChoice === '__new__'
        ? { new_activity_name: sessionName.trim() }
        : sessionActivityChoice
          ? { task_id: Number(sessionActivityChoice) }
          : {}),
      notes: notes || undefined,
      start_time: finished ? finished.startTime : startTime ?? undefined,
      end_time: finished ? finished.endTime : endTime.toISOString(),
      ...(finished
        ? {
            pomodoro_work_intervals: finished.pomodoroWorkIntervals,
            pomodoro_breaks: finished.pomodoroBreaks,
            pomodoro_break_seconds: finished.pomodoroBreakSeconds,
          }
        : {}),
    };

    onSaveSession(session);
    if (finished) persistRun(null);
    handleReset();
  };

  const handleSaveTimeLog = () => {
    if (selectedTaskId) {
      const durationInSeconds = finished ? finished.durationSeconds : time / 1000;
      onSaveTime(selectedTaskId, durationInSeconds, notes);
      if (finished) persistRun(null);
      handleReset();
    }
  };

  const handleReset = () => {
    setShowSaveModal(false);
    onModalChange?.(false);
    reset();
    setFinished(null);
    setNotes('');
    setSelectedTaskId(null);
    setSessionActivityChoice('');
    setSessionName('');
  };

  const handleCancel = () => {
    setShowSaveModal(false);
    setFinished(null);
    onModalChange?.(false);
  };

  return (
    <div className="glass-card rounded-2xl p-8 max-w-md mx-auto transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm">
      <h2 className="text-2xl font-bold text-center mb-6 text-white drop-shadow-lg">Stopwatch</h2>

      <div className="flex gap-2 mb-4">
        {(['stopwatch', 'pomodoro'] as const).map((m) => (
          <button
            key={m}
            data-testid={`mode-${m}`}
            disabled={modeLocked}
            onClick={() => {
              setMode(m);
              setPickerOpen(false);
            }}
            className={`flex-1 py-2 px-4 rounded-xl font-medium transition-all disabled:opacity-60 ${
              mode === m ? 'bg-white/30 text-white shadow-md' : 'bg-white/10 text-white/70'
            }`}
          >
            {m === 'stopwatch' ? 'Stopwatch' : 'Pomodoro'}
          </button>
        ))}
      </div>

      {mode === 'pomodoro' ? (
        run && view ? (
          <>
            <div className="glass-inner rounded-xl p-6 mb-6 text-center text-white">
              <div data-testid="pomodoro-phase" className="text-lg font-semibold">
                {PHASE_LABELS[view.phase]}
              </div>
              <div data-testid="pomodoro-phase-time" className="text-5xl font-mono drop-shadow-lg my-2">
                {view.overMs > 0 ? `+${formatMinSec(view.overMs)} over` : `${formatMinSec(view.remainingMs, true)} left`}
              </div>
              <div data-testid="pomodoro-total-work" className="text-sm text-white/70">
                Total work {formatMinSec(totalWorkMs(run))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-6">
              {run.status === 'running' ? (
                <button
                  data-testid="pomodoro-pause"
                  onClick={() => persistRun(pauseRun(run))}
                  className="glass-button font-semibold py-3 px-4 rounded-xl"
                >
                  Pause
                </button>
              ) : (
                <button
                  data-testid="pomodoro-resume"
                  onClick={() => persistRun(resumeRun(run))}
                  className="glass-button-green font-semibold py-3 px-4 rounded-xl"
                >
                  Resume
                </button>
              )}
              <button
                data-testid="pomodoro-switch"
                onClick={() => persistRun(switchPhase(run))}
                className="glass-button font-semibold py-3 px-4 rounded-xl"
              >
                {run.phase === 'work' ? 'Start break' : 'Start work'}
              </button>
              <button
                data-testid="pomodoro-finish"
                disabled={!canFinish(run)}
                onClick={handleRunFinish}
                className="glass-button-green font-semibold py-3 px-4 rounded-xl disabled:opacity-50"
              >
                Finish
              </button>
              <button
                data-testid="pomodoro-reset"
                onClick={handleRunReset}
                className="glass-button font-semibold py-3 px-4 rounded-xl"
              >
                Reset
              </button>
            </div>
          </>
        ) : pickerOpen ? (
          <div data-testid="pomodoro-picker" className="glass-inner rounded-xl p-4 mb-6 space-y-2 text-white">
            <p className="text-sm text-white/70">Choose an Activity</p>
            {tasks.map((task) => (
              <button
                key={task.id}
                data-testid={`pomodoro-activity-${task.id}`}
                onClick={() => setPickerChoice(String(task.id))}
                className={`w-full text-left py-2 px-4 rounded-xl ${
                  pickerChoice === String(task.id) ? 'bg-white/30' : 'bg-white/10'
                }`}
              >
                {task.name}
              </button>
            ))}
            <button
              data-testid="pomodoro-activity-new"
              onClick={() => setPickerChoice('__new__')}
              className={`w-full text-left py-2 px-4 rounded-xl ${
                pickerChoice === '__new__' ? 'bg-white/30' : 'bg-white/10'
              }`}
            >
              + New Activity
            </button>
            {pickerChoice === '__new__' && (
              <input
                data-testid="pomodoro-new-name"
                type="text"
                value={pickerNewName}
                onChange={(e) => setPickerNewName(e.target.value)}
                placeholder="New Activity name"
                className="bg-white/60 border border-slate-300 text-slate-800 placeholder-slate-500 w-full px-4 py-2 rounded-xl focus:outline-none"
              />
            )}
            <div className="flex gap-3 pt-2">
              <button
                data-testid="pomodoro-start"
                disabled={!pickerReady}
                onClick={handleRunStart}
                className="flex-1 glass-button-green font-semibold py-3 px-4 rounded-xl disabled:opacity-50"
              >
                Start
              </button>
              <button
                data-testid="pomodoro-cancel"
                onClick={() => setPickerOpen(false)}
                className="flex-1 glass-button font-semibold py-3 px-4 rounded-xl"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3 mb-6">
            <button
              onClick={openPicker}
              className="flex-1 glass-button-green font-semibold py-3 px-6 rounded-xl"
            >
              Start
            </button>
          </div>
        )
      ) : (
      <>
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
      </>
      )}

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-gradient-to-br from-slate-200/70 to-slate-400/5 border border-white/40 shadow-2xl rounded-2xl p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-slate-800">Save Recording</h3>
              <span className="font-mono text-lg text-slate-600">
                {saveDisplay.hours}:{saveDisplay.minutes}:{saveDisplay.seconds}
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
                    data-testid="select-activity"
                    value={sessionActivityChoice}
                    onChange={(e) => setSessionActivityChoice(e.target.value)}
                    className="bg-white/60 border border-slate-300 text-slate-800 placeholder-slate-500 w-full px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-400"
                  >
                    <option value="">No activity linked</option>
                    {tasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {matchedActivity?.id === task.id ? `Attach to ${task.name}` : task.name}
                      </option>
                    ))}
                    {trimmedSessionName && !matchedActivity && (
                      <option value="__new__" data-testid="option-activity-new">
                        {`+ New Activity: '${trimmedSessionName}'`}
                      </option>
                    )}
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
