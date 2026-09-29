import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Task } from '../../types';
import { DraggableActivity } from './DraggableActivity';

interface ActivityBankProps {
  tasks: Task[];
}

export function ActivityBank({ tasks }: ActivityBankProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { setNodeRef, isOver } = useDroppable({ id: 'bank' });

  const filteredTasks = tasks.filter((task) =>
    task.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div
      ref={setNodeRef}
      data-testid="bank-panel"
      className={`session-bank ${isCollapsed ? 'collapsed' : ''} ${isOver ? 'drag-over' : ''}`}
    >
      <button
        className="collapse-toggle"
        onClick={() => setIsCollapsed(!isCollapsed)}
        title={isCollapsed ? 'Expand activity bank' : 'Collapse activity bank'}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="currentColor"
          style={{ transform: isCollapsed ? 'rotate(180deg)' : 'none' }}
        >
          <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
        </svg>
      </button>

      {!isCollapsed && (
        <>
          <div className="bank-header">
            <h3>Activities</h3>
            <span className="session-count">{filteredTasks.length}</span>
          </div>

          <div className="bank-search">
            <input
              type="text"
              data-testid="bank-search"
              placeholder="Search activities..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="bank-sessions">
            {filteredTasks.length === 0 ? (
              <div className="empty-state">
                {searchTerm ? 'No matching activities' : 'No activities yet'}
              </div>
            ) : (
              filteredTasks.map((task) => (
                <DraggableActivity key={task.id} task={task} />
              ))
            )}
          </div>

          <div className="bank-hint">
            Drag activities to the calendar; drop a block here to remove it
          </div>
        </>
      )}
    </div>
  );
}
