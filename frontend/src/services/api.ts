import axios from 'axios';
import { Task, TaskCreate, TimeLogCreate, TimeLog } from '../types';

const API_BASE_URL = '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Task APIs
export const taskAPI = {
  getAll: async (): Promise<Task[]> => {
    const response = await api.get('/tasks');
    return response.data;
  },

  getById: async (id: number): Promise<Task> => {
    const response = await api.get(`/tasks/${id}`);
    return response.data;
  },

  create: async (task: TaskCreate): Promise<Task> => {
    const response = await api.post('/tasks', task);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/tasks/${id}`);
  },
};

// Time Log APIs
export const timeLogAPI = {
  getAll: async (taskId?: number): Promise<TimeLog[]> => {
    const params = taskId ? { task_id: taskId } : {};
    const response = await api.get('/time-logs', { params });
    return response.data;
  },

  create: async (timeLog: TimeLogCreate): Promise<TimeLog> => {
    const response = await api.post('/time-logs', timeLog);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/time-logs/${id}`);
  },
};

// Google Calendar APIs
export const googleCalendarAPI = {
  login: async () => {
    const response = await api.get('/auth/google/login');
    return response.data;
  },

  checkAuthStatus: async () => {
    const response = await api.get('/auth/status');
    return response.data;
  },

  createEvent: async (taskName: string, durationSeconds: number, startTime?: string) => {
    const response = await api.post('/auth/calendar/event', null, {
      params: {
        task_name: taskName,
        duration_seconds: durationSeconds,
        start_time: startTime,
      },
    });
    return response.data;
  },
};

export default api;
