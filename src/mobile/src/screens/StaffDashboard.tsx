import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, Icon, Portal, Text, TouchableRipple } from 'react-native-paper';
import { StaffFeatureDirectory } from '../components/StaffFeatureDirectory';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useStaffDashboard } from '../features/workspace/useStaffDashboard';
import { type WorkspaceScreen } from '../features/workspace/navigation';
import { colors as c, staffColors as s } from '../theme/theme';
import { fontStyle, typography } from '../theme/typography';
import { staffHomePalette as h, staffUi } from '../theme/staffLayout';
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
          target: task.target?.label,
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
        <View style={styles.locationRow}>
          <Icon source="map-marker-outline" size={23} color={h.ink} />
          <Text style={styles.locationLabel}>{locationLabel}</Text>
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
          <Text style={styles.muted}>Chưa tải đủ số sự cố mở. Kéo xuống để thử lại.</Text>
        )}
        {!preview && !!data.tasks.error && (
          <Text style={styles.muted}>Chưa tải được công việc hôm nay. Kéo xuống để thử lại.</Text>
        )}
      </View>
      {priorities.length > 0 && (
        <View style={styles.prioritySection}>
          <View style={styles.sectionHeading}>
            <View style={styles.headingLabel}>
              <View style={styles.headingAccent} />
              <Text style={styles.headingTitle}>Cần xử lý</Text>
            </View>
            <Button
              compact
              textColor={s.blue}
              onPress={() => go('work-orders')}
              icon="chevron-right"
              contentStyle={styles.seeAllContent}
            >
              Xem tất cả
            </Button>
          </View>
          <View style={styles.priorityRows}>
            {priorities.map((item) => (
              <TouchableRipple
                key={item.id}
                onPress={item.open}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}, ${item.detail}`}
                style={styles.priorityCard}
              >
                <View style={styles.priority}>
                  <View style={styles.priorityIcon}>
                    <Icon source="clipboard-check-outline" size={24} color={s.blue} />
                  </View>
                  <View style={styles.priorityText}>
                    <Text variant="titleSmall" style={[styles.title, typography.cardTitle]}>
                      {item.title}
                    </Text>
                    {'target' in item && !!item.target && (
                      <Text style={staffUi.secondary}>{item.target}</Text>
                    )}
                    {preview && <Text style={staffUi.secondary}>{item.detail}</Text>}
                  </View>
                  <View
                    style={[
                      styles.statusPill,
                      item.status === 'Quá hạn' && { backgroundColor: s.redSoft },
                      item.status === 'Cần làm' && { backgroundColor: s.blueSoft },
                    ]}
                  >
                    <Text
                      variant="labelSmall"
                      style={[
                        styles.priorityStatus,
                        item.status === 'Quá hạn' && { color: c.red },
                        item.status === 'Cần làm' && { color: s.blue },
                      ]}
                    >
                      {item.status}
                    </Text>
                  </View>
                  <Icon source="chevron-right" size={18} color={h.ink} />
                </View>
              </TouchableRipple>
            ))}
          </View>
        </View>
      )}
      {!preview && priorities.length === 0 && !priorityError && (
        <View style={styles.prioritySection}>
          <View style={styles.headingLabel}>
            <View style={styles.headingAccent} />
            <Text style={styles.headingTitle}>Cần xử lý</Text>
          </View>
          <Text style={[styles.muted, styles.emptyPriority]}>
            {data.priorities.loading ? 'Đang tải việc ưu tiên…' : 'Chưa có việc ưu tiên cần xử lý.'}
          </Text>
        </View>
      )}
      {!preview && priorityError && (
        <Button onPress={data.reload}>Chưa tải đủ tác vụ ưu tiên · Thử lại</Button>
      )}
      <StaffFeatureDirectory
        onOpen={open}
        onContracts={() => setContracts(true)}
        overdueMeterRooms={preview ? null : data.overdueMeterRooms}
      />
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
  summary: { gap: 8 },
  locationAction: { alignSelf: 'stretch', borderRadius: 10 },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minHeight: 48,
    paddingHorizontal: 6,
  },
  locationLabel: { ...fontStyle('bold', 18, 25), color: h.ink, flexShrink: 1 },
  title: { color: h.ink },
  muted: { ...typography.body, color: h.muted },
  metrics: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: c.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: h.border,
    paddingVertical: 8,
    boxShadow: '0 4px 14px rgba(16, 43, 73, 0.06)',
  },
  metric: { flex: 1, minWidth: 0, borderRadius: 8 },
  metricContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
    gap: 4,
    minHeight: 64,
  },
  metricLabel: { ...fontStyle('medium', 12, 17), textAlign: 'center', color: h.muted },
  divider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#C9D8EA',
    borderRadius: 0,
  },
  prioritySection: { gap: 6 },
  headingLabel: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1 },
  headingAccent: { width: 4, height: 18, borderRadius: 2, backgroundColor: s.blue },
  headingTitle: { ...fontStyle('bold', 18, 25), color: h.ink },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 3,
  },
  seeAllContent: { minHeight: 44, flexDirection: 'row-reverse' },
  priorityRows: { gap: 8 },
  priorityCard: {
    ...staffUi.surface,
    borderRadius: 16,
    borderColor: h.border,
    overflow: 'hidden',
  },
  emptyPriority: { ...staffUi.surface, borderRadius: 16, borderColor: h.border, padding: 14 },
  priority: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 72,
  },
  priorityIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: h.iconSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityText: { flex: 1, minWidth: 0, gap: 3 },
  statusPill: {
    borderRadius: 14,
    paddingHorizontal: 7,
    paddingVertical: 4,
    backgroundColor: c.amberSoft,
    maxWidth: '29%',
  },
  priorityStatus: { ...typography.status, color: c.amber, textAlign: 'center' },
  dialogActions: { flexDirection: 'column', alignItems: 'stretch' },
});
