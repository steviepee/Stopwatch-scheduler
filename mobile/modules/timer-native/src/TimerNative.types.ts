export type TimerNativeAction = {
  action: 'pause' | 'resume' | 'switch';
  atElapsedMs: number;
};

export type TimerNative = {
  elapsedRealtime(): number;
  startForegroundService(startedAtElapsedMs: number): void;
  stopForegroundService(): void;
  requestNotificationPermissionAsync(): Promise<boolean>;
  drainActions?(): TimerNativeAction[];
  notifyPhaseDue?(phase: string): void;
};
