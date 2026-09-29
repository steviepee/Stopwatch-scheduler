import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Task } from '../../types';
import { formatDuration } from '../../utils/calendarUtils';

interface DraggableActivityProps {
  task: Task;
}

export function DraggableActivity({ task }: DraggableActivityProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `activity-${task.id}`,
    data: { task },
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
      data-testid={`bank-item-${task.id}`}
      className={`draggable-session ${isDragging ? 'dragging' : ''}`}
    >
      <div className="session-name">{task.name}</div>
      {task.total_recordings ? (
        <div className="session-duration">{formatDuration(task.average_duration)}</div>
      ) : (
        <div className="session-duration" data-testid={`bank-item-${task.id}-no-history`}>no history</div>
      )}
    </div>
  );
}
