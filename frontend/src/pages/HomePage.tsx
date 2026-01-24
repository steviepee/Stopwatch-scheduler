import { useState, useEffect } from 'react';
import Stopwatch from '../components/Stopwatch';
import TaskList from '../components/TaskList';
import TaskForm from '../components/TaskForm';
import { Task } from '../types';
import { taskAPI, timeLogAPI } from '../services/api';

export default function HomePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    try {
      setLoading(true);
      const data = await taskAPI.getAll();
      setTasks(data);
    } catch (error) {
      console.error('Error loading tasks:', error);
      alert('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (name: string) => {
    try {
      await taskAPI.create({ name });
      await loadTasks();
    } catch (error) {
      console.error('Error creating task:', error);
      alert('Failed to create task');
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!confirm('Are you sure you want to delete this task?')) return;

    try {
      await taskAPI.delete(taskId);
      await loadTasks();
    } catch (error) {
      console.error('Error deleting task:', error);
      alert('Failed to delete task');
    }
  };

  const handleSaveTime = async (taskId: number, duration: number, notes?: string) => {
    try {
      await timeLogAPI.create({ task_id: taskId, duration, notes });
      await loadTasks(); // Reload to get updated averages
      alert('Time saved successfully!');
    } catch (error) {
      console.error('Error saving time:', error);
      alert('Failed to save time');
    }
  };

  const handleSelectTask = (task: Task) => {
    // Navigate to task detail page (could be implemented with React Router)
    console.log('Selected task:', task);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-8 text-gray-800">
          Stopwatch Scheduler
        </h1>

        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <Stopwatch tasks={tasks} onSaveTime={handleSaveTime} />
          <TaskForm onCreateTask={handleCreateTask} />
        </div>

        <TaskList
          tasks={tasks}
          onDeleteTask={handleDeleteTask}
          onSelectTask={handleSelectTask}
        />
      </div>
    </div>
  );
}
