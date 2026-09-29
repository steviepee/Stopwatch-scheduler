import { useState, useEffect, useMemo } from 'react';
import { StopwatchSession, StopwatchSessionCreate, Task } from '../types';
import { googleCalendarAPI, sessionAPI } from '../services/api';

interface SessionListProps {
  sessions: StopwatchSession[];
  tasks: Task[];
  onDeleteSession: (sessionId: number) => void;
  onUpdateSession: (sessionId: number, name: string) => void;
  onSessionCreated: (session: StopwatchSession) => void;
}

function toLocalInput(date: Date): string {
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

function ManualForm({
  tasks,
  onCreated,
  onCancel,
}: {
  tasks: Task[];
  onCreated: (session: StopwatchSession) => void;
  onCancel: () => void;
}) {
  const [openedAt] = useState(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    return d;
  });
  const [name, setName] = useState('');
  const [activityId, setActivityId] = useState('');
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('0');
  const [editedStart, setEditedStart] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const duration = ((Number(hours) || 0) * 60 + (Number(minutes) || 0)) * 60;
  const startValue = editedStart ?? toLocalInput(new Date(openedAt.getTime() - duration * 1000));

  const handleSave = async () => {
    if (duration <= 0 || saving) return;
    const start = new Date(startValue);
    const task = tasks.find(t => t.id === Number(activityId));
    const body: StopwatchSessionCreate = {
      name: name.trim() || task?.name || 'Recording',
      duration,
      ...(task ? { task_id: task.id } : {}),
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + duration * 1000).toISOString(),
    };
    setSaving(true);
    setError(false);
    try {
      onCreated(await sessionAPI.create(body));
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="manual-form" className="glass-inner rounded-xl p-4 mb-4 space-y-3">
      <input
        type="text"
        data-testid="manual-name"
        placeholder="Name"
        value={name}
        onChange={e => setName(e.target.value)}
        className="glass-input w-full px-3 py-2 rounded-lg text-sm"
      />
      <select
        data-testid="manual-activity"
        value={activityId}
        onChange={e => setActivityId(e.target.value)}
        className="glass-input w-full px-3 py-2 rounded-lg text-sm"
      >
        <option value="">No Activity</option>
        {tasks.map(t => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      <div className="flex gap-2 items-center">
        <input
          type="number"
          min="0"
          data-testid="manual-hours"
          value={hours}
          onChange={e => setHours(e.target.value)}
          className="glass-input w-20 px-3 py-2 rounded-lg text-sm"
        />
        <span className="text-white/60 text-xs">h</span>
        <input
          type="number"
          min="0"
          max="59"
          data-testid="manual-minutes"
          value={minutes}
          onChange={e => setMinutes(e.target.value)}
          className="glass-input w-20 px-3 py-2 rounded-lg text-sm"
        />
        <span className="text-white/60 text-xs">min</span>
      </div>
      <div className="flex gap-2 items-center">
        <label className="text-white/60 text-xs whitespace-nowrap">Start</label>
        <input
          type="datetime-local"
          data-testid="manual-start"
          value={startValue}
          onChange={e => setEditedStart(e.target.value)}
          className="glass-input flex-1 px-2 py-1 rounded-lg text-sm"
        />
      </div>
      {error && (
        <p data-testid="manual-save-error" className="text-red-300 text-sm">Failed to save recording. Try again.</p>
      )}
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="glass-button text-sm py-1 px-3 rounded-lg">
          Cancel
        </button>
        <button
          data-testid="btn-manual-save"
          onClick={handleSave}
          disabled={duration <= 0 || saving}
          className="glass-button-primary text-sm py-1 px-3 rounded-lg disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function SessionList({
  sessions,
  tasks,
  onDeleteSession,
  onUpdateSession,
  onSessionCreated,
}: SessionListProps) {
  const [manualOpen, setManualOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [isCalendarAuthenticated, setIsCalendarAuthenticated] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filteredSessions = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(dateTo + 'T23:59:59') : null;
    return sessions.filter(s => {
      if (q && !s.name.toLowerCase().includes(q)) return false;
      const created = new Date(s.created_at);
      if (from && created < from) return false;
      if (to && created > to) return false;
      return true;
    });
  }, [sessions, searchQuery, dateFrom, dateTo]);

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

  const dateStamp = () => new Date().toISOString().split('T')[0];

  const exportCSV = () => {
    const headers = ['id', 'name', 'duration_seconds', 'task_id', 'notes', 'created_at'];
    const rows = sessions.map(s => [
      s.id,
      `"${s.name.replace(/"/g, '""')}"`,
      s.duration,
      s.task_id ?? '',
      `"${(s.notes ?? '').replace(/"/g, '""')}"`,
      s.created_at,
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    download(`sessions_${dateStamp()}.csv`, csv, 'text/csv');
  };

  const exportJSON = () => {
    download(`sessions_${dateStamp()}.json`, JSON.stringify(sessions, null, 2), 'application/json');
  };

  const download = (filename: string, content: string, type: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
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
        <div className="flex gap-2">
          <button
            data-testid="btn-add-manual"
            onClick={() => setManualOpen(true)}
            className="glass-button text-xs py-1 px-3 rounded-lg"
          >
            Add manually
          </button>
          <button onClick={exportCSV} className="glass-button text-xs py-1 px-3 rounded-lg">
            CSV
          </button>
          <button onClick={exportJSON} className="glass-button text-xs py-1 px-3 rounded-lg">
            JSON
          </button>
        </div>
      </div>

      {manualOpen && (
        <ManualForm
          tasks={tasks}
          onCreated={session => {
            onSessionCreated(session);
            setManualOpen(false);
          }}
          onCancel={() => setManualOpen(false)}
        />
      )}

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
                  <div className="flex gap-2">
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
