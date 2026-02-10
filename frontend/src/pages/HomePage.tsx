import { useState, useEffect, useMemo, useCallback } from 'react';
import Stopwatch from '../components/Stopwatch';
import TaskList from '../components/TaskList';
import TaskForm from '../components/TaskForm';
import SessionList from '../components/SessionList';
import { CalendarView } from '../components/calendar';
import { Task, StopwatchSession, StopwatchSessionCreate } from '../types';
import { taskAPI, timeLogAPI, sessionAPI } from '../services/api';

export default function HomePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<StopwatchSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'calendar' | 'sessions' | 'tasks'>('calendar');
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);

  // Derive scheduled/unscheduled from sessions
  const scheduledSessions = useMemo(
    () => sessions.filter(s => s.scheduled_start),
    [sessions]
  );
  const unscheduledSessions = useMemo(
    () => sessions.filter(s => !s.scheduled_start),
    [sessions]
  );

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [tasksData, sessionsData] = await Promise.all([
        taskAPI.getAll(),
        sessionAPI.getAll(),
      ]);
      setTasks(tasksData);
      setSessions(sessionsData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper to update a session in state
  const updateSessionInState = useCallback((updatedSession: StopwatchSession) => {
    setSessions(prev => prev.map(s => s.id === updatedSession.id ? updatedSession : s));
  }, []);

  // Helper to add a session to state
  const addSessionToState = useCallback((newSession: StopwatchSession) => {
    setSessions(prev => [newSession, ...prev]);
  }, []);

  // Helper to remove a session from state
  const removeSessionFromState = useCallback((sessionId: number) => {
    setSessions(prev => prev.filter(s => s.id !== sessionId));
  }, []);

  const handleCreateTask = useCallback(async (name: string) => {
    try {
      const newTask = await taskAPI.create({ name });
      setTasks(prev => [newTask, ...prev]);
    } catch (error) {
      console.error('Error creating task:', error);
    }
  }, []);

  const handleDeleteTask = useCallback(async (taskId: number) => {
    if (!confirm('Are you sure you want to delete this task?')) return;
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
      // Refetch just the updated task to get new average
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
    if (!confirm('Are you sure you want to delete this session?')) return;
    try {
      await sessionAPI.delete(sessionId);
      removeSessionFromState(sessionId);
    } catch (error) {
      console.error('Error deleting session:', error);
    }
  }, [removeSessionFromState]);

  const handleUpdateSession = useCallback(async (sessionId: number, name: string) => {
    try {
      const updatedSession = await sessionAPI.update(sessionId, { name });
      updateSessionInState(updatedSession);
    } catch (error) {
      console.error('Error updating session:', error);
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
      // Update session locally - clear calendar fields
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
    console.log('Selected task:', task);
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

  return (
    <div className="glass-background py-6 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-bold text-white drop-shadow-lg mb-2">
            Stopwatch Scheduler
          </h1>
          <p className="text-white/70 text-lg">Track your time, boost your productivity</p>
        </header>

        {/* Main Grid */}
        <div className="grid lg:grid-cols-2 gap-6 mb-8">
          {/* Stopwatch */}
          <Stopwatch
            tasks={tasks}
            onSaveTime={handleSaveTime}
            onSaveSession={handleSaveSession}
            onModalChange={setIsSaveModalOpen}
          />

          {/* Task Form */}
          <TaskForm onCreateTask={handleCreateTask} />
        </div>

        {/* Tab Navigation - hidden when save modal is open */}
        {!isSaveModalOpen && (
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setActiveTab('calendar')}
              className={`py-3 px-6 rounded-xl font-semibold transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm ${
                activeTab === 'calendar'
                  ? 'glass-button-primary'
                  : 'glass-button'
              }`}
            >
              Calendar
            </button>
            <button
              onClick={() => setActiveTab('sessions')}
              className={`py-3 px-6 rounded-xl font-semibold transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm ${
                activeTab === 'sessions'
                  ? 'glass-button-primary'
                  : 'glass-button'
              }`}
            >
              Sessions ({sessions.length})
            </button>
            <button
              onClick={() => setActiveTab('tasks')}
              className={`py-3 px-6 rounded-xl font-semibold transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm ${
                activeTab === 'tasks'
                  ? 'glass-button-primary'
                  : 'glass-button'
              }`}
            >
              Tasks ({tasks.length})
            </button>
          </div>
        )}

        {/* Tab Content - hidden when save modal is open */}
        {!isSaveModalOpen && (
          activeTab === 'calendar' ? (
            <CalendarView
              scheduledSessions={scheduledSessions}
              unscheduledSessions={unscheduledSessions}
              onSessionUpdate={updateSessionInState}
              onSessionCreate={addSessionToState}
            />
          ) : activeTab === 'sessions' ? (
            <SessionList
              sessions={sessions}
              onDeleteSession={handleDeleteSession}
              onUpdateSession={handleUpdateSession}
              onAddToCalendar={handleAddToCalendar}
              onRemoveFromCalendar={handleRemoveFromCalendar}
            />
          ) : (
            <TaskList
              tasks={tasks}
              onDeleteTask={handleDeleteTask}
              onSelectTask={handleSelectTask}
            />
          )
        )}
      </div>
    </div>
  );
}
