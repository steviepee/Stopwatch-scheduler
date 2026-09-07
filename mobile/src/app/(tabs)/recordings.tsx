import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import DateTimePicker from '@react-native-community/datetimepicker';

import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { sessionAPI, taskAPI } from '@/services/api';
import { CREATE_SESSION_KEY } from '@/services/queryClient';
import { formatElapsed } from '@/timer/format';
import type { StopwatchSessionCreate } from '@/types';

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

export default function RecordingsScreen() {
  const queryClient = useQueryClient();
  const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: () => sessionAPI.getAll() });
  const { data: tasks } = useQuery({ queryKey: ['tasks'], queryFn: taskAPI.getAll });

  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);

  const deleteSession = useMutation({
    mutationFn: (id: number) => sessionAPI.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

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

  return (
    <View style={styles.container}>
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
          <DateTimePicker
            testID="picker-date-from"
            value={dateFrom ?? new Date()}
            mode="date"
            onChange={(_event, date) => date && setDateFrom(date)}
          />
        </View>
        <View style={styles.dateField}>
          <Text style={styles.dateLabel}>To {dateTo ? dayOf(dateTo.toISOString()) : '—'}</Text>
          <DateTimePicker
            testID="picker-date-to"
            value={dateTo ?? new Date()}
            mode="date"
            onChange={(_event, date) => date && setDateTo(date)}
          />
        </View>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {pendingSessions.map((mutation) => (
          <View
            key={`pending-${mutation.mutationId}`}
            testID={`session-pending-${mutation.mutationId}`}
            style={styles.row}>
            <Text style={styles.rowName}>{mutation.body.name}</Text>
            <Text style={styles.rowMetaText}>Pending</Text>
          </View>
        ))}

        {visibleSessions.map((session) => (
          <Pressable
            key={session.id}
            testID={`session-row-${session.id}`}
            accessibilityRole="button"
            style={styles.row}
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
});
