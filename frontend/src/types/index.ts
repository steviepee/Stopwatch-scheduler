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
