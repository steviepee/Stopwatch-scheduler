import TimerNative from '../../modules/timer-native/src/TimerNativeModule';
import type {
  TimerNativeAction,
  TimerNativeSubscription,
  TimerServiceOptions,
} from '../../modules/timer-native/src/TimerNative.types';

export function isNativeAvailable(): boolean {
  return TimerNative != null;
}

export function elapsedRealtime(): number {
  return TimerNative ? TimerNative.elapsedRealtime() : Date.now();
}

export async function startForegroundService(
  startedAtElapsedMs: number,
  options?: TimerServiceOptions
): Promise<void> {
  if (options === undefined) {
    TimerNative?.startForegroundService(startedAtElapsedMs);
  } else {
    TimerNative?.startForegroundService(startedAtElapsedMs, options);
  }
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

export function addTimerActionListener(listener: () => void): TimerNativeSubscription {
  return TimerNative?.addListener?.('onTimerAction', listener) ?? { remove: () => {} };
}

export async function requestNotificationPermission(): Promise<boolean> {
  return TimerNative ? TimerNative.requestNotificationPermissionAsync() : false;
}
