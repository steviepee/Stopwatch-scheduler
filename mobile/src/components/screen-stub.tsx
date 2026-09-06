import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme/tokens';

export function ScreenStub({ title }: { title: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
});
