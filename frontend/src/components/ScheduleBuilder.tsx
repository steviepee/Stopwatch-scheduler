import { useState, useCallback, useRef, useEffect } from 'react';
import { Task, Schedule, ScheduleCreate, ScheduleItemCreate, UserOptions, DEFAULT_USER_OPTIONS, GenerateActivity, GenerateEvent, StrategyOption } from '../types';
import { scheduleAPI, calendarImportAPI, googleCalendarAPI, insightsAPI } from '../services/api';
import ActivityInput from './ActivityInput';
import ScheduleTimeline from './ScheduleTimeline';
import { dateKey } from '../utils/calendarUtils';

interface ActivityEntry {
  taskId?: number;
  name: string;
  estimatedDuration: number; // seconds
}

interface ScheduleBuilderProps {
  tasks: Task[];
  options?: UserOptions;
  onScheduleCreated: (schedule: Schedule) => void;
}

type BuilderStep = 'setup' | 'generate' | 'save';

function formatHour(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12} ${period}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function ScheduleBuilder({ tasks, options, onScheduleCreated }: ScheduleBuilderProps) {
  const opts = options ?? DEFAULT_USER_OPTIONS;

  const [step, setStep] = useState<BuilderStep>('setup');
  const [targetDate, setTargetDate] = useState(() => dateKey(new Date()));
  const [startHour, setStartHour] = useState('08:00');
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [frogId, setFrogId] = useState<number | null>(null);
  const [chosenItems, setChosenItems] = useState<ScheduleItemCreate[]>([]);
  const [existingEvents, setExistingEvents] = useState<GenerateEvent[]>([]);
  const [dayEvents, setDayEvents] = useState<GenerateEvent[]>([]);
  const [planOptions, setPlanOptions] = useState<StrategyOption[]>([]);
  const generateSeq = useRef(0);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(false);
  const [importingCal, setImportingCal] = useState(false);
  const [calImported, setCalImported] = useState(false);
  const [peakHour, setPeakHour] = useState<number | null>(null);

  useEffect(() => {
    insightsAPI.getPeakHours()
      .then(res => setPeakHour(res.peak_hour))
      .catch(() => setPeakHour(null));
  }, []);

  // Save step state
  const [scheduleName, setScheduleName] = useState('');
  const [saveAsRegimen, setSaveAsRegimen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'success' | 'error' | null>(null);
  const [frogReplaceNotice, setFrogReplaceNotice] = useState<string | null>(null);

  const startTime = (() => {
    const d = new Date(targetDate + 'T' + startHour + ':00');
    return isNaN(d.getTime()) ? new Date() : d;
  })();

  const handleAddActivity = useCallback((activity: ActivityEntry) => {
    setActivities(prev => [...prev, activity]);
  }, []);

  const handleRemoveActivity = useCallback((idx: number) => {
    setActivities(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handleUsePeakHour = () => {
    if (peakHour == null) return;
    setStartHour(`${String(peakHour).padStart(2, '0')}:00`);
  };

  const runGenerate = async (list: ActivityEntry[], events: GenerateEvent[]) => {
    const seq = ++generateSeq.current;
    const dayStart = new Date(startTime);
    dayStart.setHours(6, 0, 0, 0);
    const dayEnd = new Date(startTime);
    dayEnd.setHours(23, 0, 0, 0);
    const response = await scheduleAPI.generate({
      start_time: startTime.toISOString(),
      day_start: dayStart.toISOString(),
      day_end: dayEnd.toISOString(),
      activities: list.map(a => ({
        task_id: a.taskId,
        name: a.name,
        estimated_duration: a.estimatedDuration,
        is_frog: a.taskId !== undefined && a.taskId === frogId ? true : undefined,
      })),
      existing_events: events,
      avoid_existing: true,
    });
    if (seq !== generateSeq.current) return;
    setPlanOptions(response.options);
    setStep('generate');
  };

  const handleReorder = async (reordered: GenerateActivity[]) => {
    const list = reordered.map(a => ({
      taskId: a.task_id ?? undefined,
      name: a.name,
      estimatedDuration: a.estimated_duration,
    }));
    setActivities(list);
    setGenerateError(false);
    try {
      await runGenerate(list, [...existingEvents, ...dayEvents]);
    } catch {
      setGenerateError(true);
      setStep('setup');
    }
  };

  const handleImportCalendar = async () => {
    setImportingCal(true);
    try {
      const status = await googleCalendarAPI.checkAuthStatus();
      if (!status.authenticated) {
        alert('Not connected to Google Calendar. Connect via the Calendar tab first.');
        return;
      }
      const events = await calendarImportAPI.getEvents(targetDate);
      // Deduplicate: drop events whose name+time already exist
      const normalized = events.map(e => ({ name: e.summary, start: e.start, end: e.end }));
      const newEvents = normalized.filter(e =>
        !existingEvents.some(ex => ex.name === e.name && ex.start === e.start)
      );
      setExistingEvents(prev => [...prev, ...newEvents]);
      setCalImported(true);
    } catch {
      alert('Failed to import calendar events.');
    } finally {
      setImportingCal(false);
    }
  };

  const handleGenerate = async () => {
    if (activities.length === 0) return;
    setGenerating(true);
    setGenerateError(false);
    setSaveResult(null);
    try {
      const daySchedules = await scheduleAPI.getRange(targetDate, targetDate);
      const events = daySchedules.flatMap(s => s.items)
        .filter(item => item.scheduled_time)
        .map(item => {
          const start = new Date(item.scheduled_time!);
          return {
            name: item.task?.name ?? item.custom_name ?? '',
            start: start.toISOString(),
            end: new Date(start.getTime() + item.estimated_duration * 1000).toISOString(),
          };
        });
      setDayEvents(events);
      await runGenerate(activities, [...existingEvents, ...events]);
    } catch {
      setGenerateError(true);
    } finally {
      setGenerating(false);
    }
  };

  const handleSelectSchedule = useCallback((items: ScheduleItemCreate[]) => {
    const stamped = frogId == null
      ? items
      : items.map(item => item.task_id === frogId ? { ...item, is_frog: true } : item);
    setChosenItems(stamped);
    setScheduleName('');
    setStep('save');
  }, [frogId]);

  const handleSave = async () => {
    if (saving || (saveAsRegimen && !scheduleName.trim())) return;
    setSaving(true);
    setSaveResult(null);
    setFrogReplaceNotice(null);
    try {
      let notice: string | null = null;
      if (!saveAsRegimen) {
        const daySchedules = await scheduleAPI.getRange(targetDate, targetDate);
        const existingFrogItem = daySchedules.flatMap(s => s.items).find(item => item.is_frog);
        const newFrogItem = frogId == null ? undefined : chosenItems.find(item => item.task_id === frogId);
        if (existingFrogItem && newFrogItem) {
          const newName = tasks.find(t => t.id === newFrogItem.task_id)?.name ?? newFrogItem.custom_name ?? '';
          const oldName = existingFrogItem.task?.name ?? existingFrogItem.custom_name ?? '';
          if (newName && newName !== oldName) {
            notice = `Frog is now ${newName} (was ${oldName}).`;
          }
        }
      }
      const payload: ScheduleCreate = saveAsRegimen
        ? { name: scheduleName.trim(), schedule_type: 'day', is_regimen: true, items: chosenItems }
        : { schedule_type: 'day', target_date: targetDate, is_regimen: false, items: chosenItems };
      const created = await scheduleAPI.create(payload);
      onScheduleCreated(created);
      setSaveResult('success');
      setFrogReplaceNotice(notice);
      // Reset builder
      setStep('setup');
      setActivities([]);
      setFrogId(null);
      setChosenItems([]);
      setExistingEvents([]);
      setDayEvents([]);
      setPlanOptions([]);
      setCalImported(false);
      setSaveAsRegimen(false);
    } catch {
      setSaveResult('error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Schedule Builder</h2>
        {step !== 'setup' && (
          <button
            onClick={() => setStep(step === 'save' ? 'generate' : 'setup')}
            className="text-white/50 hover:text-white text-sm transition-colors"
          >
            ← Back
          </button>
        )}
      </div>

      {saveResult === 'success' && (
        <p data-testid="save-success" className="text-emerald-300 text-sm">Schedule saved.</p>
      )}
      {frogReplaceNotice && (
        <p data-testid="frog-replace-notice" className="text-amber-300 text-sm">{frogReplaceNotice}</p>
      )}

      {/* Step: Setup */}
      {step === 'setup' && (
        <div className="space-y-5">
          {/* Date + Time row */}
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-40">
              <label className="block text-white/60 text-xs mb-1">Date</label>
              <input
                type="date"
                data-testid="input-target-date"
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
                className="glass-input w-full px-3 py-2 rounded-xl text-white text-sm"
              />
            </div>
            <div className="flex-1 min-w-36">
              <label className="block text-white/60 text-xs mb-1">Start Time</label>
              <input
                type="time"
                data-testid="input-start-time"
                value={startHour}
                onChange={e => setStartHour(e.target.value)}
                className="glass-input w-full px-3 py-2 rounded-xl text-white text-sm"
              />
              {peakHour != null && (
                <button
                  type="button"
                  data-testid="peak-hour-hint"
                  onClick={handleUsePeakHour}
                  className="block text-left text-amber-300/80 hover:text-amber-300 text-xs mt-1"
                >
                  Your peak hour: {formatHour(peakHour)}. Use it.
                </button>
              )}
            </div>
            <div className="flex items-end">
              <button
                onClick={handleImportCalendar}
                disabled={importingCal || calImported}
                className="glass-button px-3 py-2 rounded-xl text-sm whitespace-nowrap disabled:opacity-50"
                title="Import today's Google Calendar events to help with Best Fit scheduling"
              >
                {importingCal ? 'Importing…' : calImported ? `✓ ${existingEvents.length} imported` : 'Import from Google Calendar'}
              </button>
            </div>
          </div>

          {/* Activity list */}
          <div>
            <label className="block text-white/60 text-xs mb-2">Activities to schedule</label>
            <ActivityInput tasks={tasks} onAdd={handleAddActivity} options={opts} />
          </div>

          {/* Added activities */}
          {activities.length > 0 && (
            <div className="space-y-1.5">
              {activities.map((a, i) => (
                <div key={i} className="glass-inner rounded-xl px-4 py-2.5 flex items-center gap-3">
                  <span className="text-white/40 text-xs w-5 text-center">{i + 1}</span>
                  <span className="flex-1 text-white text-sm">{a.name}</span>
                  {a.taskId !== undefined && (
                    <label className="flex items-center cursor-pointer" title="Frog: today's hardest task">
                      <input
                        type="checkbox"
                        data-testid={`frog-toggle-${a.taskId}`}
                        checked={frogId === a.taskId}
                        onChange={() => setFrogId(prev => prev === a.taskId ? null : a.taskId!)}
                        className="w-4 h-4 rounded accent-amber-400"
                      />
                    </label>
                  )}
                  <span className="text-white/50 text-xs">{formatDuration(a.estimatedDuration)}</span>
                  <button
                    onClick={() => handleRemoveActivity(i)}
                    className="text-white/30 hover:text-red-400 transition-colors text-xs"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="text-right text-white/40 text-xs">
                Total: {formatDuration(activities.reduce((s, a) => s + a.estimatedDuration, 0))}
              </div>
            </div>
          )}

          {generateError && (
            <p data-testid="generate-error" className="text-red-300 text-sm">Couldn't generate plans for that day. Try again.</p>
          )}

          <button
            onClick={handleGenerate}
            disabled={activities.length === 0 || generating}
            className="w-full glass-button-primary py-3 rounded-xl font-semibold text-sm disabled:opacity-40"
          >
            Generate Schedule Options
          </button>
        </div>
      )}

      {/* Step: Generate — pick from 4 options */}
      {step === 'generate' && (
        <ScheduleTimeline
          options={planOptions}
          onSelect={handleSelectSchedule}
          onReorder={handleReorder}
        />
      )}

      {/* Step: Save */}
      {step === 'save' && (
        <div className="space-y-4">
          <div className="glass-inner rounded-xl px-4 py-3 space-y-1">
            {chosenItems.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-white">{tasks.find(t => t.id === item.task_id)?.name ?? item.custom_name}</span>
                <span className="text-white/50">{formatDuration(item.estimated_duration)}</span>
              </div>
            ))}
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              data-testid="checkbox-regimen"
              checked={saveAsRegimen}
              onChange={e => setSaveAsRegimen(e.target.checked)}
              className="w-4 h-4 rounded accent-emerald-400"
            />
            <span className="text-white/70 text-sm">Save as Regimen (reusable template)</span>
          </label>

          {saveAsRegimen && (
            <div>
              <label className="block text-white/60 text-xs mb-1">Regimen name</label>
              <input
                type="text"
                data-testid="input-schedule-name"
                value={scheduleName}
                onChange={e => setScheduleName(e.target.value)}
                className="glass-input w-full px-4 py-2 rounded-xl text-white text-sm"
                autoFocus
              />
            </div>
          )}

          {saveResult === 'error' && (
            <p data-testid="save-error" className="text-red-300 text-sm">Failed to save schedule. Try again.</p>
          )}

          <button
            data-testid="btn-save-schedule"
            onClick={handleSave}
            disabled={(saveAsRegimen && !scheduleName.trim()) || saving}
            className="w-full glass-button-primary py-3 rounded-xl font-semibold text-sm disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save Schedule'}
          </button>
        </div>
      )}
    </div>
  );
}
