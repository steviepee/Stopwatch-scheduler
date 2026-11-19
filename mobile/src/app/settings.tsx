import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import axios from 'axios';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { onlineManager, useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';

import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { getApiUrl, getToken, setApiUrl, setToken } from '@/services/auth';
import { CREATE_SESSION_KEY } from '@/services/queryClient';
import { DEFAULT_USER_OPTIONS, getUserOptions, setUserOptions, type UserOptions } from '@/services/options';
import { isNativeAvailable } from '@/timer/native';
import { coachAPI, settingsAPI } from '@/services/api';
import type { CoachSettings, DisplaySettings, PomodoroSettings, ReminderSettings } from '@/types';

type PomodoroKey = keyof PomodoroSettings;

const POMODORO_DEFAULTS: PomodoroSettings = {
  work_minutes: 25,
  break_minutes: 5,
  long_break_minutes: 15,
  long_break_every: 4,
};

const POMODORO_FIELDS: { key: PomodoroKey; label: string; testID: string; max: number }[] = [
  { key: 'work_minutes', label: 'Work (minutes)', testID: 'pomodoro-work', max: 180 },
  { key: 'break_minutes', label: 'Break (minutes)', testID: 'pomodoro-break', max: 180 },
  { key: 'long_break_minutes', label: 'Long break (minutes)', testID: 'pomodoro-long-break', max: 180 },
  { key: 'long_break_every', label: 'Long break every', testID: 'pomodoro-long-every', max: 12 },
];

function toFields(settings: PomodoroSettings): Record<PomodoroKey, string> {
  return {
    work_minutes: String(settings.work_minutes),
    break_minutes: String(settings.break_minutes),
    long_break_minutes: String(settings.long_break_minutes),
    long_break_every: String(settings.long_break_every),
  };
}

function inRange(value: string, max: number) {
  return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max;
}

function dollars(value: number, places: number) {
  return `$${value.toFixed(places)}`;
}

type ConnectionStatus = 'idle' | 'checking' | 'unreachable' | 'rejected' | 'ok';
type ExportResource = 'sessions' | 'tasks';
type ExportFormat = 'csv' | 'json';
type ExportStatus = 'idle' | 'exporting' | 'failed' | 'offline';

const EXPORT_STATUS_TEXT: Record<ExportStatus, string> = {
  idle: '',
  exporting: 'Exporting…',
  failed: 'Export failed',
  offline: 'Needs a connection',
};

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  idle: '',
  checking: 'Checking…',
  unreachable: 'Unreachable',
  rejected: 'Reachable, token rejected',
  ok: 'OK',
};

export default function SettingsScreen() {
  const queryClient = useQueryClient();
  const [apiUrl, setApiUrlField] = useState('');
  const [token, setTokenField] = useState('');
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [options, setOptions] = useState<UserOptions>(DEFAULT_USER_OPTIONS);

  const [pomodoro, setPomodoro] = useState(toFields(POMODORO_DEFAULTS));
  const pomodoroQuery = useQuery({ queryKey: ['settings', 'pomodoro'], queryFn: () => settingsAPI.getPomodoro() });
  const pomodoroMutation = useMutation({
    mutationFn: (settings: PomodoroSettings) => settingsAPI.updatePomodoro(settings),
    onSuccess: (data) => queryClient.setQueryData(['settings', 'pomodoro'], data),
  });

  useEffect(() => {
    if (pomodoroQuery.data) setPomodoro(toFields(pomodoroQuery.data));
  }, [pomodoroQuery.data]);

  const pomodoroValid = POMODORO_FIELDS.every((f) => inRange(pomodoro[f.key], f.max));
  const pomodoroSaveDisabled = !pomodoroQuery.data || !pomodoroValid || pomodoroMutation.isPending;

  const savePomodoro = () => {
    pomodoroMutation.mutate({
      work_minutes: Number(pomodoro.work_minutes),
      break_minutes: Number(pomodoro.break_minutes),
      long_break_minutes: Number(pomodoro.long_break_minutes),
      long_break_every: Number(pomodoro.long_break_every),
    });
  };

  const coachQuery = useQuery({ queryKey: ['settings', 'coach'], queryFn: () => settingsAPI.getCoach() });
  const coachMutation = useMutation({
    mutationFn: (settings: CoachSettings) => settingsAPI.updateCoach(settings),
    onSuccess: (data) => queryClient.setQueryData(['settings', 'coach'], data),
  });

  const notesQuery = useQuery({ queryKey: ['coach', 'notes'], queryFn: () => coachAPI.getNotes() });
  const invalidateNotes = () => queryClient.invalidateQueries({ queryKey: ['coach', 'notes'] });
  const [newNote, setNewNote] = useState('');
  const [editingNote, setEditingNote] = useState<{ id: number; text: string } | null>(null);
  const createNoteMutation = useMutation({
    mutationFn: (text: string) => coachAPI.createNote({ text }),
    onSuccess: () => {
      setNewNote('');
      invalidateNotes();
    },
  });
  const updateNoteMutation = useMutation({
    mutationFn: ({ id, text }: { id: number; text: string }) => coachAPI.updateNote(id, { text }),
    onSuccess: () => {
      setEditingNote(null);
      invalidateNotes();
    },
  });
  const deleteNoteMutation = useMutation({
    mutationFn: (id: number) => coachAPI.deleteNote(id),
    onSuccess: invalidateNotes,
  });

  const confirmDeleteNote = (id: number) => {
    Alert.alert('Delete Coach note', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteNoteMutation.mutate(id) },
    ]);
  };

  const remindersQuery = useQuery({ queryKey: ['settings', 'reminders'], queryFn: () => settingsAPI.getReminders() });
  const remindersMutation = useMutation({
    mutationFn: (settings: ReminderSettings) => settingsAPI.updateReminders(settings),
    onSuccess: (data) => queryClient.setQueryData(['settings', 'reminders'], data),
  });
  const [reminderMinutes, setReminderMinutes] = useState('');

  useEffect(() => {
    if (remindersQuery.data) setReminderMinutes(String(remindersQuery.data.minutes_before));
  }, [remindersQuery.data]);

  const reminderMinutesValid = inRange(reminderMinutes, 120);
  const remindersSaveDisabled = !remindersQuery.data || !reminderMinutesValid || remindersMutation.isPending;

  const displayQuery = useQuery({ queryKey: ['settings', 'display'], queryFn: () => settingsAPI.getDisplay() });
  const displayMutation = useMutation({
    mutationFn: (settings: DisplaySettings) => settingsAPI.updateDisplay(settings),
    onSuccess: (data) => queryClient.setQueryData(['settings', 'display'], data),
  });

  const usageQuery = useQuery({ queryKey: ['coach', 'usage'], queryFn: () => coachAPI.getUsage() });
  const conversationsQuery = useQuery({ queryKey: ['coach', 'conversations'], queryFn: () => coachAPI.getConversations() });
  const [openConversationId, setOpenConversationId] = useState<number | null>(null);
  const conversationQuery = useQuery({
    queryKey: ['coach', 'conversations', openConversationId],
    queryFn: () => coachAPI.getConversation(openConversationId as number),
    enabled: openConversationId !== null,
  });

  useEffect(() => {
    (async () => {
      setApiUrlField(await getApiUrl());
      setTokenField((await getToken()) ?? '');
      setOptions(await getUserOptions());
    })();
  }, []);

  const toggleOption = (key: keyof UserOptions) => (value: boolean) => {
    setOptions((prev) => {
      const next = { ...prev, [key]: value };
      setUserOptions(next);
      return next;
    });
  };

  const pendingCount = useMutationState({
    filters: { mutationKey: CREATE_SESSION_KEY },
    select: (mutation) => mutation.state.isPaused,
  }).filter(Boolean).length;

  const testConnection = async () => {
    setStatus('checking');
    try {
      await axios.get(`${apiUrl}/health`);
    } catch {
      setStatus('unreachable');
      return;
    }
    try {
      await axios.get(`${apiUrl}/tasks/`, { headers: { Authorization: `Bearer ${token}` } });
      setStatus('ok');
    } catch {
      setStatus('rejected');
    }
  };

  const save = async () => {
    await setApiUrl(apiUrl);
    await setToken(token);
    queryClient.invalidateQueries();
  };

  const runExport = async (resource: ExportResource, format: ExportFormat) => {
    if (!onlineManager.isOnline()) {
      setExportStatus('offline');
      return;
    }
    setExportStatus('exporting');
    try {
      const response = await axios.post(
        `${apiUrl}/exports`,
        { resource, format, disposition: 'inline' },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const origin = apiUrl.replace(/\/api\/?$/, '');
      await WebBrowser.openBrowserAsync(`${origin}${response.data.url}`);
      setExportStatus('idle');
    } catch {
      setExportStatus('failed');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>API URL</Text>
      <TextInput
        testID="input-api-url"
        style={styles.input}
        value={apiUrl}
        onChangeText={setApiUrlField}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.placeholder}
      />

      <Text style={styles.label}>Bearer token</Text>
      <TextInput
        testID="input-token"
        style={styles.input}
        value={token}
        onChangeText={setTokenField}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.placeholder}
      />

      <Pressable
        testID="btn-test-connection"
        accessibilityRole="button"
        style={styles.button}
        onPress={testConnection}>
        <Text style={styles.buttonText}>Test connection</Text>
      </Pressable>

      {status !== 'idle' && <Text style={styles.statusText}>{STATUS_TEXT[status]}</Text>}

      <Pressable testID="btn-save" accessibilityRole="button" style={styles.button} onPress={save}>
        <Text style={styles.buttonText}>Save</Text>
      </Pressable>

      <Text style={styles.label}>Duration hints</Text>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Average</Text>
        <Switch
          testID="toggle-show-average"
          value={options.showAverage}
          onValueChange={toggleOption('showAverage')}
        />
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Median</Text>
        <Switch
          testID="toggle-show-median"
          value={options.showMedian}
          onValueChange={toggleOption('showMedian')}
        />
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Previous</Text>
        <Switch
          testID="toggle-show-previous"
          value={options.showPrevious}
          onValueChange={toggleOption('showPrevious')}
        />
      </View>

      <Text style={styles.label}>Clock</Text>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Use 24-hour clock</Text>
        <Switch
          testID="toggle-clock-24h"
          value={displayQuery.data?.clock_24h ?? false}
          disabled={!displayQuery.data || displayMutation.isPending}
          onValueChange={(value) => displayMutation.mutate({ clock_24h: value })}
        />
      </View>

      <Text style={styles.label}>Pomodoro</Text>
      {pomodoroQuery.isError && <Text style={styles.statusText}>Couldn't load</Text>}
      {POMODORO_FIELDS.map((f) => (
        <View key={f.key}>
          <Text style={styles.infoLabel}>{f.label}</Text>
          <TextInput
            testID={f.testID}
            style={[styles.input, pomodoroQuery.isError && styles.inputDisabled]}
            value={pomodoro[f.key]}
            onChangeText={(value) => setPomodoro((prev) => ({ ...prev, [f.key]: value }))}
            editable={!pomodoroQuery.isError}
            keyboardType="number-pad"
            placeholderTextColor={colors.placeholder}
          />
          {!inRange(pomodoro[f.key], f.max) && (
            <Text style={styles.statusText}>{`1–${f.max}`}</Text>
          )}
        </View>
      ))}
      <Pressable
        testID="pomodoro-save"
        accessibilityRole="button"
        style={[styles.button, pomodoroSaveDisabled && styles.buttonDisabled]}
        disabled={pomodoroSaveDisabled}
        onPress={savePomodoro}>
        <Text style={styles.buttonText}>Save</Text>
      </Pressable>

      <Text style={styles.label}>Coach notes</Text>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Coach notes</Text>
        <Switch
          testID="toggle-coach-notes"
          value={coachQuery.data?.notes_enabled ?? false}
          disabled={!coachQuery.data || coachMutation.isPending}
          onValueChange={(value) => coachMutation.mutate({ notes_enabled: value })}
        />
      </View>
      {(notesQuery.data ?? []).map((note) =>
        editingNote?.id === note.id ? (
          <View key={note.id} style={styles.noteRow}>
            <TextInput
              testID={`input-note-${note.id}`}
              style={[styles.input, styles.noteText]}
              value={editingNote.text}
              onChangeText={(text) => setEditingNote({ id: note.id, text })}
              multiline
              placeholderTextColor={colors.placeholder}
            />
            <Pressable
              testID={`btn-note-save-${note.id}`}
              accessibilityRole="button"
              style={[styles.smallButton, !editingNote.text.trim() && styles.buttonDisabled]}
              disabled={!editingNote.text.trim() || updateNoteMutation.isPending}
              onPress={() => updateNoteMutation.mutate({ id: note.id, text: editingNote.text.trim() })}>
              <Text style={styles.buttonText}>Save</Text>
            </Pressable>
          </View>
        ) : (
          <View key={note.id} testID={`coach-note-${note.id}`} style={styles.noteRow}>
            <Text style={[styles.infoValue, styles.noteText]}>{note.text}</Text>
            <Pressable
              testID={`coach-note-edit-${note.id}`}
              accessibilityRole="button"
              style={styles.smallButton}
              onPress={() => setEditingNote({ id: note.id, text: note.text })}>
              <Text style={styles.buttonText}>Edit</Text>
            </Pressable>
            <Pressable
              testID={`coach-note-delete-${note.id}`}
              accessibilityRole="button"
              style={styles.smallButton}
              onPress={() => confirmDeleteNote(note.id)}>
              <Text style={styles.buttonText}>Delete</Text>
            </Pressable>
          </View>
        )
      )}
      <TextInput
        testID="input-new-note"
        style={styles.input}
        value={newNote}
        onChangeText={setNewNote}
        placeholder="New note"
        multiline
        placeholderTextColor={colors.placeholder}
      />
      <Pressable
        testID="btn-add-note"
        accessibilityRole="button"
        style={[styles.button, !newNote.trim() && styles.buttonDisabled]}
        disabled={!newNote.trim() || createNoteMutation.isPending}
        onPress={() => createNoteMutation.mutate(newNote.trim())}>
        <Text style={styles.buttonText}>Add note</Text>
      </Pressable>

      <Text style={styles.label}>Start reminders</Text>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Start reminders</Text>
        <Switch
          testID="toggle-start-reminders"
          value={remindersQuery.data?.enabled ?? false}
          disabled={!remindersQuery.data || remindersMutation.isPending}
          onValueChange={(value) =>
            remindersQuery.data &&
            remindersMutation.mutate({ enabled: value, minutes_before: remindersQuery.data.minutes_before })
          }
        />
      </View>
      <Text style={styles.infoLabel}>Minutes before</Text>
      <TextInput
        testID="input-reminder-minutes"
        style={styles.input}
        value={reminderMinutes}
        onChangeText={setReminderMinutes}
        keyboardType="number-pad"
        placeholderTextColor={colors.placeholder}
      />
      {remindersQuery.data && !reminderMinutesValid && <Text style={styles.statusText}>1–120</Text>}
      <Text style={styles.statusText}>Applies to Blocks pushed or changed from now on.</Text>
      <Pressable
        testID="reminders-save"
        accessibilityRole="button"
        style={[styles.button, remindersSaveDisabled && styles.buttonDisabled]}
        disabled={remindersSaveDisabled}
        onPress={() =>
          remindersQuery.data &&
          remindersMutation.mutate({ enabled: remindersQuery.data.enabled, minutes_before: Number(reminderMinutes) })
        }>
        <Text style={styles.buttonText}>Save</Text>
      </Pressable>

      <Text style={styles.label}>Coach usage</Text>
      {usageQuery.data && (
        <Text testID="usage-month" style={styles.infoValue}>
          {`${usageQuery.data.month}: ${usageQuery.data.conversations} conversations, ${dollars(usageQuery.data.cost_usd, 2)}`}
        </Text>
      )}
      {(conversationsQuery.data ?? []).map((c) => (
        <Pressable
          key={c.id}
          testID={`usage-conversation-${c.id}`}
          accessibilityRole="button"
          style={styles.infoRow}
          onPress={() => setOpenConversationId(openConversationId === c.id ? null : c.id)}>
          <Text style={styles.infoValue}>{`${c.target_date}  ${c.status}`}</Text>
          <Text style={styles.infoValue}>{dollars(c.cost_usd, 2)}</Text>
        </Pressable>
      ))}
      {openConversationId !== null && conversationQuery.data && (
        <View testID="usage-detail" style={styles.detail}>
          {conversationQuery.data.messages.map((m, i) => (
            <View key={i}>
              <Text style={styles.infoLabel}>{m.role === 'user' ? 'You' : 'Coach'}</Text>
              <Text style={styles.infoValue}>{m.visible_text}</Text>
            </View>
          ))}
          {conversationQuery.data.proposal?.summary && (
            <Text style={styles.infoValue}>{`Proposal: ${conversationQuery.data.proposal.summary}`}</Text>
          )}
          <Text style={styles.infoLabel}>Calls (input / output / cache read / cache write)</Text>
          {conversationQuery.data.calls.map((call, i) => (
            <Text key={i} testID={`usage-call-${i}`} style={styles.callRow}>
              {`${call.input_tokens} / ${call.output_tokens} / ${call.cache_read_input_tokens ?? 0} / ${call.cache_creation_input_tokens ?? 0}  ${call.latency_ms} ms  ${dollars(call.cost_usd, 4)}`}
            </Text>
          ))}
        </View>
      )}

      <Text style={styles.label}>Export</Text>
      <View style={styles.exportRow}>
        <Pressable
          testID="btn-export-sessions-csv"
          accessibilityRole="button"
          style={styles.exportButton}
          onPress={() => runExport('sessions', 'csv')}>
          <Text style={styles.buttonText}>Recordings CSV</Text>
        </Pressable>
        <Pressable
          testID="btn-export-sessions-json"
          accessibilityRole="button"
          style={styles.exportButton}
          onPress={() => runExport('sessions', 'json')}>
          <Text style={styles.buttonText}>Recordings JSON</Text>
        </Pressable>
      </View>
      <View style={styles.exportRow}>
        <Pressable
          testID="btn-export-tasks-csv"
          accessibilityRole="button"
          style={styles.exportButton}
          onPress={() => runExport('tasks', 'csv')}>
          <Text style={styles.buttonText}>Activities CSV</Text>
        </Pressable>
        <Pressable
          testID="btn-export-tasks-json"
          accessibilityRole="button"
          style={styles.exportButton}
          onPress={() => runExport('tasks', 'json')}>
          <Text style={styles.buttonText}>Activities JSON</Text>
        </Pressable>
      </View>
      {exportStatus !== 'idle' && (
        <Text testID="text-export-status" style={styles.statusText}>
          {EXPORT_STATUS_TEXT[exportStatus]}
        </Text>
      )}

      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>App version</Text>
        <Text style={styles.infoValue}>{Constants.expoConfig?.version ?? '—'}</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Native timer module</Text>
        <Text style={styles.infoValue}>{isNativeAvailable() ? 'Available' : 'Unavailable'}</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Pending offline saves</Text>
        <Text testID="text-pending-count" style={styles.infoValue}>
          {pendingCount}
        </Text>
      </View>
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
    gap: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  input: {
    minHeight: touchTarget,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md,
    color: colors.text,
  },
  button: {
    minHeight: touchTarget,
    borderRadius: radii.md,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    ...typography.body,
    color: colors.text,
  },
  statusText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget,
  },
  noteText: {
    flex: 1,
  },
  smallButton: {
    minHeight: touchTarget,
    minWidth: touchTarget,
    borderRadius: radii.md,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  detail: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  callRow: {
    ...typography.caption,
    color: colors.text,
  },
  exportRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  exportButton: {
    flex: 1,
    minHeight: touchTarget,
    borderRadius: radii.md,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: touchTarget,
    borderTopWidth: 1,
    borderTopColor: colors.glassBorderInner,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
  },
  infoLabel: {
    ...typography.body,
    color: colors.textMuted,
  },
  infoValue: {
    ...typography.body,
    color: colors.text,
  },
});
