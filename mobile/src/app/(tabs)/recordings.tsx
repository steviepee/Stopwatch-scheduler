import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { GlassView } from 'expo-glass-effect';

import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { sessionAPI, taskAPI } from '@/services/api';
import { CREATE_SESSION_KEY } from '@/services/queryClient';
import { PickerField } from '@/components/PickerField';
import { formatElapsed } from '@/timer/format';
import type { StopwatchSession, StopwatchSessionCreate, StopwatchSessionUpdate, Task } from '@/types';

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

function ActivityPicker({
  tasks,
  currentTaskId,
  onSelect,
}: {
  tasks: Task[];
  currentTaskId?: number;
  onSelect: (task: Task) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return tasks;
    return tasks.filter((task) => task.name.toLowerCase().includes(query));
  }, [tasks, search]);

  return (
    <>
      <TextInput
        testID="action-picker-search"
        style={styles.input}
        placeholder="Search activities"
        placeholderTextColor={colors.placeholder}
        value={search}
        onChangeText={setSearch}
      />
      <ScrollView style={styles.activityList}>
        {filtered.map((task) => (
          <Pressable
            key={task.id}
            testID={`action-picker-${task.id}`}
            accessibilityRole="button"
            style={styles.activityRow}
            onPress={() => onSelect(task)}>
            <Text style={styles.rowName}>
              {task.id === currentTaskId ? `${task.name} (current)` : task.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}

function ManualForm({ tasks, onClose }: { tasks: Task[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [openedAt] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  const [name, setName] = useState('');
  const [searchText, setSearchText] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | undefined>(undefined);
  const [selectedNewActivity, setSelectedNewActivity] = useState(false);
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [editedStart, setEditedStart] = useState<Date | null>(null);

  const durationSeconds = (parseInt(hours, 10) || 0) * 3600 + (parseInt(minutes, 10) || 0) * 60;
  const start = editedStart ?? new Date(openedAt - durationSeconds * 1000);

  const trimmedName = name.trim();
  const matchedTask = useMemo(() => {
    if (!trimmedName) return undefined;
    return tasks.find((task) => task.name.toLowerCase() === trimmedName.toLowerCase());
  }, [tasks, trimmedName]);

  const filteredTasks = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return tasks;
    return tasks.filter((task) => task.name.toLowerCase().includes(query));
  }, [tasks, searchText]);

  const selectTask = (task: Task | undefined) => {
    setSelectedTask(task);
    setSelectedNewActivity(false);
  };

  const selectNewActivity = () => {
    setSelectedTask(undefined);
    setSelectedNewActivity(true);
  };

  const save = useMutation({
    mutationFn: (body: StopwatchSessionCreate) => sessionAPI.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
  });

  const handleSave = () => {
    save.mutate({
      name: trimmedName || selectedTask?.name || 'Recording',
      duration: durationSeconds,
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + durationSeconds * 1000).toISOString(),
      ...(selectedNewActivity
        ? { new_activity_name: trimmedName }
        : selectedTask
          ? { task_id: selectedTask.id }
          : {}),
    });
  };

  const pickDate = (date: Date) => {
    const next = new Date(start);
    next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
    setEditedStart(next);
  };

  const pickTime = (date: Date) => {
    const next = new Date(start);
    next.setHours(date.getHours(), date.getMinutes(), 0, 0);
    setEditedStart(next);
  };

  const canSave = durationSeconds > 0 && !save.isPending;

  return (
    <ScrollView testID="manual-form" style={styles.sheet} contentContainerStyle={styles.sheetContent}>
      <Text style={styles.sheetTitle}>Add Recording</Text>
      <TextInput
        testID="manual-name"
        style={styles.input}
        placeholder="Name"
        placeholderTextColor={colors.placeholder}
        value={name}
        onChangeText={setName}
      />
      <TextInput
        testID="manual-activity-search"
        style={styles.input}
        placeholder="Search activities"
        placeholderTextColor={colors.placeholder}
        value={searchText}
        onChangeText={setSearchText}
      />
      <Pressable
        testID="manual-activity-none"
        accessibilityRole="button"
        style={[styles.activityRow, !selectedTask && !selectedNewActivity && styles.activityRowSelected]}
        onPress={() => selectTask(undefined)}>
        <Text style={styles.rowName}>None</Text>
      </Pressable>
      {filteredTasks.map((task) => (
        <Pressable
          key={task.id}
          testID={`manual-activity-${task.id}`}
          accessibilityRole="button"
          style={[styles.activityRow, selectedTask?.id === task.id && styles.activityRowSelected]}
          onPress={() => selectTask(task)}>
          <Text style={styles.rowName}>
            {task === matchedTask ? `Attach to ${task.name}` : task.name}
          </Text>
        </Pressable>
      ))}
      {trimmedName && !matchedTask && (
        <Pressable
          testID="manual-activity-new"
          accessibilityRole="button"
          style={[styles.activityRow, selectedNewActivity && styles.activityRowSelected]}
          onPress={selectNewActivity}>
          <Text style={styles.rowName}>{`+ New Activity: '${trimmedName}'`}</Text>
        </Pressable>
      )}

      <View style={styles.dateRange}>
        <View style={styles.dateField}>
          <Text style={styles.dateLabel}>Hours</Text>
          <TextInput
            testID="manual-hours"
            style={styles.input}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={colors.placeholder}
            value={hours}
            onChangeText={setHours}
          />
        </View>
        <View style={styles.dateField}>
          <Text style={styles.dateLabel}>Minutes</Text>
          <TextInput
            testID="manual-minutes"
            style={styles.input}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={colors.placeholder}
            value={minutes}
            onChangeText={setMinutes}
          />
        </View>
      </View>

      <View style={styles.dateRange}>
        <View style={styles.dateField}>
          <Text style={styles.dateLabel}>Start date</Text>
          <PickerField
            testID="manual-start-date"
            label={start.toLocaleDateString()}
            value={start}
            mode="date"
            onChange={pickDate}
          />
        </View>
        <View style={styles.dateField}>
          <Text style={styles.dateLabel}>Start time</Text>
          <PickerField
            testID="manual-start-time"
            label={start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            value={start}
            mode="time"
            onChange={pickTime}
          />
        </View>
      </View>

      {save.isError && (
        <Text testID="manual-save-error" style={styles.errorText}>
          Could not save. Check the connection and try again.
        </Text>
      )}

      <View style={styles.sheetActions}>
        <Pressable testID="btn-manual-cancel" accessibilityRole="button" style={[styles.button, styles.buttonMuted]} onPress={onClose}>
          <Text style={styles.buttonLabel}>Cancel</Text>
        </Pressable>
        <Pressable
          testID="btn-manual-save"
          accessibilityRole="button"
          disabled={!canSave}
          style={[styles.button, !canSave && styles.buttonDisabled]}
          onPress={handleSave}>
          <Text style={styles.buttonLabel}>{save.isPending ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

export default function RecordingsScreen() {
  const queryClient = useQueryClient();
  const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: () => sessionAPI.getAll() });
  const { data: tasks } = useQuery({ queryKey: ['tasks'], queryFn: taskAPI.getAll });

  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<StopwatchSession | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const deleteSession = useMutation({
    mutationFn: (id: number) => sessionAPI.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const updateSession = useMutation({
    mutationFn: ({ id, body }: { id: number; body: StopwatchSessionUpdate }) => sessionAPI.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setActionsFor(null);
      setPickerOpen(false);
    },
  });

  const actionsMatchedTask = useMemo(() => {
    if (!actionsFor) return undefined;
    const trimmed = actionsFor.name.trim().toLowerCase();
    return (tasks ?? []).find((task) => task.name.toLowerCase() === trimmed);
  }, [tasks, actionsFor]);

  const closeActions = () => {
    setActionsFor(null);
    setPickerOpen(false);
  };

  const handlePickTask = (task: Task) => {
    if (!actionsFor) return;
    updateSession.mutate({ id: actionsFor.id, body: { task_id: task.id } });
  };

  const handleMakeActivity = () => {
    if (!actionsFor) return;
    if (actionsMatchedTask) {
      updateSession.mutate({ id: actionsFor.id, body: { task_id: actionsMatchedTask.id } });
    } else {
      updateSession.mutate({ id: actionsFor.id, body: { new_activity_name: actionsFor.name.trim() } });
    }
  };

  const handleDetach = () => {
    if (!actionsFor) return;
    updateSession.mutate({ id: actionsFor.id, body: { task_id: null } });
  };

  const pendingSessions = useMutationState({
    filters: { mutationKey: CREATE_SESSION_KEY },
    select: (mutation) => ({
      mutationId: mutation.mutationId,
      isPaused: mutation.state.isPaused,
      body: mutation.state.variables as StopwatchSessionCreate,
    }),
  }).filter((m) => m.isPaused);

  const taskNames = useMemo(() => {
    const map = new Map<number, string>();
    (tasks ?? []).forEach((task) => map.set(task.id, task.name));
    return map;
  }, [tasks]);

  const visibleSessions = useMemo(() => {
    const fromDay = dateFrom ? dayOf(dateFrom.toISOString()) : null;
    const toDay = dateTo ? dayOf(dateTo.toISOString()) : null;
    const query = search.trim().toLowerCase();

    return (sessions ?? [])
      .filter((session) => {
        const day = dayOf(session.created_at);
        if (fromDay && day < fromDay) return false;
        if (toDay && day > toDay) return false;
        if (query && !session.name.toLowerCase().includes(query)) return false;
        return true;
      })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [sessions, dateFrom, dateTo, search]);

  if (manualOpen) {
    return <ManualForm tasks={tasks ?? []} onClose={() => setManualOpen(false)} />;
  }

  return (
    <View style={styles.container}>
      <Pressable
        testID="btn-add-manual"
        accessibilityRole="button"
        style={styles.button}
        onPress={() => setManualOpen(true)}>
        <Text style={styles.buttonLabel}>Add manually</Text>
      </Pressable>

      <TextInput
        testID="input-search"
        style={styles.input}
        placeholder="Search recordings"
        placeholderTextColor={colors.placeholder}
        value={search}
        onChangeText={setSearch}
      />

      <View style={styles.dateRange}>
        <View style={styles.dateField}>
          <Text style={styles.dateLabel}>From {dateFrom ? dayOf(dateFrom.toISOString()) : '—'}</Text>
          <PickerField
            testID="picker-date-from"
            label={dateFrom ? 'Change' : 'Pick date'}
            value={dateFrom ?? new Date()}
            mode="date"
            onChange={setDateFrom}
          />
        </View>
        <View style={styles.dateField}>
          <Text style={styles.dateLabel}>To {dateTo ? dayOf(dateTo.toISOString()) : '—'}</Text>
          <PickerField
            testID="picker-date-to"
            label={dateTo ? 'Change' : 'Pick date'}
            value={dateTo ?? new Date()}
            mode="date"
            onChange={setDateTo}
          />
        </View>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {pendingSessions.map((mutation) => (
          <GlassView
            key={`pending-${mutation.mutationId}`}
            glassEffectStyle="regular"
            testID={`session-pending-${mutation.mutationId}`}
            style={styles.row}>
            <Text style={styles.rowName}>{mutation.body.name}</Text>
            <Text style={styles.rowMetaText}>Pending</Text>
          </GlassView>
        ))}

        {visibleSessions.map((session) => (
          <Pressable
            key={session.id}
            testID={`session-row-${session.id}`}
            accessibilityRole="button"
            style={styles.row}
            onPress={() => setActionsFor(session)}
            onLongPress={() => deleteSession.mutate(session.id)}>
            <View>
              <Text testID={`session-name-${session.id}`} style={styles.rowName}>
                {session.name}
              </Text>
              <Text testID={`session-date-${session.id}`} style={styles.rowMetaText}>
                {dayOf(session.created_at)}
              </Text>
            </View>
            <View style={styles.rowMeta}>
              <Text testID={`session-duration-${session.id}`} style={styles.rowMetaText}>
                {formatElapsed(session.duration * 1000)}
              </Text>
              <Text testID={`session-activity-${session.id}`} style={styles.rowMetaText}>
                {session.task_id ? (taskNames.get(session.task_id) ?? '—') : '—'}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {actionsFor && (
        <View style={styles.overlay}>
          <ScrollView testID="session-actions" style={styles.sheet} contentContainerStyle={styles.sheetContent}>
            <Text style={styles.sheetTitle}>{actionsFor.name}</Text>

            {pickerOpen ? (
              <ActivityPicker tasks={tasks ?? []} currentTaskId={actionsFor.task_id} onSelect={handlePickTask} />
            ) : actionsFor.task_id ? (
              <>
                <Pressable
                  testID="action-change"
                  accessibilityRole="button"
                  style={styles.activityRow}
                  onPress={() => setPickerOpen(true)}>
                  <Text style={styles.rowName}>Change Activity</Text>
                </Pressable>
                <Pressable
                  testID="action-detach"
                  accessibilityRole="button"
                  style={styles.activityRow}
                  onPress={handleDetach}>
                  <Text style={styles.rowName}>Detach</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  testID="action-attach"
                  accessibilityRole="button"
                  style={styles.activityRow}
                  onPress={() => setPickerOpen(true)}>
                  <Text style={styles.rowName}>Attach to Activity</Text>
                </Pressable>
                <Pressable
                  testID="action-make-activity"
                  accessibilityRole="button"
                  style={styles.activityRow}
                  onPress={handleMakeActivity}>
                  <Text style={styles.rowName}>
                    {actionsMatchedTask ? `Attach to ${actionsMatchedTask.name}` : 'Make it an Activity'}
                  </Text>
                </Pressable>
              </>
            )}

            {updateSession.isError && (
              <Text testID="action-error" style={styles.errorText}>
                Could not save. Check the connection and try again.
              </Text>
            )}

            <View style={styles.sheetActions}>
              <Pressable
                testID="btn-actions-cancel"
                accessibilityRole="button"
                style={[styles.button, styles.buttonMuted]}
                onPress={closeActions}>
                <Text style={styles.buttonLabel}>Cancel</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    padding: spacing.lg,
    gap: spacing.md,
  },
  input: {
    minHeight: touchTarget,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md,
    color: colors.text,
  },
  dateRange: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  dateField: {
    flex: 1,
    gap: spacing.xs,
  },
  dateLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: spacing.sm,
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
    marginBottom: spacing.sm,
  },
  rowName: {
    ...typography.body,
    color: colors.text,
  },
  rowMeta: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowMetaText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  button: {
    minHeight: touchTarget,
    minWidth: touchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonMuted: {
    backgroundColor: colors.glass,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    ...typography.label,
    color: colors.text,
  },
  sheet: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  sheetContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
  },
  activityList: {
    flexGrow: 0,
  },
  sheetTitle: {
    ...typography.heading,
    color: colors.text,
  },
  activityRow: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorderInner,
  },
  activityRowSelected: {
    backgroundColor: colors.glass,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
  errorText: {
    ...typography.body,
    color: colors.red,
  },
});
