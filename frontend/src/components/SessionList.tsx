import { useState, useEffect, useMemo } from 'react';
import { StopwatchSession } from '../types';
import { googleCalendarAPI } from '../services/api';

type CalendarFilter = 'all' | 'on' | 'off';

interface SessionListProps {
  sessions: StopwatchSession[];
  onDeleteSession: (sessionId: number) => void;
  onUpdateSession: (sessionId: number, name: string) => void;
  onAddToCalendar: (sessionId: number) => void;
  onRemoveFromCalendar: (sessionId: number) => void;
}

export default function SessionList({
  sessions,
  onDeleteSession,
  onUpdateSession,
  onAddToCalendar,
  onRemoveFromCalendar,
}: SessionListProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [isCalendarAuthenticated, setIsCalendarAuthenticated] = useState(false);
  const [loadingCalendar, setLoadingCalendar] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [calendarFilter, setCalendarFilter] = useState<CalendarFilter>('all');

  const filteredSessions = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(dateTo + 'T23:59:59') : null;
    return sessions.filter(s => {
      if (q && !s.name.toLowerCase().includes(q)) return false;
      const created = new Date(s.created_at);
      if (from && created < from) return false;
      if (to && created > to) return false;
      if (calendarFilter === 'on' && !s.is_on_calendar) return false;
      if (calendarFilter === 'off' && s.is_on_calendar) return false;
      return true;
    });
  }, [sessions, searchQuery, dateFrom, dateTo, calendarFilter]);

  useEffect(() => {
    checkCalendarAuth();
  }, []);

  const checkCalendarAuth = async () => {
    try {
      const status = await googleCalendarAPI.checkAuthStatus();
      setIsCalendarAuthenticated(status.authenticated);
    } catch (error) {
      console.error('Error checking calendar auth:', error);
    }
  };

  const handleConnectCalendar = async () => {
    try {
      const response = await googleCalendarAPI.login();
      window.open(response.auth_url, '_blank');
      setTimeout(checkCalendarAuth, 3000);
    } catch (error) {
      console.error('Error connecting to calendar:', error);
    }
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleStartEdit = (session: StopwatchSession) => {
    setEditingId(session.id);
    setEditName(session.name);
  };

  const handleSaveEdit = (sessionId: number) => {
    if (editName.trim()) {
      onUpdateSession(sessionId, editName.trim());
      setEditingId(null);
      setEditName('');
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleCalendarAction = async (session: StopwatchSession) => {
    setLoadingCalendar(session.id);
    try {
      if (session.is_on_calendar) {
        await onRemoveFromCalendar(session.id);
      } else {
        await onAddToCalendar(session.id);
      }
    } finally {
      setLoadingCalendar(null);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-6 transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white drop-shadow-lg">Recordings</h2>
        {!isCalendarAuthenticated && (
          <button
            onClick={handleConnectCalendar}
            className="glass-button text-sm py-2 px-4 rounded-xl flex items-center gap-2 transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Connect Calendar
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 space-y-3">
        <input
          type="text"
          placeholder="Search by name..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="glass-input w-full px-3 py-2 rounded-lg text-sm"
        />
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex gap-2 items-center flex-1 min-w-0">
            <label className="text-white/60 text-xs whitespace-nowrap">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="glass-input flex-1 px-2 py-1 rounded-lg text-sm"
            />
          </div>
          <div className="flex gap-2 items-center flex-1 min-w-0">
            <label className="text-white/60 text-xs whitespace-nowrap">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="glass-input flex-1 px-2 py-1 rounded-lg text-sm"
            />
          </div>
          <div className="flex rounded-lg overflow-hidden border border-white/20 text-xs">
            {(['all', 'on', 'off'] as CalendarFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setCalendarFilter(f)}
                className={`px-3 py-1 transition-colors ${
                  calendarFilter === f
                    ? 'bg-white/20 text-white font-semibold'
                    : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
              >
                {f === 'all' ? 'All' : f === 'on' ? 'On Calendar' : 'Not on Calendar'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {sessions.length === 0 ? (
        <p className="text-white/70 text-center py-8">
          No sessions yet. Start the stopwatch to create your first session!
        </p>
      ) : filteredSessions.length === 0 ? (
        <p className="text-white/70 text-center py-8">No recordings match your filters.</p>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
          {filteredSessions.map((session) => (
            <div
              key={session.id}
              className="glass-inner rounded-xl p-4 transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm"
            >
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                  {editingId === session.id ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="glass-input flex-1 px-3 py-1 rounded-lg text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(session.id);
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                      />
                      <button
                        onClick={() => handleSaveEdit(session.id)}
                        className="text-green-400 hover:text-green-300 text-sm"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="text-white/70 hover:text-white text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <h3
                      className="font-semibold text-lg text-white truncate cursor-pointer hover:text-white/80"
                      onClick={() => handleStartEdit(session)}
                      title="Click to edit name"
                    >
                      {session.name}
                    </h3>
                  )}
                  <div className="text-sm text-white/70 mt-1 space-y-1">
                    <p className="flex items-center gap-2">
                      <span className="text-white/50">Duration:</span>
                      <span className="font-mono">{formatDuration(session.duration)}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <span className="text-white/50">Created:</span>
                      {formatDate(session.created_at)}
                    </p>
                    {session.notes && (
                      <p className="text-white/60 italic truncate" title={session.notes}>
                        {session.notes}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 items-end">
                  {/* Calendar Status Badge */}
                  {session.is_on_calendar && (
                    <span className="text-xs bg-green-500/30 text-green-300 px-2 py-1 rounded-full">
                      On Calendar
                    </span>
                  )}

                  <div className="flex gap-2">
                    {/* Calendar Button */}
                    {isCalendarAuthenticated && (
                      <button
                        onClick={() => handleCalendarAction(session)}
                        disabled={loadingCalendar === session.id}
                        className={`text-sm px-3 py-1 rounded-lg transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm ${
                          session.is_on_calendar
                            ? 'glass-button-red'
                            : 'glass-button-primary'
                        }`}
                        title={session.is_on_calendar ? 'Remove from calendar' : 'Add to calendar'}
                      >
                        {loadingCalendar === session.id ? (
                          '...'
                        ) : session.is_on_calendar ? (
                          '📅 Remove'
                        ) : (
                          '📅 Add'
                        )}
                      </button>
                    )}

                    {/* Delete Button */}
                    <button
                      onClick={() => onDeleteSession(session.id)}
                      className="text-red-400 hover:text-red-300 text-sm px-2 py-1 transition-all duration-300 ease-out hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
