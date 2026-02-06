import { useState } from 'react';
import { StopwatchSession } from '../../types';
import { DraggableSession } from './DraggableSession';

interface SessionBankProps {
  sessions: StopwatchSession[];
}

export function SessionBank({ sessions }: SessionBankProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredSessions = sessions.filter((session) =>
    session.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className={`session-bank ${isCollapsed ? 'collapsed' : ''}`}>
      <button
        className="collapse-toggle"
        onClick={() => setIsCollapsed(!isCollapsed)}
        title={isCollapsed ? 'Expand session bank' : 'Collapse session bank'}
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
            <h3>Sessions</h3>
            <span className="session-count">{filteredSessions.length}</span>
          </div>

          <div className="bank-search">
            <input
              type="text"
              placeholder="Search sessions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="bank-sessions">
            {filteredSessions.length === 0 ? (
              <div className="empty-state">
                {searchTerm ? 'No matching sessions' : 'No unscheduled sessions'}
              </div>
            ) : (
              filteredSessions.map((session) => (
                <DraggableSession key={session.id} session={session} />
              ))
            )}
          </div>

          <div className="bank-hint">
            Drag sessions to the calendar
          </div>
        </>
      )}
    </div>
  );
}
