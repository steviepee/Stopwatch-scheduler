import TimerNative from '../../modules/timer-native/src/TimerNativeModule';

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

export async function requestNotificationPermission(): Promise<boolean> {
  return TimerNative ? TimerNative.requestNotificationPermissionAsync() : false;
}
