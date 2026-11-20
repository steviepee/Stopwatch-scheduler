import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';

import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { coachAPI, scheduleAPI, taskAPI } from '@/services/api';
import { formatClock, useClock24h } from '@/utils/formatClock';
import type { CoachConversation, CoachProposalItem, Schedule } from '@/types';

const SOURCE_LABELS: Record<CoachProposalItem['source'], string> = {
  you_said: 'You said',
  history: 'Your history',
  guess: "Coach's guess",
};

const GOOGLE_COLOR = 'rgba(66, 133, 244, 0.35)';
const BLOCK_COLOR = 'rgba(255, 255, 255, 0.12)';
const PROPOSAL_COLOR = 'rgba(99, 102, 241, 0.45)';

function localTime(targetDate: string, hhmm: string): Date {
  const [y, m, d] = targetDate.split('-').map(Number);
  const [hour, minute] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hour, minute);
}

function errorDetail(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : 'Something went wrong. Try again.';
}

type Row =
  | { kind: 'proposal'; index: number; time: Date; item: CoachProposalItem }
  | { kind: 'day'; index: number; time: Date; name: string; onGoogle: boolean };

export default function CoachScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const queryClient = useQueryClient();
  const clock24h = useClock24h();
  const [conversation, setConversation] = useState<CoachConversation | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [noteSuggestion, setNoteSuggestion] = useState<string | null>(null);
  const [showWhereFrom, setShowWhereFrom] = useState(false);
  const [accepted, setAccepted] = useState<Schedule | null>(null);
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [opening, setOpening] = useState(true);
  const opened = useRef(false);

  const { data: tasks } = useQuery({ queryKey: ['tasks'], queryFn: taskAPI.getAll });

  function show(next: CoachConversation) {
    setConversation(next);
    setNoteSuggestion(next.note_suggestion);
    setError(null);
  }

  const openMutation = useMutation({
    mutationFn: () => coachAPI.openConversation({ target_date: date, tz_offset: new Date().getTimezoneOffset() }),
    onSuccess: show,
    onError: (err) => setError(errorDetail(err)),
    onSettled: () => setOpening(false),
  });

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    openMutation.mutate();
  }, [openMutation]);

  const sendMutation = useMutation({
    mutationFn: (message: string) => coachAPI.sendMessage(conversation!.id, { text: message }),
    onSuccess: (next) => {
      show(next);
      setText('');
    },
    onError: (err) => setError(errorDetail(err)),
  });

  const acceptMutation = useMutation({
    mutationFn: () => coachAPI.accept(conversation!.id),
    onSuccess: (schedule) => {
      setAccepted(schedule);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['coach'] });
    },
    onError: (err) => setError(errorDetail(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: () => coachAPI.reject(conversation!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coach'] });
      router.back();
    },
    onError: (err) => setError(errorDetail(err)),
  });

  const startOverMutation = useMutation({
    mutationFn: () => coachAPI.startOver(conversation!.id),
    onSuccess: (next) => {
      show(next);
      setText('');
      setShowWhereFrom(false);
      queryClient.invalidateQueries({ queryKey: ['coach'] });
    },
    onError: (err) => setError(errorDetail(err)),
  });

  const pushMutation = useMutation({
    mutationFn: (scheduleId: number) => scheduleAPI.pushToCalendar(scheduleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules'] }),
    onError: (err) => setError(errorDetail(err)),
  });

  const rateMutation = useMutation({
    mutationFn: (value: 'up' | 'down') => coachAPI.rate(conversation!.id, { rating: value }),
    onSuccess: (_, value) => {
      setRating(value);
      queryClient.invalidateQueries({ queryKey: ['coach'] });
    },
  });

  const noteMutation = useMutation({
    mutationFn: (note: string) => coachAPI.createNote({ text: note }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['coach', 'notes'] }),
  });

  const thinking = opening || sendMutation.isPending;
  const proposal = conversation?.proposal ?? null;
  const closed = accepted !== null;

  function activityName(item: CoachProposalItem): string {
    if (item.task_id === null) return item.new_activity_name ?? '';
    return tasks?.find((task) => task.id === item.task_id)?.name ?? '';
  }

  const allDay = conversation?.day_items.filter((item) => item.all_day) ?? [];

  const rows = useMemo<Row[]>(() => {
    if (!conversation || !proposal) return [];
    const list: Row[] = [
      ...conversation.day_items.flatMap((item, index) =>
        item.all_day
          ? []
          : [{ kind: 'day' as const, index, time: new Date(item.start), name: item.name, onGoogle: item.on_google }]
      ),
      ...proposal.items.map((item, index) => ({
        kind: 'proposal' as const,
        index,
        time: localTime(conversation.target_date, item.start),
        item,
      })),
    ];
    return list.sort((a, b) => a.time.getTime() - b.time.getTime());
  }, [conversation, proposal]);

  function send() {
    const message = text.trim();
    if (!message || !conversation) return;
    setError(null);
    sendMutation.mutate(message);
  }

  function confirmStartOver() {
    Alert.alert('Start over', 'This conversation ends and a new one starts for this date.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Start over', style: 'destructive', onPress: () => startOverMutation.mutate() },
    ]);
  }

  function answerNote(save: boolean) {
    if (save && noteSuggestion) noteMutation.mutate(noteSuggestion);
    setNoteSuggestion(null);
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Text style={styles.title}>{`Plan ${date}`}</Text>
        {conversation && !closed && (
          <Pressable
            testID="btn-start-over"
            accessibilityRole="button"
            disabled={startOverMutation.isPending}
            style={styles.button}
            onPress={confirmStartOver}>
            <Text style={styles.buttonLabel}>Start over</Text>
          </Pressable>
        )}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {conversation?.messages.map((message, index) => (
          <View
            key={index}
            testID={`coach-message-${index}`}
            style={[styles.message, message.role === 'user' ? styles.userMessage : styles.coachMessage]}>
            <Text style={styles.messageText}>{message.visible_text}</Text>
          </View>
        ))}

        {thinking && (
          <Text testID="coach-thinking" style={styles.muted}>
            Coach is thinking…
          </Text>
        )}

        {noteSuggestion && (
          <View testID="coach-note-suggestion" style={styles.card}>
            <Text style={styles.label}>Save this note?</Text>
            <Text style={styles.messageText}>{noteSuggestion}</Text>
            <View style={styles.row}>
              <Pressable testID="btn-note-yes" accessibilityRole="button" style={styles.button} onPress={() => answerNote(true)}>
                <Text style={styles.buttonLabel}>Yes</Text>
              </Pressable>
              <Pressable testID="btn-note-no" accessibilityRole="button" style={styles.button} onPress={() => answerNote(false)}>
                <Text style={styles.buttonLabel}>No</Text>
              </Pressable>
            </View>
          </View>
        )}

        {conversation && proposal && (
          <View style={styles.card}>
            <Pressable
              testID="btn-where-from"
              accessibilityRole="button"
              style={styles.link}
              onPress={() => setShowWhereFrom((current) => !current)}>
              <Text style={styles.linkText}>Where this came from</Text>
            </Pressable>

            {showWhereFrom && (
              <View testID="where-from-list" style={styles.whereFromList}>
                {proposal.items.map((item, index) => (
                  <View key={index} testID={`where-from-${index}`} style={styles.whereFromRow}>
                    <Text style={styles.label}>{activityName(item)}</Text>
                    <Text style={styles.muted}>{SOURCE_LABELS[item.source]}</Text>
                    <Text style={styles.messageText}>{item.reason}</Text>
                    {item.task_id !== null && (
                      <Text style={styles.muted}>
                        {item.recording_count} Recordings, typical {Math.round((item.typical_seconds ?? 0) / 60)} min
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            {allDay.length > 0 && (
              <View testID="coach-all-day">
                <Text style={styles.muted}>All day: {allDay.map((item) => item.name).join(', ')}</Text>
              </View>
            )}

            {rows.map((row) =>
              row.kind === 'day' ? (
                <View
                  key={`day-${row.index}`}
                  testID={`day-item-${row.index}`}
                  style={[styles.dayRow, { backgroundColor: row.onGoogle ? GOOGLE_COLOR : BLOCK_COLOR }]}>
                  <Text style={styles.rowTime}>{formatClock(row.time, clock24h)}</Text>
                  <Text style={styles.rowName}>{row.name}</Text>
                </View>
              ) : (
                <View
                  key={`proposal-${row.index}`}
                  testID={`proposal-item-${row.index}`}
                  style={[styles.dayRow, { backgroundColor: PROPOSAL_COLOR }]}>
                  <Text style={styles.rowTime}>{formatClock(row.time, clock24h)}</Text>
                  <Text style={styles.rowName}>{activityName(row.item)}</Text>
                  <Text style={styles.muted}>{row.item.duration_minutes} min</Text>
                  {row.item.is_frog && (
                    <Text testID={`proposal-frog-${row.index}`} accessibilityLabel="Frog">
                      🐸
                    </Text>
                  )}
                  {row.item.task_id === null && (
                    <Text testID={`proposal-new-${row.index}`} style={styles.newTag}>
                      New
                    </Text>
                  )}
                </View>
              )
            )}

            {!closed && (
              <View style={styles.row}>
                <Pressable
                  testID="btn-accept"
                  accessibilityRole="button"
                  disabled={acceptMutation.isPending || rejectMutation.isPending}
                  style={[styles.button, styles.primaryButton]}
                  onPress={() => acceptMutation.mutate()}>
                  <Text style={styles.buttonLabel}>Accept</Text>
                </Pressable>
                <Pressable
                  testID="btn-reject"
                  accessibilityRole="button"
                  disabled={acceptMutation.isPending || rejectMutation.isPending}
                  style={styles.button}
                  onPress={() => rejectMutation.mutate()}>
                  <Text style={styles.buttonLabel}>Reject</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {accepted && (
          <View testID="coach-accepted" style={styles.card}>
            <Text style={styles.label}>The plan is on your calendar.</Text>
            <View style={styles.row}>
              <Pressable
                testID="btn-coach-push-day"
                accessibilityRole="button"
                disabled={pushMutation.isPending || pushMutation.isSuccess}
                style={styles.button}
                onPress={() => pushMutation.mutate(accepted.id)}>
                <Text style={styles.buttonLabel}>{pushMutation.isSuccess ? 'Pushed' : 'Push day'}</Text>
              </Pressable>
              <Pressable
                testID="btn-rate-up"
                accessibilityRole="button"
                accessibilityLabel="Thumbs up"
                style={[styles.button, rating === 'up' && styles.primaryButton]}
                onPress={() => rateMutation.mutate('up')}>
                <Text style={styles.buttonLabel}>👍</Text>
              </Pressable>
              <Pressable
                testID="btn-rate-down"
                accessibilityRole="button"
                accessibilityLabel="Thumbs down"
                style={[styles.button, rating === 'down' && styles.primaryButton]}
                onPress={() => rateMutation.mutate('down')}>
                <Text style={styles.buttonLabel}>👎</Text>
              </Pressable>
            </View>
          </View>
        )}

        {error && (
          <Text testID="coach-error" style={styles.error}>
            {error}
          </Text>
        )}
      </ScrollView>

      {!closed && (
        <View style={styles.inputArea}>
          {proposal && conversation?.changes_left !== null && (
            <Text testID="coach-limits" style={styles.muted}>
              {conversation?.changes_left} plan changes left, {conversation?.messages_left} messages left
            </Text>
          )}
          <View style={styles.row}>
            <TextInput
              testID="coach-input"
              style={styles.input}
              value={text}
              onChangeText={setText}
              editable={!thinking && conversation !== null}
              placeholder="Message the Coach"
              placeholderTextColor={colors.placeholder}
              multiline
            />
            <Pressable
              testID="coach-send"
              accessibilityRole="button"
              disabled={thinking || !conversation || !text.trim()}
              style={[styles.button, styles.primaryButton]}
              onPress={send}>
              <Text style={styles.buttonLabel}>Send</Text>
            </Pressable>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  title: {
    ...typography.heading,
    color: colors.text,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  message: {
    borderRadius: radii.md,
    padding: spacing.sm,
    maxWidth: '85%',
  },
  coachMessage: {
    alignSelf: 'flex-start',
    backgroundColor: colors.glass,
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
  },
  messageText: {
    ...typography.body,
    color: colors.text,
  },
  muted: {
    ...typography.caption,
    color: colors.textMuted,
  },
  label: {
    ...typography.label,
    color: colors.text,
  },
  card: {
    backgroundColor: colors.glassInner,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  button: {
    minHeight: touchTarget,
    minWidth: touchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  buttonLabel: {
    ...typography.label,
    color: colors.text,
  },
  link: {
    minHeight: touchTarget,
    justifyContent: 'center',
  },
  linkText: {
    ...typography.label,
    color: colors.text,
    textDecorationLine: 'underline',
  },
  whereFromList: {
    gap: spacing.sm,
  },
  whereFromRow: {
    borderTopWidth: 1,
    borderTopColor: colors.glassBorderInner,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  rowTime: {
    ...typography.caption,
    color: colors.text,
    minWidth: 64,
  },
  rowName: {
    ...typography.label,
    color: colors.text,
    flexShrink: 1,
  },
  newTag: {
    ...typography.caption,
    color: colors.text,
    backgroundColor: colors.primaryDeep,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    overflow: 'hidden',
  },
  error: {
    ...typography.label,
    color: colors.red,
  },
  inputArea: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  input: {
    flex: 1,
    minHeight: touchTarget,
    maxHeight: 120,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.glassBorderInner,
    backgroundColor: colors.glassInner,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
  },
});
