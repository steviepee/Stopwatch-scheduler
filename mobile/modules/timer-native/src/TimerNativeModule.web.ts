import { registerWebModule, NativeModule } from 'expo';

class TimerNativeModule extends NativeModule<{}> {
  hello() {
    return 'Hello world! 👋';
  }

  async setValueAsync(value: string): Promise<void> {}
}

export default registerWebModule(TimerNativeModule, 'TimerNativeModule');
