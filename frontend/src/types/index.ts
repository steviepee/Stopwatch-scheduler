export interface Task {
  id: number;
  name: string;
  average_duration: number;
  total_recordings: number;
  created_at: string;
  updated_at: string;
}

export interface TimeLog {
  id: number;
  task_id: number;
  duration: number;
  notes?: string;
  created_at: string;
}

export interface TaskWithLogs extends Task {
  time_logs: TimeLog[];
}

export interface TaskCreate {
  name: string;
}

export interface TimeLogCreate {
  task_id: number;
  duration: number;
  notes?: string;
}

export interface StopwatchSession {
  id: number;
  name: string;
  duration: number;
  task_id?: number;
  notes?: string;
  calendar_event_id?: string;
  is_on_calendar: boolean;
  start_time?: string;
  end_time?: string;
  scheduled_start?: string;
  scheduled_end?: string;
  created_at: string;
  updated_at: string;
}

export interface StopwatchSessionCreate {
  name: string;
  duration: number;
  task_id?: number;
  notes?: string;
  start_time?: string;
  end_time?: string;
  scheduled_start?: string;
  scheduled_end?: string;
}

export interface StopwatchSessionUpdate {
  name?: string;
  duration?: number;
  task_id?: number;
  notes?: string;
  start_time?: string;
  end_time?: string;
  scheduled_start?: string;
  scheduled_end?: string;
  is_on_calendar?: boolean;
  calendar_event_id?: string;
}

export interface StopwatchSessionSchedule {
  scheduled_start: string;
  scheduled_end?: string;
}

export interface StopwatchSessionWithTask extends StopwatchSession {
  task?: Task;
}
