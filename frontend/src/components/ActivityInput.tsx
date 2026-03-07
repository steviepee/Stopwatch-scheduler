import { useState, useRef, useEffect } from 'react';
import { Task, TaskStats, UserOptions, DEFAULT_USER_OPTIONS } from '../types';
import { taskAPI } from '../services/api';

interface ActivityInputProps {
  tasks: Task[];
  onAdd: (activity: { taskId?: number; name: string; estimatedDuration: number }) => void;
  options?: UserOptions;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function ActivityInput({ tasks, onAdd, options }: ActivityInputProps) {
  const opts = options ?? DEFAULT_USER_OPTIONS;
  const [query, setQuery] = useState('');
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [matchedTask, setMatchedTask] = useState<Task | null>(null);
  const [customDuration, setCustomDuration] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const statsCache = useRef<Record<number, TaskStats>>({});

  const filtered = tasks.filter(t =>
    t.name.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (!query.trim()) {
      setMatchedTask(null);
      setStats(null);
      return;
    }
    const exact = tasks.find(t => t.name.toLowerCase() === query.toLowerCase());
    setMatchedTask(exact ?? null);
    if (exact) {
      loadStats(exact.id);
    } else {
      setStats(null);
    }
  }, [query, tasks]);

  const loadStats = async (taskId: number) => {
    if (statsCache.current[taskId]) {
      setStats(statsCache.current[taskId]);
      return;
    }
    try {
      const s = await taskAPI.getStats(taskId);
      statsCache.current[taskId] = s;
      setStats(s);
    } catch {
      setStats(null);
    }
  };

  const pickSuggested = (): number => {
    if (!stats) return 0;
    if (opts.showPrevious && stats.previous != null) return stats.previous;
    if (opts.showMedian && stats.median != null) return stats.median;
    if (opts.showAverage) return stats.average;
    return stats.average;
  };

  const handleSelect = (task: Task) => {
    setQuery(task.name);
    setShowDropdown(false);
    loadStats(task.id);
    setMatchedTask(task);
    inputRef.current?.focus();
  };

  const handleAdd = () => {
    const name = query.trim();
    if (!name) return;

    let duration: number;
    if (customDuration) {
      duration = parseFloat(customDuration) * 60; // user enters minutes
    } else {
      duration = pickSuggested();
    }
    if (!duration || duration <= 0) duration = 30 * 60; // default 30 min

    onAdd({ taskId: matchedTask?.id, name, estimatedDuration: duration });
    setQuery('');
    setCustomDuration('');
    setStats(null);
    setMatchedTask(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (showDropdown && filtered.length > 0) {
        handleSelect(filtered[0]);
      } else {
        handleAdd();
      }
    }
    if (e.key === 'Escape') setShowDropdown(false);
  };

  const anyMetric = opts.showAverage || opts.showMedian || opts.showPrevious;

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            onKeyDown={handleKeyDown}
            placeholder="Activity name (e.g. Go for a run)"
            className="glass-input w-full px-4 py-2 rounded-xl text-white placeholder-white/50 text-sm"
          />

          {/* Autocomplete dropdown */}
          {showDropdown && query && filtered.length > 0 && (
            <div className="absolute z-50 top-full mt-1 w-full glass-card rounded-xl overflow-hidden shadow-xl">
              {filtered.slice(0, 6).map(task => (
                <button
                  key={task.id}
                  onMouseDown={() => handleSelect(task)}
                  className="w-full text-left px-4 py-2 text-white hover:bg-white/10 transition-colors flex justify-between items-center text-sm"
                >
                  <span>{task.name}</span>
                  <span className="text-white/50 text-xs">{formatDuration(task.average_duration)} avg</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Custom duration override (in minutes) */}
        <input
          type="number"
          value={customDuration}
          onChange={e => setCustomDuration(e.target.value)}
          placeholder="min"
          min="1"
          className="glass-input w-20 px-3 py-2 rounded-xl text-white placeholder-white/50 text-sm text-center"
          title="Override duration in minutes"
        />

        <button
          onClick={handleAdd}
          disabled={!query.trim()}
          className="glass-button-primary px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {/* Duration metrics hint */}
      {stats && anyMetric && (
        <div className="flex gap-3 mt-1.5 px-1 text-xs text-white/60">
          {opts.showAverage && (
            <span>Avg: <span className="text-white/80">{formatDuration(stats.average)}</span></span>
          )}
          {opts.showMedian && stats.median != null && (
            <span>Median: <span className="text-white/80">{formatDuration(stats.median)}</span></span>
          )}
          {opts.showPrevious && stats.previous != null && (
            <span>Last: <span className="text-white/80">{formatDuration(stats.previous)}</span></span>
          )}
          {!customDuration && (
            <span className="text-white/40 ml-auto">
              Will use {opts.showPrevious && stats.previous ? 'last' : opts.showMedian && stats.median ? 'median' : 'avg'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
