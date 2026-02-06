import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { StopwatchSession } from '../../types';
import { formatDuration } from '../../utils/calendarUtils';

interface DraggableSessionProps {
  session: StopwatchSession;
}

export function DraggableSession({ session }: DraggableSessionProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `session-${session.id}`,
    data: { session },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`draggable-session ${isDragging ? 'dragging' : ''}`}
    >
      <div className="session-name">{session.name}</div>
      <div className="session-duration">{formatDuration(session.duration)}</div>
    </div>
  );
}
