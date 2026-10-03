import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { ScheduleItem } from '../../types';
import { formatDuration, positionFromTime, heightFromDuration } from '../../utils/calendarUtils';

interface ItemBlockProps {
  item: ScheduleItem;
  startHour: number;
  slotHeight: number;
  intervalMin: number;
  selected: boolean;
  editing: boolean;
  onSelect: (itemId: number) => void;
  onToggleEdit: (itemId: number) => void;
  onRemoveFromGoogle: (item: ScheduleItem) => void;
  onResize: (item: ScheduleItem, newDurationSeconds: number) => void;
}

const RESIZE_SNAP = 300;
const MIN_BLOCK_HEIGHT = 24;

function snapDuration(seconds: number) {
  return Math.max(RESIZE_SNAP, Math.round(seconds / RESIZE_SNAP) * RESIZE_SNAP);
}

export function ItemBlock({
  item,
  startHour,
  slotHeight,
  intervalMin,
  selected,
  editing,
  onSelect,
  onToggleEdit,
  onRemoveFromGoogle,
  onResize,
}: ItemBlockProps) {
  const [previewDuration, setPreviewDuration] = useState<number | null>(null);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `block-${item.id}`,
    data: { item },
    disabled: editing,
  });

  const exported = !!item.calendar_event_id;
  const duration = previewDuration ?? item.estimated_duration;
  const top = positionFromTime(new Date(item.scheduled_time!), startHour, slotHeight, intervalMin);
  const height = Math.max(MIN_BLOCK_HEIGHT, heightFromDuration(duration, slotHeight, intervalMin));

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const secondsAt = (clientY: number) =>
      snapDuration(item.estimated_duration + ((clientY - startY) / slotHeight) * intervalMin * 60);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      setPreviewDuration(secondsAt(moveEvent.clientY));
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      const next = secondsAt(upEvent.clientY);
      setPreviewDuration(null);
      if (next !== item.estimated_duration) onResize(item, next);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const style = {
    top: `${top}px`,
    height: `${height}px`,
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`item-block-${item.id}`}
      className={`session-block ${isDragging ? 'dragging' : ''} ${exported ? 'on-google' : ''} ${selected ? 'selected' : ''} ${editing ? 'editing' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item.id);
      }}
    >
      <div className="session-block-header" {...listeners} {...attributes}>
        <span className="session-block-name">{item.task?.name ?? item.custom_name}</span>
        <span className="session-block-duration">{formatDuration(duration)}</span>
      </div>
      {selected && (
        <div className="session-block-actions">
          <button
            className="action-btn"
            data-testid={`btn-edit-block-${item.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleEdit(item.id);
            }}
          >
            {editing ? 'Done' : 'Edit block'}
          </button>
          {exported && (
            <button
              className="action-btn remove-btn"
              data-testid={`btn-remove-google-${item.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveFromGoogle(item);
              }}
            >
              Remove from Google
            </button>
          )}
        </div>
      )}
      {exported && (
        <div className="google-indicator" title="On Google Calendar">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
          </svg>
        </div>
      )}
      {item.calendar_stale && (
        <div
          className="changed-indicator"
          data-testid={`item-block-${item.id}-changed`}
          title="Changed since push"
        />
      )}
      {editing && (
        <div
          className="resize-handle"
          data-testid={`item-block-${item.id}-resize-handle`}
          onMouseDown={handleResizeStart}
          onClick={(e) => e.stopPropagation()}
          title="Drag to resize"
        />
      )}
    </div>
  );
}
