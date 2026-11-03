export type TimerNativeAction = {
  action: 'pause' | 'resume' | 'switch';
  atElapsedMs: number;
};

export type TimerServiceOptions = {
  paused?: boolean;
  pomodoro?: {
    phase: 'work' | 'break' | 'longBreak';
    phaseStartedAtElapsedMs: number;
    phaseAccumulatedMs: number;
    targetMs: number;
  };
};

export type TimerNativeSubscription = { remove(): void };

export type TimerNative = {
  elapsedRealtime(): number;
  startForegroundService(startedAtElapsedMs: number, options?: TimerServiceOptions): void;
  stopForegroundService(): void;
  requestNotificationPermissionAsync(): Promise<boolean>;
  drainActions?(): TimerNativeAction[];
  notifyPhaseDue?(phase: string): void;
  addListener?(eventName: 'onTimerAction', listener: () => void): TimerNativeSubscription;
};
