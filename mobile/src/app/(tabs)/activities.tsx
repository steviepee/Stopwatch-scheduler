import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';

import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { taskAPI } from '@/services/api';
import { formatElapsed } from '@/timer/format';
import type { TaskCreate } from '@/types';

export default function ActivitiesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: tasks, isError } = useQuery({ queryKey: ['tasks'], queryFn: taskAPI.getAll });

  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState('');

  const createTask = useMutation({
    mutationFn: (task: TaskCreate) => taskAPI.create(task),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setSheetOpen(false);
      setName('');
    },
  });

  const closeSheet = () => {
    setSheetOpen(false);
    setName('');
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createTask.mutate({ name: trimmed });
  };

  if (isError) {
    return (
      <View style={styles.container}>
        <Text style={styles.offline}>Offline — showing nothing</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {(tasks ?? []).map((task) => (
          <Pressable
            key={task.id}
            testID={`activity-row-${task.id}`}
            accessibilityRole="button"
            style={styles.row}
            onPress={() => router.push(`/activity/${task.id}` as Href)}>
            <Text style={styles.rowName}>{task.name}</Text>
            <View style={styles.rowMeta}>
              <Text testID={`activity-average-${task.id}`} style={styles.rowMetaText}>
                {formatElapsed(task.average_duration * 1000)}
              </Text>
              <Text testID={`activity-count-${task.id}`} style={styles.rowMetaText}>
                {task.total_recordings}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {!sheetOpen && (
        <Pressable
          testID="btn-add-activity"
          accessibilityRole="button"
          style={styles.addButton}
          onPress={() => setSheetOpen(true)}>
          <Text style={styles.addButtonLabel}>+ Add Activity</Text>
        </Pressable>
      )}

      {sheetOpen && (
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>New Activity</Text>
          <TextInput
            testID="input-activity-name"
            style={styles.input}
            placeholder="Name"
            placeholderTextColor={colors.placeholder}
            value={name}
            onChangeText={setName}
          />
          <View style={styles.sheetActions}>
            <Pressable
              testID="btn-activity-cancel"
              accessibilityRole="button"
              style={[styles.button, styles.buttonMuted]}
              onPress={closeSheet}>
              <Text style={styles.buttonLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              testID="btn-activity-save"
              accessibilityRole="button"
              style={styles.button}
              onPress={handleSave}>
              <Text style={styles.buttonLabel}>Save</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    gap: spacing.md,
  },
  offline: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
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
  addButton: {
    minHeight: touchTarget,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonLabel: {
    ...typography.label,
    color: colors.text,
  },
  sheet: {
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
  sheetActions: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
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
  buttonLabel: {
    ...typography.label,
    color: colors.text,
  },
});
