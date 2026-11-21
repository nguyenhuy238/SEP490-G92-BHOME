import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import { DashboardCard, DashboardStatus } from './DashboardKit';
import { colors, staffColors } from '../theme/theme';
import { typography } from '../theme/typography';

// Owner uses the same surfaces, type and touch feedback as Staff/Tenant.
export function OwnerLoading() {
  return (
    <View accessibilityLabel="Đang tải dữ liệu" accessibilityRole="progressbar" style={{ gap: 12 }}>
      {[0, 1, 2].map((key) => (
        <View key={key} style={styles.skeleton}>
          <View style={styles.skeletonLine} />
          <View style={[styles.skeletonLine, { width: '60%' }]} />
        </View>
      ))}
    </View>
  );
}

export function OwnerDataState({
  loading,
  error,
  reload,
}: {
  loading: boolean;
  error: string;
  reload: () => void;
}) {
  return (
    <>
      {loading && <OwnerLoading />}
      {!!error && <OwnerFailure retry={reload} busy={loading} />}
    </>
  );
}

export function OwnerEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <DashboardCard>
      <Text style={typography.sectionHeading}>{title}</Text>
      <Text style={{ color: colors.muted }}>{detail}</Text>
    </DashboardCard>
  );
}

export function OwnerFailure({ retry, busy = false }: { retry: () => void; busy?: boolean }) {
  return (
    <DashboardCard>
      <Text accessibilityRole="alert">
        Chưa cập nhật được dữ liệu. Kiểm tra kết nối và thử lại.
      </Text>
      <Button onPress={retry} disabled={busy} contentStyle={{ minHeight: 48 }}>
        Thử lại
      </Button>
    </DashboardCard>
  );
}

export function OwnerRecordRow({
  title,
  detail,
  status,
  urgent = false,
  onPress,
  action = 'Xem chi tiết',
  children,
}: {
  title: string;
  detail?: string;
  status: string;
  urgent?: boolean;
  onPress: () => void;
  action?: string;
  children?: React.ReactNode;
}) {
  return (
    <TouchableRipple
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${action}: ${title}`}
      style={styles.record}
    >
      <View style={styles.recordContent}>
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <DashboardStatus
            tone={urgent ? 'red' : 'blue'}
            palette={urgent ? { background: colors.redSoft, foreground: colors.red } : undefined}
          >
            {status}
          </DashboardStatus>
          <Text style={[typography.sectionHeading, { color: staffColors.navy }]} numberOfLines={2}>
            {title}
          </Text>
          {children}
          {!!detail && (
            <Text style={{ color: colors.muted }} numberOfLines={3}>
              {detail}
            </Text>
          )}
          <Text style={[typography.link, { color: colors.blue }]}>{action}</Text>
        </View>
        <Icon source="chevron-right" size={22} color={colors.muted} />
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  record: { backgroundColor: colors.white, borderRadius: 18, overflow: 'hidden' },
  recordContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    minHeight: 64,
  },
  skeleton: { backgroundColor: colors.white, borderRadius: 18, padding: 16, gap: 12 },
  skeletonLine: { backgroundColor: colors.border, borderRadius: 6, width: '85%', height: 16 },
});

export function OwnerScreenIntro({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={ownerSurfaceStyles.intro}>
      <Text accessibilityRole="header" style={ownerSurfaceStyles.title}>
        {title}
      </Text>
      <Text style={ownerSurfaceStyles.secondary}>{detail}</Text>
    </View>
  );
}

export function OwnerSection({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={ownerSurfaceStyles.section}>
      <View style={ownerSurfaceStyles.sectionHeading}>
        <Text accessibilityRole="header" style={ownerSurfaceStyles.sectionTitle}>
          {title}
        </Text>
        {!!detail && <Text style={ownerSurfaceStyles.secondary}>{detail}</Text>}
      </View>
      {children}
    </View>
  );
}

export function OwnerSurface({ children }: { children: React.ReactNode }) {
  return <View style={ownerSurfaceStyles.surface}>{children}</View>;
}

export function OwnerDivider() {
  return <View style={ownerSurfaceStyles.divider} />;
}

export function OwnerLinkRow({
  icon,
  title,
  detail,
  value,
  onPress,
}: {
  icon: string;
  title: string;
  detail?: string;
  value?: string;
  onPress: () => void;
}) {
  return (
    <TouchableRipple onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      <View style={ownerSurfaceStyles.link}>
        <View style={ownerSurfaceStyles.icon}>
          <Icon source={icon} size={21} color={staffColors.blue} />
        </View>
        <View style={ownerSurfaceStyles.grow}>
          <Text style={ownerSurfaceStyles.rowTitle}>{title}</Text>
          {!!detail && (
            <Text style={ownerSurfaceStyles.secondary} numberOfLines={2}>
              {detail}
            </Text>
          )}
        </View>
        {!!value && <Text style={ownerSurfaceStyles.value}>{value}</Text>}
        <Icon source="chevron-right" size={18} color={colors.muted} />
      </View>
    </TouchableRipple>
  );
}

const ownerSurfaceStyles = StyleSheet.create({
  intro: { gap: 4, paddingHorizontal: 2 },
  title: { ...typography.screenTitle, color: '#173654' },
  secondary: { ...typography.secondary, color: colors.muted, flexShrink: 1 },
  section: { gap: 12 },
  sectionHeading: { gap: 3 },
  sectionTitle: { ...typography.sectionHeading, color: '#173654' },
  surface: {
    backgroundColor: colors.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 64 },
  link: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: staffColors.blueSoft,
  },
  grow: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { ...typography.link, color: '#173654' },
  value: { ...typography.value, color: staffColors.blue, fontVariant: ['tabular-nums'] },
});

export const ownerMobileStyles = ownerSurfaceStyles;
