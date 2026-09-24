import { Link } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, spacing, touchTarget, typography } from '@/theme/tokens';

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <Text style={[styles.tabIcon, !focused && styles.tabIconInactive]}>{glyph}</Text>;
}

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
        sceneStyle: { backgroundColor: 'transparent' },
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.glassBorder },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Stopwatch',
          tabBarIcon: ({ focused }) => <TabIcon glyph="⏱️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="activities"
        options={{
          title: 'Activities',
          tabBarIcon: ({ focused }) => <TabIcon glyph="📋" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="recordings"
        options={{
          title: 'Recordings',
          tabBarIcon: ({ focused }) => <TabIcon glyph="⏺️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'Schedule',
          tabBarIcon: ({ focused }) => <TabIcon glyph="📝" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Calendar',
          tabBarIcon: ({ focused }) => <TabIcon glyph="📅" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  settingsButton: {
    minWidth: touchTarget,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: __DEV__ ? spacing.xxl : spacing.xs,
  },
  settingsIcon: {
    ...typography.heading,
    color: colors.text,
  },
  tabIcon: {
    fontSize: 20,
    lineHeight: 24,
  },
  tabIconInactive: {
    opacity: 0.5,
  },
});
