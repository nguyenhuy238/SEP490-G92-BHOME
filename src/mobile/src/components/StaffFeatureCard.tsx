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
  ...featureCardLayout,
  status: { ...typography.status, color: staffColors.orange, textAlign: 'center' },
  title: {
    color: staffColors.navy,
    textAlign: 'center',
    ...typography.cardTitle,
  },
  description: { ...typography.secondary, textAlign: 'center' },
});
