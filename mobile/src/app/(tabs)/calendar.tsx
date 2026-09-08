import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { sessionAPI, calendarImportAPI } from '@/services/api';
import {
  formatDayLong,
  heightFromDuration,
  isSameDay,
  nextDay,
  positionFromTime,
  previousDay,
  snapToSlot,
} from '@/utils/calendarUtils';
import type { StopwatchSession } from '@/types';

const START_HOUR = 0;
const END_HOUR = 24;
const HOUR_HEIGHT = 180; // px per hour (3px/min) — keeps a 15-minute block above the 44pt touch target
const INTERVAL_MIN = 60;
const SNAP_MIN = 15;

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function pxToMinutes(px: number): number {
  return (px / HOUR_HEIGHT) * 60;
}

export default function CalendarDayScreen() {
  const queryClient = useQueryClient();
  const [day, setDay] = useState(() => new Date());

  const { data: scheduled } = useQuery({
    queryKey: ['sessions', 'scheduled'],
    queryFn: sessionAPI.getScheduled,
  });

  const {
    data: googleEvents,
    isError: googleError,
    refetch: refetchGoogle,
  } = useQuery({
    queryKey: ['calendar-events', dayKey(day)],
    queryFn: () => calendarImportAPI.getEvents(dayKey(day)),
  });

  const scheduleMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { scheduled_start: string; scheduled_end: string } }) =>
      sessionAPI.schedule(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const dayItems = useMemo(
    () =>
      (scheduled ?? []).filter(
        (session) => session.scheduled_start && isSameDay(new Date(session.scheduled_start), day)
      ),
    [scheduled, day]
  );

  function commitDrag(item: StopwatchSession, translationY: number) {
    if (!item.scheduled_start) return;
    const originalStart = new Date(item.scheduled_start);
    const durationMs = item.scheduled_end
      ? new Date(item.scheduled_end).getTime() - originalStart.getTime()
      : item.duration * 1000;
    const rawStart = new Date(originalStart.getTime() + pxToMinutes(translationY) * 60 * 1000);
    const snappedStart = snapToSlot(rawStart, SNAP_MIN);
    const snappedEnd = new Date(snappedStart.getTime() + durationMs);
    scheduleMutation.mutate({
      id: item.id,
      body: { scheduled_start: snappedStart.toISOString(), scheduled_end: snappedEnd.toISOString() },
    });
  }

  function commitResize(item: StopwatchSession, translationY: number) {
    if (!item.scheduled_start) return;
    const baseEnd = item.scheduled_end
      ? new Date(item.scheduled_end)
      : new Date(new Date(item.scheduled_start).getTime() + item.duration * 1000);
    const rawEnd = new Date(baseEnd.getTime() + pxToMinutes(translationY) * 60 * 1000);
    const snappedEnd = snapToSlot(rawEnd, SNAP_MIN);
    scheduleMutation.mutate({
      id: item.id,
      body: { scheduled_start: item.scheduled_start, scheduled_end: snappedEnd.toISOString() },
    });
  }

  return (
    <View style={styles.container}>
      <View style={styles.nav}>
        <Pressable
          testID="day-nav-prev"
          accessibilityRole="button"
          style={styles.navButton}
          onPress={() => setDay((current) => previousDay(current))}>
          <Text style={styles.navLabel}>‹</Text>
        </Pressable>
        <Text testID="day-label" style={styles.dayLabel}>
          {formatDayLong(day)}
        </Text>
        <Pressable
          testID="day-nav-next"
          accessibilityRole="button"
          style={styles.navButton}
          onPress={() => setDay((current) => nextDay(current))}>
          <Text style={styles.navLabel}>›</Text>
        </Pressable>
      </View>

      {googleError && (
        <View testID="google-events-error" style={styles.errorBanner}>
          <Text style={styles.errorText}>Couldn't load Google events</Text>
          <Pressable
            testID="btn-retry-google"
            accessibilityRole="button"
            style={styles.retryButton}
            onPress={() => refetchGoogle()}>
            <Text style={styles.buttonLabel}>Retry</Text>
          </Pressable>
        </View>
      )}

      <ScrollView
        style={styles.grid}
        contentContainerStyle={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT, position: 'relative' }}>
        {isSameDay(day, new Date()) && (
          <View
            testID="current-time-line"
            style={[
              styles.currentTimeLine,
              { top: positionFromTime(new Date(), START_HOUR, HOUR_HEIGHT, INTERVAL_MIN) },
            ]}
          />
        )}

        {(googleEvents ?? []).map((event) => {
          const start = new Date(event.start);
          const end = new Date(event.end);
          const key = event.id ?? `${event.summary}-${event.start}`;
          return (
            <View
              key={key}
              testID={`google-block-${key}`}
              style={[
                styles.googleBlock,
                {
                  top: positionFromTime(start, START_HOUR, HOUR_HEIGHT, INTERVAL_MIN),
                  height: heightFromDuration((end.getTime() - start.getTime()) / 1000, HOUR_HEIGHT, INTERVAL_MIN),
                },
              ]}>
              <Text style={styles.googleBlockText}>{event.summary}</Text>
            </View>
          );
        })}

        {dayItems.map((item) => {
          const start = new Date(item.scheduled_start!);
          const dragGesture = Gesture.Pan().onEnd((event) => {
            runOnJS(commitDrag)(item, event.translationY);
          });
          const resizeGesture = Gesture.Pan().onEnd((event) => {
            runOnJS(commitResize)(item, event.translationY);
          });

          return (
            <GestureDetector key={item.id} gesture={dragGesture}>
              <View
                testID={`session-block-${item.id}`}
                style={[
                  styles.sessionBlock,
                  {
                    top: positionFromTime(start, START_HOUR, HOUR_HEIGHT, INTERVAL_MIN),
                    height: heightFromDuration(item.duration, HOUR_HEIGHT, INTERVAL_MIN),
                  },
                ]}>
                <Text style={styles.sessionBlockText}>{item.name}</Text>
                <GestureDetector gesture={resizeGesture}>
                  <View testID={`session-block-${item.id}-resize-handle`} style={styles.resizeHandle} />
                </GestureDetector>
              </View>
            </GestureDetector>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  navButton: {
    minWidth: touchTarget,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navLabel: {
    ...typography.heading,
    color: colors.text,
  },
  dayLabel: {
    ...typography.body,
    color: colors.text,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  errorText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  retryButton: {
    minHeight: touchTarget,
    minWidth: touchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    ...typography.label,
    color: colors.text,
  },
  grid: {
    flex: 1,
  },
  currentTimeLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.red,
    zIndex: 2,
  },
  googleBlock: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    borderRadius: radii.sm,
    backgroundColor: colors.glassInner,
    borderWidth: 1,
    borderColor: colors.glassBorderInner,
    borderStyle: 'dashed',
    padding: spacing.xs,
  },
  googleBlockText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  sessionBlock: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    borderRadius: radii.sm,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: spacing.xs,
  },
  sessionBlockText: {
    ...typography.label,
    color: colors.text,
  },
  resizeHandle: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: spacing.sm,
  },
});
