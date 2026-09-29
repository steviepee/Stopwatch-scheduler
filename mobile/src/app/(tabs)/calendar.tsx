import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { scheduleAPI, taskAPI, calendarImportAPI } from '@/services/api';
import {
  formatDayLong,
  formatDayShort,
  formatHour,
  getWeekDays,
  heightFromDuration,
  isSameDay,
  nextDay,
  positionFromTime,
  previousDay,
  snapToSlot,
  timeFromPosition,
} from '@/utils/calendarUtils';
import type { Schedule, ScheduleItem, Task } from '@/types';

type GoogleEvent = { id?: string; summary: string; start: string; end: string };
type WeekAgendaItem =
  | { type: 'item'; id: number; start: Date; name: string }
  | { type: 'google'; id: string; start: Date; name: string };
type DragPayload = { key: string; name: string; seconds: number };

const START_HOUR = 0;
const END_HOUR = 24;
const HOUR_HEIGHT = 180; // px per hour (3px/min) — keeps a 15-minute block above the 44pt touch target
const INTERVAL_MIN = 60;
const SNAP_MIN = 15;
const RESIZE_SNAP_SECONDS = 300;
const GUTTER = 56; // hour labels sit left of the blocks
const MIN_BLOCK_HEIGHT = 44;
const INITIAL_SCROLL_HOUR = 8;
// Drags start on a long press so a plain swipe still scrolls the grid and the bank.
const DRAG_LONG_PRESS_MS = 300;
// The server seeds an Activity with no history at 10 minutes (D40); the ghost matches it.
const NO_HISTORY_SECONDS = 600;

type DragGhost = {
  ghostY: SharedValue<number>;
  containerTop: SharedValue<number>;
  start: (payload: DragPayload) => void;
  finish: () => void;
};

// Local calendar date, the key a Schedule is filed under (D39).
function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function pxToMinutes(px: number): number {
  return (px / HOUR_HEIGHT) * 60;
}

function shiftDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function blockHeight(seconds: number): number {
  return Math.max(MIN_BLOCK_HEIGHT, heightFromDuration(seconds, HOUR_HEIGHT, INTERVAL_MIN));
}

function itemName(item: ScheduleItem): string {
  return item.task?.name ?? item.custom_name ?? '';
}

function timedItems(schedules: Schedule[] | undefined): ScheduleItem[] {
  return (schedules ?? []).flatMap((schedule) => schedule.items.filter((item) => item.scheduled_time));
}

function isUnauthorized(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 401;
}

type DayAction = { run: () => Promise<string>; failure: string };

export default function CalendarDayScreen() {
  const queryClient = useQueryClient();
  const [day, setDay] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [bankExpanded, setBankExpanded] = useState(true);
  const [bankSearch, setBankSearch] = useState('');
  const [googleAuthError, setGoogleAuthError] = useState(false);
  const [dragItem, setDragItem] = useState<DragPayload | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Gesture absoluteY is window-relative; these convert it to the grid's content space.
  const containerRef = useRef<View>(null);
  const gridRef = useRef<ScrollView>(null);
  const containerTop = useSharedValue(0);
  const gridTop = useRef(0);
  const bankTop = useRef(Infinity);
  const scrollY = useRef(0);
  const ghostY = useSharedValue(0);
  const ghostStyle = useAnimatedStyle(() => ({ top: ghostY.value }));
  const drag: DragGhost = {
    ghostY,
    containerTop,
    start: (payload) => setDragItem(payload),
    finish: () => setDragItem(null),
  };

  const { data: daySchedules } = useQuery({
    queryKey: ['schedules', 'range', dayKey(day), dayKey(day)],
    queryFn: () => scheduleAPI.getRange(dayKey(day), dayKey(day)),
  });

  const { data: tasks } = useQuery({
    queryKey: ['tasks'],
    queryFn: taskAPI.getAll,
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

  const weekStartKey = weekDayKeys[0];
  const weekEndKey = weekDayKeys[weekDayKeys.length - 1];
  const { data: weekSchedules } = useQuery({
    queryKey: ['schedules', 'range', weekStartKey, weekEndKey],
    queryFn: () => scheduleAPI.getRange(weekStartKey, weekEndKey),
    enabled: viewMode === 'week',
  });

  const filteredBank = useMemo(
    () => (tasks ?? []).filter((task) => task.name.toLowerCase().includes(bankSearch.toLowerCase())),
    [tasks, bankSearch]
  );

  const invalidateSchedules = () => queryClient.invalidateQueries({ queryKey: ['schedules'] });

  function onGoogleError(error: unknown) {
    if (isUnauthorized(error)) {
      setGoogleAuthError(true);
    }
  }

  const placeMutation = useMutation({
    mutationFn: ({ date, taskId, scheduledTime }: { date: string; taskId: number; scheduledTime: string }) =>
      scheduleAPI.placeActivity(date, { task_id: taskId, scheduled_time: scheduledTime }),
    onSuccess: invalidateSchedules,
  });

  const moveMutation = useMutation({
    mutationFn: ({ item, scheduledTime }: { item: ScheduleItem; scheduledTime: string }) =>
      scheduleAPI.updateItem(item.schedule_id, item.id, { scheduled_time: scheduledTime }),
    onSuccess: invalidateSchedules,
    onError: onGoogleError,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ item, deleteEvent }: { item: ScheduleItem; deleteEvent: boolean }) =>
      scheduleAPI.deleteItem(item.schedule_id, item.id, deleteEvent),
    onSuccess: invalidateSchedules,
    onError: onGoogleError,
  });

  const resizeMutation = useMutation({
    mutationFn: ({ item, seconds }: { item: ScheduleItem; seconds: number }) =>
      scheduleAPI.updateItem(item.schedule_id, item.id, { estimated_duration: seconds }),
    onSuccess: invalidateSchedules,
    onError: onGoogleError,
  });

  // Push, remove and clear share one status line so none of them fails silently.
  const dayAction = useMutation({
    mutationFn: ({ run }: DayAction) => run(),
    onSettled: invalidateSchedules,
  });

  const dayItems = useMemo(() => timedItems(daySchedules), [daySchedules]);
  const daySchedule = daySchedules?.[0];
  const selectedItem = dayItems.find((item) => item.id === selectedId);

  function changeDay(next: (current: Date) => Date) {
    setDay(next);
    setSelectedId(null);
    setEditingId(null);
    dayAction.reset();
  }

  function toggleSelected(item: ScheduleItem) {
    setSelectedId((current) => (current === item.id ? null : item.id));
    setEditingId(null);
  }

  function pushDay(schedule: Schedule) {
    dayAction.mutate({
      run: async () => {
        const pushed = await scheduleAPI.pushToCalendar(schedule.id);
        const count = pushed.items.filter((item) => item.calendar_event_id).length;
        return `Pushed ${count} event${count === 1 ? '' : 's'} to Google`;
      },
      failure: 'Push failed',
    });
  }

  function removeDay(schedule: Schedule) {
    Alert.alert('Remove day', 'Clear the whole day, or only take it off Google Calendar?', [
      {
        text: 'Clear all',
        style: 'destructive',
        onPress: () =>
          dayAction.mutate({
            run: async () => {
              await scheduleAPI.clearDay(schedule.id, true);
              return 'Day cleared';
            },
            failure: 'Clear failed',
          }),
      },
      {
        text: 'Remove from Google only',
        onPress: () =>
          dayAction.mutate({
            run: async () => {
              await scheduleAPI.removeFromCalendar(schedule.id);
              return 'Removed from Google';
            },
            failure: 'Remove failed',
          }),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function removeItemFromGoogle(item: ScheduleItem) {
    Alert.alert('Remove from Google', `Delete the Google event for "${itemName(item)}"? The block stays.`, [
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          dayAction.mutate({
            run: async () => {
              await scheduleAPI.removeItemFromCalendar(item.schedule_id, item.id);
              return 'Removed from Google';
            },
            failure: 'Remove failed',
          }),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function commitResize(item: ScheduleItem, translationY: number) {
    const raw = item.estimated_duration + pxToMinutes(translationY) * 60;
    const seconds = Math.max(RESIZE_SNAP_SECONDS, Math.round(raw / RESIZE_SNAP_SECONDS) * RESIZE_SNAP_SECONDS);
    resizeMutation.mutate({ item, seconds });
  }

  function isOverBank(absoluteY: number): boolean {
    return absoluteY - containerTop.value >= bankTop.current;
  }

  function removeItem(item: ScheduleItem) {
    if (!item.calendar_event_id) {
      deleteMutation.mutate({ item, deleteEvent: false });
      return;
    }
    Alert.alert('Remove block', `"${itemName(item)}" is on Google Calendar.`, [
      { text: 'Also delete from Google', style: 'destructive', onPress: () => deleteMutation.mutate({ item, deleteEvent: true }) },
      { text: 'Keep on Google', onPress: () => deleteMutation.mutate({ item, deleteEvent: false }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function commitDrag(item: ScheduleItem, translationY: number, absoluteY?: number) {
    if (!item.scheduled_time) return;
    if (absoluteY !== undefined && isOverBank(absoluteY)) {
      removeItem(item);
      return;
    }
    const originalStart = new Date(item.scheduled_time);
    const rawStart = new Date(originalStart.getTime() + pxToMinutes(translationY) * 60 * 1000);
    const snappedStart = snapToSlot(rawStart, SNAP_MIN);
    // A Block stays on its own day (D49).
    if (!isSameDay(snappedStart, originalStart)) return;
    moveMutation.mutate({ item, scheduledTime: snappedStart.toISOString() });
  }

  function commitBankDrop(task: Task, absoluteY: number) {
    if (isOverBank(absoluteY)) return;
    const gridY = absoluteY - containerTop.value - gridTop.current + scrollY.current;
    if (gridY < 0) return;
    const rawStart = timeFromPosition(gridY, day, START_HOUR, HOUR_HEIGHT, INTERVAL_MIN);
    const snappedStart = snapToSlot(rawStart, SNAP_MIN);
    if (!isSameDay(snappedStart, day)) return;
    placeMutation.mutate({ date: dayKey(day), taskId: task.id, scheduledTime: snappedStart.toISOString() });
  }

  function buildWeekAgendaItems(dayDate: Date, googleForDay: GoogleEvent[]): WeekAgendaItem[] {
    const dayScheduleItems: WeekAgendaItem[] = timedItems(weekSchedules)
      .filter((item) => isSameDay(new Date(item.scheduled_time!), dayDate))
      .map((item) => ({ type: 'item', id: item.id, start: new Date(item.scheduled_time!), name: itemName(item) }));
    const dayGoogle: WeekAgendaItem[] = googleForDay.map((e) => ({
      type: 'google',
      id: e.id ?? e.summary,
      start: new Date(e.start),
      name: e.summary,
    }));
    return [...dayScheduleItems, ...dayGoogle].sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  return (
    <View
      ref={containerRef}
      style={styles.container}
      onLayout={() => containerRef.current?.measureInWindow?.((_x, y) => { containerTop.value = y; })}>
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
        <View style={styles.nav}>
          <Pressable
            testID="week-nav-prev"
            accessibilityRole="button"
            style={styles.navButton}
            onPress={() => setDay((current) => shiftDays(current, -7))}>
            <Text style={styles.navLabel}>‹</Text>
          </Pressable>
          <Text testID="week-label" style={styles.dayLabel}>
            {formatDayShort(weekDays[0])} – {formatDayShort(weekDays[weekDays.length - 1])}
          </Text>
          <Pressable
            testID="week-nav-next"
            accessibilityRole="button"
            style={styles.navButton}
            onPress={() => setDay((current) => shiftDays(current, 7))}>
            <Text style={styles.navLabel}>›</Text>
          </Pressable>
        </View>
      )}

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
                    <Text style={styles.weekItemText}>
                      {item.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}  {item.name}
                    </Text>
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
          onPress={() => changeDay(previousDay)}>
          <Text style={styles.navLabel}>‹</Text>
        </Pressable>
        <Text testID="day-label" style={styles.dayLabel}>
          {formatDayLong(day)}
        </Text>
        <Pressable
          testID="day-nav-next"
          accessibilityRole="button"
          style={styles.navButton}
          onPress={() => changeDay(nextDay)}>
          <Text style={styles.navLabel}>›</Text>
        </Pressable>
      </View>

      {daySchedule && dayItems.length > 0 && (
        <View style={styles.actionRow}>
          {dayItems.some((item) => !item.calendar_event_id) && (
            <Pressable
              testID="btn-push-day"
              accessibilityRole="button"
              disabled={dayAction.isPending}
              style={styles.actionButton}
              onPress={() => pushDay(daySchedule)}>
              <Text style={styles.buttonLabel}>Push day</Text>
            </Pressable>
          )}
          <Pressable
            testID="btn-remove-day"
            accessibilityRole="button"
            disabled={dayAction.isPending}
            style={styles.actionButton}
            onPress={() => removeDay(daySchedule)}>
            <Text style={styles.buttonLabel}>Remove day</Text>
          </Pressable>
        </View>
      )}

      {selectedItem && (
        <View style={styles.actionRow}>
          <Pressable
            testID={`btn-edit-block-${selectedItem.id}`}
            accessibilityRole="button"
            style={[styles.actionButton, editingId === selectedItem.id && styles.toggleButtonActive]}
            onPress={() => setEditingId((current) => (current === selectedItem.id ? null : selectedItem.id))}>
            <Text style={styles.buttonLabel}>{editingId === selectedItem.id ? 'Done editing' : 'Edit block'}</Text>
          </Pressable>
          {selectedItem.calendar_event_id && (
            <Pressable
              testID={`btn-remove-google-${selectedItem.id}`}
              accessibilityRole="button"
              disabled={dayAction.isPending}
              style={styles.actionButton}
              onPress={() => removeItemFromGoogle(selectedItem)}>
              <Text style={styles.buttonLabel}>Remove from Google</Text>
            </Pressable>
          )}
        </View>
      )}

      {dayAction.isPending && (
        <Text testID="day-action-working" style={styles.statusText}>Working…</Text>
      )}
      {dayAction.isSuccess && (
        <Text testID="day-action-success" style={styles.statusText}>{dayAction.data}</Text>
      )}
      {dayAction.isError && (
        <Text testID="day-action-error" style={[styles.statusText, styles.statusError]}>
          {isUnauthorized(dayAction.error)
            ? 'Google Calendar needs to be reconnected — authorize from a laptop.'
            : `${dayAction.variables.failure}. Try again.`}
        </Text>
      )}

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
        ref={gridRef}
        style={styles.grid}
        contentContainerStyle={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT, position: 'relative' }}
        scrollEventThrottle={16}
        onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
        onLayout={(e) => {
          gridTop.current = e.nativeEvent.layout.y;
          if (scrollY.current === 0) {
            const y = (INITIAL_SCROLL_HOUR - START_HOUR) * HOUR_HEIGHT;
            gridRef.current?.scrollTo?.({ y, animated: false });
            scrollY.current = y;
          }
        }}>
        {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
          <View key={i} style={[styles.hourRow, { top: i * HOUR_HEIGHT }]}>
            <Text style={styles.hourLabel}>{formatHour(START_HOUR + i)}</Text>
          </View>
        ))}

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

        {dayItems.map((item) => (
          <DayBlock
            key={item.id}
            item={item}
            top={positionFromTime(new Date(item.scheduled_time!), START_HOUR, HOUR_HEIGHT, INTERVAL_MIN)}
            dimmed={dragItem?.key === `item-${item.id}`}
            selected={item.id === selectedId}
            editing={item.id === editingId}
            drag={drag}
            onMove={commitDrag}
            onResize={commitResize}>
            <Pressable accessibilityRole="button" onPress={() => toggleSelected(item)}>
              <Text style={styles.blockText}>{itemName(item)}</Text>
            </Pressable>
          </DayBlock>
        ))}
      </ScrollView>

      <View
        testID="bank-panel"
        style={styles.bankPanel}
        onLayout={(e) => { bankTop.current = e.nativeEvent.layout.y; }}>
        <Pressable
          testID="bank-toggle"
          accessibilityRole="button"
          style={styles.bankHeader}
          onPress={() => setBankExpanded((current) => !current)}>
          <Text style={styles.bankHeaderText}>Activities ({filteredBank.length})</Text>
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
            <Text style={styles.bankHint}>Hold an activity, then drag it onto the day.</Text>
            <ScrollView horizontal style={styles.bankList}>
              {filteredBank.map((task) => (
                <BankChip key={task.id} task={task} drag={drag} onDrop={commitBankDrop} />
              ))}
            </ScrollView>
          </>
        )}
      </View>
      {dragItem && (
        <Animated.View
          pointerEvents="none"
          style={[styles.block, styles.ghost, { height: blockHeight(dragItem.seconds) }, ghostStyle]}>
          <Text style={styles.blockText}>{dragItem.name}</Text>
        </Animated.View>
      )}
      </>
      )}
    </View>
  );
}

function DayBlock({
  item,
  top,
  dimmed,
  selected,
  editing,
  drag,
  onMove,
  onResize,
  children,
}: {
  item: ScheduleItem;
  top: number;
  dimmed: boolean;
  selected: boolean;
  editing: boolean;
  drag: DragGhost;
  onMove: (item: ScheduleItem, translationY: number, absoluteY?: number) => void;
  onResize: (item: ScheduleItem, translationY: number) => void;
  children: ReactNode;
}) {
  const { ghostY, containerTop, start, finish } = drag;
  const active = useSharedValue(false);
  const resizeY = useSharedValue(0);
  const baseHeight = blockHeight(item.estimated_duration);
  const heightStyle = useAnimatedStyle(() => ({ height: Math.max(MIN_BLOCK_HEIGHT, baseHeight + resizeY.value) }));
  const payload: DragPayload = { key: `item-${item.id}`, name: itemName(item), seconds: item.estimated_duration };

  const resizeGesture = Gesture.Pan()
    .onUpdate((event) => {
      resizeY.value = event.translationY;
    })
    .onEnd((event) => {
      runOnJS(onResize)(item, event.translationY);
    })
    .onFinalize(() => {
      resizeY.value = 0;
    });

  // In edit mode the Block resizes only; its move gesture does nothing (D42).
  const dragGesture = Gesture.Pan()
    .activateAfterLongPress(DRAG_LONG_PRESS_MS)
    .onUpdate((event) => {
      if (editing) return;
      ghostY.value = event.absoluteY - containerTop.value - (event.y - event.translationY);
      if (!active.value) {
        active.value = true;
        runOnJS(start)(payload);
      }
    })
    .onEnd((event) => {
      if (editing) return;
      runOnJS(onMove)(item, event.translationY, event.absoluteY);
    })
    .onFinalize(() => {
      if (active.value) {
        active.value = false;
        runOnJS(finish)();
      }
    });

  return (
    <GestureDetector gesture={dragGesture}>
      <Animated.View
        testID={`item-block-${item.id}`}
        style={[styles.block, { top }, heightStyle, selected && styles.selectedBlock, dimmed && styles.dimmed]}>
        {children}
        {editing && (
          <GestureDetector gesture={resizeGesture}>
            <View testID={`item-block-${item.id}-resize-handle`} style={styles.resizeHandle}>
              <View style={styles.resizeGrip} />
            </View>
          </GestureDetector>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

function BankChip({
  task,
  drag,
  onDrop,
}: {
  task: Task;
  drag: DragGhost;
  onDrop: (task: Task, absoluteY: number) => void;
}) {
  const { ghostY, containerTop, start, finish } = drag;
  const active = useSharedValue(false);
  const noHistory = !task.total_recordings;
  const payload: DragPayload = {
    key: `task-${task.id}`,
    name: task.name,
    seconds: noHistory ? NO_HISTORY_SECONDS : task.average_duration,
  };

  const gesture = Gesture.Pan()
    .activateAfterLongPress(DRAG_LONG_PRESS_MS)
    .onUpdate((event) => {
      ghostY.value = event.absoluteY - containerTop.value;
      if (!active.value) {
        active.value = true;
        runOnJS(start)(payload);
      }
    })
    .onEnd((event) => {
      runOnJS(onDrop)(task, event.absoluteY);
    })
    .onFinalize(() => {
      if (active.value) {
        active.value = false;
        runOnJS(finish)();
      }
    });

  return (
    <GestureDetector gesture={gesture}>
      <View testID={`bank-item-${task.id}`} style={styles.bankItem}>
        <Text style={styles.bankItemText}>{task.name}</Text>
        {noHistory && (
          <Text testID={`bank-item-${task.id}-no-history`} style={styles.noHistoryText}>
            no history
          </Text>
        )}
      </View>
    </GestureDetector>
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
  hourRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: colors.glassBorderInner,
  },
  hourLabel: {
    ...typography.caption,
    color: colors.textMuted,
    width: GUTTER,
    paddingLeft: spacing.xs,
  },
  ghost: {
    left: GUTTER,
    borderColor: colors.primary,
    opacity: 0.9,
  },
  dimmed: {
    opacity: 0.4,
  },

  bankHint: {
    ...typography.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
  },
  block: {
    position: 'absolute',
    left: GUTTER,
    right: spacing.lg,
    borderRadius: radii.sm,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: spacing.xs,
  },
  blockText: {
    ...typography.label,
    color: colors.text,
  },
  noHistoryText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  selectedBlock: {
    borderColor: colors.primary,
  },
  resizeHandle: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: touchTarget,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: spacing.xs,
  },
  resizeGrip: {
    width: 40,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  actionButton: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    ...typography.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  statusError: {
    color: colors.red,
  },

});
