import { NativeModule, requireNativeModule } from 'expo';

declare class TimerNativeModule extends NativeModule<{}> {
  hello(): string;
  setValueAsync(value: string): Promise<void>;
}

export default requireNativeModule<TimerNativeModule>('TimerNative');
