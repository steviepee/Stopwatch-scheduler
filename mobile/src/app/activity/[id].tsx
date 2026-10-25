import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { GlassView } from 'expo-glass-effect';

import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { taskAPI, timeLogAPI } from '@/services/api';
import { useUserOptions } from '@/services/options';
import { formatElapsed } from '@/timer/format';

function statText(value: number | null): string {
  return value === null ? '—' : formatElapsed(value * 1000);
}

type Quadrant = 'q1' | 'q2' | 'q3' | 'q4';

const QUADRANTS: { id: Quadrant; label: string; is_urgent: boolean; is_important: boolean }[] = [
  { id: 'q1', label: 'Urgent & Important', is_urgent: true, is_important: true },
  { id: 'q2', label: 'Important', is_urgent: false, is_important: true },
  { id: 'q3', label: 'Urgent', is_urgent: true, is_important: false },
  { id: 'q4', label: 'Neither', is_urgent: false, is_important: false },
];

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const taskId = Number(id);
  const options = useUserOptions();
  const queryClient = useQueryClient();

  const { data: task } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => taskAPI.getById(taskId),
  });

  const { data: stats } = useQuery({
    queryKey: ['task-stats', taskId],
    queryFn: () => taskAPI.getStats(taskId),
  });

  const { data: logs } = useQuery({
    queryKey: ['time-logs', taskId],
    queryFn: () => timeLogAPI.getAll(taskId),
  });

  const currentQuadrant = task
    ? QUADRANTS.find((q) => q.is_urgent === !!task.is_urgent && q.is_important === !!task.is_important)?.id
    : undefined;

  const updateQuadrant = useMutation({
    mutationFn: (quadrant: { is_urgent: boolean; is_important: boolean }) =>
      taskAPI.update(taskId, quadrant),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
    },
  });

  const recentLogs = useMemo(() => {
    const list = logs ?? [];
    return [...list]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10);
  }, [logs]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.quadrantGrid}>
        {QUADRANTS.map((quadrant) => (
          <Pressable
            key={quadrant.id}
            testID={`quadrant-${quadrant.id}`}
            accessibilityRole="button"
            style={[styles.quadrantCell, currentQuadrant === quadrant.id && styles.quadrantCellCurrent]}
            onPress={() =>
              updateQuadrant.mutate({ is_urgent: quadrant.is_urgent, is_important: quadrant.is_important })
            }>
            <Text style={styles.quadrantLabel}>
              {currentQuadrant === quadrant.id ? `${quadrant.label} (current)` : quadrant.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {stats && (
        <View style={styles.statsRow}>
          {options.showAverage && (
            <GlassView glassEffectStyle="regular" style={styles.statCard}>
              <Text style={styles.statLabel}>Average</Text>
              <Text testID="stat-average" style={styles.statValue}>
                {formatElapsed(stats.average * 1000)}
              </Text>
            </GlassView>
          )}
          {options.showMedian && (
            <GlassView glassEffectStyle="regular" style={styles.statCard}>
              <Text style={styles.statLabel}>Median</Text>
              <Text testID="stat-median" style={styles.statValue}>
                {statText(stats.median)}
              </Text>
            </GlassView>
          )}
          {options.showPrevious && (
            <GlassView glassEffectStyle="regular" style={styles.statCard}>
              <Text style={styles.statLabel}>Previous</Text>
              <Text testID="stat-previous" style={styles.statValue}>
                {statText(stats.previous)}
              </Text>
            </GlassView>
          )}
        </View>
      )}

      <Text style={styles.sectionTitle}>Recent Recordings</Text>
      {recentLogs.map((log) => (
        <View key={log.id} testID={`time-log-${log.id}`} style={styles.logRow}>
          <Text style={styles.logDate}>{log.created_at.slice(0, 10)}</Text>
          <Text style={styles.logDuration}>{formatElapsed(log.duration * 1000)}</Text>
        </View>
      ))}
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
  quadrantGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  quadrantCell: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: touchTarget,
    borderRadius: radii.md,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  quadrantCellCurrent: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryDeep,
  },
  quadrantLabel: {
    ...typography.label,
    color: colors.text,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statCard: {
    flex: 1,
    borderRadius: radii.md,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  statValue: {
    ...typography.heading,
    color: colors.text,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  logRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorderInner,
    paddingVertical: spacing.sm,
  },
  logDate: {
    ...typography.body,
    color: colors.text,
  },
  logDuration: {
    ...typography.body,
    color: colors.textMuted,
  },
});
