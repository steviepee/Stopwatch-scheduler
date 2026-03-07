import { useState, useEffect } from 'react';
import { formatDayLong } from '../../utils/calendarUtils';
import { Task, TaskStats, UserOptions, DEFAULT_USER_OPTIONS } from '../../types';
import { taskAPI } from '../../services/api';

interface CreateEventModalProps {
  initialDate: Date;
  initialTime: string; // "HH:MM" format
  onClose: () => void;
  onSubmit: (data: { name: string; date: Date; startTime: string; durationMinutes: number }) => void;
  tasks?: Task[];
  options?: UserOptions;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m`;
}

export function CreateEventModal({ initialDate, initialTime, onClose, onSubmit, tasks = [], options }: CreateEventModalProps) {
  const opts = options ?? DEFAULT_USER_OPTIONS;
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState(initialTime);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [stats, setStats] = useState<TaskStats | null>(null);

  useEffect(() => {
    if (!name.trim()) { setStats(null); return; }
    const exact = tasks.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (exact) {
      taskAPI.getStats(exact.id).then(s => {
        setStats(s);
        // Auto-fill duration from best available metric
        let secs: number | null = null;
        if (opts.showPrevious && s.previous != null) secs = s.previous;
        else if (opts.showMedian && s.median != null) secs = s.median;
        else if (opts.showAverage) secs = s.average;
        if (secs) setDurationMinutes(Math.round(secs / 60));
      }).catch(() => setStats(null));
    } else {
      setStats(null);
    }
  }, [name]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), date: initialDate, startTime, durationMinutes });
  };

  const durationOptions = [
    { value: 15, label: '15 minutes' },
    { value: 30, label: '30 minutes' },
    { value: 45, label: '45 minutes' },
    { value: 60, label: '1 hour' },
    { value: 90, label: '1.5 hours' },
    { value: 120, label: '2 hours' },
    { value: 180, label: '3 hours' },
    { value: 240, label: '4 hours' },
  ];

  const anyMetric = opts.showAverage || opts.showMedian || opts.showPrevious;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>New Event</h3>
          <button className="modal-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label htmlFor="event-name">Event name</label>
              <input
                id="event-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Meeting, Appointment, etc."
                autoFocus
                className="glass-input"
                list="activity-suggestions"
              />
              <datalist id="activity-suggestions">
                {tasks.map(t => <option key={t.id} value={t.name} />)}
              </datalist>
              {/* Duration hints */}
              {stats && anyMetric && (
                <div className="flex gap-3 mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  {opts.showAverage && (
                    <span>Avg: <strong style={{ color: 'rgba(255,255,255,0.8)' }}>{formatDuration(stats.average)}</strong></span>
                  )}
                  {opts.showMedian && stats.median != null && (
                    <span>Median: <strong style={{ color: 'rgba(255,255,255,0.8)' }}>{formatDuration(stats.median)}</strong></span>
                  )}
                  {opts.showPrevious && stats.previous != null && (
                    <span>Last: <strong style={{ color: 'rgba(255,255,255,0.8)' }}>{formatDuration(stats.previous)}</strong></span>
                  )}
                </div>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="event-date">Date</label>
                <div className="date-display">{formatDayLong(initialDate)}</div>
              </div>

              <div className="form-group">
                <label htmlFor="event-time">Start time</label>
                <input
                  id="event-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="glass-input"
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="event-duration">Duration</label>
              <select
                id="event-duration"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="glass-input"
              >
                {durationOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="glass-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="glass-button-primary" disabled={!name.trim()}>
              Create Event
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
