def add_recording(task, duration: float) -> None:
    total = task.average_duration * task.total_recordings
    task.total_recordings += 1
    task.average_duration = (total + duration) / task.total_recordings


def remove_recording(task, duration: float) -> None:
    if task.total_recordings > 1:
        total = task.average_duration * task.total_recordings
        task.total_recordings -= 1
        task.average_duration = (total - duration) / task.total_recordings
    else:
        task.total_recordings = 0
        task.average_duration = 0.0
