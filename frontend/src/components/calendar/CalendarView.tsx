import { useState, useCallback, useEffect, useMemo } from 'react';
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, pointerWithin } from '@dnd-kit/core';
import { Schedule, ScheduleItem, Task } from '../../types';
import { scheduleAPI } from '../../services/api';
import { CalendarGrid } from './CalendarGrid';
import { ActivityBank } from './ActivityBank';
import { ActivityPicker } from './ActivityPicker';
import { formatDuration, previousWeek, nextWeek, previousDay, nextDay, formatDayLong, getWeekDays, dateKey } from '../../utils/calendarUtils';

interface CalendarViewProps {
  tasks: Task[];
}

const START_HOUR = 6;
const END_HOUR = 23;
const SLOT_HEIGHT = 30; // pixels per 30 minutes
const INTERVAL_MIN = 30;
const SNAP_MIN = 15;
const NO_HISTORY_SECONDS = 600;

type Status = { kind: 'working' | 'success' | 'error'; text: string };

function errorText(error: unknown, fallback: string): string {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 401) return 'Google Calendar is not authorized. Authorize from a laptop, then try again.';
  return fallback;
}

// Minutes since START_HOUR, snapped and kept on the grid.
function snapMinutes(minutes: number, round: (n: number) => number): number {
  const snapped = round(minutes / SNAP_MIN) * SNAP_MIN;
  return Math.min(Math.max(snapped, 0), (END_HOUR - START_HOUR) * 60 - SNAP_MIN);
}

function slotTime(key: string, minutes: number): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, START_HOUR, minutes);
}

export function CalendarView({ tasks }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'week' | 'day'>('week');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [activeDrag, setActiveDrag] = useState<{ name: string; seconds: number } | null>(null);
  const [picker, setPicker] = useState<{ date: Date; minutes: number } | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [bankDelete, setBankDelete] = useState<ScheduleItem | null>(null);
  const [removeDay, setRemoveDay] = useState<Schedule | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  const days = viewMode === 'week' ? getWeekDays(currentDate) : [currentDate];
  const rangeStart = dateKey(days[0]);
  const rangeEnd = dateKey(days[days.length - 1]);

  const load = useCallback(async () => {
    try {
      setSchedules(await scheduleAPI.getRange(rangeStart, rangeEnd));
    } catch (error) {
      console.error('Failed to load schedules:', error);
      setStatus({ kind: 'error', text: 'Could not load the calendar.' });
    }
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    load();
  }, [load]);

  const schedulesByDate = useMemo(() => {
    const byDate: Record<string, Schedule> = {};
    for (const s of schedules) if (s.target_date) byDate[s.target_date] = s;
    return byDate;
  }, [schedules]);

  const itemsByDate = useMemo(() => {
    const byDate: Record<string, ScheduleItem[]> = {};
    for (const item of schedules.flatMap((s) => s.items)) {
      if (!item.scheduled_time) continue;
      const key = dateKey(new Date(item.scheduled_time));
      (byDate[key] ??= []).push(item);
    }
    return byDate;
  }, [schedules]);

  // A change to the day's Items; a failure is shown, and the view reloads either way.
  const change = useCallback(async (fn: () => Promise<unknown>, failure: string) => {
    try {
      await fn();
    } catch (error) {
      console.error(failure, error);
      setStatus({ kind: 'error', text: errorText(error, failure) });
    } finally {
      await load();
    }
  }, [load]);

  // A Google action (push, remove, clear) with working / success / error feedback.
  const dayAction = useCallback(async (fn: () => Promise<string>, failure: string) => {
    setStatus({ kind: 'working', text: 'Working…' });
    try {
      setStatus({ kind: 'success', text: await fn() });
    } catch (error) {
      console.error(failure, error);
      setStatus({ kind: 'error', text: errorText(error, failure) });
    } finally {
      await load();
    }
  }, [load]);

  const place = useCallback((key: string, taskId: number, time: Date) =>
    change(
      () => scheduleAPI.placeActivity(key, { task_id: taskId, scheduled_time: time.toISOString() }),
      'Could not place the activity.',
    ), [change]);

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as { task?: Task; item?: ScheduleItem } | undefined;
    if (data?.task) {
      const t = data.task;
      setActiveDrag({ name: t.name, seconds: t.total_recordings ? t.average_duration : NO_HISTORY_SECONDS });
    } else if (data?.item) {
      const i = data.item;
      setActiveDrag({ name: i.task?.name ?? i.custom_name ?? '', seconds: i.estimated_duration });
    }
  };

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;

    const data = active.data.current as { task?: Task; item?: ScheduleItem } | undefined;
    const overId = String(over.id);

    if (data?.item && overId === 'bank') {
      const item = data.item;
      if (item.calendar_event_id) {
        setBankDelete(item);
      } else {
        await change(() => scheduleAPI.deleteItem(item.schedule_id, item.id, false), 'Could not remove the block.');
      }
      return;
    }

    if (!overId.startsWith('column-')) return;
    const key = overId.slice('column-'.length);
    const activeRect = active.rect.current.translated;
    if (!activeRect) return;
    const y = activeRect.top - over.rect.top;
    const time = slotTime(key, snapMinutes((y / SLOT_HEIGHT) * INTERVAL_MIN, Math.round));

    if (data?.task) {
      await place(key, data.task.id, time);
    } else if (data?.item) {
      const item = data.item;
      const current = new Date(item.scheduled_time!);
      // D49: a Block stays on its own day.
      if (dateKey(current) !== key || current.getTime() === time.getTime()) return;
      await change(
        () => scheduleAPI.updateItem(item.schedule_id, item.id, { scheduled_time: time.toISOString() }),
        'Could not move the block.',
      );
    }
  }, [change, place]);

  const handleSelect = useCallback((itemId: number) => {
    setSelectedId(itemId);
    setEditingId((prev) => (prev === itemId ? prev : null));
  }, []);

  const handleToggleEdit = useCallback((itemId: number) => {
    setEditingId((prev) => (prev === itemId ? null : itemId));
  }, []);

  const handleResize = useCallback((item: ScheduleItem, seconds: number) =>
    change(
      () => scheduleAPI.updateItem(item.schedule_id, item.id, { estimated_duration: seconds }),
      'Could not resize the block.',
    ), [change]);

  const handleRemoveFromGoogle = useCallback((item: ScheduleItem) => {
    if (!window.confirm('Remove this block\'s event from Google Calendar? The block stays.')) return;
    dayAction(async () => {
      await scheduleAPI.removeItemFromCalendar(item.schedule_id, item.id);
      return 'Removed from Google Calendar.';
    }, 'Could not remove the event from Google Calendar.');
  }, [dayAction]);

  const handlePushDay = useCallback((schedule: Schedule) =>
    dayAction(async () => {
      const pushed = await scheduleAPI.pushToCalendar(schedule.id);
      const count = pushed.items.filter((i) => i.calendar_event_id).length;
      return `Pushed ${count} event${count === 1 ? '' : 's'} to Google Calendar.`;
    }, 'Could not push the day to Google Calendar.'), [dayAction]);

  const handleSlotClick = useCallback((date: Date, minutesFromStart: number) => {
    setSelectedId(null);
    setEditingId(null);
    setPicker({ date, minutes: snapMinutes(minutesFromStart, Math.floor) });
  }, []);

  const handlePick = (task: Task) => {
    if (!picker) return;
    const key = dateKey(picker.date);
    setPicker(null);
    place(key, task.id, slotTime(key, picker.minutes));
  };

  const confirmBankDelete = (deleteEvent: boolean) => {
    const item = bankDelete!;
    setBankDelete(null);
    change(() => scheduleAPI.deleteItem(item.schedule_id, item.id, deleteEvent), 'Could not remove the block.');
  };

  const confirmRemoveDay = (choice: 'clear' | 'google') => {
    const schedule = removeDay!;
    setRemoveDay(null);
    if (choice === 'clear') {
      dayAction(async () => {
        await scheduleAPI.clearDay(schedule.id, true);
        return 'Cleared the day.';
      }, 'Could not clear the day.');
    } else {
      dayAction(async () => {
        await scheduleAPI.removeFromCalendar(schedule.id);
        return 'Removed the day from Google Calendar.';
      }, 'Could not remove the day from Google Calendar.');
    }
  };

  const navigate = (date: Date) => {
    setCurrentDate(date);
    setSelectedId(null);
    setEditingId(null);
    setStatus(null);
  };

  const goToPrev = () => {
    navigate(viewMode === 'week' ? previousWeek(currentDate) : previousDay(currentDate));
  };

  const goToNext = () => {
    navigate(viewMode === 'week' ? nextWeek(currentDate) : nextDay(currentDate));
  };

  const goToToday = () => {
    navigate(new Date());
  };

  const pickerTime = picker ? slotTime(dateKey(picker.date), picker.minutes) : null;

  return (
    <DndContext
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      collisionDetection={pointerWithin}
    >
      <div className="calendar-view">
        {/* Header with navigation */}
        <div className="calendar-header">
          <div className="nav-controls">
            <button className="nav-btn" onClick={goToPrev}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
              </svg>
            </button>
            <button className="today-btn" onClick={goToToday}>
              Today
            </button>
            <button className="nav-btn" onClick={goToNext}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
              </svg>
            </button>
          </div>

          <h2 className="current-date">
            {viewMode === 'day' ? formatDayLong(currentDate) : `Week of ${formatDayLong(currentDate)}`}
          </h2>

          <div className="view-toggle">
            <button
              className={`toggle-btn ${viewMode === 'week' ? 'active' : ''}`}
              onClick={() => setViewMode('week')}
            >
              Week
            </button>
            <button
              className={`toggle-btn ${viewMode === 'day' ? 'active' : ''}`}
              onClick={() => setViewMode('day')}
            >
              Day
            </button>
          </div>
        </div>

        {status && (
          <div
            className={`day-action-status ${status.kind}`}
            data-testid={`day-action-${status.kind}`}
            role={status.kind === 'error' ? 'alert' : 'status'}
          >
            {status.text}
          </div>
        )}

        {/* Main content area */}
        <div className="calendar-content">
          <ActivityBank tasks={tasks} />

          <CalendarGrid
            days={days}
            viewMode={viewMode}
            schedulesByDate={schedulesByDate}
            itemsByDate={itemsByDate}
            startHour={START_HOUR}
            endHour={END_HOUR}
            slotHeight={SLOT_HEIGHT}
            intervalMin={INTERVAL_MIN}
            selectedId={selectedId}
            editingId={editingId}
            onSelect={handleSelect}
            onToggleEdit={handleToggleEdit}
            onRemoveFromGoogle={handleRemoveFromGoogle}
            onResize={handleResize}
            onSlotClick={handleSlotClick}
            onPushDay={handlePushDay}
            onRemoveDay={setRemoveDay}
          />
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeDrag ? (
          <div className="drag-overlay-session">
            <div className="session-name">{activeDrag.name}</div>
            <div className="session-duration">{formatDuration(activeDrag.seconds)}</div>
          </div>
        ) : null}
      </DragOverlay>

      {/* Activity picker for an empty slot (D50) */}
      {picker && pickerTime && (
        <ActivityPicker
          date={picker.date}
          time={`${pickerTime.getHours().toString().padStart(2, '0')}:${pickerTime.getMinutes().toString().padStart(2, '0')}`}
          tasks={tasks}
          onClose={() => setPicker(null)}
          onPick={handlePick}
        />
      )}

      {/* Exported Block dropped on the Bank (D45) */}
      {bankDelete && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Remove block</h3>
            </div>
            <div className="modal-body">
              This block is on Google Calendar. Delete its Google event too?
            </div>
            <div className="modal-footer">
              <button className="glass-button-red" onClick={() => confirmBankDelete(true)}>Also delete from Google</button>
              <button className="glass-button" onClick={() => confirmBankDelete(false)}>Keep on Google</button>
              <button className="glass-button" onClick={() => setBankDelete(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Remove day (D45) */}
      {removeDay && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Remove day</h3>
            </div>
            <div className="modal-body">
              Clear all deletes the day's Google events and its blocks. Remove from Google only
              deletes the events and keeps the blocks.
            </div>
            <div className="modal-footer">
              <button className="glass-button-red" onClick={() => confirmRemoveDay('clear')}>Clear all</button>
              <button className="glass-button" onClick={() => confirmRemoveDay('google')}>Remove from Google only</button>
              <button className="glass-button" onClick={() => setRemoveDay(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </DndContext>
  );
}
