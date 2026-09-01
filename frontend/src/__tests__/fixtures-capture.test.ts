/**
 * Captures the current (oracle) outputs of the four schedule strategies as
 * JSON fixtures for backend parity tests. All datetimes are fixed UTC instants
 * so the fixture is timezone-independent.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { buildTimeline, bestFitOrder } from '../components/ScheduleTimeline';

interface ActivityEntry { taskId?: number; name: string; estimatedDuration: number }

const activities: ActivityEntry[] = [
  { taskId: 1, name: 'Write report', estimatedDuration: 5400 },   // 90m
  { name: 'Email sweep', estimatedDuration: 1800 },               // 30m
  { taskId: 2, name: 'Gym', estimatedDuration: 3600 },            // 60m
  { name: 'Read chapter', estimatedDuration: 1800 },              // 30m (tie with Email sweep)
  { name: 'Plan tomorrow', estimatedDuration: 900 },              // 15m
];

const existingEvents = [
  { name: 'Standup', start: '2026-09-02T09:00:00Z', end: '2026-09-02T09:30:00Z' },
  { name: 'Lunch', start: '2026-09-02T12:00:00Z', end: '2026-09-02T13:00:00Z' },
];

const startTime = new Date('2026-09-02T08:00:00Z');
const dayStart = new Date('2026-09-02T06:00:00Z');
const dayEnd = new Date('2026-09-02T23:00:00Z');

function serialize(order: ActivityEntry[]) {
  const timeline = buildTimeline(order, startTime);
  return {
    order: order.map(a => a.name),
    timeline: timeline.map(t => ({
      name: t.name,
      start: t.startTime.toISOString(),
      end: t.endTime.toISOString(),
    })),
  };
}

describe('fixture capture', () => {
  it('captures the four strategy outputs', () => {
    const fixture = {
      input: { activities, existingEvents, startTime: startTime.toISOString(), dayStart: dayStart.toISOString(), dayEnd: dayEnd.toISOString() },
      strategies: {
        'your-order': serialize([...activities]),
        'shortest-first': serialize([...activities].sort((a, b) => a.estimatedDuration - b.estimatedDuration)),
        'longest-first': serialize([...activities].sort((a, b) => b.estimatedDuration - a.estimatedDuration)),
        'best-fit': serialize(bestFitOrder(activities, existingEvents, dayStart, dayEnd)),
        'best-fit-no-events': serialize(bestFitOrder(activities, [], dayStart, dayEnd)),
      },
    };
    const dir = resolve(process.cwd(), '../backend/tests/fixtures');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'generate_parity.json'), JSON.stringify(fixture, null, 2) + '\n');
    expect(fixture.strategies['your-order'].order.length).toBe(5);
  });
});
