import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import axios from 'axios';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { onlineManager, useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';

import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { getApiUrl, getToken, setApiUrl, setToken } from '@/services/auth';
import { CREATE_SESSION_KEY } from '@/services/queryClient';
import { DEFAULT_USER_OPTIONS, getUserOptions, setUserOptions, type UserOptions } from '@/services/options';
import { isNativeAvailable } from '@/timer/native';
import { settingsAPI } from '@/services/api';
import type { PomodoroSettings } from '@/types';

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
