import TimerNative from '../../modules/timer-native/src/TimerNativeModule';
import type { TimerNativeAction } from '../../modules/timer-native/src/TimerNative.types';

export function isNativeAvailable(): boolean {
  return TimerNative != null;
}

export function elapsedRealtime(): number {
  return TimerNative ? TimerNative.elapsedRealtime() : Date.now();
}

export async function startForegroundService(startedAtElapsedMs: number): Promise<void> {
  TimerNative?.startForegroundService(startedAtElapsedMs);
}

export async function stopForegroundService(): Promise<void> {
  TimerNative?.stopForegroundService();
}

export function drainActions(): TimerNativeAction[] {
  return TimerNative?.drainActions?.() ?? [];
}

export function notifyPhaseDue(phase: string): void {
  TimerNative?.notifyPhaseDue?.(phase);
}

export async function requestNotificationPermission(): Promise<boolean> {
  return TimerNative ? TimerNative.requestNotificationPermissionAsync() : false;
}
