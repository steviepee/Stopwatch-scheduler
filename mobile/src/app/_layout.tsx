import { Image } from 'expo-image';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { persister, queryClient } from '@/services/queryClient';
import { colors } from '@/theme/tokens';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Image
        source={require('../../assets/cloth_mural.jpg')}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} />
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister, buster: 'v2-no-optimistic-sessions' }}
        onSuccess={() => queryClient.resumePausedMutations()}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: 'transparent' },
          }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="activity/[id]"
            options={{
              headerShown: true,
              title: 'Activity',
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.text,
            }}
          />
          <Stack.Screen
            name="settings"
            options={{
              headerShown: true,
              title: 'Settings',
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.text,
            }}
          />
        </Stack>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}
