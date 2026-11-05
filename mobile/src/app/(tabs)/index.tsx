import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { GlassView } from 'expo-glass-effect';

import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { settingsAPI, taskAPI } from '@/services/api';
import { useCreateSession } from '@/services/mutations';
import { usePomodoro, useTimer } from '@/timer/store';
import { formatElapsed } from '@/timer/format';
import type { PomodoroConfig, PomodoroPhase } from '@/timer/pomodoro';
import type { StopwatchSessionCreate, Task } from '@/types';

const DEFAULT_POMODORO: PomodoroConfig = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
};

const PHASE_LABELS: Record<PomodoroPhase, string> = {
  work: 'Work',
  break: 'Break',
  longBreak: 'Long break',
};

function defaultName(startUtc: string): string {
  return startUtc.slice(0, 16).replace('T', ' ');
}

type ActionButtonProps = {
  testID: string;
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'danger' | 'muted';
  disabled?: boolean;
};

function ActionButton({ testID, label, onPress, variant = 'primary', disabled = false }: ActionButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        variant === 'danger' && styles.buttonDanger,
        variant === 'muted' && styles.buttonMuted,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

export default function StopwatchScreen() {
  const timer = useTimer();
  const run = usePomodoro();
  const createSession = useCreateSession();
  const { data: tasks } = useQuery({ queryKey: ['tasks'], queryFn: taskAPI.getAll });
  const { data: pomodoroSettings } = useQuery({
    queryKey: ['settings', 'pomodoro'],
    queryFn: () => settingsAPI.getPomodoro(),
  });
  const pomodoroConfig: PomodoroConfig = pomodoroSettings
    ? {
        workMinutes: pomodoroSettings.work_minutes,
        breakMinutes: pomodoroSettings.break_minutes,
        longBreakMinutes: pomodoroSettings.long_break_minutes,
        longBreakEvery: pomodoroSettings.long_break_every,
      }
    : DEFAULT_POMODORO;

  const [selectedMode, setSelectedMode] = useState<'stopwatch' | 'pomodoro'>('stopwatch');
  const mode = run.status !== 'idle' ? 'pomodoro' : selectedMode;
  const modeLocked = timer.status !== 'idle' || run.status !== 'idle';

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTask, setPickerTask] = useState<Task | undefined>(undefined);
  const [pickerNew, setPickerNew] = useState(false);
  const [pickerNewName, setPickerNewName] = useState('');
  const pickerReady = pickerNew ? pickerNewName.trim() !== '' : pickerTask !== undefined;

  const [sheetOpen, setSheetOpen] = useState(false);
  const [savingRun, setSavingRun] = useState(false);
  const [name, setName] = useState('');
  const [searchText, setSearchText] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | undefined>(undefined);
  const [selectedNewActivity, setSelectedNewActivity] = useState(false);
  const [confirmation, setConfirmation] = useState<{ clockJumpDetected: boolean } | null>(null);

  const trimmedName = name.trim();
  const matchedTask = useMemo(() => {
    if (!trimmedName) return undefined;
    return (tasks ?? []).find((task) => task.name.toLowerCase() === trimmedName.toLowerCase());
  }, [tasks, trimmedName]);

  const filteredTasks = useMemo(() => {
    const list = tasks ?? [];
    const query = searchText.trim().toLowerCase();
    if (!query) return list;
    return list.filter((task) => task.name.toLowerCase().includes(query));
  }, [tasks, searchText]);

  const runActivity = run.activity;
  const runActivityName = runActivity
    ? 'taskId' in runActivity
      ? tasks?.find((task) => task.id === runActivity.taskId)?.name
      : runActivity.newActivityName
    : undefined;

  const closePicker = () => {
    setPickerOpen(false);
    setPickerTask(undefined);
    setPickerNew(false);
    setPickerNewName('');
  };

  const startRun = () => {
    if (!pickerReady) return;
    run.start(
      pomodoroConfig,
      pickerNew ? { newActivityName: pickerNewName.trim() } : { taskId: (pickerTask as Task).id }
    );
    closePicker();
  };

  const resetRun = () => {
    if (!run.canFinish) {
      run.reset();
      return;
    }
    Alert.alert('Discard this Pomodoro run?', 'The work logged in this run will be lost.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: run.reset },
    ]);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setSavingRun(false);
    setName('');
    setSearchText('');
    setSelectedTask(undefined);
    setSelectedNewActivity(false);
  };

  const selectTask = (task: Task | undefined) => {
    setSelectedTask(task);
    setSelectedNewActivity(false);
  };

  const selectNewActivity = () => {
    setSelectedTask(undefined);
    setSelectedNewActivity(true);
  };

  const handleSaveRun = () => {
    const result = run.finish();
    const body: StopwatchSessionCreate = {
      name: trimmedName || runActivityName || defaultName(result.startUtc),
      duration: result.durationSeconds,
      start_time: result.startUtc,
      end_time: result.endUtc,
      ...(runActivity && 'taskId' in runActivity
        ? { task_id: runActivity.taskId }
        : runActivity
          ? { new_activity_name: runActivity.newActivityName }
          : {}),
      pomodoro_work_intervals: result.pomodoroWorkIntervals,
      pomodoro_breaks: result.pomodoroBreaks,
      pomodoro_break_seconds: result.pomodoroBreakSeconds,
    };
    createSession.mutate(body);
    closeSheet();
    setConfirmation({ clockJumpDetected: result.clockJumpDetected });
  };

  const handleSave = () => {
    if (savingRun) {
      handleSaveRun();
      return;
    }
    const result = timer.finish();
    const finalName = trimmedName || selectedTask?.name || defaultName(result.startUtc);
    const body: StopwatchSessionCreate = {
      name: finalName,
      duration: result.durationSeconds,
      start_time: result.startUtc,
      end_time: result.endUtc,
      ...(selectedNewActivity
        ? { new_activity_name: trimmedName }
        : selectedTask
          ? { task_id: selectedTask.id }
          : {}),
    };
    createSession.mutate(body);
    timer.reset();
    closeSheet();
    setConfirmation({ clockJumpDetected: result.clockJumpDetected });
  };

  return (
    <View style={styles.container}>
      <View style={styles.modeSwitch}>
        {(['stopwatch', 'pomodoro'] as const).map((option) => (
          <Pressable
            key={option}
            testID={`mode-${option}`}
            accessibilityRole="button"
            disabled={modeLocked}
            onPress={() => setSelectedMode(option)}
            style={[styles.modeOption, mode === option && styles.modeOptionActive]}
          >
            <Text style={styles.buttonLabel}>{option === 'stopwatch' ? 'Stopwatch' : 'Pomodoro'}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'pomodoro' && run.status !== 'idle' ? (
        <View style={styles.runView}>
          <Text testID="pomodoro-phase" style={styles.phaseLabel}>
            {PHASE_LABELS[run.phase]}
          </Text>
          <Text testID="pomodoro-phase-time" style={styles.elapsed}>
            {run.overMs > 0
              ? `+${formatElapsed(run.overMs)} over`
              : `${formatElapsed(Math.ceil(run.remainingMs / 1000) * 1000)} left`}
          </Text>
          <Text style={styles.textMuted}>
            {runActivityName ? `${runActivityName} · work ` : 'Work '}
            <Text testID="pomodoro-total-work">{formatElapsed(run.totalWorkMs)}</Text>
          </Text>
        </View>
      ) : mode === 'pomodoro' ? (
        <Text style={styles.elapsed}>{formatElapsed(pomodoroConfig.workMinutes * 60_000)}</Text>
      ) : (
        <Text style={styles.elapsed}>{formatElapsed(timer.elapsedMs)}</Text>
      )}

      {!sheetOpen && !pickerOpen && mode === 'pomodoro' && run.status !== 'idle' && (
        <View style={styles.controls}>
          {run.status === 'running' ? (
            <ActionButton testID="pomodoro-pause" label="Pause" onPress={run.pause} variant="muted" />
          ) : (
            <ActionButton testID="pomodoro-resume" label="Resume" onPress={run.resume} />
          )}
          <ActionButton
            testID="pomodoro-switch"
            label={run.phase === 'work' ? 'Start break' : 'Start work'}
            onPress={run.switchPhase}
          />
          <ActionButton
            testID="pomodoro-finish"
            label="Finish"
            onPress={() => {
              setSavingRun(true);
              setSheetOpen(true);
            }}
            disabled={!run.canFinish}
          />
          <ActionButton testID="pomodoro-reset" label="Reset" onPress={resetRun} variant="danger" />
        </View>
      )}

      {!sheetOpen && !pickerOpen && mode === 'pomodoro' && run.status === 'idle' && (
        <View style={styles.controls}>
          <ActionButton testID="btn-start" label="Start" onPress={() => setPickerOpen(true)} />
        </View>
      )}

      {!sheetOpen && mode === 'stopwatch' && (
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
        <GlassView glassEffectStyle="regular" testID="save-confirmation" style={styles.confirmation}>
          <Text style={styles.confirmationText}>
            {confirmation.clockJumpDetected
              ? 'Saved — the clock moved during this recording'
              : 'Saved'}
          </Text>
        </GlassView>
      )}

      {pickerOpen && (
        <View testID="pomodoro-picker" style={styles.sheet}>
          <Text style={styles.sheetTitle}>Choose an Activity</Text>
          <ScrollView style={styles.activityList}>
            {(tasks ?? []).map((task) => (
              <Pressable
                key={task.id}
                testID={`pomodoro-activity-${task.id}`}
                accessibilityRole="button"
                style={[styles.activityRow, !pickerNew && pickerTask?.id === task.id && styles.activityRowSelected]}
                onPress={() => {
                  setPickerTask(task);
                  setPickerNew(false);
                }}
              >
                <Text style={styles.activityLabel}>{task.name}</Text>
              </Pressable>
            ))}
            <Pressable
              testID="pomodoro-activity-new"
              accessibilityRole="button"
              style={[styles.activityRow, pickerNew && styles.activityRowSelected]}
              onPress={() => {
                setPickerTask(undefined);
                setPickerNew(true);
              }}
            >
              <Text style={styles.activityLabel}>+ New Activity</Text>
            </Pressable>
          </ScrollView>
          {pickerNew && (
            <TextInput
              testID="pomodoro-new-name"
              style={styles.input}
              placeholder="New Activity name"
              placeholderTextColor={colors.placeholder}
              value={pickerNewName}
              onChangeText={setPickerNewName}
            />
          )}
          <View style={styles.sheetActions}>
            <ActionButton testID="pomodoro-cancel" label="Cancel" onPress={closePicker} variant="muted" />
            <ActionButton testID="pomodoro-start" label="Start" onPress={startRun} disabled={!pickerReady} />
          </View>
        </View>
      )}

      {sheetOpen && savingRun && (
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Save Pomodoro run</Text>
          <TextInput
            testID="input-name"
            style={styles.input}
            placeholder={runActivityName ?? 'Name (optional)'}
            placeholderTextColor={colors.placeholder}
            value={name}
            onChangeText={setName}
          />
          <Text style={styles.activityLabel}>{`Activity: ${runActivityName ?? '—'}`}</Text>
          <View style={styles.sheetActions}>
            <ActionButton testID="btn-cancel" label="Cancel" onPress={closeSheet} variant="muted" />
            <ActionButton testID="btn-save-confirm" label="Save" onPress={handleSave} />
          </View>
        </View>
      )}

      {sheetOpen && !savingRun && (
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
              onPress={() => selectTask(undefined)}
            >
              <Text style={styles.activityLabel}>None</Text>
            </Pressable>
            {filteredTasks.map((task) => (
              <Pressable
                key={task.id}
                accessibilityRole="button"
                style={styles.activityRow}
                onPress={() => selectTask(task)}
              >
                <Text style={styles.activityLabel}>
                  {task === matchedTask ? `Attach to ${task.name}` : task.name}
                </Text>
              </Pressable>
            ))}
            {trimmedName && !matchedTask && (
              <Pressable
                testID="activity-new"
                accessibilityRole="button"
                style={styles.activityRow}
                onPress={selectNewActivity}
              >
                <Text style={styles.activityLabel}>{`+ New Activity: '${trimmedName}'`}</Text>
              </Pressable>
            )}
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
    backgroundColor: 'transparent',
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
  buttonDisabled: {
    opacity: 0.4,
  },
  modeSwitch: {
    flexDirection: 'row',
    borderRadius: radii.pill,
    backgroundColor: colors.glassInner,
    padding: spacing.xs,
  },
  modeOption: {
    minHeight: touchTarget,
    minWidth: touchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeOptionActive: {
    backgroundColor: colors.primary,
  },
  runView: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  phaseLabel: {
    ...typography.heading,
    color: colors.text,
  },
  textMuted: {
    ...typography.body,
    color: colors.textMuted,
  },
  activityRowSelected: {
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
