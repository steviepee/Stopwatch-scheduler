import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'api_token';
const API_URL_KEY = 'api_url';

export const getToken = async (): Promise<string | null> => {
  return SecureStore.getItemAsync(TOKEN_KEY);
};

export const setToken = async (token: string): Promise<void> => {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
};

export const getApiUrl = async (): Promise<string> => {
  const stored = await SecureStore.getItemAsync(API_URL_KEY);
  return stored ?? process.env.EXPO_PUBLIC_API_URL ?? '';
};

export const setApiUrl = async (url: string): Promise<void> => {
  await SecureStore.setItemAsync(API_URL_KEY, url);
};
