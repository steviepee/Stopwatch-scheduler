import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const USER_OPTIONS_KEY = 'userOptions';

export interface UserOptions {
  showAverage: boolean;
  showMedian: boolean;
  showPrevious: boolean;
}

export const DEFAULT_USER_OPTIONS: UserOptions = {
  showAverage: true,
  showMedian: false,
  showPrevious: false,
};

export async function getUserOptions(): Promise<UserOptions> {
  const raw = await AsyncStorage.getItem(USER_OPTIONS_KEY);
  if (!raw) return DEFAULT_USER_OPTIONS;
  return { ...DEFAULT_USER_OPTIONS, ...JSON.parse(raw) };
}

export async function setUserOptions(options: UserOptions): Promise<void> {
  await AsyncStorage.setItem(USER_OPTIONS_KEY, JSON.stringify(options));
}

export function useUserOptions(): UserOptions {
  const [options, setOptions] = useState<UserOptions>(DEFAULT_USER_OPTIONS);

  useEffect(() => {
    getUserOptions().then(setOptions);
  }, []);

  return options;
}
