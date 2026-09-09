import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { GlassView } from 'expo-glass-effect';

import { colors, radii, spacing, typography } from '@/theme/tokens';
import { taskAPI, timeLogAPI } from '@/services/api';
import { formatElapsed } from '@/timer/format';

function statText(value: number | null): string {
  return value === null ? '—' : formatElapsed(value * 1000);
}

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const taskId = Number(id);

  const { data: stats } = useQuery({
    queryKey: ['task-stats', taskId],
    queryFn: () => taskAPI.getStats(taskId),
  });

  const { data: logs } = useQuery({
    queryKey: ['time-logs', taskId],
    queryFn: () => timeLogAPI.getAll(taskId),
  });

  const recentLogs = useMemo(() => {
    const list = logs ?? [];
    return [...list]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10);
  }, [logs]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {stats && (
        <View style={styles.statsRow}>
          <GlassView glassEffectStyle="regular" style={styles.statCard}>
            <Text style={styles.statLabel}>Average</Text>
            <Text testID="stat-average" style={styles.statValue}>
              {formatElapsed(stats.average * 1000)}
            </Text>
          </GlassView>
          <GlassView glassEffectStyle="regular" style={styles.statCard}>
            <Text style={styles.statLabel}>Median</Text>
            <Text testID="stat-median" style={styles.statValue}>
              {statText(stats.median)}
            </Text>
          </GlassView>
          <GlassView glassEffectStyle="regular" style={styles.statCard}>
            <Text style={styles.statLabel}>Previous</Text>
            <Text testID="stat-previous" style={styles.statValue}>
              {statText(stats.previous)}
            </Text>
          </GlassView>
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
