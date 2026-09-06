import { TimerNative } from './TimerNative.types';

const TimerNativeModule: TimerNative = {
  elapsedRealtime: () => Date.now(),
  startForegroundService: () => {},
  stopForegroundService: () => {},
  requestNotificationPermissionAsync: async () => false,
};

export default TimerNativeModule;
