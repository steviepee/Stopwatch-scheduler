import { requireOptionalNativeModule } from 'expo';

import { TimerNative } from './TimerNative.types';

export default requireOptionalNativeModule<TimerNative>('TimerNative');
