import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Button,
  Dialog,
  Icon,
  IconButton,
  Portal,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import { Pill, ui } from '../components/WorkspaceKit';
import { ChoiceField, Input } from '../components/WorkflowControls';
import { groupRoomMeterTasks, meterRoundLabel } from '../features/workspace/roomMeterTasks';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import { errorMessage, type MeterTask, type Named } from '../lib/api';
import { conciseMessage } from '../lib/toast';
import { displayContractDate } from '../../../../packages/client-core/src/contracts';
import { formatInstant, formatMeterReading } from '../../../../packages/client-core/src/localization';
import type { ConfirmedReading } from '../../../../packages/client-core/src/meter';
import { colors as c } from '../theme/theme';

const QUICK_STATUS_FILTERS = [
  { id: '', label: 'Tất cả' },
  { id: 'pending', label: 'Chưa ghi' },
  { id: '2', label: 'Đã ghi' },
] as const;

const SHEET_STATUS_OPTIONS = [
  { id: '', label: 'Tất cả trạng thái' },
  { id: 'pending', label: 'Chưa ghi' },
  { id: '2', label: 'Đã ghi' },
  { id: '0', label: 'Được giao' },
  { id: '1', label: 'Đang xử lý' },
  { id: '3', label: 'Đã hủy' },
];

function statusFilterLabel(status: string): string {
  return SHEET_STATUS_OPTIONS.find((item) => item.id === status)?.label ?? status;
}

function matchesStatusFilter(group: MeterTask[], status: string): boolean {
  if (!status) return true;
  if (status === 'pending') return group.some((task) => task.status < 2);
  if (status === '2') {
    const required = group.filter((task) => task.status !== 3);
    return required.length > 0
      ? required.every((task) => task.status === 2)
      : group.some((task) => task.status === 2);
  }
  return group.some((task) => String(task.status) === status);
}

export function MeterTasksScreen() {
  const { api, session } = useSession();
  const staff = session?.roles.includes('Staff');
  const currentUserId = session?.userId;
  const [room, setRoom] = useState('');
  const [period, setPeriod] = useState('');
  const [due, setDue] = useState('');
  const [status, setStatus] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    api: typeof api;
    key: string;
    data: MeterTask[];
    error: string;
  } | null>(null);
  const [readings, setReadings] = useState<Record<string, ConfirmedReading>>({});

  const locations = useWorkspaceQuery<Named[]>(staff ? '/api/v1/capture/locations' : null, {
    notifyError: false,
  });
  const assignedLocation = locations.data?.[0] ?? null;
  const assignedLocationId = assignedLocation?.id ?? '';

  const rooms = useWorkspaceQuery<Named[]>(
    staff && assignedLocationId
      ? `/api/v1/capture/locations/${encodeURIComponent(assignedLocationId)}/rooms`
      : null,
    { notifyError: false },
  );

  const validDue =
    !due ||
    (/^\d{4}-\d{2}-\d{2}$/.test(due) &&
      !Number.isNaN(Date.parse(due)) &&
      new Date(due).toISOString().slice(0, 10) === due);
  const params = new URLSearchParams();
  if (assignedLocationId) params.set('locationId', assignedLocationId);
  if (room) params.set('roomId', room);
  if (due && validDue) params.set('dueDate', due);
  const scope = params.toString();
  const key = `${assignedLocationId}:${scope}:${revision}`;

  const reloadTasks = useCallback(() => setRevision((v) => v + 1), []);
  const handleReload = useCallback(() => {
    locations.reload();
    if (assignedLocationId) {
      rooms.reload();
      reloadTasks();
    }
  }, [assignedLocationId, locations, reloadTasks, rooms]);

  useFocusEffect(
    useCallback(() => {
      reloadTasks();
    }, [reloadTasks]),
  );

  useEffect(() => {
    if (!api || !staff || !assignedLocationId || !validDue) return;
    const controller = new AbortController();
    void (async () => {
      try {
        // The existing API has no billingPeriod filter. Collect its scoped pages
        // before filtering periods locally, so later pages cannot be omitted.
        const data: MeterTask[] = [];
        for (let serverPage = 1; ; serverPage++) {
          const batch = await api.request<MeterTask[]>(
            `/api/v1/capture/meter-tasks?page=${serverPage}&${scope}`,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          data.push(...batch);
          if (batch.length < 100) break;
        }
        setState({ api, key, data, error: '' });
      } catch (e) {
        if (!controller.signal.aborted) {
          setState({ api, key, data: [], error: conciseMessage(errorMessage(e)) });
        }
      }
    })();
    return () => controller.abort();
  }, [api, assignedLocationId, key, scope, staff, validDue]);

  const current =
    assignedLocationId && validDue && state?.key === key && state.api === api ? state : null;
  const loading = !!api && !!staff && !!assignedLocationId && validDue && !current;
  const currentData = current?.data;

  const scopedTasks = useMemo(() => {
    if (!assignedLocation) return [];
    const raw = currentData ?? [];
    return raw.filter((task) => {
      if (task.locationId && task.locationId !== assignedLocation.id) return false;
      if (!task.locationId && task.location && task.location !== assignedLocation.label)
        return false;
      if (
        task.assignedStaffUserId &&
        currentUserId &&
        task.assignedStaffUserId !== currentUserId
      )
        return false;
      return true;
    });
  }, [assignedLocation, currentData, currentUserId]);

  const periods = useMemo(
    () =>
      [
        ...new Set(
          scopedTasks.map((task) => task.billingPeriod).filter((p): p is string => !!p),
        ),
      ]
        .sort()
        .reverse(),
    [scopedTasks],
  );

  // Filter status after grouping, so a completed meter is not hidden beside its pending counterpart.
  const filtered = useMemo(
    () =>
      groupRoomMeterTasks(
        scopedTasks.filter((task) => !period || task.billingPeriod === period),
      ).filter((group) => matchesStatusFilter(group, status)),
    [period, scopedTasks, status],
  );

  const visiblePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 20)));
  const items = useMemo(
    () => filtered.slice((visiblePage - 1) * 20, visiblePage * 20),
    [filtered, visiblePage],
  );

  useEffect(() => {
    if (!api || !staff || !items.length) return;
    const missingIds = [
      ...new Set(
        items
          .flatMap((group) => group)
          .filter((task) => task.status === 2 && !!task.confirmedReadingId)
          .map((task) => task.confirmedReadingId!)
          .filter((readingId) => !readings[readingId]),
      ),
    ];
    if (!missingIds.length) return;
    const controller = new AbortController();
    void (async () => {
      const loaded: Record<string, ConfirmedReading> = {};
      await Promise.allSettled(
        missingIds.map(async (readingId) => {
          const reading = await api.request<ConfirmedReading>(
            `/api/v1/capture/readings/${encodeURIComponent(readingId)}`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted && reading) {
            loaded[readingId] = reading;
          }
        }),
      );
      if (!controller.signal.aborted && Object.keys(loaded).length > 0) {
        setReadings((prev) => ({ ...prev, ...loaded }));
      }
    })();
    return () => controller.abort();
  }, [api, items, readings, staff]);

  const changeFilter = (setter: (v: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };

  const clearFilters = () => {
    setRoom('');
    setPeriod('');
    setDue('');
    setStatus('');
    setPage(1);
  };

  const hasActiveFilters = Boolean(room || period || due || status);
  const advancedFilterCount =
    (room ? 1 : 0) + (period ? 1 : 0) + (due ? 1 : 0) + (status ? 1 : 0);
  const selectedRoomLabel =
    rooms.data?.find((item) => item.id === room)?.label ?? room;

  if (!staff) return <Text>Chỉ Staff được phép ghi chỉ số điện nước.</Text>;

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text variant="titleLarge" style={styles.title}>
            Ghi chỉ số điện nước
          </Text>
          <Text variant="bodySmall" style={styles.subtitle}>
            Quản lý ghi chỉ số theo phòng
          </Text>
        </View>
        <IconButton
          icon="refresh"
          size={20}
          accessibilityLabel="Tải lại danh sách ghi chỉ số"
          disabled={locations.loading || loading}
          onPress={handleReload}
          style={styles.refreshBtn}
        />
      </View>

      {assignedLocation && (
        <View style={styles.locationBadge}>
          <Icon source="map-marker-outline" size={15} color={c.primary} />
          <Text variant="labelLarge" style={styles.locationText} numberOfLines={1}>
            Cơ sở: {assignedLocation.label}
          </Text>
        </View>
      )}

      {locations.loading && !assignedLocation ? (
        <View
          style={styles.stateCard}
          accessibilityRole="progressbar"
          accessibilityLabel="Đang tải cơ sở được phân công"
        >
          <ActivityIndicator size="small" color={c.primary} />
          <Text variant="bodySmall" style={styles.subtitle}>
            Đang tải cơ sở và tác vụ được phân công…
          </Text>
        </View>
      ) : locations.error && !assignedLocation ? (
        <View style={styles.stateCard}>
          <Icon source="alert-circle-outline" size={28} color={c.red} />
          <Text variant="titleMedium" style={styles.stateTitle}>
            Không tải được cơ sở được phân công
          </Text>
          <Text accessibilityRole="alert" variant="bodySmall" style={ui.red}>
            {locations.error}
          </Text>
          <Button mode="outlined" compact onPress={handleReload}>
            Thử lại
          </Button>
        </View>
      ) : !assignedLocation ? (
        <View style={styles.stateCard}>
          <Icon source="office-building-outline" size={28} color={c.muted} />
          <Text variant="titleMedium" style={styles.stateTitle}>
            Chưa có cơ sở được phân công
          </Text>
          <Text variant="bodySmall" style={styles.stateDescription}>
            Tài khoản của bạn hiện chưa được phân công cơ sở để ghi chỉ số điện nước.
          </Text>
          <Button mode="outlined" compact onPress={handleReload}>
            Tải lại
          </Button>
        </View>
      ) : (
        <>
          <View style={styles.toolbarRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickTabs}
            >
              {QUICK_STATUS_FILTERS.map((tab) => {
                const active = status === tab.id;
                return (
                  <TouchableRipple
                    key={tab.id}
                    accessibilityRole="tab"
                    accessibilityLabel={tab.label}
                    accessibilityState={{ selected: active }}
                    onPress={() => changeFilter(setStatus, tab.id)}
                    style={[styles.quickTab, active && styles.quickTabActive]}
                  >
                    <Text
                      variant="labelMedium"
                      style={{ color: active ? c.white : c.ink, fontWeight: '600' }}
                    >
                      {tab.label}
                    </Text>
                  </TouchableRipple>
                );
              })}
            </ScrollView>
            <TouchableRipple
              accessibilityRole="button"
              accessibilityLabel="Bộ lọc"
              onPress={() => setFilterOpen(true)}
              style={[
                styles.filterTrigger,
                advancedFilterCount > 0 && styles.filterTriggerActive,
              ]}
            >
              <View style={styles.filterTriggerRow}>
                <Icon
                  source="tune-variant"
                  size={18}
                  color={advancedFilterCount > 0 ? c.primary : c.ink}
                />
                <Text
                  variant="labelMedium"
                  style={{
                    color: advancedFilterCount > 0 ? c.primary : c.ink,
                    fontWeight: '600',
                  }}
                >
                  Lọc{advancedFilterCount > 0 ? ` (${advancedFilterCount})` : ''}
                </Text>
              </View>
            </TouchableRipple>
          </View>

          {hasActiveFilters && (
            <View style={styles.activeChipsRow}>
              {!!room && (
                <TouchableRipple
                  accessibilityRole="button"
                  accessibilityLabel={`Xóa lọc phòng ${selectedRoomLabel}`}
                  onPress={() => changeFilter(setRoom, '')}
                  style={styles.activeChip}
                >
                  <View style={styles.activeChipInner}>
                    <Text variant="labelSmall" style={styles.activeChipText}>
                      Phòng: {selectedRoomLabel}
                    </Text>
                    <Icon source="close" size={14} color={c.primary} />
                  </View>
                </TouchableRipple>
              )}
              {!!period && (
                <TouchableRipple
                  accessibilityRole="button"
                  accessibilityLabel={`Xóa lọc kỳ ${displayContractDate(period)}`}
                  onPress={() => changeFilter(setPeriod, '')}
                  style={styles.activeChip}
                >
                  <View style={styles.activeChipInner}>
                    <Text variant="labelSmall" style={styles.activeChipText}>
                      Kỳ: {displayContractDate(period)}
                    </Text>
                    <Icon source="close" size={14} color={c.primary} />
                  </View>
                </TouchableRipple>
              )}
              {!!status && (
                <TouchableRipple
                  accessibilityRole="button"
                  accessibilityLabel={`Xóa lọc trạng thái ${statusFilterLabel(status)}`}
                  onPress={() => changeFilter(setStatus, '')}
                  style={styles.activeChip}
                >
                  <View style={styles.activeChipInner}>
                    <Text variant="labelSmall" style={styles.activeChipText}>
                      Trạng thái: {statusFilterLabel(status)}
                    </Text>
                    <Icon source="close" size={14} color={c.primary} />
                  </View>
                </TouchableRipple>
              )}
              <Button compact mode="text" onPress={clearFilters}>
                Xóa bộ lọc
              </Button>
            </View>
          )}

          {current && !current.error && (
            <View style={styles.listSummaryRow}>
              <Text variant="labelLarge" style={styles.listSummaryText}>
                Phòng được phân công ({filtered.length})
              </Text>
            </View>
          )}

          {loading && (
            <View
              style={styles.stateCard}
              accessibilityRole="progressbar"
              accessibilityLabel="Đang tải tác vụ ghi chỉ số"
            >
              <ActivityIndicator size="small" color={c.primary} />
              <Text variant="bodySmall" style={styles.subtitle}>
                Đang tải danh sách phòng cần ghi chỉ số…
              </Text>
            </View>
          )}

          {!!current?.error && (
            <View style={styles.stateCard}>
              <Icon source="alert-circle-outline" size={28} color={c.red} />
              <Text variant="titleMedium" style={styles.stateTitle}>
                Không tải được danh sách ghi chỉ số
              </Text>
              <Text accessibilityRole="alert" variant="bodySmall" style={ui.red}>
                {current.error}
              </Text>
              <Button mode="outlined" compact onPress={handleReload}>
                Thử lại
              </Button>
            </View>
          )}

          {!loading &&
            !current?.error &&
            items.map((group) => {
              const ordered = [...group].sort(
                (a, b) =>
                  a.utilityType - b.utilityType || a.meterCode.localeCompare(b.meterCode),
              );
              const primaryTask = ordered.find((item) => item.status < 2) ?? ordered[0]!;
              const requiredTasks = ordered.filter((item) => item.status !== 3);
              const totalRequired = requiredTasks.length;
              const completedCount = requiredTasks.filter((item) => item.status === 2).length;
              const hasPending = requiredTasks.some((item) => item.status < 2);
              const allCompleted = totalRequired > 0 && completedCount === totalRequired;
              const progressLabel = allCompleted
                ? 'Hoàn thành'
                : `${completedCount}/${totalRequired || ordered.length} đã ghi`;
              const progressTone = allCompleted
                ? 'green'
                : completedCount > 0
                  ? 'blue'
                  : 'amber';
              const dueTask =
                ordered.find((item) => item.status < 2 && item.dueAt) ??
                ordered.find((item) => item.dueAt) ??
                primaryTask;
              const dueAt = dueTask?.dueAt ?? null;
              const isOverdue = ordered.some(
                (item) =>
                  item.status < 2 &&
                  !!item.dueAt &&
                  Number.isFinite(Date.parse(item.dueAt)) &&
                  Date.parse(item.dueAt) < Date.now(),
              );

              return (
                <View
                  key={ordered.map((item) => item.id).join(':')}
                  testID="meter-room-card"
                  style={styles.roomCard}
                >
                  <View style={styles.cardHeader}>
                    <View style={styles.cardHeaderLeft}>
                      <Text variant="titleMedium" style={styles.roomNumber}>
                        Phòng {primaryTask.room}
                      </Text>
                      <Text variant="bodySmall" style={styles.metadataText} numberOfLines={1}>
                        {allCompleted
                          ? meterRoundLabel(primaryTask)
                          : `${meterRoundLabel(primaryTask)} · Tiến độ: ${completedCount}/${
                              totalRequired || ordered.length
                            } đã ghi`}
                      </Text>
                    </View>
                    <Pill tone={progressTone}>{progressLabel}</Pill>
                  </View>

                  <View style={styles.meterSection}>
                    {ordered.map((meter, index) => {
                      const isElectric = meter.utilityType === 0;
                      const unit = isElectric ? 'kWh' : 'm³';
                      const sameUtilityCount = ordered.filter(
                        (item) => item.utilityType === meter.utilityType,
                      ).length;
                      const confirmed = meter.confirmedReadingId
                        ? readings[meter.confirmedReadingId]
                        : undefined;
                      const statusLabel =
                        meter.status === 2
                          ? 'Đã ghi'
                          : meter.status === 3
                            ? 'Đã hủy'
                            : 'Chưa ghi';
                      const statusTone =
                        meter.status === 2
                          ? 'green'
                          : meter.status === 3
                            ? 'neutral'
                            : 'amber';

                      return (
                        <View
                          key={meter.id}
                          style={[
                            styles.meterRow,
                            index > 0 && styles.meterRowDivider,
                          ]}
                        >
                          <View style={styles.meterLabelGroup}>
                            <Icon
                              source={
                                isElectric ? 'lightning-bolt-outline' : 'water-outline'
                              }
                              size={18}
                              color={isElectric ? c.amber : c.blue}
                            />
                            <Text variant="bodyMedium" style={styles.meterTypeLabel}>
                              {isElectric ? 'Điện' : 'Nước'}
                              {sameUtilityCount > 1 ? ` · ${meter.meterCode}` : ''}
                            </Text>
                          </View>
                          <View style={styles.meterValueGroup}>
                            {meter.status === 2 && confirmed && (
                              <View style={styles.confirmedReadingGroup}>
                                <Text variant="labelLarge" style={styles.confirmedReadingText}>
                                  {formatMeterReading(confirmed.confirmedValue, unit)}
                                </Text>
                                {meter.purpose !== 0 &&
                                  confirmed.consumption !== null &&
                                  confirmed.consumption !== undefined && (
                                    <Text variant="labelSmall" style={styles.consumptionSubtext}>
                                      Tiêu thụ: {formatMeterReading(confirmed.consumption, unit)}
                                    </Text>
                                  )}
                              </View>
                            )}
                            <Pill tone={statusTone}>{statusLabel}</Pill>
                          </View>
                        </View>
                      );
                    })}
                  </View>

                  {allCompleted && (
                    <Text variant="labelSmall" style={styles.completedRoomNote}>
                      {primaryTask.purpose === 0
                        ? 'Đã lưu chỉ số ban đầu (mốc khởi tạo, không tính tiêu thụ tháng)'
                        : 'Đã lưu chỉ số kỳ này để hệ thống tổng hợp hóa đơn theo lịch'}
                    </Text>
                  )}

                  <View style={styles.cardFooter}>
                    <View style={styles.dueGroup}>
                      <Text
                        variant="labelSmall"
                        style={isOverdue ? styles.overdueText : styles.dueText}
                      >
                        {dueAt
                          ? `Hạn: ${formatInstant(dueAt)}`
                          : `Ngày ghi: ${displayContractDate(primaryTask.readingDate)}`}
                      </Text>
                      {isOverdue && <Pill tone="red">Quá hạn</Pill>}
                    </View>
                    <Button
                      mode={hasPending ? 'contained' : 'outlined'}
                      compact
                      icon={hasPending ? 'camera-outline' : 'text-box-search-outline'}
                      disabled={!hasPending && totalRequired === 0}
                      contentStyle={styles.cardActionContent}
                      style={[
                        styles.cardActionButton,
                        hasPending && { backgroundColor: c.primary },
                      ]}
                      onPress={() =>
                        router.push({ pathname: '/meter', params: { taskId: primaryTask.id } })
                      }
                    >
                      {hasPending ? 'Ghi chỉ số' : 'Xem chi tiết'}
                    </Button>
                  </View>
                </View>
              );
            })}

          {current && !current.error && !items.length && (
            <View style={styles.stateCard}>
              <Icon source="gauge-empty" size={28} color={c.muted} />
              <Text variant="titleMedium" style={styles.stateTitle}>
                {hasActiveFilters
                  ? 'Không có phòng phù hợp bộ lọc'
                  : 'Chưa có tác vụ ghi chỉ số được giao'}
              </Text>
              <Text variant="bodySmall" style={styles.stateDescription}>
                {hasActiveFilters
                  ? 'Hãy thử đổi phòng, kỳ ghi hoặc trạng thái để xem tác vụ.'
                  : 'Các tác vụ ghi chỉ số điện nước tại cơ sở của bạn sẽ hiển thị tại đây.'}
              </Text>
              {hasActiveFilters && (
                <Button mode="outlined" compact onPress={clearFilters}>
                  Xóa bộ lọc
                </Button>
              )}
            </View>
          )}

          {filtered.length > 20 && (
            <View style={styles.paginationRow}>
              <Button
                mode="outlined"
                compact
                disabled={visiblePage === 1 || loading}
                onPress={() => setPage(visiblePage - 1)}
              >
                Trang trước
              </Button>
              <Text variant="labelMedium" style={styles.subtitle}>
                Trang {visiblePage} / {Math.ceil(filtered.length / 20)}
              </Text>
              <Button
                mode="outlined"
                compact
                disabled={visiblePage * 20 >= filtered.length || loading}
                onPress={() => setPage(visiblePage + 1)}
              >
                Trang sau
              </Button>
            </View>
          )}

          <Portal>
            <Dialog
              visible={filterOpen}
              onDismiss={() => setFilterOpen(false)}
              style={styles.sheetContainer}
            >
              <Dialog.Title>Bộ lọc ghi chỉ số</Dialog.Title>
              <Dialog.Content>
                <View style={styles.sheetBodyContent}>
                  <ChoiceField
                    label="Phòng"
                    value={room}
                    disabled={rooms.loading}
                    options={[{ id: '', label: 'Tất cả phòng' }, ...(rooms.data ?? [])]}
                    onChange={(v) => changeFilter(setRoom, v)}
                  />
                  {!!rooms.error && (
                    <View style={styles.inlineErrorRow}>
                      <Text variant="bodySmall" style={ui.red}>
                        {rooms.error}
                      </Text>
                      <Button compact mode="text" onPress={rooms.reload}>
                        Thử lại
                      </Button>
                    </View>
                  )}
                  <ChoiceField
                    label="Kỳ ghi chỉ số"
                    value={period}
                    options={[
                      { id: '', label: 'Tất cả kỳ ghi' },
                      ...periods.map((p) => ({ id: p, label: displayContractDate(p) })),
                    ]}
                    onChange={(v) => changeFilter(setPeriod, v)}
                  />
                  <ChoiceField
                    label="Trạng thái tác vụ"
                    value={status}
                    options={SHEET_STATUS_OPTIONS}
                    onChange={(v) => changeFilter(setStatus, v)}
                  />
                  <Input
                    label="Hạn ghi số (yyyy-MM-dd)"
                    value={due}
                    onChange={(v) => changeFilter(setDue, v)}
                  />
                  {!validDue && (
                    <Text variant="bodySmall" style={ui.red}>
                      Nhập ngày hợp lệ theo yyyy-MM-dd.
                    </Text>
                  )}
                </View>
              </Dialog.Content>
              <Dialog.Actions>
                <Button disabled={!hasActiveFilters} onPress={clearFilters}>
                  Đặt lại
                </Button>
                <Button onPress={() => setFilterOpen(false)}>Áp dụng</Button>
              </Dialog.Actions>
            </Dialog>
          </Portal>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { gap: 10 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: c.primary, fontWeight: '700' },
  subtitle: { color: c.muted },
  refreshBtn: { margin: 0 },
  locationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: c.soft,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  locationText: { color: c.primary, fontWeight: '600' },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  quickTabs: { gap: 6, paddingVertical: 2 },
  quickTab: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickTabActive: {
    backgroundColor: c.primary,
    borderColor: c.primary,
  },
  filterTrigger: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.border,
    justifyContent: 'center',
  },
  filterTriggerActive: {
    backgroundColor: c.tint,
    borderColor: c.blue,
  },
  filterTriggerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  activeChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  activeChip: {
    backgroundColor: c.tint,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: c.border,
  },
  activeChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  activeChipText: { color: c.primary, fontWeight: '600' },
  listSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listSummaryText: { color: c.muted },
  stateCard: {
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    gap: 8,
  },
  stateTitle: { color: c.ink, fontWeight: '600', textAlign: 'center' },
  stateDescription: { color: c.muted, textAlign: 'center' },
  roomCard: {
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardHeaderLeft: { flex: 1, minWidth: 0, gap: 2 },
  roomNumber: { color: c.primary, fontWeight: '700' },
  metadataText: { color: c.muted },
  meterSection: {
    backgroundColor: c.soft,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  meterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    gap: 8,
    flexWrap: 'nowrap',
  },
  meterRowDivider: {
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  meterLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  meterTypeLabel: { color: c.ink, fontWeight: '500', flexShrink: 1 },
  meterValueGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  confirmedReadingGroup: {
    alignItems: 'flex-end',
    minWidth: 0,
  },
  confirmedReadingText: {
    color: c.primary,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  consumptionSubtext: {
    color: c.muted,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  completedRoomNote: {
    color: c.muted,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 2,
  },
  dueGroup: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  dueText: { color: c.muted },
  overdueText: { color: c.red, fontWeight: '600' },
  cardActionButton: { borderRadius: 8 },
  cardActionContent: { minHeight: 38, paddingHorizontal: 6 },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  sheetContainer: {
    backgroundColor: c.white,
    borderRadius: 16,
  },
  sheetBodyContent: { gap: 12 },
  inlineErrorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
