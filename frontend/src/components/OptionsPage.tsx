import { useEffect, useRef, useState } from 'react';
import { PomodoroSettings, UserOptions } from '../types';
import { settingsAPI } from '../services/api';

interface OptionsPageProps {
  options: UserOptions;
  onChange: (opts: UserOptions) => void;
  onSignOut?: () => void;
}

const BACKGROUND_PRESETS = [
  { label: 'Cloth Mural (default)', value: '/cloth_mural.jpg' },
  { label: 'None (solid dark)', value: null },
];

type PomodoroKey = keyof PomodoroSettings;

const POMODORO_DEFAULTS: PomodoroSettings = {
  work_minutes: 25,
  break_minutes: 5,
  long_break_minutes: 15,
  long_break_every: 4,
};

const POMODORO_FIELDS: { key: PomodoroKey; label: string; testId: string; max: number }[] = [
  { key: 'work_minutes', label: 'Work (minutes)', testId: 'pomodoro-work', max: 180 },
  { key: 'break_minutes', label: 'Break (minutes)', testId: 'pomodoro-break', max: 180 },
  { key: 'long_break_minutes', label: 'Long break (minutes)', testId: 'pomodoro-long-break', max: 180 },
  { key: 'long_break_every', label: 'Long break every', testId: 'pomodoro-long-every', max: 12 },
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

export default function OptionsPage({ options, onChange, onSignOut }: OptionsPageProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pomodoro, setPomodoro] = useState(toFields(POMODORO_DEFAULTS));
  const [pomodoroStatus, setPomodoroStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [pomodoroSaving, setPomodoroSaving] = useState(false);
  const [pomodoroSaveFailed, setPomodoroSaveFailed] = useState(false);

  useEffect(() => {
    settingsAPI.getPomodoro()
      .then(data => {
        setPomodoro(toFields(data));
        setPomodoroStatus('loaded');
      })
      .catch(() => setPomodoroStatus('error'));
  }, []);

  const pomodoroValid = POMODORO_FIELDS.every(f => inRange(pomodoro[f.key], f.max));
  const pomodoroSaveDisabled = pomodoroStatus !== 'loaded' || !pomodoroValid || pomodoroSaving;

  const savePomodoro = async () => {
    setPomodoroSaving(true);
    try {
      const saved = await settingsAPI.updatePomodoro({
        work_minutes: Number(pomodoro.work_minutes),
        break_minutes: Number(pomodoro.break_minutes),
        long_break_minutes: Number(pomodoro.long_break_minutes),
        long_break_every: Number(pomodoro.long_break_every),
      });
      setPomodoro(toFields(saved));
      setPomodoroSaveFailed(false);
    } catch {
      setPomodoroSaveFailed(true);
    } finally {
      setPomodoroSaving(false);
    }
  };

  const toggle = (key: keyof Pick<UserOptions, 'showAverage' | 'showMedian' | 'showPrevious'>) => {
    onChange({ ...options, [key]: !options[key] });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    onChange({ ...options, backgroundImage: url });
  };

  return (
    <div className="glass-card rounded-2xl p-6 space-y-8 max-w-xl">
      <h2 className="text-xl font-bold text-white">Options</h2>

      {/* Duration metrics */}
      <section className="space-y-3">
        <h3 className="text-white/60 text-xs uppercase tracking-wider">Duration Metrics</h3>
        <p className="text-white/50 text-xs">
          Choose which metrics appear when adding activities to a schedule. The first enabled metric (Previous → Median → Average) is used to pre-fill the estimated duration.
        </p>
        <div className="space-y-2">
          {[
            { key: 'showAverage' as const, label: 'Average', description: 'Mean across all recordings' },
            { key: 'showMedian' as const, label: 'Median', description: 'Middle value of all recordings' },
            { key: 'showPrevious' as const, label: 'Previous', description: 'Duration from your last recording' },
          ].map(({ key, label, description }) => (
            <label
              key={key}
              className="flex items-center gap-3 cursor-pointer glass-inner rounded-xl px-4 py-3"
            >
              <input
                type="checkbox"
                checked={options[key]}
                onChange={() => toggle(key)}
                className="w-4 h-4 rounded accent-emerald-400"
              />
              <div>
                <div className="text-white text-sm font-medium">{label}</div>
                <div className="text-white/50 text-xs">{description}</div>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* Background image */}
      <section className="space-y-3">
        <h3 className="text-white/60 text-xs uppercase tracking-wider">Background Image</h3>
        <div className="space-y-2">
          {BACKGROUND_PRESETS.map(preset => (
            <label
              key={preset.label}
              className="flex items-center gap-3 cursor-pointer glass-inner rounded-xl px-4 py-3"
            >
              <input
                type="radio"
                name="bg"
                checked={options.backgroundImage === preset.value}
                onChange={() => onChange({ ...options, backgroundImage: preset.value })}
                className="accent-emerald-400"
              />
              <span className="text-white text-sm">{preset.label}</span>
            </label>
          ))}

          <label className="flex items-center gap-3 cursor-pointer glass-inner rounded-xl px-4 py-3">
            <input
              type="radio"
              name="bg"
              checked={
                options.backgroundImage !== null &&
                !BACKGROUND_PRESETS.some(p => p.value === options.backgroundImage)
              }
              onChange={() => fileRef.current?.click()}
              className="accent-emerald-400"
            />
            <span className="text-white text-sm">Custom image</span>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="ml-auto glass-button px-3 py-1 rounded-lg text-xs"
            >
              Upload
            </button>
          </label>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />

          {options.backgroundImage &&
            !BACKGROUND_PRESETS.some(p => p.value === options.backgroundImage) && (
              <div className="px-4">
                <img
                  src={options.backgroundImage}
                  alt="Preview"
                  className="w-full h-24 object-cover rounded-xl opacity-70"
                />
              </div>
            )}
        </div>
      </section>

      {/* Pomodoro lengths */}
      <section className="space-y-3">
        <h3 className="text-white/60 text-xs uppercase tracking-wider">Pomodoro</h3>
        {pomodoroStatus === 'error' && <p className="text-white/50 text-xs">Couldn't load</p>}
        <div className="space-y-2">
          {POMODORO_FIELDS.map(f => (
            <label key={f.key} className="block glass-inner rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-white text-sm flex-1">{f.label}</span>
                <input
                  data-testid={f.testId}
                  type="number"
                  min={1}
                  max={f.max}
                  value={pomodoro[f.key]}
                  onChange={e => {
                    const value = e.target.value;
                    setPomodoro(prev => ({ ...prev, [f.key]: value }));
                  }}
                  disabled={pomodoroStatus !== 'loaded'}
                  className="w-20 bg-white/10 text-white rounded-lg px-2 py-1 text-sm disabled:opacity-40"
                />
              </div>
              {!inRange(pomodoro[f.key], f.max) && (
                <div className="text-red-300 text-xs mt-1">{`1–${f.max}`}</div>
              )}
            </label>
          ))}
        </div>
        {pomodoroSaveFailed && <p className="text-red-300 text-xs">Couldn't save</p>}
        <button
          type="button"
          data-testid="pomodoro-save"
          onClick={savePomodoro}
          disabled={pomodoroSaveDisabled}
          className="glass-button px-4 py-3 rounded-xl text-sm disabled:opacity-40"
        >
          Save
        </button>
      </section>

      {onSignOut && (
        <section className="space-y-3">
          <h3 className="text-white/60 text-xs uppercase tracking-wider">Account</h3>
          <button
            type="button"
            onClick={onSignOut}
            className="glass-button px-4 py-3 rounded-xl text-sm"
          >
            Sign out
          </button>
        </section>
      )}
    </div>
  );
}
