import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import DateTimePicker from '@react-native-community/datetimepicker';
import { GlassView } from 'expo-glass-effect';

import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { PickerField } from '@/components/PickerField';
import { calendarImportAPI, taskAPI, scheduleAPI } from '@/services/api';
import { useUserOptions, type UserOptions } from '@/services/options';
import { formatElapsed } from '@/timer/format';
import type { GenerateActivity, GenerateEvent, GenerateRequest, Schedule, ScheduleCreate, StrategyOption, Task } from '@/types';

const STRATEGIES = ['your-order', 'shortest-first', 'longest-first', 'best-fit'];

// Rounds up, matching what an untouched row schedules: a cushion, and it
// keeps the block on a minute boundary.
const toMinutes = (seconds: number) => String(Math.ceil(seconds / 60));

// D40: an Activity with no history plans at 10 minutes.
const defaultMinutes = (task: Task) =>
  task.average_duration > 0 && task.total_recordings > 0 ? toMinutes(task.average_duration) : '10';

function statText(value: number | null): string {
  return value === null ? '—' : formatElapsed(value * 1000);
}

function DurationHints({ task, options }: { task: Task; options: UserOptions }) {
  const needsStats = options.showMedian || options.showPrevious;
  const { data: stats } = useQuery({
    queryKey: ['task-stats', task.id],
    queryFn: () => taskAPI.getStats(task.id),
    enabled: needsStats,
  });

  return (
    <>
      {options.showAverage && (
        <Text testID={`hint-average-${task.id}`} style={styles.caption}>
          {formatElapsed(task.average_duration * 1000)}
        </Text>
      )}
      {options.showMedian && stats && (
        <Text testID={`hint-median-${task.id}`} style={styles.caption}>
          {statText(stats.median)}
        </Text>
      )}
      {options.showPrevious && stats && (
        <Text testID={`hint-previous-${task.id}`} style={styles.caption}>
          {statText(stats.previous)}
        </Text>
      )}
    </>
  );
}

function roundUpTo15(date: Date): Date {
  const ms = 15 * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

function defaultDayEnd(base: Date): Date {
  const result = new Date(base);
  result.setHours(23, 0, 0, 0);
  return result;
}

function onDate(time: Date, date: Date): Date {
  const result = new Date(time);
  result.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  return result;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function fetchExistingEvents(
  date: string,
  onGoogleError: (error: unknown) => void,
): Promise<GenerateEvent[]> {
  const [schedules, googleEvents] = await Promise.all([
    scheduleAPI.getRange(date, date),
    calendarImportAPI.getEvents(date).catch((error) => {
      onGoogleError(error);
      return [];
    }),
  ]);
  const items = schedules.flatMap((schedule) => schedule.items).filter((item) => item.scheduled_time);
  return [
    ...items.map((item) => {
      const start = new Date(item.scheduled_time!);
      return {
        name: item.task?.name ?? item.custom_name ?? '',
        start: start.toISOString(),
        end: new Date(start.getTime() + item.estimated_duration * 1000).toISOString(),
      };
    }),
    ...googleEvents.map((event) => ({ name: event.summary, start: event.start, end: event.end })),
  ];
}

export default function ScheduleScreen() {
  const queryClient = useQueryClient();
  const userOptions = useUserOptions();
  const { data: tasks } = useQuery({ queryKey: ['tasks'], queryFn: taskAPI.getAll });
  const { data: regimens } = useQuery({ queryKey: ['regimens'], queryFn: () => scheduleAPI.getAll(true) });

  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [durations, setDurations] = useState<Record<number, string>>({});
  const [startTime, setStartTime] = useState<Date>(() => roundUpTo15(new Date()));
  const [dayEnd, setDayEnd] = useState<Date>(() => defaultDayEnd(roundUpTo15(new Date())));
  const [generateRequest, setGenerateRequest] = useState<GenerateRequest | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);
  const [scheduleName, setScheduleName] = useState('');
  const [isRegimen, setIsRegimen] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [applyOpenId, setApplyOpenId] = useState<number | null>(null);
  const [pushedById, setPushedById] = useState<Record<number, Schedule>>({});
  const [googleAuthError, setGoogleAuthError] = useState(false);
  const [googleEventsSkipped, setGoogleEventsSkipped] = useState<'unauthorized' | 'unavailable' | null>(null);

  const filteredTasks = useMemo(() => {
    const list = tasks ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return list;
    return list.filter((task) => task.name.toLowerCase().includes(query));
  }, [tasks, search]);

  const generateMutation = useMutation({
    mutationFn: async (request: GenerateRequest) => {
      setGoogleEventsSkipped(null);
      const existingEvents = await fetchExistingEvents(localDateKey(new Date(request.start_time)), (error) =>
        setGoogleEventsSkipped(
          (error as { response?: { status?: number } })?.response?.status === 401 ? 'unauthorized' : 'unavailable',
        ),
      );
      return scheduleAPI.generate({ ...request, existing_events: existingEvents });
    },
  });

  const saveMutation = useMutation({
    mutationFn: (option: StrategyOption) => {
      const items = option.timeline.map((entry, i) => ({
        task_id: entry.task_id ?? undefined,
        estimated_duration: Math.round((new Date(entry.end).getTime() - new Date(entry.start).getTime()) / 1000),
        position: i,
        scheduled_time: entry.start,
      }));
      const body: ScheduleCreate = isRegimen
        ? { name: scheduleName.trim(), is_regimen: true, items }
        : { target_date: localDateKey(startTime), is_regimen: false, items };
      return scheduleAPI.create(body);
    },
    onSuccess: (_data, option) => {
      setSavedKey(saveKey(option.strategy));
      queryClient.invalidateQueries({ queryKey: ['regimens'] });
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });

  // Save stays disabled for exactly what was just saved, so a second tap cannot duplicate it.
  function saveKey(strategy: string): string {
    return JSON.stringify([generateRequest, strategy, scheduleName, isRegimen]);
  }

  const applyRegimenMutation = useMutation({
    mutationFn: ({ id, targetDate }: { id: number; targetDate: string }) =>
      scheduleAPI.applyRegimen(id, { target_date: targetDate, tz_offset: new Date().getTimezoneOffset() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regimens'] });
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });

  function onCalendarPushError(error: unknown) {
    if ((error as { response?: { status?: number } })?.response?.status === 401) {
      setGoogleAuthError(true);
    }
  }

  const pushToCalendarMutation = useMutation({
    mutationFn: (id: number) => scheduleAPI.pushToCalendar(id),
    onSuccess: (data) => {
      setPushedById((prev) => ({ ...prev, [data.id]: data }));
      queryClient.invalidateQueries({ queryKey: ['regimens'] });
    },
    onError: onCalendarPushError,
  });

  const removeScheduleCalendarMutation = useMutation({
    mutationFn: (id: number) => scheduleAPI.removeFromCalendar(id),
    onSuccess: (_data, id) => {
      setPushedById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['regimens'] });
    },
    onError: onCalendarPushError,
  });

  // One status line for both calendar actions: starting one clears the other's outcome.
  function pushSchedule(id: number) {
    removeScheduleCalendarMutation.reset();
    pushToCalendarMutation.mutate(id);
  }

  function removeScheduleCalendar(id: number) {
    pushToCalendarMutation.reset();
    removeScheduleCalendarMutation.mutate(id);
  }

  const calendarActionPending = pushToCalendarMutation.isPending || removeScheduleCalendarMutation.isPending;
  const calendarActionSuccess = pushToCalendarMutation.isSuccess
    ? `Pushed ${pushToCalendarMutation.data.items.filter((item) => item.calendar_event_id).length} events to Google`
    : removeScheduleCalendarMutation.isSuccess
      ? 'Removed from Google'
      : null;
  const calendarActionError = pushToCalendarMutation.isError
    ? "Couldn't push to Google. Try again."
    : removeScheduleCalendarMutation.isError
      ? "Couldn't remove from Google. Try again."
      : null;

  function toggleActivity(task: Task) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  }

  function buildRequest(): GenerateRequest {
    const activities: GenerateActivity[] = (tasks ?? [])
      .filter((task) => selectedIds.has(task.id))
      .map((task) => ({
        task_id: task.id,
        name: task.name,
        estimated_duration:
          durations[task.id] !== undefined
            ? Number(durations[task.id]) * 60
            : Number(defaultMinutes(task)) * 60,
      }));

    const startIso = startTime.toISOString();
    return {
      start_time: startIso,
      day_start: startIso,
      day_end: dayEnd.toISOString(),
      activities,
      strategies: STRATEGIES,
      avoid_existing: true,
    };
  }

  function handleDateChange(date: Date) {
    setStartTime((prev) => onDate(prev, date));
    setDayEnd((prev) => onDate(prev, date));
  }

  function handleGenerate() {
    const request = buildRequest();
    setGenerateRequest(request);
    setSelectedStrategy(null);
    generateMutation.mutate(request);
  }

  function handleRetry() {
    if (generateRequest) generateMutation.mutate(generateRequest);
  }

  const options = generateMutation.data?.options ?? [];
  const selectedOption = options.find((option) => option.strategy === selectedStrategy) ?? null;
  const savedSchedule = saveMutation.data;
  const isSaved = !!selectedOption && savedKey === saveKey(selectedOption.strategy);
  const nameMissing = isRegimen && !scheduleName.trim();
  const saveDisabled = saveMutation.isPending || isSaved || nameMissing;
  const savedSchedulePush = savedSchedule ? pushedById[savedSchedule.id] : undefined;
  const isSavedSchedulePushed = !!savedSchedulePush?.items.some((item) => item.calendar_event_id);
  const savedScheduleEventsPushed = savedSchedulePush?.items.filter((item) => item.calendar_event_id).length ?? 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Build a schedule</Text>

      {googleAuthError && (
        <GlassView glassEffectStyle="regular" style={styles.card}>
          <Text testID="google-auth-error" style={styles.caption}>
            Google Calendar needs to be reconnected — authorize from a laptop.
          </Text>
        </GlassView>
      )}

      <TextInput
        testID="input-activity-search"
        style={styles.input}
        placeholder="Search activities"
        placeholderTextColor={colors.placeholder}
        value={search}
        onChangeText={setSearch}
      />

      {filteredTasks.map((task) => (
        <View key={task.id} style={styles.activityBlock}>
          <Pressable
            testID={`activity-row-${task.id}`}
            accessibilityRole="button"
            style={[styles.row, selectedIds.has(task.id) && styles.rowSelected]}
            onPress={() => toggleActivity(task)}
          >
            <Text style={styles.rowLabel}>{task.name}</Text>
          </Pressable>
          {selectedIds.has(task.id) && (
            <>
              <Text style={styles.caption}>Minutes</Text>
              <TextInput
                testID={`input-duration-${task.id}`}
                style={styles.input}
                keyboardType="numeric"
                value={durations[task.id] ?? defaultMinutes(task)}
                onChangeText={(text) => setDurations((prev) => ({ ...prev, [task.id]: text }))}
              />
              <DurationHints task={task} options={userOptions} />
            </>
          )}
        </View>
      ))}

      <View style={styles.row}>
        <Text style={styles.rowLabel}>Date</Text>
        <PickerField
          testID="picker-date"
          label={startTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
          value={startTime}
          mode="date"
          onChange={handleDateChange}
        />
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Start time</Text>
        <PickerField
          testID="picker-start-time"
          label={formatTime(startTime)}
          value={startTime}
          mode="time"
          onChange={setStartTime}
        />
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Day end</Text>
        <PickerField
          testID="picker-day-end"
          label={formatTime(dayEnd)}
          value={dayEnd}
          mode="time"
          onChange={setDayEnd}
        />
      </View>

      <Pressable testID="btn-generate" accessibilityRole="button" style={styles.button} onPress={handleGenerate}>
        <Text style={styles.buttonLabel}>Generate</Text>
      </Pressable>

      {generateMutation.isError && (
        <Pressable
          testID="btn-retry-generate"
          accessibilityRole="button"
          style={styles.button}
          onPress={handleRetry}
        >
          <Text style={styles.buttonLabel}>Retry</Text>
        </Pressable>
      )}

      {googleEventsSkipped && (
        <Text testID="google-events-skipped" style={styles.caption}>
          {googleEventsSkipped === 'unauthorized'
            ? 'Planned without Google events — authorize from a laptop to include them.'
            : 'Planned without Google events.'}
        </Text>
      )}

      {options.map((option) => (
        <GlassView
          key={option.strategy}
          glassEffectStyle="regular"
          testID={`option-card-${option.strategy}`}
          style={[styles.card, option.strategy === selectedStrategy && styles.rowSelected]}>
          <Text style={styles.rowLabel}>{option.label}</Text>
          <Text style={styles.caption}>{option.description}</Text>
          {option.strategy === selectedStrategy && option.excluded.length > 0 && (
            <Text style={styles.caption}>
              Didn't fit: {option.excluded.map((entry) => entry.name).join(', ')}
            </Text>
          )}
          <Pressable
            testID={`btn-select-${option.strategy}`}
            accessibilityRole="button"
            style={styles.button}
            onPress={() => setSelectedStrategy(option.strategy)}
          >
            <Text style={styles.buttonLabel}>{option.strategy === selectedStrategy ? 'Selected' : 'Select'}</Text>
          </Pressable>
        </GlassView>
      ))}

      {selectedOption && (
        <GlassView glassEffectStyle="regular" style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Save as regimen</Text>
            <Switch testID="checkbox-regimen" value={isRegimen} onValueChange={setIsRegimen} />
          </View>
          {isRegimen && (
            <TextInput
              testID="input-schedule-name"
              style={styles.input}
              placeholder="Regimen name"
              placeholderTextColor={colors.placeholder}
              value={scheduleName}
              onChangeText={setScheduleName}
            />
          )}
          <Pressable
            testID="btn-save"
            accessibilityRole="button"
            style={[styles.button, saveDisabled && styles.buttonDisabled]}
            disabled={saveDisabled}
            onPress={() => saveMutation.mutate(selectedOption)}
          >
            <Text style={styles.buttonLabel}>
              {saveMutation.isPending ? 'Saving…' : isSaved ? 'Saved' : 'Save'}
            </Text>
          </Pressable>
          {saveMutation.isError && (
            <Text testID="save-error" style={styles.caption}>
              Couldn't save. Check the connection and try again.
            </Text>
          )}
        </GlassView>
      )}

      {savedSchedule && (
        <GlassView glassEffectStyle="regular" style={styles.card}>
          <Text style={styles.rowLabel}>{savedSchedule.name ?? savedSchedule.target_date}</Text>
          {isSavedSchedulePushed ? (
            <>
              <Text testID="text-events-pushed" style={styles.caption}>
                {savedScheduleEventsPushed}
              </Text>
              <Pressable
                testID="btn-remove-schedule-calendar"
                accessibilityRole="button"
                style={styles.button}
                onPress={() => removeScheduleCalendar(savedSchedule.id)}
              >
                <Text style={styles.buttonLabel}>Remove from Calendar</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              testID="btn-push-schedule"
              accessibilityRole="button"
              style={styles.button}
              onPress={() => pushSchedule(savedSchedule.id)}
            >
              <Text style={styles.buttonLabel}>Push to Calendar</Text>
            </Pressable>
          )}
        </GlassView>
      )}

      {calendarActionPending && (
        <Text testID="schedule-action-working" style={styles.caption}>Working…</Text>
      )}
      {calendarActionSuccess && (
        <Text testID="schedule-action-success" style={styles.caption}>{calendarActionSuccess}</Text>
      )}
      {calendarActionError && (
        <Text testID="schedule-action-error" style={styles.caption}>{calendarActionError}</Text>
      )}

      <Text style={styles.heading}>Regimens</Text>
      {applyRegimenMutation.isSuccess && (
        <Text testID="apply-success" style={styles.caption}>
          Applied to {applyRegimenMutation.data.target_date}
        </Text>
      )}
      {applyRegimenMutation.isError && (
        <Text testID="apply-error" style={styles.caption}>
          Couldn't apply. Check the connection and try again.
        </Text>
      )}
      {(regimens ?? []).map((regimen) => {
        const regimenPush = pushedById[regimen.id];
        const regimenItems = regimenPush?.items ?? regimen.items;
        const isRegimenPushed = regimenItems.some((item) => item.calendar_event_id);
        return (
        <GlassView key={regimen.id} glassEffectStyle="regular" testID={`regimen-row-${regimen.id}`} style={styles.row}>
          <Text style={styles.rowLabel}>{regimen.name}</Text>
          <Pressable
            testID={`btn-apply-${regimen.id}`}
            accessibilityRole="button"
            style={styles.button}
            onPress={() => setApplyOpenId(regimen.id)}
          >
            <Text style={styles.buttonLabel}>Apply</Text>
          </Pressable>
          {isRegimenPushed ? (
            <Pressable
              testID={`btn-remove-calendar-${regimen.id}`}
              accessibilityRole="button"
              style={styles.button}
              onPress={() => removeScheduleCalendar(regimen.id)}
            >
              <Text style={styles.buttonLabel}>Remove</Text>
            </Pressable>
          ) : (
            <Pressable
              testID={`btn-push-${regimen.id}`}
              accessibilityRole="button"
              style={styles.button}
              onPress={() => pushSchedule(regimen.id)}
            >
              <Text style={styles.buttonLabel}>Push</Text>
            </Pressable>
          )}
          {applyOpenId === regimen.id && (
            <DateTimePicker
              testID={`picker-apply-${regimen.id}`}
              value={new Date()}
              mode="date"
              onChange={(event, date) => {
                setApplyOpenId(null);
                if (event.type === 'set' && date) {
                  applyRegimenMutation.mutate({ id: regimen.id, targetDate: localDateKey(date) });
                }
              }}
            />
          )}
        </GlassView>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  heading: {
    ...typography.heading,
    color: colors.text,
  },
  input: {
    minHeight: touchTarget,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md,
    color: colors.text,
  },
  activityBlock: {
    gap: spacing.xs,
  },
  row: {
    minHeight: touchTarget,
    borderRadius: radii.md,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowSelected: {
    borderColor: colors.primary,
  },
  rowLabel: {
    ...typography.body,
    color: colors.text,
  },
  card: {
    borderRadius: radii.md,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: spacing.md,
    gap: spacing.sm,
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
  },
  button: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    ...typography.label,
    color: colors.text,
  },
});
