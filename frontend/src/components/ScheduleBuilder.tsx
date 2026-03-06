import { useState, useCallback } from 'react';
import { Task, Schedule, ScheduleCreate, ScheduleItemCreate, UserOptions, DEFAULT_USER_OPTIONS } from '../types';
import { scheduleAPI, calendarImportAPI, googleCalendarAPI } from '../services/api';
import ActivityInput from './ActivityInput';
import ScheduleTimeline from './ScheduleTimeline';

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

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function todayDateValue(): string {
  return new Date().toISOString().split('T')[0];
}

export default function ScheduleBuilder({ tasks, options, onScheduleCreated }: ScheduleBuilderProps) {
  const opts = options ?? DEFAULT_USER_OPTIONS;

  const [step, setStep] = useState<BuilderStep>('setup');
  const [targetDate, setTargetDate] = useState(todayDateValue());
  const [startHour, setStartHour] = useState('08:00');
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [chosenItems, setChosenItems] = useState<ScheduleItemCreate[]>([]);
  const [chosenOrder, setChosenOrder] = useState<ActivityEntry[]>([]);
  const [existingEvents, setExistingEvents] = useState<{ name: string; start: string; end: string }[]>([]);
  const [importingCal, setImportingCal] = useState(false);
  const [calImported, setCalImported] = useState(false);

  // Save step state
  const [scheduleName, setScheduleName] = useState('');
  const [saveAsRegimen, setSaveAsRegimen] = useState(false);
  const [saving, setSaving] = useState(false);

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

  const handleReorder = useCallback((reordered: ActivityEntry[]) => {
    setActivities(reordered);
  }, []);

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

  const handleGenerate = () => {
    if (activities.length === 0) return;
    setStep('generate');
  };

  const handleSelectSchedule = useCallback((ordered: ActivityEntry[], items: ScheduleItemCreate[]) => {
    setChosenOrder(ordered);
    setChosenItems(items);
    const defaultName = new Date(targetDate).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    setScheduleName(defaultName + ' Schedule');
    setStep('save');
  }, [targetDate]);

  const handleSave = async () => {
    if (!scheduleName.trim()) return;
    setSaving(true);
    try {
      const payload: ScheduleCreate = {
        name: scheduleName.trim(),
        schedule_type: 'day',
        target_date: new Date(targetDate).toISOString(),
        is_regimen: saveAsRegimen,
        items: chosenItems,
      };
      const created = await scheduleAPI.create(payload);
      onScheduleCreated(created);
      // Reset builder
      setStep('setup');
      setActivities([]);
      setChosenItems([]);
      setChosenOrder([]);
      setExistingEvents([]);
      setCalImported(false);
      setSaveAsRegimen(false);
    } catch {
      alert('Failed to save schedule.');
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

      {/* Step: Setup */}
      {step === 'setup' && (
        <div className="space-y-5">
          {/* Date + Time row */}
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-40">
              <label className="block text-white/60 text-xs mb-1">Date</label>
              <input
                type="date"
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
                className="glass-input w-full px-3 py-2 rounded-xl text-white text-sm"
              />
            </div>
            <div className="flex-1 min-w-36">
              <label className="block text-white/60 text-xs mb-1">Start Time</label>
              <input
                type="time"
                value={startHour}
                onChange={e => setStartHour(e.target.value)}
                className="glass-input w-full px-3 py-2 rounded-xl text-white text-sm"
              />
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

          <button
            onClick={handleGenerate}
            disabled={activities.length === 0}
            className="w-full glass-button-primary py-3 rounded-xl font-semibold text-sm disabled:opacity-40"
          >
            Generate Schedule Options
          </button>
        </div>
      )}

      {/* Step: Generate — pick from 4 options */}
      {step === 'generate' && (
        <ScheduleTimeline
          activities={activities}
          startTime={startTime}
          existingEvents={existingEvents}
          onSelect={handleSelectSchedule}
          onReorder={handleReorder}
        />
      )}

      {/* Step: Save */}
      {step === 'save' && (
        <div className="space-y-4">
          <div className="glass-inner rounded-xl px-4 py-3 space-y-1">
            {chosenOrder.map((a, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-white">{a.name}</span>
                <span className="text-white/50">{formatDuration(a.estimatedDuration)}</span>
              </div>
            ))}
          </div>

          <div>
            <label className="block text-white/60 text-xs mb-1">Schedule name</label>
            <input
              type="text"
              value={scheduleName}
              onChange={e => setScheduleName(e.target.value)}
              className="glass-input w-full px-4 py-2 rounded-xl text-white text-sm"
              autoFocus
            />
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={saveAsRegimen}
              onChange={e => setSaveAsRegimen(e.target.checked)}
              className="w-4 h-4 rounded accent-emerald-400"
            />
            <span className="text-white/70 text-sm">Save as Regimen (reusable template)</span>
          </label>

          <button
            onClick={handleSave}
            disabled={!scheduleName.trim() || saving}
            className="w-full glass-button-primary py-3 rounded-xl font-semibold text-sm disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save Schedule'}
          </button>
        </div>
      )}
    </div>
  );
}
