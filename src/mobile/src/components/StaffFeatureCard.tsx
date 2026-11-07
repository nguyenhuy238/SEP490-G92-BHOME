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
  compact?: boolean;
  status?: string;
  incident?: boolean;
}

export function StaffFeatureCard({
  title,
  description,
  icon,
  color,
  background,
  onPress,
  compact = false,
  status,
  incident = false,
}: StaffFeatureCardProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.surface,
        incident && styles.incidentSurface,
        { backgroundColor: theme.colors.surface },
      ]}
    >
      <TouchableRipple
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={[description, status].filter(Boolean).join('. ')}
        onPress={onPress}
        style={[styles.ripple, incident && { borderRadius: 14 }]}
      >
        <View style={[styles.content, compact && styles.compact, incident && { minHeight: 168 }]}>
          <View
            style={[styles.icon, compact && styles.compactIcon, { backgroundColor: background }]}
          >
            <Icon source={icon} size={compact ? 22 : 26} color={color} />
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
          {!!status && (
            <Text variant="labelSmall" style={styles.status}>
              {status}
            </Text>
          )}
        </View>
      </TouchableRipple>
    </View>
  );
}

const styles = StyleSheet.create({
  incidentSurface: { borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', boxShadow: 'none' },
  surface: { flex: 1, borderRadius: 18, boxShadow: '0 3px 14px rgba(25, 52, 82, 0.05)' },
  ripple: { flex: 1, borderRadius: 18, overflow: 'hidden' },
  content: { flexGrow: 1, padding: 12, alignItems: 'center', gap: 6 },
  compact: { padding: 12, gap: 4 },
  compactIcon: { width: 36, height: 36, borderRadius: 12 },
  status: { color: staffColors.orange, textAlign: 'center' },
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
