import { useEffect, useRef, useState } from 'react';
import { CoachConversationDetail, CoachConversationSummary, CoachNote, CoachUsage, PomodoroSettings, ReminderSettings, UserOptions } from '../types';
import { coachAPI, settingsAPI } from '../services/api';

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
  const [clock24h, setClock24h] = useState<boolean | null>(null);
  const [notesEnabled, setNotesEnabled] = useState<boolean | null>(null);
  const [notes, setNotes] = useState<CoachNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [editingNote, setEditingNote] = useState<{ id: number; text: string } | null>(null);
  const [reminders, setReminders] = useState<ReminderSettings | null>(null);
  const [reminderMinutes, setReminderMinutes] = useState('');
  const [usage, setUsage] = useState<CoachUsage | null>(null);
  const [conversations, setConversations] = useState<CoachConversationSummary[]>([]);
  const [detail, setDetail] = useState<CoachConversationDetail | null>(null);

  useEffect(() => {
    settingsAPI.getPomodoro()
      .then(data => {
        setPomodoro(toFields(data));
        setPomodoroStatus('loaded');
      })
      .catch(() => setPomodoroStatus('error'));
    settingsAPI.getDisplay().then(data => setClock24h(data.clock_24h)).catch(() => {});
    settingsAPI.getCoach().then(data => setNotesEnabled(data.notes_enabled)).catch(() => {});
    coachAPI.getNotes().then(setNotes).catch(() => {});
    settingsAPI.getReminders()
      .then(data => {
        setReminders(data);
        setReminderMinutes(String(data.minutes_before));
      })
      .catch(() => {});
    coachAPI.getUsage().then(setUsage).catch(() => {});
    coachAPI.getConversations().then(setConversations).catch(() => {});
  }, []);

  const toggleClock24h = async () => {
    if (clock24h === null) return;
    const saved = await settingsAPI.updateDisplay({ clock_24h: !clock24h });
    setClock24h(saved.clock_24h);
  };

  const toggleNotesEnabled = async () => {
    if (notesEnabled === null) return;
    const saved = await settingsAPI.updateCoach({ notes_enabled: !notesEnabled });
    setNotesEnabled(saved.notes_enabled);
  };

  const addNote = async () => {
    const text = newNote.trim();
    if (!text) return;
    const created = await coachAPI.createNote({ text });
    setNotes(prev => [...prev, created]);
    setNewNote('');
  };

  const saveNote = async () => {
    if (!editingNote || !editingNote.text.trim()) return;
    const saved = await coachAPI.updateNote(editingNote.id, { text: editingNote.text.trim() });
    setNotes(prev => prev.map(n => (n.id === saved.id ? saved : n)));
    setEditingNote(null);
  };

  const deleteNote = async (id: number) => {
    if (!window.confirm('Delete this Coach note?')) return;
    await coachAPI.deleteNote(id);
    setNotes(prev => prev.filter(n => n.id !== id));
  };

  const reminderMinutesValid = inRange(reminderMinutes, 120);

  const saveReminders = async (body: ReminderSettings) => {
    const saved = await settingsAPI.updateReminders(body);
    setReminders(saved);
    setReminderMinutes(String(saved.minutes_before));
  };

  const openConversation = async (id: number) => {
    setDetail(await coachAPI.getConversation(id));
  };

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

      {/* Clock */}
      <section className="space-y-3">
        <h3 className="text-white/60 text-xs uppercase tracking-wider">Clock</h3>
        <label className="flex items-center gap-3 cursor-pointer glass-inner rounded-xl px-4 py-3">
          <input
            type="checkbox"
            data-testid="toggle-clock-24h"
            checked={clock24h ?? false}
            disabled={clock24h === null}
            onChange={toggleClock24h}
            className="w-4 h-4 rounded accent-emerald-400"
          />
          <span className="text-white text-sm">Use 24-hour clock</span>
        </label>
      </section>

      {/* Coach notes */}
      <section className="space-y-3">
        <h3 className="text-white/60 text-xs uppercase tracking-wider">Coach notes</h3>
        <label className="flex items-center gap-3 cursor-pointer glass-inner rounded-xl px-4 py-3">
          <input
            type="checkbox"
            data-testid="toggle-coach-notes"
            checked={notesEnabled ?? false}
            disabled={notesEnabled === null}
            onChange={toggleNotesEnabled}
            className="w-4 h-4 rounded accent-emerald-400"
          />
          <span className="text-white text-sm">Let the Coach suggest and use notes</span>
        </label>
        <div className="space-y-2">
          {notes.map(note => (
            <div key={note.id} data-testid={`coach-note-${note.id}`} className="glass-inner rounded-xl px-4 py-3 flex items-center gap-3">
              {editingNote?.id === note.id ? (
                <>
                  <input
                    type="text"
                    data-testid={`input-note-${note.id}`}
                    value={editingNote.text}
                    maxLength={300}
                    onChange={e => setEditingNote({ id: note.id, text: e.target.value })}
                    className="flex-1 bg-white/10 text-white rounded-lg px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    data-testid={`btn-note-save-${note.id}`}
                    onClick={saveNote}
                    disabled={!editingNote.text.trim()}
                    className="glass-button px-3 py-1 rounded-lg text-xs disabled:opacity-40"
                  >
                    Save
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-white text-sm">{note.text}</span>
                  <button
                    type="button"
                    data-testid={`coach-note-edit-${note.id}`}
                    onClick={() => setEditingNote({ id: note.id, text: note.text })}
                    className="glass-button px-3 py-1 rounded-lg text-xs"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    data-testid={`coach-note-delete-${note.id}`}
                    onClick={() => deleteNote(note.id)}
                    className="text-red-400 hover:text-red-300 text-xs"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            data-testid="input-new-note"
            value={newNote}
            maxLength={300}
            onChange={e => setNewNote(e.target.value)}
            placeholder="A note for the Coach"
            className="flex-1 bg-white/10 text-white rounded-lg px-3 py-2 text-sm"
          />
          <button
            type="button"
            data-testid="btn-add-note"
            onClick={addNote}
            disabled={!newNote.trim()}
            className="glass-button px-4 py-2 rounded-xl text-sm disabled:opacity-40"
          >
            Add note
          </button>
        </div>
      </section>

      {/* Start reminders */}
      <section className="space-y-3">
        <h3 className="text-white/60 text-xs uppercase tracking-wider">Start reminders</h3>
        <label className="flex items-center gap-3 cursor-pointer glass-inner rounded-xl px-4 py-3">
          <input
            type="checkbox"
            data-testid="toggle-start-reminders"
            checked={reminders?.enabled ?? false}
            disabled={reminders === null}
            onChange={() => reminders && saveReminders({ enabled: !reminders.enabled, minutes_before: reminders.minutes_before })}
            className="w-4 h-4 rounded accent-emerald-400"
          />
          <span className="text-white text-sm">Remind me before each Block starts</span>
        </label>
        <label className="block glass-inner rounded-xl px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-white text-sm flex-1">Minutes before</span>
            <input
              data-testid="input-reminder-minutes"
              type="number"
              min={1}
              max={120}
              value={reminderMinutes}
              onChange={e => setReminderMinutes(e.target.value)}
              disabled={reminders === null}
              className="w-20 bg-white/10 text-white rounded-lg px-2 py-1 text-sm disabled:opacity-40"
            />
          </div>
          {reminders !== null && !reminderMinutesValid && (
            <div className="text-red-300 text-xs mt-1">1–120</div>
          )}
        </label>
        <p className="text-white/50 text-xs">Applies to Blocks pushed or changed from now on.</p>
        <button
          type="button"
          data-testid="reminders-save"
          onClick={() => reminders && saveReminders({ enabled: reminders.enabled, minutes_before: Number(reminderMinutes) })}
          disabled={reminders === null || !reminderMinutesValid}
          className="glass-button px-4 py-3 rounded-xl text-sm disabled:opacity-40"
        >
          Save
        </button>
      </section>

      {/* Coach usage */}
      <section className="space-y-3">
        <h3 className="text-white/60 text-xs uppercase tracking-wider">Coach usage</h3>
        {usage && (
          <p data-testid="usage-month" className="text-white text-sm">
            {usage.month}: {usage.conversations} conversations, {usage.accepted} accepted, ${usage.cost_usd.toFixed(2)}
          </p>
        )}
        <div className="space-y-2">
          {conversations.map(c => (
            <button
              key={c.id}
              type="button"
              data-testid={`usage-conversation-${c.id}`}
              onClick={() => openConversation(c.id)}
              className="w-full glass-inner rounded-xl px-4 py-3 flex justify-between text-white text-sm"
            >
              <span>{c.target_date}</span>
              <span className="text-white/70">{c.status}</span>
              <span>${c.cost_usd.toFixed(2)}</span>
            </button>
          ))}
        </div>
        {detail && (
          <div data-testid="usage-detail" className="glass-inner rounded-xl p-4 space-y-3 text-white text-sm">
            <div className="flex justify-between items-center">
              <span className="font-medium">{detail.target_date} ({detail.status})</span>
              <button type="button" onClick={() => setDetail(null)} className="text-white/60 hover:text-white">✕</button>
            </div>
            <div className="space-y-2">
              {detail.messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                  <span className="text-white/50 text-xs block">{m.role === 'user' ? 'You' : 'Coach'}</span>
                  <span>{m.visible_text}</span>
                </div>
              ))}
            </div>
            {detail.proposal?.summary && <p className="text-white/80">Proposal: {detail.proposal.summary}</p>}
            <table className="w-full text-xs">
              <thead className="text-white/50">
                <tr>
                  <th className="text-left">#</th>
                  <th className="text-right">In</th>
                  <th className="text-right">Out</th>
                  <th className="text-right">Cache read</th>
                  <th className="text-right">Cache write</th>
                  <th className="text-right">Latency</th>
                  <th className="text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {detail.calls.map((call, i) => (
                  <tr key={i} data-testid={`usage-call-${i}`}>
                    <td>{call.turn_index}</td>
                    <td className="text-right">{call.input_tokens}</td>
                    <td className="text-right">{call.output_tokens}</td>
                    <td className="text-right">{call.cache_read_input_tokens ?? 0}</td>
                    <td className="text-right">{call.cache_creation_input_tokens ?? 0}</td>
                    <td className="text-right">{call.latency_ms} ms</td>
                    <td className="text-right">${call.cost_usd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
