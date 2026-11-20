import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text, TouchableRipple } from 'react-native-paper';
import { router } from 'expo-router';
import { DashboardHeading, DashboardStatus, dashboardStyles } from '../components/DashboardKit';
import { StaffFeatureDirectory } from '../components/StaffFeatureDirectory';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useStaffDashboard } from '../features/workspace/useStaffDashboard';
import { type WorkspaceScreen } from '../features/workspace/navigation';
import { colors as c, staffColors as s } from '../theme/theme';
import { typography } from '../theme/typography';
import {
  isEmbeddedInitialMeterTask,
  isEmbeddedMoveInInventory,
  isMainMoveInWork,
} from '../services/operationalTasks';

export function StaffDashboard() {
  const {
    go,
    preview,
    staffLocationId,
    staffLocations,
    staffLocationsLoading,
    staffLocationsError,
    selectStaffLocation,
    reloadStaffLocations,
  } = useWorkspace();
  const data = useStaffDashboard();
  const [handover, setHandover] = useState(false);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
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
    : [
        ...(data.overdue.data?.items ?? [])
          .filter(
            (task) =>
              ['Assigned', 'InProgress'].includes(task.status) &&
              !isEmbeddedMoveInInventory(task) &&
              !isEmbeddedInitialMeterTask(task) &&
              !!scopedLocationId &&
              task.locationId === scopedLocationId,
          )
          .map((task) => ({
            id: task.id,
            title: task.title,
            detail:
              data.locations.data?.find((location) => location.id === task.locationId)?.label ??
              'Cơ sở được phân công',
            status: 'Quá hạn',
            open: () =>
              isMainMoveInWork(task)
                ? go('move-in', { contractId: task.target!.contractId!, section: 'handover' })
                : go(task.kind === 'MoveInInventory' ? 'move-in-inventory' : 'task-detail', {
                    taskId: task.id,
                  }),
          })),
        ...selectedInspections
          .filter((item) => item.status === 'Approved')
          .slice(0, 2)
          .map((item) => ({
            id: item.contractId,
            title: 'Kiểm tra trả phòng',
            detail: `Phòng ${item.roomNumber} · ${item.locationName}`,
            status: 'Được phân công',
            open: () => go('move-out', { contractId: item.contractId }),
          })),
        ...(data.meters.data ?? [])
          .filter(
            (item) =>
              item.status === 0 && !!scopedLocationId && item.locationId === scopedLocationId,
          )
          .slice(0, 2)
          .map((item) => ({
            id: item.id,
            title: `Ghi chỉ số ${item.utilityType === 0 ? 'điện' : 'nước'}`,
            detail: `Phòng ${item.room} · ${item.location}`,
            status: 'Cần ghi số',
            open: () => router.push({ pathname: '/meter', params: { taskId: item.id } }),
          })),
      ];
  const priorityError = [data.overdue, data.inspections, data.meters].some(
    (query) => !!query.error,
  );
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
    if (screen === 'move-in') setHandover(true);
    else if (params) go(screen, params);
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
        {!preview && availableLocations.length > 1 && (
          <Button
            mode="outlined"
            icon="map-marker-multiple-outline"
            onPress={() => setLocationPickerOpen(true)}
            accessibilityLabel="Chuyển cơ sở"
          >
            Cơ sở hiện tại: {activeLocation?.label ?? 'Chọn cơ sở'} · Đổi cơ sở
          </Button>
        )}
        <TouchableRipple
          onPress={() => go('shifts')}
          accessibilityRole="button"
          accessibilityLabel="Xem lịch ca"
        >
          <View style={styles.shift}>
            <DashboardStatus tone="neutral">
              {preview ? 'Ca sáng · 07:30–16:30 · Mẫu' : 'Chưa có dữ liệu ca làm'}
            </DashboardStatus>
            <Text variant="labelSmall" style={[styles.muted, typography.status]}>
              Xem lịch ca ›
            </Text>
          </View>
        </TouchableRipple>
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
              screen: 'move-out' as const,
            },
          ].map((metric, index) => (
            <TouchableRipple
              key={metric.label}
              style={[styles.metric, index > 0 && styles.divider]}
              onPress={() => go(metric.screen)}
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
        {!preview && (
          <Text variant="labelSmall" style={[styles.muted, typography.status]}>
            Bàn giao nhận phòng chưa hoàn tất được theo dõi trong Công việc của tôi. Mở tác vụ để
            kiểm tra và lấy xác nhận của Tenant.
          </Text>
        )}
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
            {priorities.slice(0, 5).map((item) => (
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
      {!preview && priorityError && (
        <Button onPress={data.reload}>Chưa tải đủ tác vụ ưu tiên · Thử lại</Button>
      )}
      <StaffFeatureDirectory onOpen={open} />
      <Portal>
        <Dialog visible={locationPickerOpen} onDismiss={() => setLocationPickerOpen(false)}>
          <Dialog.Title>Chuyển cơ sở</Dialog.Title>
          <Dialog.ScrollArea>
            <ScrollView style={{ maxHeight: 360 }}>
              {availableLocations.map((location) => (
                <Button
                  key={location.id}
                  mode={location.id === scopedLocationId ? 'contained-tonal' : 'text'}
                  onPress={() => {
                    setLocationPickerOpen(false);
                    selectStaffLocation?.(location.id);
                  }}
                >
                  {location.label}
                </Button>
              ))}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setLocationPickerOpen(false)}>Đóng</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={handover} onDismiss={() => setHandover(false)}>
          <Dialog.Title>Bàn giao / Trả phòng</Dialog.Title>
          <Dialog.Content>
            <Text style={typography.body}>Chọn nghiệp vụ cần thực hiện theo hồ sơ hợp đồng.</Text>
          </Dialog.Content>
          <Dialog.Actions style={styles.dialogActions}>
            <Button
              onPress={() => {
                setHandover(false);
                go('move-in');
              }}
            >
              Bàn giao nhận phòng
            </Button>
            <Button
              onPress={() => {
                setHandover(false);
                go('move-out');
              }}
            >
              Kiểm tra trả phòng
            </Button>
            <Button onPress={() => setHandover(false)}>Đóng</Button>
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
  shift: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
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
