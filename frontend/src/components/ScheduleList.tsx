import { useState } from 'react';
import { Schedule } from '../types';
import { scheduleAPI } from '../services/api';

interface ScheduleListProps {
  schedules: Schedule[];
  regimens: Schedule[];
  onScheduleUpdate: (s: Schedule) => void;
  onScheduleDelete: (id: number) => void;
  onApplyRegimen: (regimen: Schedule) => void;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function StarRating({ value, onChange }: { value?: number; onChange: (r: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(null)}
          onClick={() => onChange(star)}
          className="text-lg leading-none transition-colors"
          style={{ color: (hover ?? value ?? 0) >= star ? '#fbbf24' : 'rgba(255,255,255,0.2)' }}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function ScheduleCard({
  schedule,
  onUpdate,
  onDelete,
}: {
  schedule: Schedule;
  onUpdate: (s: Schedule) => void;
  onDelete: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const handleRate = async (rating: number) => {
    try {
      const updated = await scheduleAPI.rate(schedule.id, rating);
      onUpdate(updated);
    } catch {
      console.error('Failed to rate schedule');
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${schedule.name}"?`)) return;
    try {
      await scheduleAPI.delete(schedule.id);
      onDelete(schedule.id);
    } catch {
      console.error('Failed to delete schedule');
    }
  };

  const totalDuration = schedule.items.reduce((s, i) => s + i.estimated_duration, 0);

  return (
    <div className="glass-inner rounded-xl overflow-hidden transition-all duration-300 ease-out hover:scale-[1.01] hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5">
      <button
        className="w-full px-4 py-3 flex items-center gap-3 text-left"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="text-white font-medium text-sm truncate">{schedule.name}</div>
          <div className="text-white/50 text-xs mt-0.5">
            {formatDate(schedule.target_date)} · {schedule.items.length} activities · {formatDuration(totalDuration)}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StarRating value={schedule.rating} onChange={handleRate} />
          <span className="text-white/30 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2 border-t border-white/10">
          {schedule.items.map((item, i) => (
            <div key={item.id} className="flex justify-between text-sm pt-1">
              <span className="text-white/70">{i + 1}. {item.custom_name ?? item.task?.name ?? '—'}</span>
              <span className="text-white/40">{formatDuration(item.estimated_duration)}</span>
            </div>
          ))}
          {schedule.notes && (
            <p className="text-white/50 text-xs pt-1">{schedule.notes}</p>
          )}
          <div className="flex justify-end pt-1">
            <button
              onClick={handleDelete}
              className="text-red-400/60 hover:text-red-400 text-xs transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RegimenCard({
  regimen,
  onApply,
  onDelete,
}: {
  regimen: Schedule;
  onApply: (r: Schedule) => void;
  onDelete: (id: number) => void;
}) {
  const totalDuration = regimen.items.reduce((s, i) => s + i.estimated_duration, 0);

  const handleDelete = async () => {
    if (!confirm(`Delete regimen "${regimen.name}"?`)) return;
    try {
      await scheduleAPI.delete(regimen.id);
      onDelete(regimen.id);
    } catch {
      console.error('Failed to delete regimen');
    }
  };

  return (
    <div className="glass-inner rounded-xl px-4 py-3 flex items-center gap-3 transition-all duration-300 ease-out hover:scale-[1.01] hover:bg-white/5">
      <div className="flex-1 min-w-0">
        <div className="text-white font-medium text-sm truncate">{regimen.name}</div>
        <div className="text-white/50 text-xs mt-0.5">
          {regimen.items.length} activities · {formatDuration(totalDuration)}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={() => onApply(regimen)}
          className="glass-button px-3 py-1.5 rounded-lg text-xs font-medium"
        >
          Apply to Date
        </button>
        <button
          onClick={handleDelete}
          className="text-red-400/50 hover:text-red-400 text-xs transition-colors px-1"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function ScheduleList({
  schedules,
  regimens,
  onScheduleUpdate,
  onScheduleDelete,
  onApplyRegimen,
}: ScheduleListProps) {
  const [tab, setTab] = useState<'schedules' | 'regimens'>('schedules');

  return (
    <div className="glass-card rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Saved Schedules</h2>
        <div className="flex gap-1">
          <button
            onClick={() => setTab('schedules')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              tab === 'schedules' ? 'glass-button-primary' : 'glass-button'
            }`}
          >
            Schedules ({schedules.length})
          </button>
          <button
            onClick={() => setTab('regimens')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              tab === 'regimens' ? 'glass-button-primary' : 'glass-button'
            }`}
          >
            Regimens ({regimens.length})
          </button>
        </div>
      </div>

      {tab === 'schedules' && (
        schedules.length === 0 ? (
          <p className="text-white/40 text-sm text-center py-4">No schedules yet. Build one above.</p>
        ) : (
          <div className="space-y-2">
            {schedules.map(s => (
              <ScheduleCard
                key={s.id}
                schedule={s}
                onUpdate={onScheduleUpdate}
                onDelete={onScheduleDelete}
              />
            ))}
          </div>
        )
      )}

      {tab === 'regimens' && (
        regimens.length === 0 ? (
          <p className="text-white/40 text-sm text-center py-4">No regimens yet. Save a schedule as a regimen to reuse it.</p>
        ) : (
          <div className="space-y-2">
            {regimens.map(r => (
              <RegimenCard
                key={r.id}
                regimen={r}
                onApply={onApplyRegimen}
                onDelete={onScheduleDelete}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}
