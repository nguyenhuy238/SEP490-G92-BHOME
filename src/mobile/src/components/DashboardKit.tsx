import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Button, Icon, ProgressBar, Text } from 'react-native-paper';
import { StaffFeatureCard } from './StaffFeatureCard';
import { colors as c, staffColors as s } from '../theme/theme';
import { typography } from '../theme/typography';

// Shared presentation follows the existing Staff dashboard, including its spacing,
// surfaces and icon palette. Data and navigation remain in each role's screen.
export const dashboardStyles = StyleSheet.create({
  summary: {
    backgroundColor: c.white,
    borderRadius: 22,
    padding: 16,
    gap: 16,
    boxShadow: '0 3px 14px rgba(25, 52, 82, 0.05)',
  },
  card: {
    backgroundColor: c.white,
    borderRadius: 18,
    padding: 16,
    gap: 12,
    boxShadow: '0 3px 14px rgba(25, 52, 82, 0.05)',
  },
  section: { gap: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accent: { width: 4, height: 18, borderRadius: 2, backgroundColor: s.accent },
  title: { color: s.navy, flexShrink: 1 },
  muted: { color: c.muted },
  grow: { flex: 1, minWidth: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { flexGrow: 1, flexBasis: '45%', minWidth: 130 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: s.blueSoft,
  },
  value: { color: s.navy, fontVariant: ['tabular-nums'] },
});

export function DashboardCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[dashboardStyles.card, style]}>{children}</View>;
}

export function DashboardStatus({
  children,
  tone = 'blue',
}: {
  children: React.ReactNode;
  tone?: 'blue' | 'green' | 'red' | 'amber' | 'neutral';
}) {
  const [backgroundColor, color] = {
    blue: [s.blueSoft, s.blue],
    green: [s.greenSoft, s.green],
    red: [s.redSoft, s.red],
    amber: [s.orangeSoft, s.orange],
    neutral: [c.soft, c.muted],
  }[tone];
  return (
    <View
      style={{
        backgroundColor,
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 8,
        alignSelf: 'flex-start',
        maxWidth: '100%',
      }}
    >
      <Text variant="labelMedium" style={[typography.label, { color }]}>
        {children}
      </Text>
    </View>
  );
}

export function DashboardSummary({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={dashboardStyles.summary}>
      <View style={{ gap: 4 }}>
        <Text variant="headlineSmall" style={[dashboardStyles.title, typography.screenTitle]}>
          {title}
        </Text>
        <Text variant="bodySmall" style={[dashboardStyles.muted, typography.secondary]}>
          {detail}
        </Text>
      </View>
      {children}
    </View>
  );
}

export function DashboardHeading({
  title,
  detail,
  action,
  onPress,
}: {
  title: string;
  detail?: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={dashboardStyles.sectionHeading}>
      <View style={dashboardStyles.accent} />
      <View style={dashboardStyles.grow}>
        <Text variant="titleMedium" style={[dashboardStyles.title, typography.sectionHeading]}>
          {title}
        </Text>
        {!!detail && (
          <Text variant="bodySmall" style={[dashboardStyles.muted, typography.secondary]}>
            {detail}
          </Text>
        )}
      </View>
      {!!action && (
        <Button onPress={onPress} textColor={s.blue} contentStyle={{ minHeight: 44 }}>
          {action}
        </Button>
      )}
    </View>
  );
}

export function DashboardSection({
  title,
  children,
  action,
  onPress,
}: {
  title: string;
  children: React.ReactNode;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={dashboardStyles.section}>
      <DashboardHeading title={title} action={action} onPress={onPress} />
      {children}
    </View>
  );
}

export function DashboardMetric({
  label,
  value,
  icon,
  detail,
  danger = false,
  progress,
}: {
  label: string;
  value: string;
  icon: string;
  detail?: string;
  danger?: boolean;
  progress?: number;
}) {
  return (
    <View style={[dashboardStyles.card, dashboardStyles.cell]}>
      <View style={dashboardStyles.icon}>
        <Icon source={icon} size={26} color={s.blue} />
      </View>
      <Text variant="bodySmall" style={dashboardStyles.muted}>
        {label}
      </Text>
      <Text variant="headlineMedium" style={[dashboardStyles.value, danger && { color: s.red }]}>
        {value}
      </Text>
      {!!detail && (
        <Text variant="bodySmall" style={dashboardStyles.muted}>
          {detail}
        </Text>
      )}
      {progress !== undefined && <ProgressBar progress={progress} color={s.blue} />}
    </View>
  );
}

export function DashboardActions({
  items,
}: {
  items: { label: string; icon: string; detail?: string; onPress: () => void }[];
}) {
  const palette = [
    [s.blue, s.blueSoft],
    [s.purple, s.purpleSoft],
    [s.green, s.greenSoft],
    [s.orange, s.orangeSoft],
  ];
  return (
    <View style={dashboardStyles.grid}>
      {items.map((item, index) => (
        <View key={item.label} style={dashboardStyles.cell}>
          <StaffFeatureCard
            title={item.label}
            description={item.detail ?? ''}
            icon={item.icon}
            color={palette[index % palette.length][0]}
            background={palette[index % palette.length][1]}
            onPress={item.onPress}
          />
        </View>
      ))}
    </View>
  );
}
