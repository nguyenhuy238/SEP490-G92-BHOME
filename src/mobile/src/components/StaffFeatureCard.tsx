import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple, useTheme } from 'react-native-paper';
import { staffColors } from '../theme/theme';

interface StaffFeatureCardProps {
  title: string;
  description: string;
  icon: string;
  color: string;
  background: string;
  onPress: () => void;
}

export function StaffFeatureCard({
  title,
  description,
  icon,
  color,
  background,
  onPress,
}: StaffFeatureCardProps) {
  const theme = useTheme();
  return (
    <View style={[styles.surface, { backgroundColor: theme.colors.surface }]}>
      <TouchableRipple
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={description}
        onPress={onPress}
        style={styles.ripple}
      >
        <View style={styles.content}>
          <View style={[styles.icon, { backgroundColor: background }]}>
            <Icon source={icon} size={26} color={color} />
          </View>
          <Text variant="titleMedium" style={styles.title}>
            {title}
          </Text>
          <Text
            variant="bodySmall"
            style={[styles.description, { color: theme.colors.onSurfaceVariant }]}
          >
            {description}
          </Text>
        </View>
      </TouchableRipple>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1, borderRadius: 18, boxShadow: '0 3px 14px rgba(25, 52, 82, 0.05)' },
  ripple: { flex: 1, borderRadius: 18, overflow: 'hidden' },
  content: { flexGrow: 1, padding: 12, alignItems: 'center', gap: 6 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  title: {
    color: staffColors.navy,
    textAlign: 'center',
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
  },
  description: { textAlign: 'center', fontSize: 12, lineHeight: 17 },
});
