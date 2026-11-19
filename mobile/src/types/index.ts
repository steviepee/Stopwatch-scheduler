export interface Task {
  id: number;
  name: string;
  average_duration: number;
  total_recordings: number;
  is_urgent?: boolean;
  is_important?: boolean;
  intended_length?: number | null;
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

export interface TaskUpdate {
  is_urgent?: boolean;
  is_important?: boolean;
  intended_length?: number | null;
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
  start_time?: string;
  end_time?: string;
  pomodoro_work_intervals?: number | null;
  pomodoro_breaks?: number | null;
  pomodoro_break_seconds?: number | null;
  created_at: string;
  updated_at: string;
}

export interface StopwatchSessionCreate {
  name: string;
  duration: number;
  task_id?: number;
  new_activity_name?: string;
  notes?: string;
  start_time?: string;
  end_time?: string;
  pomodoro_work_intervals?: number;
  pomodoro_breaks?: number;
  pomodoro_break_seconds?: number;
}

export interface StopwatchSessionUpdate {
  name?: string;
  duration?: number;
  task_id?: number | null;
  new_activity_name?: string;
  notes?: string;
  start_time?: string;
  end_time?: string;
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
  calendar_event_id?: string;
  calendar_stale?: boolean;
  task?: Task;
  is_frog?: boolean;
  created_at: string;
}

export interface ScheduleItemCreate {
  task_id?: number;
  custom_name?: string;
  estimated_duration: number;
  position?: number;
  scheduled_time?: string;
  is_frog?: boolean;
}

export interface ScheduleItemUpdate {
  task_id?: number;
  custom_name?: string;
  estimated_duration?: number;
  position?: number;
  scheduled_time?: string;
  is_frog?: boolean;
}

export interface ScheduleItemPlace {
  task_id: number;
  scheduled_time: string;
  estimated_duration?: number;
}

export interface Schedule {
  id: number;
  name: string | null;
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
  name?: string;
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
  tz_offset: number;
}

// User preferences persisted on the device
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

export interface GenerateActivity {
  task_id?: number | null;
  name: string;
  estimated_duration: number;
  is_urgent?: boolean;
  is_important?: boolean;
  is_frog?: boolean;
}

export interface GenerateEvent {
  name: string;
  start: string;
  end: string;
}

export interface GenerateRequest {
  start_time: string;
  day_start: string;
  day_end: string;
  activities: GenerateActivity[];
  existing_events?: GenerateEvent[];
  strategies?: string[] | null;
  avoid_existing?: boolean;
}

export interface TimelineEntry {
  task_id: number | null;
  name: string;
  start: string;
  end: string;
}

export interface FlaggedEntry {
  name: string;
  reason: string;
}

export interface StrategyOption {
  strategy: string;
  label: string;
  description: string;
  timeline: TimelineEntry[];
  flagged: FlaggedEntry[];
  excluded: FlaggedEntry[];
}

export interface GenerateResponse {
  options: StrategyOption[];
}

export interface PeakHoursResponse {
  peak_hour: number | null;
}

export interface PomodoroSettings {
  work_minutes: number;
  break_minutes: number;
  long_break_minutes: number;
  long_break_every: number;
}

export interface CoachSettings {
  notes_enabled: boolean;
}

export interface ReminderSettings {
  enabled: boolean;
  minutes_before: number;
}

export interface CoachNote {
  id: number;
  text: string;
  created_at: string;
  confirmed_at: string;
}

export interface CoachUsage {
  month: string;
  conversations: number;
  accepted: number;
  cost_usd: number;
}

export interface CoachConversationSummary {
  id: number;
  target_date: string;
  status: string;
  user_turns: number;
  revision_turns: number;
  call_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
  proposed_count: number | null;
  accepted_count: number | null;
  rating: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface CoachVisibleMessage {
  role: string;
  visible_text: string;
  created_at: string;
}

export interface CoachCallRow {
  turn_index: number;
  model: string;
  effort: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  stop_reason: string | null;
  latency_ms: number;
  cost_usd: number;
  created_at: string;
}

export interface CoachConversationDetail extends CoachConversationSummary {
  messages: CoachVisibleMessage[];
  proposal: { summary?: string } | null;
  calls: CoachCallRow[];
}
