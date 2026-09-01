import axios from 'axios';
import { Task, TaskCreate, TaskStats, TimeLogCreate, TimeLog, StopwatchSession, StopwatchSessionCreate, StopwatchSessionUpdate, StopwatchSessionWithTask, StopwatchSessionSchedule, Schedule, ScheduleCreate, ScheduleUpdate, ScheduleItem, ScheduleItemCreate, ScheduleItemUpdate, ApplyRegimen } from '../types';

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
    const response = await api.get('/tasks/');
    return response.data;
  },

  getById: async (id: number): Promise<Task> => {
    const response = await api.get(`/tasks/${id}`);
    return response.data;
  },

  create: async (task: TaskCreate): Promise<Task> => {
    const response = await api.post('/tasks/', task);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/tasks/${id}`);
  },

  getStats: async (id: number): Promise<TaskStats> => {
    const response = await api.get(`/tasks/${id}/stats`);
    return response.data;
  },
};

// Time Log APIs
export const timeLogAPI = {
  getAll: async (taskId?: number): Promise<TimeLog[]> => {
    const params = taskId ? { task_id: taskId } : {};
    const response = await api.get('/time-logs/', { params });
    return response.data;
  },

  create: async (timeLog: TimeLogCreate): Promise<TimeLog> => {
    const response = await api.post('/time-logs/', timeLog);
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
  getAll: async (taskId?: number, onCalendar?: boolean, scheduled?: boolean): Promise<StopwatchSession[]> => {
    const params: Record<string, unknown> = {};
    if (taskId !== undefined) params.task_id = taskId;
    if (onCalendar !== undefined) params.on_calendar = onCalendar;
    if (scheduled !== undefined) params.scheduled = scheduled;
    const response = await api.get('/sessions/', { params });
    return response.data;
  },

  getScheduled: async (): Promise<StopwatchSession[]> => {
    const response = await api.get('/sessions/', { params: { scheduled: true } });
    return response.data;
  },

  getUnscheduled: async (): Promise<StopwatchSession[]> => {
    const response = await api.get('/sessions/', { params: { scheduled: false } });
    return response.data;
  },

  getById: async (id: number): Promise<StopwatchSessionWithTask> => {
    const response = await api.get(`/sessions/${id}`);
    return response.data;
  },

  create: async (session: StopwatchSessionCreate): Promise<StopwatchSession> => {
    const response = await api.post('/sessions/', session);
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

  schedule: async (id: number, schedule: StopwatchSessionSchedule): Promise<StopwatchSession> => {
    const response = await api.put(`/sessions/${id}/schedule`, schedule);
    return response.data;
  },

  unschedule: async (id: number): Promise<StopwatchSession> => {
    const response = await api.put(`/sessions/${id}/unschedule`);
    return response.data;
  },
};

// Schedule APIs
export const scheduleAPI = {
  getAll: async (isRegimen?: boolean): Promise<Schedule[]> => {
    const params: Record<string, unknown> = {};
    if (isRegimen !== undefined) params.is_regimen = isRegimen;
    const response = await api.get('/schedules/', { params });
    return response.data;
  },

  getById: async (id: number): Promise<Schedule> => {
    const response = await api.get(`/schedules/${id}`);
    return response.data;
  },

  create: async (schedule: ScheduleCreate): Promise<Schedule> => {
    const response = await api.post('/schedules/', schedule);
    return response.data;
  },

  update: async (id: number, schedule: ScheduleUpdate): Promise<Schedule> => {
    const response = await api.put(`/schedules/${id}`, schedule);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/schedules/${id}`);
  },

  rate: async (id: number, rating: number): Promise<Schedule> => {
    const response = await api.patch(`/schedules/${id}/rate`, null, { params: { rating } });
    return response.data;
  },

  applyRegimen: async (id: number, body: ApplyRegimen): Promise<Schedule> => {
    const response = await api.post(`/schedules/${id}/apply`, body);
    return response.data;
  },

  addItem: async (scheduleId: number, item: ScheduleItemCreate): Promise<ScheduleItem> => {
    const response = await api.post(`/schedules/${scheduleId}/items`, item);
    return response.data;
  },

  updateItem: async (scheduleId: number, itemId: number, item: ScheduleItemUpdate): Promise<ScheduleItem> => {
    const response = await api.put(`/schedules/${scheduleId}/items/${itemId}`, item);
    return response.data;
  },

  deleteItem: async (scheduleId: number, itemId: number): Promise<void> => {
    await api.delete(`/schedules/${scheduleId}/items/${itemId}`);
  },
};

// Google Calendar import
export const calendarImportAPI = {
  getEvents: async (date: string): Promise<{ summary: string; start: string; end: string }[]> => {
    const response = await api.get('/auth/calendar/events', { params: { date, tz_offset: new Date().getTimezoneOffset() } });
    return response.data;
  },
};

export default api;
