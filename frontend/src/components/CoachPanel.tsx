import { useEffect, useMemo, useRef, useState } from 'react';
import { coachAPI, scheduleAPI } from '../services/api';
import { formatClock, useClock24h } from '../utils/formatClock';
import type { CoachConversation, CoachProposalItem, Schedule, Task } from '../types';

interface CoachPanelProps {
  date: string;
  tasks: Task[];
  onClose: () => void;
  onAccepted: () => void;
}

const SOURCE_LABELS: Record<CoachProposalItem['source'], string> = {
  you_said: 'You said',
  history: 'Your history',
  guess: "Coach's guess",
};

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

export function CoachPanel({ date, tasks, onClose, onAccepted }: CoachPanelProps) {
  const clock24h = useClock24h();
  const [conversation, setConversation] = useState<CoachConversation | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [noteSuggestion, setNoteSuggestion] = useState<string | null>(null);
  const [showWhereFrom, setShowWhereFrom] = useState(false);
  const [accepted, setAccepted] = useState<Schedule | null>(null);
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [thinking, setThinking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pushed, setPushed] = useState(false);
  const opened = useRef(false);

  function show(next: CoachConversation) {
    setConversation(next);
    setNoteSuggestion(next.note_suggestion);
    setError(null);
  }

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    coachAPI
      .openConversation({ target_date: date, tz_offset: new Date().getTimezoneOffset() })
      .then(show)
      .catch((err) => setError(errorDetail(err)))
      .finally(() => setThinking(false));
  }, [date]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(errorDetail(err));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const message = text.trim();
    if (!message || !conversation) return;
    setError(null);
    setThinking(true);
    try {
      show(await coachAPI.sendMessage(conversation.id, { text: message }));
      setText('');
    } catch (err) {
      setError(errorDetail(err));
    } finally {
      setThinking(false);
    }
  }

  const accept = () =>
    run(async () => {
      setAccepted(await coachAPI.accept(conversation!.id));
      setError(null);
      onAccepted();
    });

  const reject = () =>
    run(async () => {
      await coachAPI.reject(conversation!.id);
      onClose();
    });

  const startOver = () => {
    if (!window.confirm('Start over? This conversation ends and a new one starts for this date.')) return;
    run(async () => {
      show(await coachAPI.startOver(conversation!.id));
      setText('');
      setShowWhereFrom(false);
    });
  };

  const pushDay = () =>
    run(async () => {
      await scheduleAPI.pushToCalendar(accepted!.id);
      setPushed(true);
    });

  const rate = (value: 'up' | 'down') =>
    run(async () => {
      await coachAPI.rate(conversation!.id, { rating: value });
      setRating(value);
    });

  function answerNote(save: boolean) {
    if (save && noteSuggestion) {
      coachAPI.createNote({ text: noteSuggestion }).catch((err) => setError(errorDetail(err)));
    }
    setNoteSuggestion(null);
  }

  const proposal = conversation?.proposal ?? null;
  const closed = accepted !== null;

  function activityName(item: CoachProposalItem): string {
    if (item.task_id === null) return item.new_activity_name ?? '';
    return tasks.find((task) => task.id === item.task_id)?.name ?? '';
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

  return (
    <div className="coach-panel" data-testid="coach-panel">
      <div className="coach-header">
        <h2>{`Plan ${date}`}</h2>
        {conversation && !closed && (
          <button className="glass-button" data-testid="btn-start-over" disabled={busy} onClick={startOver}>
            Start over
          </button>
        )}
        <button className="glass-button" data-testid="btn-coach-close" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="coach-scroll">
        {conversation?.messages.map((message, index) => (
          <div
            key={index}
            data-testid={`coach-message-${index}`}
            className={`coach-message ${message.role === 'user' ? 'coach-message-user' : 'coach-message-coach'}`}
          >
            {message.visible_text}
          </div>
        ))}

        {thinking && (
          <div className="coach-muted" data-testid="coach-thinking">
            Coach is thinking…
          </div>
        )}

        {noteSuggestion && (
          <div className="coach-card" data-testid="coach-note-suggestion">
            <strong>Save this note?</strong>
            <div>{noteSuggestion}</div>
            <div className="coach-row">
              <button className="glass-button" data-testid="btn-note-yes" onClick={() => answerNote(true)}>
                Yes
              </button>
              <button className="glass-button" data-testid="btn-note-no" onClick={() => answerNote(false)}>
                No
              </button>
            </div>
          </div>
        )}

        {conversation && proposal && (
          <div className="coach-card">
            <button className="coach-link" data-testid="btn-where-from" onClick={() => setShowWhereFrom((v) => !v)}>
              Where this came from
            </button>

            {showWhereFrom && (
              <div className="coach-where-from" data-testid="where-from-list">
                {proposal.items.map((item, index) => (
                  <div key={index} className="coach-where-from-row" data-testid={`where-from-${index}`}>
                    <strong>{activityName(item)}</strong>
                    <div className="coach-muted">{SOURCE_LABELS[item.source]}</div>
                    <div>{item.reason}</div>
                    {item.task_id !== null && (
                      <div className="coach-muted">
                        {item.recording_count} Recordings, typical {Math.round((item.typical_seconds ?? 0) / 60)} min
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {allDay.length > 0 && (
              <div className="coach-muted" data-testid="coach-all-day">
                All day: {allDay.map((item) => item.name).join(', ')}
              </div>
            )}

            {rows.map((row) =>
              row.kind === 'day' ? (
                <div
                  key={`day-${row.index}`}
                  data-testid={`day-item-${row.index}`}
                  className={`coach-day-row ${row.onGoogle ? 'coach-row-google' : 'coach-row-block'}`}
                >
                  <span className="coach-row-time">{formatClock(row.time, clock24h)}</span>
                  <span>{row.name}</span>
                </div>
              ) : (
                <div
                  key={`proposal-${row.index}`}
                  data-testid={`proposal-item-${row.index}`}
                  className="coach-day-row coach-row-proposal"
                >
                  <span className="coach-row-time">{formatClock(row.time, clock24h)}</span>
                  <span>{activityName(row.item)}</span>
                  <span className="coach-muted">{row.item.duration_minutes} min</span>
                  {row.item.is_frog && (
                    <span data-testid={`proposal-frog-${row.index}`} aria-label="Frog">
                      🐸
                    </span>
                  )}
                  {row.item.task_id === null && (
                    <span className="coach-new-tag" data-testid={`proposal-new-${row.index}`}>
                      New
                    </span>
                  )}
                </div>
              )
            )}

            {!closed && (
              <div className="coach-row">
                <button className="glass-button-primary" data-testid="btn-accept" disabled={busy} onClick={accept}>
                  Accept
                </button>
                <button className="glass-button" data-testid="btn-reject" disabled={busy} onClick={reject}>
                  Reject
                </button>
              </div>
            )}
          </div>
        )}

        {accepted && (
          <div className="coach-card" data-testid="coach-accepted">
            <strong>The plan is on your calendar.</strong>
            <div className="coach-row">
              <button
                className="glass-button"
                data-testid="btn-coach-push-day"
                disabled={busy || pushed}
                onClick={pushDay}
              >
                {pushed ? 'Pushed' : 'Push day'}
              </button>
              <button
                className={rating === 'up' ? 'glass-button-primary' : 'glass-button'}
                data-testid="btn-rate-up"
                aria-label="Thumbs up"
                onClick={() => rate('up')}
              >
                👍
              </button>
              <button
                className={rating === 'down' ? 'glass-button-primary' : 'glass-button'}
                data-testid="btn-rate-down"
                aria-label="Thumbs down"
                onClick={() => rate('down')}
              >
                👎
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="coach-error" data-testid="coach-error" role="alert">
            {error}
          </div>
        )}
      </div>

      {!closed && (
        <div className="coach-input-area">
          {proposal && conversation?.changes_left !== null && (
            <div className="coach-muted" data-testid="coach-limits">
              {conversation?.changes_left} plan changes left, {conversation?.messages_left} messages left
            </div>
          )}
          <form
            className="coach-row"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              className="glass-input coach-input"
              data-testid="coach-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={thinking || conversation === null}
              placeholder="Message the Coach"
              maxLength={2000}
            />
            <button
              type="submit"
              className="glass-button-primary"
              data-testid="coach-send"
              disabled={thinking || !conversation || !text.trim()}
            >
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
