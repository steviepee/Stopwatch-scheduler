import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import DateTimePicker from '@react-native-community/datetimepicker';

import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { taskAPI, scheduleAPI } from '@/services/api';
import type { GenerateActivity, GenerateRequest, ScheduleItemCreate, StrategyOption, Task } from '@/types';

const STRATEGIES = ['your-order', 'shortest-first', 'longest-first', 'best-fit'];

function roundUpTo15(date: Date): Date {
  const ms = 15 * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

function defaultDayEnd(base: Date): Date {
  const result = new Date(base);
  result.setHours(23, 0, 0, 0);
  return result;
}

function defaultScheduleName(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ScheduleScreen() {
  const queryClient = useQueryClient();
  const { data: tasks } = useQuery({ queryKey: ['tasks'], queryFn: taskAPI.getAll });
  const { data: regimens } = useQuery({ queryKey: ['regimens'], queryFn: () => scheduleAPI.getAll(true) });

  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [durations, setDurations] = useState<Record<number, string>>({});
  const [startTime, setStartTime] = useState<Date>(() => roundUpTo15(new Date()));
  const [dayEnd, setDayEnd] = useState<Date>(() => defaultDayEnd(roundUpTo15(new Date())));
  const [generateRequest, setGenerateRequest] = useState<GenerateRequest | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);
  const [scheduleName, setScheduleName] = useState(defaultScheduleName);
  const [isRegimen, setIsRegimen] = useState(false);
  const [applyOpenId, setApplyOpenId] = useState<number | null>(null);

  const filteredTasks = useMemo(() => {
    const list = tasks ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return list;
    return list.filter((task) => task.name.toLowerCase().includes(query));
  }, [tasks, search]);

  const generateMutation = useMutation({
    mutationFn: (request: GenerateRequest) => scheduleAPI.generate(request),
  });

  const saveMutation = useMutation({
    mutationFn: async (option: StrategyOption) => {
      const created = await scheduleAPI.create({
        name: scheduleName.trim() || defaultScheduleName(),
        is_regimen: isRegimen,
      });
      for (let i = 0; i < option.timeline.length; i++) {
        const entry = option.timeline[i];
        const item: ScheduleItemCreate = {
          task_id: entry.task_id ?? undefined,
          estimated_duration: Math.round((new Date(entry.end).getTime() - new Date(entry.start).getTime()) / 1000),
          position: i,
          scheduled_time: entry.start,
        };
        await scheduleAPI.addItem(created.id, item);
      }
      return created;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['regimens'] }),
  });

  const applyRegimenMutation = useMutation({
    mutationFn: ({ id, targetDate }: { id: number; targetDate: string }) =>
      scheduleAPI.applyRegimen(id, { target_date: targetDate }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['regimens'] }),
  });

  function toggleActivity(task: Task) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
    setDurations((prev) =>
      prev[task.id] !== undefined ? prev : { ...prev, [task.id]: String(task.average_duration) }
    );
  }

  function buildRequest(): GenerateRequest {
    const activities: GenerateActivity[] = (tasks ?? [])
      .filter((task) => selectedIds.has(task.id))
      .map((task) => ({
        task_id: task.id,
        name: task.name,
        estimated_duration: Number(durations[task.id] ?? task.average_duration),
      }));

    const startIso = startTime.toISOString();
    return {
      start_time: startIso,
      day_start: startIso,
      day_end: dayEnd.toISOString(),
      activities,
      strategies: STRATEGIES,
    };
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Build a schedule</Text>

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
            <TextInput
              testID={`input-duration-${task.id}`}
              style={styles.input}
              keyboardType="numeric"
              value={durations[task.id] ?? String(task.average_duration)}
              onChangeText={(text) => setDurations((prev) => ({ ...prev, [task.id]: text }))}
            />
          )}
        </View>
      ))}

      <View style={styles.row}>
        <Text style={styles.rowLabel}>Start time</Text>
        <DateTimePicker
          testID="picker-start-time"
          value={startTime}
          mode="time"
          onChange={(_event, date) => date && setStartTime(date)}
        />
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Day end</Text>
        <DateTimePicker
          testID="picker-day-end"
          value={dayEnd}
          mode="time"
          onChange={(_event, date) => date && setDayEnd(date)}
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

      {options.map((option) => (
        <View key={option.strategy} testID={`option-card-${option.strategy}`} style={styles.card}>
          <Text style={styles.rowLabel}>{option.label}</Text>
          <Text style={styles.caption}>{option.description}</Text>
          <Pressable
            testID={`btn-select-${option.strategy}`}
            accessibilityRole="button"
            style={styles.button}
            onPress={() => setSelectedStrategy(option.strategy)}
          >
            <Text style={styles.buttonLabel}>Select</Text>
          </Pressable>
        </View>
      ))}

      {selectedOption && (
        <View style={styles.card}>
          <TextInput
            testID="input-schedule-name"
            style={styles.input}
            value={scheduleName}
            onChangeText={setScheduleName}
          />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Save as regimen</Text>
            <Switch testID="checkbox-regimen" value={isRegimen} onValueChange={setIsRegimen} />
          </View>
          <Pressable
            testID="btn-save"
            accessibilityRole="button"
            style={styles.button}
            onPress={() => saveMutation.mutate(selectedOption)}
          >
            <Text style={styles.buttonLabel}>Save</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.heading}>Regimens</Text>
      {(regimens ?? []).map((regimen) => (
        <View key={regimen.id} testID={`regimen-row-${regimen.id}`} style={styles.row}>
          <Text style={styles.rowLabel}>{regimen.name}</Text>
          <Pressable
            testID={`btn-apply-${regimen.id}`}
            accessibilityRole="button"
            style={styles.button}
            onPress={() => setApplyOpenId(regimen.id)}
          >
            <Text style={styles.buttonLabel}>Apply</Text>
          </Pressable>
          {applyOpenId === regimen.id && (
            <DateTimePicker
              testID={`picker-apply-${regimen.id}`}
              value={new Date()}
              mode="date"
              onChange={(_event, date) => {
                if (date) {
                  applyRegimenMutation.mutate({ id: regimen.id, targetDate: date.toISOString() });
                  setApplyOpenId(null);
                }
              }}
            />
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  buttonLabel: {
    ...typography.label,
    color: colors.text,
  },
});
