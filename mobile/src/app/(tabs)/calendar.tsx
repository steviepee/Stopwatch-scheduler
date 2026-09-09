import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { sessionAPI, calendarImportAPI } from '@/services/api';
import {
  formatDayLong,
  formatDayShort,
  getWeekDays,
  heightFromDuration,
  isSameDay,
  nextDay,
  positionFromTime,
  previousDay,
  snapToSlot,
  timeFromPosition,
} from '@/utils/calendarUtils';
import type { StopwatchSession } from '@/types';

type GoogleEvent = { id?: string; summary: string; start: string; end: string };
type WeekAgendaItem =
  | { type: 'session'; id: number; start: Date; name: string }
  | { type: 'google'; id: string; start: Date; name: string };

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
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [bankExpanded, setBankExpanded] = useState(true);
  const [bankSearch, setBankSearch] = useState('');
  const [googleAuthError, setGoogleAuthError] = useState(false);

  const { data: scheduled } = useQuery({
    queryKey: ['sessions', 'scheduled'],
    queryFn: sessionAPI.getScheduled,
  });

  const { data: unscheduled } = useQuery({
    queryKey: ['sessions', 'unscheduled'],
    queryFn: sessionAPI.getUnscheduled,
  });

  const {
    data: googleEvents,
    isError: googleError,
    refetch: refetchGoogle,
  } = useQuery({
    queryKey: ['calendar-events', dayKey(day)],
    queryFn: () => calendarImportAPI.getEvents(dayKey(day)),
  });

  const weekDays = useMemo(() => getWeekDays(day), [day]);
  const weekDayKeys = useMemo(() => weekDays.map(dayKey), [weekDays]);
  const weekGoogleQueries = useQueries({
    queries: weekDayKeys.map((key) => ({
      queryKey: ['calendar-events', key],
      queryFn: () => calendarImportAPI.getEvents(key),
      enabled: viewMode === 'week',
    })),
  });

  const filteredBank = useMemo(
    () => (unscheduled ?? []).filter((item) => item.name.toLowerCase().includes(bankSearch.toLowerCase())),
    [unscheduled, bankSearch]
  );

  const scheduleMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { scheduled_start: string; scheduled_end: string } }) =>
      sessionAPI.schedule(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const unscheduleMutation = useMutation({
    mutationFn: (id: number) => sessionAPI.unschedule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  function onCalendarPushError(error: unknown) {
    if ((error as { response?: { status?: number } })?.response?.status === 401) {
      setGoogleAuthError(true);
    }
  }

  const addToCalendarMutation = useMutation({
    mutationFn: (id: number) => sessionAPI.addToCalendar(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    onError: onCalendarPushError,
  });

  const removeFromCalendarMutation = useMutation({
    mutationFn: (id: number) => sessionAPI.removeFromCalendar(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    onError: onCalendarPushError,
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

  function commitUnschedule(item: StopwatchSession) {
    unscheduleMutation.mutate(item.id);
  }

  function commitBankDrop(item: StopwatchSession, absoluteY: number) {
    const rawStart = timeFromPosition(absoluteY, day, START_HOUR, HOUR_HEIGHT, INTERVAL_MIN);
    const snappedStart = snapToSlot(rawStart, SNAP_MIN);
    const snappedEnd = new Date(snappedStart.getTime() + item.duration * 1000);
    scheduleMutation.mutate({
      id: item.id,
      body: { scheduled_start: snappedStart.toISOString(), scheduled_end: snappedEnd.toISOString() },
    });
  }

  function buildWeekAgendaItems(dayDate: Date, googleForDay: GoogleEvent[]): WeekAgendaItem[] {
    const daySessions: WeekAgendaItem[] = (scheduled ?? [])
      .filter((s) => s.scheduled_start && isSameDay(new Date(s.scheduled_start), dayDate))
      .map((s) => ({ type: 'session', id: s.id, start: new Date(s.scheduled_start!), name: s.name }));
    const dayGoogle: WeekAgendaItem[] = googleForDay.map((e) => ({
      type: 'google',
      id: e.id ?? e.summary,
      start: new Date(e.start),
      name: e.summary,
    }));
    return [...daySessions, ...dayGoogle].sort((a, b) => a.start.getTime() - b.start.getTime());
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
      <View style={styles.viewToggleRow}>
        <Pressable
          testID="view-toggle-day"
          accessibilityRole="button"
          style={[styles.toggleButton, viewMode === 'day' && styles.toggleButtonActive]}
          onPress={() => setViewMode('day')}>
          <Text style={styles.buttonLabel}>Day</Text>
        </Pressable>
        <Pressable
          testID="view-toggle-week"
          accessibilityRole="button"
          style={[styles.toggleButton, viewMode === 'week' && styles.toggleButtonActive]}
          onPress={() => setViewMode('week')}>
          <Text style={styles.buttonLabel}>Week</Text>
        </Pressable>
      </View>

      {viewMode === 'week' && (
        <ScrollView testID="week-agenda">
          {weekDays.map((weekDay, index) => {
            const key = dayKey(weekDay);
            const items = buildWeekAgendaItems(weekDay, weekGoogleQueries[index]?.data ?? []);
            return (
              <Pressable
                key={key}
                testID={`week-day-${key}`}
                accessibilityRole="button"
                style={styles.weekDaySection}
                onPress={() => {
                  setDay(weekDay);
                  setViewMode('day');
                }}>
                <Text style={styles.weekDayLabel}>{formatDayShort(weekDay)}</Text>
                {items.map((item) => (
                  <View key={`${item.type}-${item.id}`} testID={`week-${item.type}-${item.id}`} style={styles.weekItemRow}>
                    <Text style={styles.weekItemText}>{item.name}</Text>
                  </View>
                ))}
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {viewMode === 'day' && (
      <>
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

      {googleAuthError && (
        <View testID="google-auth-error" style={styles.errorBanner}>
          <Text style={styles.errorText}>Google Calendar needs to be reconnected — authorize from a laptop.</Text>
        </View>
      )}

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
            const droppedOnBank = (event as unknown as { droppedOnBank?: boolean }).droppedOnBank;
            if (droppedOnBank) {
              runOnJS(commitUnschedule)(item);
            } else {
              runOnJS(commitDrag)(item, event.translationY);
            }
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
                {item.is_on_calendar ? (
                  <View style={styles.calendarControls}>
                    <View testID={`session-block-${item.id}-calendar-marker`} style={styles.calendarMarker} />
                    <Pressable
                      testID={`session-block-${item.id}-remove-calendar`}
                      accessibilityRole="button"
                      style={styles.calendarButton}
                      onPress={() => removeFromCalendarMutation.mutate(item.id)}>
                      <Text style={styles.calendarButtonText}>Remove</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    testID={`session-block-${item.id}-push`}
                    accessibilityRole="button"
                    style={styles.calendarButton}
                    onPress={() => addToCalendarMutation.mutate(item.id)}>
                    <Text style={styles.calendarButtonText}>Push</Text>
                  </Pressable>
                )}
                <GestureDetector gesture={resizeGesture}>
                  <View testID={`session-block-${item.id}-resize-handle`} style={styles.resizeHandle} />
                </GestureDetector>
              </View>
            </GestureDetector>
          );
        })}
      </ScrollView>

      <View style={styles.bankPanel}>
        <Pressable
          testID="bank-toggle"
          accessibilityRole="button"
          style={styles.bankHeader}
          onPress={() => setBankExpanded((current) => !current)}>
          <Text style={styles.bankHeaderText}>Unscheduled ({filteredBank.length})</Text>
        </Pressable>
        {bankExpanded && (
          <>
            <TextInput
              testID="bank-search"
              style={styles.bankSearchInput}
              placeholder="Search"
              placeholderTextColor={colors.placeholder}
              value={bankSearch}
              onChangeText={setBankSearch}
            />
            <ScrollView horizontal style={styles.bankList}>
              {filteredBank.map((item) => {
                const bankGesture = Gesture.Pan().onEnd((event) => {
                  runOnJS(commitBankDrop)(item, event.absoluteY);
                });
                return (
                  <GestureDetector key={item.id} gesture={bankGesture}>
                    <View testID={`bank-item-${item.id}`} style={styles.bankItem}>
                      <Text style={styles.bankItemText}>{item.name}</Text>
                    </View>
                  </GestureDetector>
                );
              })}
            </ScrollView>
          </>
        )}
      </View>
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  viewToggleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  toggleButton: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleButtonActive: {
    backgroundColor: colors.primary,
  },
  weekDaySection: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  weekDayLabel: {
    ...typography.label,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  weekItemRow: {
    paddingVertical: spacing.xs,
  },
  weekItemText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  bankPanel: {
    borderTopWidth: 1,
    borderTopColor: colors.glassBorder,
  },
  bankHeader: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  bankHeaderText: {
    ...typography.label,
    color: colors.text,
  },
  bankSearchInput: {
    minHeight: touchTarget,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.glassInner,
    borderWidth: 1,
    borderColor: colors.glassBorderInner,
    color: colors.text,
  },
  bankList: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  bankItem: {
    minHeight: touchTarget,
    minWidth: touchTarget,
    marginRight: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bankItemText: {
    ...typography.label,
    color: colors.text,
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
  calendarControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  calendarMarker: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.green,
  },
  calendarButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.glassInner,
    borderWidth: 1,
    borderColor: colors.glassBorderInner,
  },
  calendarButtonText: {
    ...typography.caption,
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
