import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple, useTheme } from 'react-native-paper';
import { staffColors } from '../theme/theme';
import { typography } from '../theme/typography';
import { featureCardLayout } from './FeatureCardLayout';

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
  danger?: boolean;
  shortcut?: boolean;
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
  danger = false,
  shortcut = false,
}: StaffFeatureCardProps) {
  const theme = useTheme();
  if (shortcut) {
    return (
      <TouchableRipple
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={[description, status].filter(Boolean).join('. ')}
        onPress={onPress}
        style={styles.shortcutRipple}
      >
        <View style={styles.shortcutContent}>
          <View style={[styles.shortcutIcon, { backgroundColor: background }]}>
            <Icon source={icon} size={26} color={color} />
          </View>
          <View style={styles.shortcutText}>
            <Text variant="titleMedium" style={styles.shortcutTitle}>
              {title}
            </Text>
            {!!status && (
              <Text
                variant="labelSmall"
                style={[styles.status, styles.shortcutStatus, danger && { color: '#BA1A1A' }]}
              >
                {status}
              </Text>
            )}
          </View>
        </View>
      </TouchableRipple>
    );
  }
  return (
    <View
      style={[
        styles.surface,
        incident && styles.incidentSurface,
        { backgroundColor: danger ? staffColors.redSoft : theme.colors.surface },
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
            <Text
              variant="labelSmall"
              style={[styles.status, danger && { color: staffColors.red }]}
            >
              {status}
            </Text>
          )}
        </View>
      </TouchableRipple>
    </View>
  );
}

const styles = StyleSheet.create({
  shortcutRipple: {
    borderRadius: 16,
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DCE6F2',
  },
  shortcutContent: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
    minHeight: 80,
  },
  shortcutIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutText: { flex: 1, minWidth: 0, gap: 3 },
  shortcutTitle: { ...typography.cardTitle, color: '#102B49', textAlign: 'left' },
  shortcutStatus: { textAlign: 'left' },
  incidentSurface: { borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', boxShadow: 'none' },
  ...featureCardLayout,
  status: { ...typography.status, color: staffColors.orange, textAlign: 'center' },
  title: {
    color: staffColors.navy,
    textAlign: 'center',
    ...typography.cardTitle,
  },
  description: { ...typography.secondary, textAlign: 'center' },
});
