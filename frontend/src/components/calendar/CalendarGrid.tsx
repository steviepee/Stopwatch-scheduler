import { useDroppable } from '@dnd-kit/core';
import { StopwatchSession } from '../../types';
import { SessionBlock } from './SessionBlock';
import {
  getWeekDays,
  formatHour,
  formatDayShort,
  isSameDay,
} from '../../utils/calendarUtils';

interface CalendarGridProps {
  currentDate: Date;
  viewMode: 'week' | 'day';
  sessions: StopwatchSession[];
  startHour: number;
  endHour: number;
  slotHeight: number;
  intervalMin: number;
  onRemoveFromCalendar: (sessionId: number) => void;
  onExportToGoogle: (sessionId: number) => void;
  onResize: (sessionId: number, newDurationSeconds: number) => void;
  onSlotClick: (date: Date, hour: number, minute: number) => void;
}

function DroppableColumn({
  date,
  children,
  onSlotClick,
  startHour,
  slotHeight,
  intervalMin,
}: {
  date: Date;
  children: React.ReactNode;
  onSlotClick: (date: Date, hour: number, minute: number) => void;
  startHour: number;
  slotHeight: number;
  intervalMin: number;
}) {
  const dateStr = date.toISOString().split('T')[0];
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${dateStr}`,
    data: { date },
  });

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only handle clicks directly on the column, not on session blocks
    if ((e.target as HTMLElement).closest('.session-block')) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;

    // Calculate time from position
    const totalMinutes = (y / slotHeight) * intervalMin;
    const hour = Math.floor(totalMinutes / 60) + startHour;
    const minute = Math.floor((totalMinutes % 60) / intervalMin) * intervalMin;

    onSlotClick(date, hour, minute);
  };

  return (
    <div
      ref={setNodeRef}
      className={`day-column ${isOver ? 'drag-over' : ''}`}
      data-date={dateStr}
      onClick={handleClick}
    >
      {children}
    </div>
  );
}

export function CalendarGrid({
  currentDate,
  viewMode,
  sessions,
  startHour,
  endHour,
  slotHeight,
  intervalMin,
  onRemoveFromCalendar,
  onExportToGoogle,
  onResize,
  onSlotClick,
}: CalendarGridProps) {
  const days = viewMode === 'week' ? getWeekDays(currentDate) : [currentDate];
  const today = new Date();
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
  const slotsPerHour = 60 / intervalMin;
  const totalSlots = hours.length * slotsPerHour;

  // Get sessions for a specific day
  const getSessionsForDay = (day: Date) => {
    return sessions.filter((session) => {
      if (!session.scheduled_start) return false;
      const sessionDate = new Date(session.scheduled_start);
      return isSameDay(sessionDate, day);
    });
  };

  // Current time indicator
  const getCurrentTimePosition = () => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    if (hours < startHour || hours > endHour) return null;
    const totalMinutes = (hours - startHour) * 60 + minutes;
    return (totalMinutes / intervalMin) * slotHeight;
  };

  const currentTimePos = getCurrentTimePosition();

  return (
    <div className={`calendar-grid ${viewMode}`}>
      {/* Header row with day names */}
      <div className="grid-header">
        <div className="time-column-header"></div>
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className={`day-header ${isSameDay(day, today) ? 'today' : ''}`}
          >
            {formatDayShort(day)}
          </div>
        ))}
      </div>

      {/* Grid body */}
      <div className="grid-body" style={{ height: `${totalSlots * slotHeight}px` }}>
        {/* Time column */}
        <div className="time-column">
          {hours.map((hour) => (
            <div
              key={hour}
              className="time-label"
              style={{ height: `${slotsPerHour * slotHeight}px` }}
            >
              {formatHour(hour)}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((day) => (
          <DroppableColumn
            key={day.toISOString()}
            date={day}
            onSlotClick={onSlotClick}
            startHour={startHour}
            slotHeight={slotHeight}
            intervalMin={intervalMin}
          >
            {/* Time slot lines */}
            {hours.map((hour) => (
              <div
                key={hour}
                className="hour-slot"
                style={{ height: `${slotsPerHour * slotHeight}px` }}
              >
                {Array.from({ length: slotsPerHour - 1 }, (_, i) => (
                  <div
                    key={i}
                    className="half-hour-line"
                    style={{ top: `${(i + 1) * slotHeight}px` }}
                  />
                ))}
              </div>
            ))}

            {/* Session blocks */}
            {getSessionsForDay(day).map((session) => (
              <SessionBlock
                key={session.id}
                session={session}
                startHour={startHour}
                slotHeight={slotHeight}
                intervalMin={intervalMin}
                onRemove={onRemoveFromCalendar}
                onExportToGoogle={onExportToGoogle}
                onResize={onResize}
              />
            ))}

            {/* Current time indicator */}
            {isSameDay(day, today) && currentTimePos !== null && (
              <div
                className="current-time-indicator"
                style={{ top: `${currentTimePos}px` }}
              >
                <div className="current-time-dot" />
                <div className="current-time-line" />
              </div>
            )}
          </DroppableColumn>
        ))}
      </div>
    </div>
  );
}
