import { useState, useCallback } from 'react';
import { ScheduleItemCreate } from '../types';

interface ActivityEntry {
  taskId?: number;
  name: string;
  estimatedDuration: number; // seconds
}

interface TimelineItem extends ActivityEntry {
  startTime: Date;
  endTime: Date;
}

interface ScheduleTimelineProps {
  activities: ActivityEntry[];
  startTime: Date;
  existingEvents: { name: string; start: string; end: string }[]; // from Google Calendar or scheduled sessions
  onSelect: (ordered: ActivityEntry[], items: ScheduleItemCreate[]) => void;
  onReorder: (activities: ActivityEntry[]) => void;
}

type OptionKey = 'your-order' | 'shortest-first' | 'longest-first' | 'best-fit';

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

export function buildTimeline(activities: ActivityEntry[], start: Date): TimelineItem[] {
  const timeline: TimelineItem[] = [];
  let cursor = new Date(start);
  for (const a of activities) {
    const startTime = new Date(cursor);
    const endTime = new Date(cursor.getTime() + a.estimatedDuration * 1000);
    timeline.push({ ...a, startTime, endTime });
    cursor = endTime;
  }
  return timeline;
}

export function bestFitOrder(
  activities: ActivityEntry[],
  existingEvents: { name: string; start: string; end: string }[],
  dayStart: Date,
  dayEnd: Date
): ActivityEntry[] {
  // Build free gaps from existing events
  const events = existingEvents
    .map(e => ({ start: new Date(e.start), end: new Date(e.end) }))
    .filter(e => e.start >= dayStart && e.start < dayEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const gaps: { start: Date; end: Date; duration: number }[] = [];
  let cursor = new Date(dayStart);
  for (const ev of events) {
    if (ev.start > cursor) {
      gaps.push({ start: cursor, end: ev.start, duration: (ev.start.getTime() - cursor.getTime()) / 1000 });
    }
    if (ev.end > cursor) cursor = ev.end;
  }
  if (cursor < dayEnd) {
    gaps.push({ start: cursor, end: dayEnd, duration: (dayEnd.getTime() - cursor.getTime()) / 1000 });
  }

  if (gaps.length === 0) return [...activities].sort((a, b) => b.estimatedDuration - a.estimatedDuration);

  // Greedy: place longest activity into largest gap
  const remaining = [...activities].sort((a, b) => b.estimatedDuration - a.estimatedDuration);
  const sortedGaps = [...gaps].sort((a, b) => b.duration - a.duration);
  const placed: ActivityEntry[] = [];
  const unplaced: ActivityEntry[] = [];

  for (const activity of remaining) {
    const gap = sortedGaps.find(g => g.duration >= activity.estimatedDuration);
    if (gap) {
      placed.push(activity);
      gap.duration -= activity.estimatedDuration;
    } else {
      unplaced.push(activity);
    }
  }

  return [...placed, ...unplaced];
}

export default function ScheduleTimeline({
  activities,
  startTime,
  existingEvents,
  onSelect,
  onReorder,
}: ScheduleTimelineProps) {
  const [selected, setSelected] = useState<OptionKey>('your-order');
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const dayStart = new Date(startTime);
  dayStart.setHours(6, 0, 0, 0);
  const dayEnd = new Date(startTime);
  dayEnd.setHours(23, 0, 0, 0);

  const options: Record<OptionKey, { label: string; description: string; order: ActivityEntry[] }> = {
    'your-order': {
      label: 'Your Order',
      description: 'Activities in the order you listed them',
      order: [...activities],
    },
    'shortest-first': {
      label: 'Shortest First',
      description: 'Build momentum with quick wins',
      order: [...activities].sort((a, b) => a.estimatedDuration - b.estimatedDuration),
    },
    'longest-first': {
      label: 'Longest First',
      description: 'Tackle the hardest thing early',
      order: [...activities].sort((a, b) => b.estimatedDuration - a.estimatedDuration),
    },
    'best-fit': {
      label: 'Best Fit',
      description: existingEvents.length > 0
        ? 'Slots activities around your existing events'
        : 'No existing events — falls back to longest first',
      order: bestFitOrder(activities, existingEvents, dayStart, dayEnd),
    },
  };

  const currentOrder = selected === 'your-order' ? activities : options[selected].order;
  const timeline = buildTimeline(currentOrder, startTime);
  const totalSeconds = activities.reduce((s, a) => s + a.estimatedDuration, 0);
  const endTime = timeline.length > 0 ? timeline[timeline.length - 1].endTime : startTime;

  const handleConfirm = useCallback(() => {
    const items: ScheduleItemCreate[] = timeline.map((item, i) => ({
      task_id: item.taskId,
      custom_name: item.taskId ? undefined : item.name,
      estimated_duration: item.estimatedDuration,
      position: i,
      scheduled_time: item.startTime.toISOString(),
    }));
    onSelect(currentOrder, items);
  }, [timeline, currentOrder, onSelect]);

  // Drag-to-reorder for "your-order" tab
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const reordered = [...activities];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    setDragIdx(idx);
    onReorder(reordered);
  };
  const handleDragEnd = () => setDragIdx(null);

  return (
    <div className="space-y-4">
      {/* Option tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(Object.keys(options) as OptionKey[]).map(key => (
          <button
            key={key}
            onClick={() => setSelected(key)}
            className={`px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 text-left ${
              selected === key ? 'glass-button-primary' : 'glass-button hover:bg-white/10'
            }`}
          >
            <div className="font-semibold">{options[key].label}</div>
            <div className="text-xs opacity-70 mt-0.5 leading-tight">{options[key].description}</div>
          </button>
        ))}
      </div>

      {/* Summary bar */}
      <div className="glass-inner rounded-xl px-4 py-2 flex gap-4 text-sm text-white/70">
        <span>Total: <span className="text-white font-medium">{formatDuration(totalSeconds)}</span></span>
        <span>Start: <span className="text-white font-medium">{formatTime(startTime)}</span></span>
        <span>End: <span className="text-white font-medium">{formatTime(endTime)}</span></span>
        <span className="ml-auto text-white/40">{activities.length} activities</span>
      </div>

      {/* Timeline blocks */}
      <div className="space-y-1.5">
        {timeline.map((item, i) => {
          const isDraggable = selected === 'your-order';
          return (
            <div
              key={`${item.name}-${i}`}
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
                <span className="text-white text-sm font-medium">{item.name}</span>
                {!item.taskId && (
                  <span className="ml-2 text-white/40 text-xs">(custom)</span>
                )}
              </div>
              <div className="text-right">
                <div className="text-white/60 text-xs">{formatTime(item.startTime)} – {formatTime(item.endTime)}</div>
                <div className="text-white/40 text-xs">{formatDuration(item.estimatedDuration)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Existing events overlay hint */}
      {existingEvents.length > 0 && selected === 'best-fit' && (
        <div className="glass-inner rounded-xl px-4 py-2 text-xs text-white/50">
          <span className="text-white/70 font-medium">Existing events considered:</span>{' '}
          {existingEvents.map(e => e.name).join(', ')}
        </div>
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
