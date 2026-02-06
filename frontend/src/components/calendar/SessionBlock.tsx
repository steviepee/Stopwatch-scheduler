import { useState, useCallback } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { StopwatchSession } from '../../types';
import { formatDuration, positionFromTime, heightFromDuration } from '../../utils/calendarUtils';

interface SessionBlockProps {
  session: StopwatchSession;
  startHour: number;
  slotHeight: number;
  intervalMin: number;
  onRemove: (sessionId: number) => void;
  onExportToGoogle: (sessionId: number) => void;
  onResize: (sessionId: number, newDurationSeconds: number) => void;
}

export function SessionBlock({
  session,
  startHour,
  slotHeight,
  intervalMin,
  onRemove,
  onExportToGoogle,
  onResize,
}: SessionBlockProps) {
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHeight, setResizeHeight] = useState<number | null>(null);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `block-${session.id}`,
    data: { session, isScheduled: true },
    disabled: isResizing,
  });

  if (!session.scheduled_start) return null;

  const scheduledStart = new Date(session.scheduled_start);
  const top = positionFromTime(scheduledStart, startHour, slotHeight, intervalMin);

  // Use scheduled_end if available, otherwise calculate from duration
  let baseHeight: number;
  if (session.scheduled_end) {
    const scheduledEnd = new Date(session.scheduled_end);
    const durationMs = scheduledEnd.getTime() - scheduledStart.getTime();
    baseHeight = heightFromDuration(durationMs / 1000, slotHeight, intervalMin);
  } else {
    baseHeight = heightFromDuration(session.duration, slotHeight, intervalMin);
  }

  // Minimum height for visibility
  baseHeight = Math.max(baseHeight, slotHeight);

  const displayHeight = resizeHeight ?? baseHeight;

  // Calculate display duration based on current height
  const displayDurationSeconds = (displayHeight / slotHeight) * intervalMin * 60;

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);

    const startY = e.clientY;
    const startHeight = baseHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(slotHeight, startHeight + deltaY);
      // Snap to slot intervals
      const snappedHeight = Math.round(newHeight / slotHeight) * slotHeight;
      setResizeHeight(snappedHeight);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      setIsResizing(false);

      // Calculate new duration and call onResize
      if (resizeHeight !== null && resizeHeight !== baseHeight) {
        const newDurationSeconds = (resizeHeight / slotHeight) * intervalMin * 60;
        onResize(session.id, newDurationSeconds);
      }
      setResizeHeight(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [baseHeight, slotHeight, intervalMin, session.id, onResize, resizeHeight]);

  const style = {
    top: `${top}px`,
    height: `${displayHeight}px`,
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`session-block ${isDragging ? 'dragging' : ''} ${isResizing ? 'resizing' : ''} ${session.is_on_calendar ? 'on-google' : ''}`}
    >
      <div className="session-block-header" {...listeners} {...attributes}>
        <span className="session-block-name">{session.name}</span>
        <span className="session-block-duration">{formatDuration(displayDurationSeconds)}</span>
      </div>
      <div className="session-block-actions">
        {!session.is_on_calendar && (
          <button
            className="action-btn export-btn"
            onClick={(e) => {
              e.stopPropagation();
              onExportToGoogle(session.id);
            }}
            title="Export to Google Calendar"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z" />
            </svg>
          </button>
        )}
        <button
          className="action-btn remove-btn"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(session.id);
          }}
          title="Remove from calendar"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      </div>
      {session.is_on_calendar && (
        <div className="google-indicator" title="On Google Calendar">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
          </svg>
        </div>
      )}
      {/* Resize handle */}
      <div
        className="resize-handle"
        onMouseDown={handleResizeStart}
        title="Drag to resize"
      />
    </div>
  );
}
