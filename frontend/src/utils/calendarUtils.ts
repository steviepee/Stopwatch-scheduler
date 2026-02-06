// Calendar utility functions

/**
 * Get an array of 7 days for the week containing the given date
 */
export function getWeekDays(date: Date): Date[] {
  const days: Date[] = [];
  const startOfWeek = new Date(date);
  const day = startOfWeek.getDay();
  startOfWeek.setDate(startOfWeek.getDate() - day); // Start from Sunday

  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(startOfWeek);
    dayDate.setDate(startOfWeek.getDate() + i);
    days.push(dayDate);
  }

  return days;
}

/**
 * Generate time slots for a calendar grid
 */
export function getTimeSlots(startHour: number, endHour: number, intervalMin: number): string[] {
  const slots: string[] = [];

  for (let hour = startHour; hour <= endHour; hour++) {
    for (let min = 0; min < 60; min += intervalMin) {
      if (hour === endHour && min > 0) break;
      const time = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
      slots.push(time);
    }
  }

  return slots;
}

/**
 * Convert a time to Y pixel position on the grid
 */
export function positionFromTime(time: Date, startHour: number, slotHeight: number, intervalMin: number): number {
  const hours = time.getHours();
  const minutes = time.getMinutes();
  const totalMinutes = (hours - startHour) * 60 + minutes;
  return (totalMinutes / intervalMin) * slotHeight;
}

/**
 * Convert a Y pixel position to time
 */
export function timeFromPosition(y: number, date: Date, startHour: number, slotHeight: number, intervalMin: number): Date {
  const totalMinutes = (y / slotHeight) * intervalMin;
  const hours = Math.floor(totalMinutes / 60) + startHour;
  const minutes = Math.floor(totalMinutes % 60);

  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/**
 * Snap time to nearest slot boundary
 */
export function snapToSlot(time: Date, intervalMin: number): Date {
  const result = new Date(time);
  const minutes = result.getMinutes();
  const snappedMinutes = Math.round(minutes / intervalMin) * intervalMin;
  result.setMinutes(snappedMinutes, 0, 0);
  return result;
}

/**
 * Format hour as "9 AM", "2 PM", etc.
 */
export function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

/**
 * Format duration in seconds to human readable string
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

/**
 * Calculate height in pixels for a duration
 */
export function heightFromDuration(durationSeconds: number, slotHeight: number, intervalMin: number): number {
  const durationMinutes = durationSeconds / 60;
  return (durationMinutes / intervalMin) * slotHeight;
}

/**
 * Check if two dates are the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Format date as "Mon 5", "Tue 6", etc.
 */
export function formatDayShort(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[date.getDay()]} ${date.getDate()}`;
}

/**
 * Format date as "Monday, February 5"
 */
export function formatDayLong(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Get start of day for a date
 */
export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Navigate to previous week
 */
export function previousWeek(date: Date): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - 7);
  return result;
}

/**
 * Navigate to next week
 */
export function nextWeek(date: Date): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + 7);
  return result;
}

/**
 * Navigate to previous day
 */
export function previousDay(date: Date): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - 1);
  return result;
}

/**
 * Navigate to next day
 */
export function nextDay(date: Date): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + 1);
  return result;
}
