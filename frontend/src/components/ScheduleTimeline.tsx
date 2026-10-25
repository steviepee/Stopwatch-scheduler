import { useState, useCallback } from 'react';
import { GenerateActivity, ScheduleItemCreate, StrategyOption, TimelineEntry } from '../types';

interface ScheduleTimelineProps {
  options: StrategyOption[];
  onSelect: (items: ScheduleItemCreate[]) => void;
  onReorder: (activities: GenerateActivity[]) => void;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function entrySeconds(entry: TimelineEntry): number {
  return (Date.parse(entry.end) - Date.parse(entry.start)) / 1000;
}

export default function ScheduleTimeline({ options, onSelect, onReorder }: ScheduleTimelineProps) {
  const [selected, setSelected] = useState('your-order');
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const option = options.find(o => o.strategy === selected) ?? options[0];
  const timeline = option?.timeline ?? [];
  const totalSeconds = timeline.reduce((s, e) => s + entrySeconds(e), 0);
  const isEisenhowerEmpty =
    !!option &&
    option.strategy === 'eisenhower' &&
    option.timeline.length === 0 &&
    option.excluded.length > 0 &&
    option.excluded.every(e => e.reason === 'not-urgent-not-important');

  const handleConfirm = useCallback(() => {
    const items: ScheduleItemCreate[] = timeline.map((entry, i) => ({
      task_id: entry.task_id ?? undefined,
      custom_name: entry.task_id ? undefined : entry.name,
      estimated_duration: entrySeconds(entry),
      position: i,
      scheduled_time: new Date(entry.start).toISOString(),
    }));
    onSelect(items);
  }, [timeline, onSelect]);

  // Drag-to-reorder for "your-order" tab
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const reordered = [...timeline];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    setDragIdx(idx);
    onReorder(reordered.map(entry => ({
      task_id: entry.task_id,
      name: entry.name,
      estimated_duration: entrySeconds(entry),
    })));
  };
  const handleDragEnd = () => setDragIdx(null);

  return (
    <div className="space-y-4">
      {/* Strategy dropdown */}
      <select
        data-testid="strategy-picker"
        value={selected}
        onChange={e => setSelected(e.target.value)}
        className="glass-input w-full px-3 py-2 rounded-xl text-white text-sm"
      >
        {options.map(o => (
          <option key={o.strategy} value={o.strategy}>{o.label}</option>
        ))}
      </select>

      {option && (
        <p data-testid="strategy-description" className="text-white/60 text-xs">{option.description}</p>
      )}

      {isEisenhowerEmpty ? (
        <div data-testid="eisenhower-empty-notice" className="glass-inner rounded-xl px-4 py-2 text-xs text-white/50">
          None of these Activities have a quadrant yet. Set them on the Activities tab.
        </div>
      ) : (
        <>
          {/* Summary bar */}
          {timeline.length > 0 && (
            <div className="glass-inner rounded-xl px-4 py-2 flex gap-4 text-sm text-white/70">
              <span>Total: <span className="text-white font-medium">{formatDuration(totalSeconds)}</span></span>
              <span>Start: <span className="text-white font-medium">{formatTime(new Date(timeline[0].start))}</span></span>
              <span>End: <span className="text-white font-medium">{formatTime(new Date(timeline[timeline.length - 1].end))}</span></span>
              <span className="ml-auto text-white/40">{timeline.length} activities</span>
            </div>
          )}

          {/* Timeline blocks */}
          <div className="space-y-1.5">
            {timeline.map((entry, i) => {
              const isDraggable = option?.strategy === 'your-order';
              return (
                <div
                  key={`${entry.name}-${i}`}
                  draggable={isDraggable}
                  onDragStart={isDraggable ? () => handleDragStart(i) : undefined}
                  onDragOver={isDraggable ? (e) => handleDragOver(e, i) : undefined}
                  onDragEnd={isDraggable ? handleDragEnd : undefined}
                  className={`glass-inner rounded-xl px-4 py-2.5 flex items-center gap-3 ${
                    isDraggable ? 'cursor-grab active:cursor-grabbing' : ''
                  } ${dragIdx === i ? 'opacity-50' : ''}`}
                >
                  {isDraggable && (
                    <span className="text-white/30 text-lg select-none">⠿</span>
                  )}
                  <span className="text-white/40 text-xs w-5 text-center">{i + 1}</span>
                  <div className="flex-1">
                    <span className="text-white text-sm font-medium">{entry.name}</span>
                    {!entry.task_id && (
                      <span className="ml-2 text-white/40 text-xs">(custom)</span>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-white/60 text-xs">{formatTime(new Date(entry.start))} – {formatTime(new Date(entry.end))}</div>
                    <div className="text-white/40 text-xs">{formatDuration(entrySeconds(entry))}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {option && option.excluded.length > 0 && (
            <div className="glass-inner rounded-xl px-4 py-2 text-xs text-white/50">
              {`Didn't fit: ${option.excluded.map(e => e.name).join(', ')}`}
            </div>
          )}

          {option && option.flagged.length > 0 && (
            <div className="glass-inner rounded-xl px-4 py-2 text-xs text-white/50">
              {`Consider delegating: ${option.flagged.map(e => e.name).join(', ')}`}
            </div>
          )}
        </>
      )}

      <button
        onClick={handleConfirm}
        className="w-full glass-button-primary py-3 rounded-xl font-semibold text-sm"
      >
        Use This Schedule
      </button>
    </div>
  );
}
