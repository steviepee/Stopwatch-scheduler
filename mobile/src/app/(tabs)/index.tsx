import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { taskAPI } from '@/services/api';
import { useCreateSession } from '@/services/mutations';
import { useTimer } from '@/timer/store';
import { formatElapsed } from '@/timer/format';
import type { StopwatchSessionCreate, Task } from '@/types';

function defaultName(startUtc: string): string {
  return startUtc.slice(0, 16).replace('T', ' ');
}

type ActionButtonProps = {
  testID: string;
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'danger' | 'muted';
};

function ActionButton({ testID, label, onPress, variant = 'primary' }: ActionButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.button, variant === 'danger' && styles.buttonDanger, variant === 'muted' && styles.buttonMuted]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

export default function StopwatchScreen() {
  const timer = useTimer();
  const createSession = useCreateSession();
  const { data: tasks } = useQuery({ queryKey: ['tasks'], queryFn: taskAPI.getAll });

  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState('');
  const [searchText, setSearchText] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | undefined>(undefined);
  const [confirmation, setConfirmation] = useState<{ clockJumpDetected: boolean } | null>(null);

  const filteredTasks = useMemo(() => {
    const list = tasks ?? [];
    const query = searchText.trim().toLowerCase();
    if (!query) return list;
    return list.filter((task) => task.name.toLowerCase().includes(query));
  }, [tasks, searchText]);

  const closeSheet = () => {
    setSheetOpen(false);
    setName('');
    setSearchText('');
    setSelectedTask(undefined);
  };

  const handleSave = () => {
    const result = timer.finish();
    const finalName = name.trim() || selectedTask?.name || defaultName(result.startUtc);
    const body: StopwatchSessionCreate = {
      name: finalName,
      duration: result.durationSeconds,
      start_time: result.startUtc,
      end_time: result.endUtc,
      ...(selectedTask ? { task_id: selectedTask.id } : {}),
    };
    createSession.mutate(body);
    timer.reset();
    closeSheet();
    setConfirmation({ clockJumpDetected: result.clockJumpDetected });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.elapsed}>{formatElapsed(timer.elapsedMs)}</Text>

      {!sheetOpen && (
        <View style={styles.controls}>
          {timer.status === 'idle' && (
            <ActionButton testID="btn-start" label="Start" onPress={timer.start} />
          )}
          {timer.status === 'running' && (
            <ActionButton testID="btn-pause" label="Pause" onPress={timer.pause} variant="muted" />
          )}
          {timer.status === 'paused' && (
            <>
              <ActionButton testID="btn-resume" label="Resume" onPress={timer.resume} />
              <ActionButton testID="btn-reset" label="Reset" onPress={timer.reset} variant="danger" />
              {timer.elapsedMs > 0 && (
                <ActionButton testID="btn-save-open" label="Save" onPress={() => setSheetOpen(true)} />
              )}
            </>
          )}
        </View>
      )}

      {confirmation && (
        <View testID="save-confirmation" style={styles.confirmation}>
          <Text style={styles.confirmationText}>
            {confirmation.clockJumpDetected
              ? 'Saved — the clock moved during this recording'
              : 'Saved'}
          </Text>
        </View>
      )}

      {sheetOpen && (
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Save Recording</Text>
          <TextInput
            testID="input-name"
            style={styles.input}
            placeholder="Name (optional)"
            placeholderTextColor={colors.placeholder}
            value={name}
            onChangeText={setName}
          />
          <TextInput
            testID="activity-search"
            style={styles.input}
            placeholder="Search activities"
            placeholderTextColor={colors.placeholder}
            value={searchText}
            onChangeText={setSearchText}
          />
          <ScrollView style={styles.activityList}>
            <Pressable
              testID="activity-none"
              accessibilityRole="button"
              style={styles.activityRow}
              onPress={() => setSelectedTask(undefined)}
            >
              <Text style={styles.activityLabel}>None</Text>
            </Pressable>
            {filteredTasks.map((task) => (
              <Pressable
                key={task.id}
                accessibilityRole="button"
                style={styles.activityRow}
                onPress={() => setSelectedTask(task)}
              >
                <Text style={styles.activityLabel}>{task.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.sheetActions}>
            <ActionButton testID="btn-cancel" label="Cancel" onPress={closeSheet} variant="muted" />
            <ActionButton testID="btn-save-confirm" label="Save" onPress={handleSave} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
    gap: spacing.lg,
  },
  elapsed: {
    ...typography.display,
    color: colors.text,
  },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'center',
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
  buttonDanger: {
    backgroundColor: colors.red,
  },
  buttonMuted: {
    backgroundColor: colors.glass,
  },
  buttonLabel: {
    ...typography.label,
    color: colors.text,
  },
  confirmation: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.glass,
  },
  confirmationText: {
    ...typography.body,
    color: colors.text,
  },
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sheetTitle: {
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
  activityList: {
    flexGrow: 0,
  },
  activityRow: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorderInner,
  },
  activityLabel: {
    ...typography.body,
    color: colors.text,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
});
