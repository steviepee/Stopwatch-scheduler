import { useDroppable } from '@dnd-kit/core';
import { Schedule, ScheduleItem } from '../../types';
import { ItemBlock } from './ItemBlock';
import {
  formatHour,
  formatDayShort,
  isSameDay,
  dateKey,
} from '../../utils/calendarUtils';

interface CalendarGridProps {
  days: Date[];
  viewMode: 'week' | 'day';
  schedulesByDate: Record<string, Schedule>;
  itemsByDate: Record<string, ScheduleItem[]>;
  startHour: number;
  endHour: number;
  slotHeight: number;
  intervalMin: number;
  selectedId: number | null;
  editingId: number | null;
  onSelect: (itemId: number) => void;
  onToggleEdit: (itemId: number) => void;
  onRemoveFromGoogle: (item: ScheduleItem) => void;
  onResize: (item: ScheduleItem, newDurationSeconds: number) => void;
  onSlotClick: (date: Date, minutesFromStart: number) => void;
  onPushDay: (schedule: Schedule) => void;
  onRemoveDay: (schedule: Schedule) => void;
}

function DroppableColumn({
  date,
  children,
  onSlotClick,
  slotHeight,
  intervalMin,
}: {
  date: Date;
  children: React.ReactNode;
  onSlotClick: (date: Date, minutesFromStart: number) => void;
  slotHeight: number;
  intervalMin: number;
}) {
  const key = dateKey(date);
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${key}`,
    data: { date },
  });

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.session-block')) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    onSlotClick(date, (y / slotHeight) * intervalMin);
  };

  return (
    <div
      ref={setNodeRef}
      className={`day-column ${isOver ? 'drag-over' : ''}`}
      data-date={key}
      data-testid={`day-column-${key}`}
      onClick={handleClick}
    >
      {children}
    </div>
  );
}

export function CalendarGrid({
  days,
  viewMode,
  schedulesByDate,
  itemsByDate,
  startHour,
  endHour,
  slotHeight,
  intervalMin,
  selectedId,
  editingId,
  onSelect,
  onToggleEdit,
  onRemoveFromGoogle,
  onResize,
  onSlotClick,
  onPushDay,
  onRemoveDay,
}: CalendarGridProps) {
  const today = new Date();
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
  const slotsPerHour = 60 / intervalMin;
  const totalSlots = hours.length * slotsPerHour;

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
      {/* Header row with day names and day actions */}
      <div className="grid-header">
        <div className="time-column-header"></div>
        {days.map((day) => {
          const key = dateKey(day);
          const schedule = schedulesByDate[key];
          const items = schedule?.items ?? [];
          return (
            <div
              key={key}
              className={`day-header ${isSameDay(day, today) ? 'today' : ''}`}
            >
              {formatDayShort(day)}
              {schedule && items.length > 0 && (
                <div className="day-header-actions">
                  {items.some((i) => !i.calendar_event_id) && (
                    <button
                      className="action-btn"
                      data-testid={`btn-push-day-${key}`}
                      onClick={() => onPushDay(schedule)}
                    >
                      Push day
                    </button>
                  )}
                  <button
                    className="action-btn remove-btn"
                    data-testid={`btn-remove-day-${key}`}
                    onClick={() => onRemoveDay(schedule)}
                  >
                    Remove day
                  </button>
                </div>
              )}
            </div>
          );
        })}
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
            key={dateKey(day)}
            date={day}
            onSlotClick={onSlotClick}
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

            {/* Schedule Item blocks */}
            {(itemsByDate[dateKey(day)] ?? []).map((item) => (
              <ItemBlock
                key={item.id}
                item={item}
                startHour={startHour}
                slotHeight={slotHeight}
                intervalMin={intervalMin}
                selected={selectedId === item.id}
                editing={editingId === item.id}
                onSelect={onSelect}
                onToggleEdit={onToggleEdit}
                onRemoveFromGoogle={onRemoveFromGoogle}
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
