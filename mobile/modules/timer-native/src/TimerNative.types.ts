export type TimerNative = {
  elapsedRealtime(): number;
  startForegroundService(startedAtElapsedMs: number): void;
  stopForegroundService(): void;
  requestNotificationPermissionAsync(): Promise<boolean>;
};
