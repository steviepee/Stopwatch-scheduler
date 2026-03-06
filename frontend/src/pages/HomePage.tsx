import { useState, useEffect, useMemo, useCallback } from 'react';
import Stopwatch from '../components/Stopwatch';
import TaskList from '../components/TaskList';
import TaskForm from '../components/TaskForm';
import SessionList from '../components/SessionList';
import ScheduleBuilder from '../components/ScheduleBuilder';
import ScheduleList from '../components/ScheduleList';
import OptionsPage from '../components/OptionsPage';
import { CalendarView } from '../components/calendar';
import TaskDetailModal from '../components/TaskDetailModal';
import { Task, StopwatchSession, StopwatchSessionCreate, Schedule, UserOptions, DEFAULT_USER_OPTIONS } from '../types';
import { taskAPI, timeLogAPI, sessionAPI, scheduleAPI } from '../services/api';

type ActiveTab = 'calendar' | 'schedule' | 'recordings' | 'activities' | 'options';

function loadOptions(): UserOptions {
  try {
    const raw = localStorage.getItem('userOptions');
    if (raw) return { ...DEFAULT_USER_OPTIONS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_USER_OPTIONS;
}

function saveOptions(opts: UserOptions) {
  localStorage.setItem('userOptions', JSON.stringify(opts));
}

export default function HomePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<StopwatchSession[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('calendar');
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [options, setOptions] = useState<UserOptions>(loadOptions);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Derive scheduled/unscheduled from sessions
  const scheduledSessions = useMemo(
    () => sessions.filter(s => s.scheduled_start),
    [sessions]
  );
  const unscheduledSessions = useMemo(
    () => sessions.filter(s => !s.scheduled_start),
    [sessions]
  );

  // Derive schedules vs regimens
  const savedSchedules = useMemo(() => schedules.filter(s => !s.is_regimen), [schedules]);
  const regimens = useMemo(() => schedules.filter(s => s.is_regimen), [schedules]);

  // Apply background image from options
  useEffect(() => {
    const bg = options.backgroundImage ?? '/cloth_mural.jpg';
    document.documentElement.style.setProperty('--bg-image', `url('${bg}')`);
  }, [options.backgroundImage]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [tasksData, sessionsData, schedulesData] = await Promise.all([
        taskAPI.getAll(),
        sessionAPI.getAll(),
        scheduleAPI.getAll(),
      ]);
      setTasks(tasksData);
      setSessions(sessionsData);
      setSchedules(schedulesData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOptionsChange = useCallback((opts: UserOptions) => {
    setOptions(opts);
    saveOptions(opts);
  }, []);

  // Session helpers
  const updateSessionInState = useCallback((updatedSession: StopwatchSession) => {
    setSessions(prev => prev.map(s => s.id === updatedSession.id ? updatedSession : s));
  }, []);

  const addSessionToState = useCallback((newSession: StopwatchSession) => {
    setSessions(prev => [newSession, ...prev]);
  }, []);

  const removeSessionFromState = useCallback((sessionId: number) => {
    setSessions(prev => prev.filter(s => s.id !== sessionId));
  }, []);

  // Schedule helpers
  const addScheduleToState = useCallback((s: Schedule) => {
    setSchedules(prev => [s, ...prev]);
  }, []);

  const updateScheduleInState = useCallback((s: Schedule) => {
    setSchedules(prev => prev.map(x => x.id === s.id ? s : x));
  }, []);

  const removeScheduleFromState = useCallback((id: number) => {
    setSchedules(prev => prev.filter(s => s.id !== id));
  }, []);

  const handleApplyRegimen = useCallback(async (regimen: Schedule) => {
    const dateStr = prompt('Apply regimen to date (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
    if (!dateStr) return;
    try {
      const applied = await scheduleAPI.applyRegimen(regimen.id, {
        target_date: new Date(dateStr).toISOString(),
      });
      addScheduleToState(applied);
      setActiveTab('schedule');
    } catch {
      alert('Failed to apply regimen.');
    }
  }, [addScheduleToState]);

  // Task handlers
  const handleCreateTask = useCallback(async (name: string) => {
    try {
      const newTask = await taskAPI.create({ name });
      setTasks(prev => [newTask, ...prev]);
    } catch (error) {
      console.error('Error creating task:', error);
    }
  }, []);

  const handleDeleteTask = useCallback(async (taskId: number) => {
    if (!confirm('Are you sure you want to delete this activity?')) return;
    try {
      await taskAPI.delete(taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  }, []);

  const handleSaveTime = useCallback(async (taskId: number, duration: number, notes?: string) => {
    try {
      await timeLogAPI.create({ task_id: taskId, duration, notes });
      const updatedTask = await taskAPI.getById(taskId);
      setTasks(prev => prev.map(t => t.id === taskId ? updatedTask : t));
    } catch (error) {
      console.error('Error saving time:', error);
    }
  }, []);

  const handleSaveSession = useCallback(async (session: StopwatchSessionCreate) => {
    try {
      const newSession = await sessionAPI.create(session);
      addSessionToState(newSession);
    } catch (error) {
      console.error('Error saving session:', error);
    }
  }, [addSessionToState]);

  const handleDeleteSession = useCallback(async (sessionId: number) => {
    if (!confirm('Are you sure you want to delete this recording?')) return;
    try {
      await sessionAPI.delete(sessionId);
      removeSessionFromState(sessionId);
    } catch (error) {
      console.error('Error deleting recording:', error);
    }
  }, [removeSessionFromState]);

  const handleUpdateSession = useCallback(async (sessionId: number, name: string) => {
    try {
      const updatedSession = await sessionAPI.update(sessionId, { name });
      updateSessionInState(updatedSession);
    } catch (error) {
      console.error('Error updating recording:', error);
    }
  }, [updateSessionInState]);

  const handleAddToCalendar = useCallback(async (sessionId: number) => {
    try {
      const updatedSession = await sessionAPI.addToCalendar(sessionId);
      updateSessionInState(updatedSession);
    } catch (error) {
      console.error('Error adding to calendar:', error);
    }
  }, [updateSessionInState]);

  const handleRemoveFromCalendar = useCallback(async (sessionId: number) => {
    try {
      await sessionAPI.removeFromCalendar(sessionId);
      setSessions(prev => prev.map(s =>
        s.id === sessionId
          ? { ...s, is_on_calendar: false, calendar_event_id: undefined }
          : s
      ));
    } catch (error) {
      console.error('Error removing from calendar:', error);
    }
  }, []);

  const handleSelectTask = useCallback((task: Task) => {
    setSelectedTask(task);
  }, []);

  if (loading) {
    return (
      <div className="glass-background flex items-center justify-center">
        <div className="glass-card rounded-2xl p-8">
          <div className="text-xl text-white flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Loading...
          </div>
        </div>
      </div>
    );
  }

  const tabs: { key: ActiveTab; label: string }[] = [
    { key: 'calendar', label: 'Calendar' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'recordings', label: `Recordings (${sessions.length})` },
    { key: 'activities', label: `Activities (${tasks.length})` },
    { key: 'options', label: 'Options' },
  ];

  return (
    <>
    {selectedTask && (
      <TaskDetailModal
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onTaskUpdated={updated => setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))}
      />
    )}
    <div className="glass-background py-6 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-bold text-white drop-shadow-lg mb-2">
            Stopwatch Scheduler
          </h1>
          <p className="text-white/70 text-lg">Track your time, build smarter schedules</p>
        </header>

        {/* Main Grid */}
        <div className="grid lg:grid-cols-2 gap-6 mb-8">
          <Stopwatch
            tasks={tasks}
            onSaveTime={handleSaveTime}
            onSaveSession={handleSaveSession}
            onModalChange={setIsSaveModalOpen}
          />
          <TaskForm onCreateTask={handleCreateTask} />
        </div>

        {/* Tab Navigation */}
        {!isSaveModalOpen && (
          <div className="flex gap-2 mb-6 flex-wrap">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`py-3 px-6 rounded-xl font-semibold transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm ${
                  activeTab === tab.key ? 'glass-button-primary' : 'glass-button'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Tab Content */}
        {!isSaveModalOpen && (
          <>
            {activeTab === 'calendar' && (
              <CalendarView
                scheduledSessions={scheduledSessions}
                unscheduledSessions={unscheduledSessions}
                onSessionUpdate={updateSessionInState}
                onSessionCreate={addSessionToState}
                tasks={tasks}
                options={options}
              />
            )}

            {activeTab === 'schedule' && (
              <div className="space-y-6">
                <ScheduleBuilder
                  tasks={tasks}
                  options={options}
                  onScheduleCreated={addScheduleToState}
                />
                <ScheduleList
                  schedules={savedSchedules}
                  regimens={regimens}
                  onScheduleUpdate={updateScheduleInState}
                  onScheduleDelete={removeScheduleFromState}
                  onApplyRegimen={handleApplyRegimen}
                />
              </div>
            )}

            {activeTab === 'recordings' && (
              <SessionList
                sessions={sessions}
                onDeleteSession={handleDeleteSession}
                onUpdateSession={handleUpdateSession}
                onAddToCalendar={handleAddToCalendar}
                onRemoveFromCalendar={handleRemoveFromCalendar}
              />
            )}

            {activeTab === 'activities' && (
              <TaskList
                tasks={tasks}
                onDeleteTask={handleDeleteTask}
                onSelectTask={handleSelectTask}
              />
            )}

            {activeTab === 'options' && (
              <OptionsPage options={options} onChange={handleOptionsChange} />
            )}
          </>
        )}
      </div>
    </div>
    </>
  );
}
