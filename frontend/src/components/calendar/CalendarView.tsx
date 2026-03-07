import { useState, useCallback } from 'react';
import { DndContext, DragEndEvent, DragOverlay, pointerWithin } from '@dnd-kit/core';
import { StopwatchSession, Task, UserOptions } from '../../types';
import { sessionAPI } from '../../services/api';
import { CalendarGrid } from './CalendarGrid';
import { SessionBank } from './SessionBank';
import { CreateEventModal } from './CreateEventModal';
import { formatDuration, previousWeek, nextWeek, previousDay, nextDay, formatDayLong, timeFromPosition, snapToSlot } from '../../utils/calendarUtils';

interface CalendarViewProps {
  scheduledSessions: StopwatchSession[];
  unscheduledSessions: StopwatchSession[];
  onSessionUpdate: (session: StopwatchSession) => void;
  onSessionCreate: (session: StopwatchSession) => void;
  tasks?: Task[];
  options?: UserOptions;
}

const START_HOUR = 6;
const END_HOUR = 23;
const SLOT_HEIGHT = 30; // pixels per 30 minutes
const INTERVAL_MIN = 30;

interface CreateEventData {
  date: Date;
  time: string; // "HH:MM"
}

export function CalendarView({
  scheduledSessions,
  unscheduledSessions,
  onSessionUpdate,
  onSessionCreate,
  tasks,
  options,
}: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'week' | 'day'>('week');
  const [activeDragSession, setActiveDragSession] = useState<StopwatchSession | null>(null);
  const [createEventData, setCreateEventData] = useState<CreateEventData | null>(null);

  const handleDragStart = (event: { active: { data: { current?: { session?: StopwatchSession } } } }) => {
    const session = event.active.data.current?.session;
    if (session) {
      setActiveDragSession(session);
    }
  };

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDragSession(null);

    const { active, over } = event;
    if (!over) return;

    const session = active.data.current?.session as StopwatchSession | undefined;
    if (!session) return;

    // Check if dropped on a day column
    const overId = over.id as string;
    if (!overId.startsWith('column-')) return;

    const dropDate = over.data.current?.date as Date | undefined;
    if (!dropDate) return;

    // Calculate drop position from the event
    // Use the center of the dragged element relative to the drop zone
    const overRect = over.rect;
    const activeRect = active.rect.current.translated;

    if (!overRect || !activeRect) return;

    // Calculate Y position relative to the drop zone
    const relativeY = activeRect.top - overRect.top;

    // Convert to time
    const dropTime = timeFromPosition(relativeY, dropDate, START_HOUR, SLOT_HEIGHT, INTERVAL_MIN);
    const snappedTime = snapToSlot(dropTime, INTERVAL_MIN);

    // Ensure time is within bounds
    if (snappedTime.getHours() < START_HOUR) {
      snappedTime.setHours(START_HOUR, 0, 0, 0);
    }
    if (snappedTime.getHours() >= END_HOUR) {
      snappedTime.setHours(END_HOUR - 1, 30, 0, 0);
    }

    try {
      const updatedSession = await sessionAPI.schedule(session.id, {
        scheduled_start: snappedTime.toISOString(),
      });
      onSessionUpdate(updatedSession);
    } catch (error) {
      console.error('Failed to schedule session:', error);
    }
  }, [onSessionUpdate]);

  const handleRemoveFromCalendar = useCallback(async (sessionId: number) => {
    try {
      const updatedSession = await sessionAPI.unschedule(sessionId);
      onSessionUpdate(updatedSession);
    } catch (error) {
      console.error('Failed to unschedule session:', error);
    }
  }, [onSessionUpdate]);

  const handleExportToGoogle = useCallback(async (sessionId: number) => {
    try {
      const updatedSession = await sessionAPI.addToCalendar(sessionId);
      onSessionUpdate(updatedSession);
    } catch (error) {
      console.error('Failed to export to Google Calendar:', error);
    }
  }, [onSessionUpdate]);

  const handleResize = useCallback(async (sessionId: number, newDurationSeconds: number) => {
    try {
      // Find the session to get its scheduled_start
      const session = scheduledSessions.find(s => s.id === sessionId);
      if (!session || !session.scheduled_start) return;

      const scheduledStart = new Date(session.scheduled_start);
      const scheduledEnd = new Date(scheduledStart.getTime() + newDurationSeconds * 1000);

      const updatedSession = await sessionAPI.schedule(sessionId, {
        scheduled_start: scheduledStart.toISOString(),
        scheduled_end: scheduledEnd.toISOString(),
      });
      onSessionUpdate(updatedSession);
    } catch (error) {
      console.error('Failed to resize session:', error);
    }
  }, [scheduledSessions, onSessionUpdate]);

  const handleSlotClick = useCallback((date: Date, hour: number, minute: number) => {
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    setCreateEventData({ date, time: timeStr });
  }, []);

  const handleCreateEvent = useCallback(async (data: { name: string; date: Date; startTime: string; durationMinutes: number }) => {
    try {
      const [hours, minutes] = data.startTime.split(':').map(Number);
      const startDate = new Date(data.date);
      startDate.setHours(hours, minutes, 0, 0);

      const endDate = new Date(startDate.getTime() + data.durationMinutes * 60 * 1000);
      const durationSeconds = data.durationMinutes * 60;

      // Create a new session with scheduled time
      const newSession = await sessionAPI.create({
        name: data.name,
        duration: durationSeconds,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        scheduled_start: startDate.toISOString(),
        scheduled_end: endDate.toISOString(),
      });

      setCreateEventData(null);
      onSessionCreate(newSession);
    } catch (error) {
      console.error('Failed to create event:', error);
    }
  }, [onSessionCreate]);

  const goToPrev = () => {
    setCurrentDate(viewMode === 'week' ? previousWeek(currentDate) : previousDay(currentDate));
  };

  const goToNext = () => {
    setCurrentDate(viewMode === 'week' ? nextWeek(currentDate) : nextDay(currentDate));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

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

        {/* Main content area */}
        <div className="calendar-content">
          <SessionBank sessions={unscheduledSessions} />

          <CalendarGrid
            currentDate={currentDate}
            viewMode={viewMode}
            sessions={scheduledSessions}
            startHour={START_HOUR}
            endHour={END_HOUR}
            slotHeight={SLOT_HEIGHT}
            intervalMin={INTERVAL_MIN}
            onRemoveFromCalendar={handleRemoveFromCalendar}
            onExportToGoogle={handleExportToGoogle}
            onResize={handleResize}
            onSlotClick={handleSlotClick}
          />
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeDragSession ? (
          <div className="drag-overlay-session">
            <div className="session-name">{activeDragSession.name}</div>
            <div className="session-duration">{formatDuration(activeDragSession.duration)}</div>
          </div>
        ) : null}
      </DragOverlay>

      {/* Create event modal */}
      {createEventData && (
        <CreateEventModal
          initialDate={createEventData.date}
          initialTime={createEventData.time}
          onClose={() => setCreateEventData(null)}
          onSubmit={handleCreateEvent}
          tasks={tasks}
          options={options}
        />
      )}
    </DndContext>
  );
}
