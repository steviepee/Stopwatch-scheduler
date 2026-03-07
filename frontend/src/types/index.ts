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

export interface TaskStats {
  average: number;
  median: number | null;
  previous: number | null;
}

export interface ScheduleItem {
  id: number;
  schedule_id: number;
  task_id?: number;
  custom_name?: string;
  estimated_duration: number;
  position: number;
  scheduled_time?: string;
  task?: Task;
  created_at: string;
}

export interface ScheduleItemCreate {
  task_id?: number;
  custom_name?: string;
  estimated_duration: number;
  position?: number;
  scheduled_time?: string;
}

export interface ScheduleItemUpdate {
  task_id?: number;
  custom_name?: string;
  estimated_duration?: number;
  position?: number;
  scheduled_time?: string;
}

export interface Schedule {
  id: number;
  name: string;
  schedule_type: 'day' | 'week' | 'month';
  target_date?: string;
  rating?: number;
  notes?: string;
  is_regimen: boolean;
  items: ScheduleItem[];
  created_at: string;
  updated_at: string;
}

export interface ScheduleCreate {
  name: string;
  schedule_type?: 'day' | 'week' | 'month';
  target_date?: string;
  notes?: string;
  is_regimen?: boolean;
  items?: ScheduleItemCreate[];
}

export interface ScheduleUpdate {
  name?: string;
  schedule_type?: 'day' | 'week' | 'month';
  target_date?: string;
  rating?: number;
  notes?: string;
  is_regimen?: boolean;
}

export interface ApplyRegimen {
  target_date: string;
  name?: string;
}

// User preferences stored in localStorage
export interface UserOptions {
  showAverage: boolean;
  showMedian: boolean;
  showPrevious: boolean;
  backgroundImage: string | null;
}

export const DEFAULT_USER_OPTIONS: UserOptions = {
  showAverage: true,
  showMedian: true,
  showPrevious: true,
  backgroundImage: null,
};
