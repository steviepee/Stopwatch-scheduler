import axios from 'axios';
import { Task, TaskCreate, TimeLogCreate, TimeLog, StopwatchSession, StopwatchSessionCreate, StopwatchSessionUpdate, StopwatchSessionWithTask } from '../types';

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

// Stopwatch Session APIs
export const sessionAPI = {
  getAll: async (taskId?: number, onCalendar?: boolean): Promise<StopwatchSession[]> => {
    const params: Record<string, unknown> = {};
    if (taskId !== undefined) params.task_id = taskId;
    if (onCalendar !== undefined) params.on_calendar = onCalendar;
    const response = await api.get('/sessions', { params });
    return response.data;
  },

  getById: async (id: number): Promise<StopwatchSessionWithTask> => {
    const response = await api.get(`/sessions/${id}`);
    return response.data;
  },

  create: async (session: StopwatchSessionCreate): Promise<StopwatchSession> => {
    const response = await api.post('/sessions', session);
    return response.data;
  },

  update: async (id: number, session: StopwatchSessionUpdate): Promise<StopwatchSession> => {
    const response = await api.put(`/sessions/${id}`, session);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/sessions/${id}`);
  },

  addToCalendar: async (id: number): Promise<StopwatchSession> => {
    const response = await api.post(`/sessions/${id}/calendar`);
    return response.data;
  },

  removeFromCalendar: async (id: number): Promise<void> => {
    await api.delete(`/sessions/${id}/calendar`);
  },
};

export default api;
