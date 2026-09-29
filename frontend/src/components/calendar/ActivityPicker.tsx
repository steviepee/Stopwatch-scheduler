import { useState } from 'react';
import { formatDayLong, formatDuration } from '../../utils/calendarUtils';
import { Task } from '../../types';

interface ActivityPickerProps {
  date: Date;
  time: string; // "HH:MM"
  tasks: Task[];
  onClose: () => void;
  onPick: (task: Task) => void;
}

export function ActivityPicker({ date, time, tasks, onClose, onPick }: ActivityPickerProps) {
  const [search, setSearch] = useState('');
  const matches = tasks.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" data-testid="activity-picker" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Place an Activity</h3>
          <button className="modal-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="date-display">{formatDayLong(date)} at {time}</div>
          <div className="form-group">
            <input
              type="text"
              data-testid="activity-picker-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search activities..."
              autoFocus
              className="glass-input"
            />
          </div>
          <div className="picker-options">
            {matches.length === 0 ? (
              <div className="empty-state">No matching activities</div>
            ) : (
              matches.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  data-testid={`activity-picker-option-${t.id}`}
                  className="glass-button picker-option"
                  onClick={() => onPick(t)}
                >
                  <span>{t.name}</span>
                  <span className="session-duration">
                    {t.total_recordings ? formatDuration(t.average_duration) : 'no history'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
