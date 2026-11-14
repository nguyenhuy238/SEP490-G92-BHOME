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
          <DashboardStatus tone={urgent ? 'red' : 'blue'}>{status}</DashboardStatus>
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
