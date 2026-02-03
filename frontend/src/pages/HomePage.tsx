import { useState, useEffect } from 'react';
import Stopwatch from '../components/Stopwatch';
import TaskList from '../components/TaskList';
import TaskForm from '../components/TaskForm';
import SessionList from '../components/SessionList';
import { Task, StopwatchSession, StopwatchSessionCreate } from '../types';
import { taskAPI, timeLogAPI, sessionAPI } from '../services/api';

export default function HomePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<StopwatchSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'sessions' | 'tasks'>('sessions');

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

  const handleCreateTask = async (name: string) => {
    try {
      await taskAPI.create({ name });
      await loadData();
    } catch (error) {
      console.error('Error creating task:', error);
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
      await taskAPI.delete(taskId);
      await loadData();
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };

  const handleSaveTime = async (taskId: number, duration: number, notes?: string) => {
    try {
      await timeLogAPI.create({ task_id: taskId, duration, notes });
      await loadData();
    } catch (error) {
      console.error('Error saving time:', error);
    }
  };

  const handleSaveSession = async (session: StopwatchSessionCreate) => {
    try {
      await sessionAPI.create(session);
      await loadData();
    } catch (error) {
      console.error('Error saving session:', error);
    }
  };

  const handleDeleteSession = async (sessionId: number) => {
    if (!confirm('Are you sure you want to delete this session?')) return;
    try {
      await sessionAPI.delete(sessionId);
      await loadData();
    } catch (error) {
      console.error('Error deleting session:', error);
    }
  };

  const handleUpdateSession = async (sessionId: number, name: string) => {
    try {
      await sessionAPI.update(sessionId, { name });
      await loadData();
    } catch (error) {
      console.error('Error updating session:', error);
    }
  };

  const handleAddToCalendar = async (sessionId: number) => {
    try {
      await sessionAPI.addToCalendar(sessionId);
      await loadData();
    } catch (error) {
      console.error('Error adding to calendar:', error);
    }
  };

  const handleRemoveFromCalendar = async (sessionId: number) => {
    try {
      await sessionAPI.removeFromCalendar(sessionId);
      await loadData();
    } catch (error) {
      console.error('Error removing from calendar:', error);
    }
  };

  const handleSelectTask = (task: Task) => {
    console.log('Selected task:', task);
  };

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
          />

          {/* Task Form */}
          <TaskForm onCreateTask={handleCreateTask} />
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('sessions')}
            className={`py-3 px-6 rounded-xl font-semibold transition-all ${
              activeTab === 'sessions'
                ? 'glass-button-primary'
                : 'glass-button'
            }`}
          >
            Sessions ({sessions.length})
          </button>
          <button
            onClick={() => setActiveTab('tasks')}
            className={`py-3 px-6 rounded-xl font-semibold transition-all ${
              activeTab === 'tasks'
                ? 'glass-button-primary'
                : 'glass-button'
            }`}
          >
            Tasks ({tasks.length})
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'sessions' ? (
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
        )}
      </div>
    </div>
  );
}
