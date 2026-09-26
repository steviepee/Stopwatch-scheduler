import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';

// On Android the picker is a dialog that opens as soon as it mounts, so it is
// mounted only after the field is tapped. Dismissing it reports the original
// value with type 'dismissed', which must not count as a choice.
export function PickerField({
  testID,
  label,
  value,
  mode,
  onChange,
}: {
  testID: string;
  label: string;
  value: Date;
  mode: 'date' | 'time';
  onChange: (date: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        testID={`${testID}-open`}
        accessibilityRole="button"
        style={styles.field}
        onPress={() => setOpen(true)}>
        <Text style={styles.label}>{label}</Text>
      </Pressable>
      {open && (
        <DateTimePicker
          testID={testID}
          value={value}
          mode={mode}
          onChange={(event, date) => {
            setOpen(false);
            if (event.type === 'set' && date) onChange(date);
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    justifyContent: 'center',
  },
  label: {
    ...typography.body,
    color: colors.text,
  },
});
