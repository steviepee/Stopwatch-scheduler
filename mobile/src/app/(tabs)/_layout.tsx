import { Link } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, spacing, touchTarget, typography } from '@/theme/tokens';

function SettingsButton() {
  return (
    <Link href="/settings" asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Settings"
        style={styles.settingsButton}>
        <Text style={styles.settingsIcon}>⚙</Text>
      </Pressable>
    </Link>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerRight: () => <SettingsButton />,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.glassBorder },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
      }}>
      <Tabs.Screen name="index" options={{ title: 'Stopwatch' }} />
      <Tabs.Screen name="activities" options={{ title: 'Activities' }} />
      <Tabs.Screen name="recordings" options={{ title: 'Recordings' }} />
      <Tabs.Screen name="schedule" options={{ title: 'Schedule' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  settingsButton: {
    minWidth: touchTarget,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  settingsIcon: {
    ...typography.heading,
    color: colors.text,
  },
});
