from datetime import datetime


def _add_session(db, name, duration, start_time=None, created_at=None):
    from app.models.stopwatch_session import StopwatchSession
    s = StopwatchSession(
        name=name,
        duration=duration,
        start_time=start_time,
        created_at=created_at or datetime(2026, 9, 2, 12, 0, 0),
    )
    db.add(s)
    db.commit()
    return s


def _add_task(db):
    from app.models.task import Task
    t = Task(name='Work')
    db.add(t)
    db.commit()
    return t


def _add_timelog(db, task_id, duration, created_at):
    from app.models.time_log import TimeLog
    tl = TimeLog(task_id=task_id, duration=duration, created_at=created_at)
    db.add(tl)
    db.commit()
    return tl


def test_empty_db(client):
    resp = client.get('/api/insights/peak-hours')
    assert resp.status_code == 200
    data = resp.json()
    assert data['total_seconds'] == 0
    assert data['peak_hour'] is None
    assert len(data['hours']) == 24
    assert all(h['seconds'] == 0 and h['count'] == 0 for h in data['hours'])


def test_session_spans_hour_boundary(client, db):
    _add_session(db, 'Work', 3600, start_time=datetime(2026, 9, 2, 9, 30, 0))
    resp = client.get('/api/insights/peak-hours?tz_offset=0')
    assert resp.status_code == 200
    data = resp.json()
    hours = {h['hour']: h for h in data['hours']}
    assert abs(hours[9]['seconds'] - 1800) < 0.01
    assert abs(hours[10]['seconds'] - 1800) < 0.01
    assert hours[9]['count'] == 1
    assert hours[10]['count'] == 1
    assert abs(data['total_seconds'] - 3600) < 0.01
    assert data['peak_hour'] == 9


def test_tz_offset_shifts_hours(client, db):
    _add_session(db, 'Work', 3600, start_time=datetime(2026, 9, 2, 9, 30, 0))
    resp = client.get('/api/insights/peak-hours?tz_offset=60')
    data = resp.json()
    hours = {h['hour']: h for h in data['hours']}
    assert abs(hours[8]['seconds'] - 1800) < 0.01
    assert abs(hours[9]['seconds'] - 1800) < 0.01
    assert hours[10]['count'] == 0


def test_no_start_time_uses_created_at(client, db):
    _add_session(db, 'Work', 3600, created_at=datetime(2026, 9, 2, 10, 30, 0))
    resp = client.get('/api/insights/peak-hours?tz_offset=0')
    data = resp.json()
    hours = {h['hour']: h for h in data['hours']}
    assert abs(hours[9]['seconds'] - 1800) < 0.01
    assert abs(hours[10]['seconds'] - 1800) < 0.01


def test_timelog_distributes_correctly(client, db):
    task = _add_task(db)
    _add_timelog(db, task.id, 1800, created_at=datetime(2026, 9, 2, 11, 0, 0))
    resp = client.get('/api/insights/peak-hours?tz_offset=0')
    data = resp.json()
    hours = {h['hour']: h for h in data['hours']}
    assert abs(hours[10]['seconds'] - 1800) < 0.01
    assert hours[10]['count'] == 1
    assert hours[11]['seconds'] == 0
    assert abs(data['total_seconds'] - 1800) < 0.01
    assert data['peak_hour'] == 10


def test_peak_hour_highest_seconds(client, db):
    # A: 600s in h9; B: 3700s => 3600 in h14, 100 in h15 => h14 wins
    _add_session(db, 'A', 600, start_time=datetime(2026, 9, 2, 9, 0, 0))
    _add_session(db, 'B', 3700, start_time=datetime(2026, 9, 2, 14, 0, 0))
    resp = client.get('/api/insights/peak-hours?tz_offset=0')
    data = resp.json()
    assert data['peak_hour'] == 14
