import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text, TouchableRipple } from 'react-native-paper';
import { DashboardHeading, dashboardStyles } from '../components/DashboardKit';
import { StaffFeatureDirectory } from '../components/StaffFeatureDirectory';
import { StaffFeatureCard } from '../components/StaffFeatureCard';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useStaffDashboard } from '../features/workspace/useStaffDashboard';
import { type WorkspaceScreen } from '../features/workspace/navigation';
import { colors as c, staffColors as s } from '../theme/theme';
import { typography } from '../theme/typography';
import {
  isEmbeddedInitialMeterTask,
  isEmbeddedMoveInInventory,
  isMainMoveInWork,
  isMainMoveOutWork,
} from '../services/operationalTasks';

export function StaffDashboard() {
  const {
    go,
    preview,
    staffLocationId,
    staffLocations,
    staffLocationsLoading,
    staffLocationsError,
    reloadStaffLocations,
  } = useWorkspace();
  const data = useStaffDashboard();
  const [contracts, setContracts] = useState(false);
  const availableLocations = staffLocations ?? data.locations.data ?? [];
  const activeLocation = availableLocations.find(
    (item) => item.id === (staffLocationId ?? availableLocations[0]?.id),
  );
  const scopedLocationId = staffLocationId ?? activeLocation?.id ?? '';
  // useStaffDashboard resolves move-out assignments against Room IDs from the
  // selected authorized Location; never rely on non-unique Location names here.
  const selectedInspections = data.inspections.data ?? [];
  const priorities = preview
    ? [
        {
          id: 'sample-meter',
          title: 'Ghi chỉ số điện',
          detail: 'Phòng 301 · Dữ liệu mẫu',
          status: 'Cần ghi số',
          open: () => go('meter-reading'),
        },
      ]
    : (data.priorities.data?.items ?? [])
        .filter(
          (task) =>
            ['Assigned', 'InProgress'].includes(task.status) &&
            !isEmbeddedMoveInInventory(task) &&
            !isEmbeddedInitialMeterTask(task) &&
            !!scopedLocationId &&
            task.locationId === scopedLocationId,
        )
        .slice(0, 2)
        .map((task) => ({
          id: task.id,
          title: task.title,
          detail:
            data.locations.data?.find((location) => location.id === task.locationId)?.label ??
            'Cơ sở được phân công',
          status: task.isOverdue
            ? 'Quá hạn'
            : task.status === 'InProgress'
              ? 'Đang xử lý'
              : 'Cần làm',
          open: () =>
            isMainMoveInWork(task)
              ? go('move-in', { contractId: task.target!.contractId!, section: 'handover' })
              : isMainMoveOutWork(task)
                ? go('move-out', { contractId: task.target!.contractId!, taskId: task.id })
                : go(task.kind === 'MoveInInventory' ? 'move-in-inventory' : 'task-detail', {
                    taskId: task.id,
                  }),
        }));
  const priorityError = !!data.priorities.error;
  const locationLabel = preview
    ? 'BHOME Đống Đa - Tòa B · Mẫu'
    : (staffLocationsLoading ?? data.locations.loading)
      ? 'Đang tải cơ sở…'
      : availableLocations.length
        ? (activeLocation ?? availableLocations[0])!.label +
          (staffLocationsError ? ' · Chưa cập nhật được' : '')
        : (staffLocationsError ?? data.locations.error)
          ? 'Chưa tải được cơ sở'
          : 'Chưa có cơ sở được phân công';
  const taskValue = preview ? '6' : data.tasks.data ? String(data.tasks.data.totalCount) : '—';
  const pendingInspections = data.inspections.data
    ? selectedInspections.filter((item) => item.status === 'Approved')
    : null;
  function open(screen: WorkspaceScreen, params?: Record<string, string>) {
    if (params) go(screen, params);
    else go(screen);
  }
  return (
    <>
      <View style={styles.summary}>
        <View style={styles.greetingRow}>
          <View style={styles.greeting}>
            <Text variant="headlineSmall" style={[styles.title, typography.screenTitle]}>
              {preview ? 'Xin chào, Long!' : 'Chào bạn, bắt đầu ngày mới!'}
            </Text>
            <Text variant="bodySmall" style={[styles.muted, typography.secondary]}>
              {locationLabel}
            </Text>
          </View>
          <Button
            compact
            icon="refresh"
            onPress={() => {
              data.reload();
              reloadStaffLocations?.();
            }}
            accessibilityLabel="Làm mới tổng quan"
          >
            Làm mới
          </Button>
        </View>
        <View style={styles.metrics}>
          {[
            { label: 'Hạn hôm nay', value: taskValue, screen: 'work-orders' as const },
            {
              label: 'Sự cố chờ xử lý',
              value: preview
                ? '1'
                : data.incidents?.total != null
                  ? String(data.incidents.total)
                  : '—',
              screen: 'staff-incidents' as const,
            },
            {
              label: 'Kiểm tra trả phòng',
              value: preview
                ? '2'
                : pendingInspections
                  ? `${data.inspections.data!.length >= 100 ? '≥' : ''}${pendingInspections.length}`
                  : '—',
              screen: 'staff-handovers' as const,
            },
          ].map((metric, index) => (
            <TouchableRipple
              key={metric.label}
              style={[styles.metric, index > 0 && styles.divider]}
              onPress={() =>
                metric.screen === 'staff-handovers'
                  ? go(metric.screen, { tab: 'MoveOut' })
                  : go(metric.screen)
              }
              accessibilityRole="button"
              accessibilityLabel={metric.label}
            >
              <View style={styles.metricContent}>
                <Text variant="headlineMedium" style={[styles.title, typography.metric]}>
                  {metric.value}
                </Text>
                <Text style={styles.metricLabel}>{metric.label}</Text>
              </View>
            </TouchableRipple>
          ))}
        </View>
        {!preview && !!data.incidents?.error && (
          <Text style={styles.muted}>Chưa tải đủ số sự cố mở. Chạm Làm mới để thử lại.</Text>
        )}
        {!preview && !!data.tasks.error && (
          <Text style={styles.muted}>
            Chưa tải được công việc hôm nay. Chạm Làm mới để thử lại.
          </Text>
        )}
      </View>
      {priorities.length > 0 && (
        <View style={styles.section}>
          <DashboardHeading title="Cần xử lý" detail="Các tác vụ ưu tiên trong phạm vi được giao" />
          <View style={styles.priorityList}>
            {priorities.map((item) => (
              <TouchableRipple
                key={item.id}
                onPress={item.open}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}, ${item.detail}`}
              >
                <View style={styles.priority}>
                  <View style={styles.greeting}>
                    <Text variant="titleSmall" style={[styles.title, typography.cardTitle]}>
                      {item.title}
                    </Text>
                    <Text variant="labelSmall" style={[styles.muted, typography.secondary]}>
                      {item.detail}
                    </Text>
                  </View>
                  <Text variant="labelSmall" style={styles.priorityStatus}>
                    {item.status} ›
                  </Text>
                </View>
              </TouchableRipple>
            ))}
          </View>
        </View>
      )}
      {!preview && priorities.length === 0 && !priorityError && (
        <View style={styles.section}>
          <DashboardHeading title="Cần xử lý" />
          <Text style={styles.muted}>
            {data.priorities.loading ? 'Đang tải việc ưu tiên…' : 'Chưa có việc ưu tiên cần xử lý.'}
          </Text>
        </View>
      )}
      {!preview && priorityError && (
        <Button onPress={data.reload}>Chưa tải đủ tác vụ ưu tiên · Thử lại</Button>
      )}
      <StaffFeatureDirectory
        onOpen={open}
        overdueMeterRooms={preview ? null : data.overdueMeterRooms}
      />
      <View style={styles.section}>
        <StaffFeatureCard
          title="Hợp đồng"
          description="Tạo và theo dõi hợp đồng"
          icon="file-document-outline"
          color={s.blue}
          background={s.blueSoft}
          onPress={() => setContracts(true)}
          compact
        />
      </View>
      <Portal>
        <Dialog visible={contracts} onDismiss={() => setContracts(false)}>
          <Dialog.Title>Hợp đồng</Dialog.Title>
          <Dialog.Actions style={styles.dialogActions}>
            <Button
              onPress={() => {
                setContracts(false);
                go('onboarding');
              }}
            >
              Tạo hợp đồng thuê
            </Button>
            <Button
              onPress={() => {
                setContracts(false);
                go('prepare-contract', { kind: 'Holding' });
              }}
            >
              Tạo hợp đồng giữ chỗ
            </Button>
            <Button
              onPress={() => {
                setContracts(false);
                go('signing');
              }}
            >
              Xem hợp đồng
            </Button>
            <Button onPress={() => setContracts(false)}>Đóng</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}
const styles = StyleSheet.create({
  summary: { ...dashboardStyles.summary, borderRadius: 18, gap: 12 },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  greeting: { flex: 1, minWidth: 100, gap: 4 },
  title: { color: s.navy },
  muted: { ...typography.body, color: c.muted },
  metrics: { flexDirection: 'row' },
  metric: { flex: 1 },
  metricContent: { alignItems: 'center', paddingHorizontal: 4, paddingVertical: 8, gap: 5 },
  metricLabel: { ...typography.status, textAlign: 'center', color: c.muted },
  divider: { borderLeftWidth: 1, borderLeftColor: c.border },
  section: dashboardStyles.section,
  priorityList: { backgroundColor: c.white, borderRadius: 16, overflow: 'hidden' },
  priority: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  priorityStatus: { ...typography.status, color: s.orange, flexShrink: 1 },
  dialogActions: { flexDirection: 'column', alignItems: 'stretch' },
});
