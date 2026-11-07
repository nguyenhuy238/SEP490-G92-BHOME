import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Button,
  Icon,
  IconButton,
  Menu,
  Text,
  TextInput,
  TouchableRipple,
} from 'react-native-paper';
import {
  contractError,
  displayContractDate,
  formatContractMoney,
  text,
  type ContractClient,
  type ContractSummary,
} from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { Pill, ui } from '../../components/WorkspaceKit';
import { useWorkspaceHeaderRefresh } from '../../components/WorkspaceHeaderContext';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { colors as c } from '../../theme/theme';
import {
  loadStaffContracts,
  staffContractPage,
  staffContractSorts,
  staffContractTabs,
  staffContractTone,
  defaultStaffContractListView,
  type StaffContractListView,
} from './staffContractList';

type Schedule = Awaited<ReturnType<ContractClient['moveOutAssignments']>>[number];
type Snapshot = {
  api: ContractClient;
  revision: number;
  contracts: ContractSummary[];
  schedules: Schedule[];
  error: string;
  scheduleError: string;
};

export function StaffContractsList({
  api,
  onCreate,
  onOpen,
  onInspection,
  viewState,
  onViewStateChange,
}: {
  api: ContractClient;
  onCreate: () => void;
  onOpen: (contract: ContractSummary) => void;
  onInspection: (id: string) => void;
  viewState?: StaffContractListView;
  onViewStateChange?: (view: StaffContractListView) => void;
}) {
  const { resetScroll } = useWorkspace();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const [localView, setLocalView] = useState({ ...defaultStaffContractListView });
  const view = viewState ?? localView;
  const { status, search, sort, page } = view;
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useFocusEffect(
    useCallback(() => {
      refresh();
      return () => pending.current?.abort();
    }, [refresh]),
  );
  useEffect(() => {
    if (!revision) return;
    const controller = new AbortController();
    pending.current = controller;
    void (async () => {
      const [contracts, schedules] = await Promise.allSettled([
        loadStaffContracts(api, controller.signal),
        api.moveOutAssignments(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setSnapshot({
        api,
        revision,
        contracts: contracts.status === 'fulfilled' ? contracts.value : [],
        schedules: schedules.status === 'fulfilled' ? schedules.value : [],
        error: contracts.status === 'rejected' ? contractError(contracts.reason) : '',
        scheduleError: schedules.status === 'rejected' ? contractError(schedules.reason) : '',
      });
    })();
    return () => controller.abort();
  }, [api, revision]);
  const loading = !snapshot || snapshot.api !== api || snapshot.revision !== revision;
  const contracts = useMemo(() => (loading ? [] : snapshot.contracts), [loading, snapshot]);
  const error = !loading ? snapshot.error : '';
  const schedules = !loading ? snapshot.schedules : [];
  const scheduleError = !loading ? snapshot.scheduleError : '';
  const result = useMemo(
    () => staffContractPage(contracts, status, search, sort, page),
    [contracts, status, search, sort, page],
  );
  const headerRefreshAvailable = useWorkspaceHeaderRefresh(refresh, loading);
  function changeView(patch: Partial<StaffContractListView>) {
    const next = { ...view, ...patch };
    if (onViewStateChange) onViewStateChange(next);
    else setLocalView(next);
    resetScroll?.();
  }
  function clearFilters() {
    changeView({ ...defaultStaffContractListView });
  }

  return (
    <View style={styles.screen}>
      <View style={styles.summary}>
        <View style={ui.grow}>
          <Text variant="headlineSmall" style={styles.title}>
            {loading || error ? '—' : contracts.length} hợp đồng
          </Text>
          <Text variant="bodySmall" style={ui.muted}>
            Quản lý hợp đồng thuê phòng
          </Text>
        </View>
        <Button
          mode="contained"
          icon="plus"
          accessibilityLabel="Tạo mới hợp đồng"
          contentStyle={{ minHeight: 44 }}
          style={styles.create}
          onPress={onCreate}
        >
          Tạo mới
        </Button>
        {!headerRefreshAvailable && (
          <IconButton
            icon="refresh"
            accessibilityLabel="Tải lại hợp đồng"
            disabled={loading}
            onPress={refresh}
          />
        )}
      </View>
      <TouchableRipple
        accessibilityRole="button"
        accessibilityLabel={`Lịch kiểm tra trả phòng, ${loading || scheduleError ? 'chưa tải được' : schedules.length + ' lịch'}`}
        accessibilityState={{ expanded: scheduleOpen }}
        disabled={loading}
        onPress={() => setScheduleOpen((value) => !value)}
        style={styles.schedule}
      >
        <View style={styles.scheduleRow}>
          <Icon source="calendar-check-outline" size={22} color={c.primary} />
          <Text variant="labelLarge" style={ui.grow}>
            Lịch kiểm tra trả phòng
          </Text>
          <Pill tone="blue">{loading || scheduleError ? '—' : schedules.length}</Pill>
          <Icon source={scheduleOpen ? 'chevron-up' : 'chevron-right'} size={20} color={c.muted} />
        </View>
      </TouchableRipple>
      {scheduleOpen && (
        <View style={styles.scheduleDetails}>
          {!!scheduleError && (
            <>
              <Text accessibilityRole="alert" style={ui.red}>
                {scheduleError}
              </Text>
              <Button onPress={refresh}>Thử lại lịch kiểm tra</Button>
            </>
          )}
          {!scheduleError && !schedules.length && (
            <Text style={ui.muted}>Chưa có lịch kiểm tra được giao.</Text>
          )}
          {schedules.map((schedule) => (
            <TouchableRipple
              key={schedule.contractId}
              accessibilityRole="button"
              accessibilityLabel={`Mở kiểm tra phòng ${schedule.roomNumber}`}
              onPress={() => onInspection(schedule.contractId)}
              style={styles.schedule}
            >
              <View style={styles.scheduleRow}>
                <View style={ui.grow}>
                  <Text variant="titleSmall">Phòng {schedule.roomNumber}</Text>
                  <Text variant="bodySmall" style={ui.muted}>
                    {formatInstant(schedule.scheduledAt)}
                  </Text>
                  <Text variant="bodySmall" style={ui.muted} numberOfLines={1}>
                    {schedule.locationName}
                  </Text>
                </View>
                <Icon source="chevron-right" size={20} color={c.primary} />
              </View>
            </TouchableRipple>
          ))}
        </View>
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.statusTabs}
      >
        {staffContractTabs.map((tab) => (
          <Button
            key={tab.id}
            mode={status === tab.id ? 'contained' : 'outlined'}
            accessibilityRole="tab"
            accessibilityState={{ selected: status === tab.id }}
            disabled={loading || !!error}
            style={[
              styles.statusTab,
              status !== tab.id && { backgroundColor: c.white, borderColor: c.border },
            ]}
            contentStyle={{ minHeight: 44 }}
            labelStyle={{ fontSize: 12 }}
            onPress={() => {
              changeView({ status: tab.id, page: 1 });
            }}
          >
            {tab.label} (
            {loading || error ? '—' : staffContractPage(contracts, tab.id, search, sort, 1).total})
          </Button>
        ))}
      </ScrollView>
      <View style={styles.searchRow}>
        <TextInput
          mode="outlined"
          dense
          placeholder="Tìm theo mã phòng, hợp đồng..."
          accessibilityLabel="Tìm hợp đồng"
          value={search}
          onChangeText={(value) => {
            changeView({ search: value, page: 1 });
          }}
          autoCapitalize="none"
          autoCorrect={false}
          left={<TextInput.Icon icon="magnify" />}
          right={
            search ? (
              <TextInput.Icon
                icon="close"
                accessibilityLabel="Xóa tìm kiếm"
                onPress={() => {
                  changeView({ search: '', page: 1 });
                }}
              />
            ) : undefined
          }
          style={styles.search}
          outlineStyle={{ borderRadius: 12 }}
        />
        <Menu
          visible={sortOpen}
          onDismiss={() => setSortOpen(false)}
          anchor={
            <IconButton
              icon="sort-variant"
              mode="outlined"
              accessibilityLabel={`Sắp xếp hợp đồng: ${staffContractSorts.find((item) => item.id === sort)?.label}`}
              style={styles.sortButton}
              onPress={() => setSortOpen(true)}
            />
          }
        >
          {staffContractSorts.map((item) => (
            <Menu.Item
              key={item.id}
              title={item.label}
              leadingIcon={sort === item.id ? 'check' : undefined}
              onPress={() => {
                changeView({ sort: item.id, page: 1 });
                setSortOpen(false);
              }}
            />
          ))}
        </Menu>
      </View>
      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator accessibilityLabel="Đang tải hợp đồng" />
          <Text style={ui.muted}>Đang tải hợp đồng…</Text>
        </View>
      ) : error ? (
        <View style={styles.state}>
          <Text accessibilityRole="alert" style={ui.red}>
            {error}
          </Text>
          <Button onPress={refresh}>Thử tải lại hợp đồng</Button>
        </View>
      ) : (
        <>
          <View style={styles.cards}>
            {result.items.map((contract) => (
              <TouchableRipple
                key={contract.id}
                testID="staff-contract-card"
                accessibilityRole="button"
                accessibilityLabel={`Mở hợp đồng phòng ${contract.roomNumber}, ${text(contract.status)}`}
                onPress={() => onOpen(contract)}
                style={styles.card}
              >
                <View style={styles.cardBody}>
                  <View style={styles.cardInfo}>
                    <Text variant="titleMedium" numberOfLines={2} style={styles.room}>
                      Phòng {contract.roomNumber}
                    </Text>
                    <Text variant="labelSmall" numberOfLines={1} style={ui.muted}>
                      {contract.locationName}
                    </Text>
                    <Text variant="labelSmall" style={ui.muted}>
                      {displayContractDate(contract.startDate)} –{' '}
                      {displayContractDate(contract.endDate)}
                    </Text>
                    <Text variant="titleMedium" style={[ui.money, styles.rent]}>
                      {formatContractMoney(contract.monthlyRent)}/tháng
                    </Text>
                  </View>
                  <View style={styles.cardTrailing}>
                    <Pill tone={staffContractTone(contract.status)}>{text(contract.status)}</Pill>
                    <Icon source="chevron-right" size={24} color={c.primary} />
                  </View>
                </View>
              </TouchableRipple>
            ))}
          </View>
          {!result.total && (
            <View style={styles.state}>
              <Icon source="file-search-outline" size={32} color={c.muted} />
              <Text variant="titleMedium">
                {contracts.length ? 'Không tìm thấy hợp đồng' : 'Chưa có hợp đồng'}
              </Text>
              <Text style={ui.muted}>
                {contracts.length
                  ? 'Thử đổi từ khóa hoặc trạng thái.'
                  : 'Các hợp đồng trong phạm vi phụ trách sẽ xuất hiện tại đây.'}
              </Text>
              {!!(search || status) && <Button onPress={clearFilters}>Xóa bộ lọc</Button>}
            </View>
          )}
          <View style={styles.pagination}>
            <Text variant="bodySmall" style={ui.muted} accessibilityLiveRegion="polite">
              Hiển thị {result.from}–{result.to} / {result.total}
            </Text>
            {!!result.total && (
              <View style={styles.pageControls}>
                <IconButton
                  icon="chevron-left"
                  accessibilityLabel="Trang trước"
                  disabled={result.page === 1}
                  onPress={() => {
                    changeView({ page: result.page - 1 });
                  }}
                />
                <Text variant="labelLarge">
                  Trang {result.page} / {result.pages}
                </Text>
                <IconButton
                  icon="chevron-right"
                  accessibilityLabel="Trang sau"
                  disabled={result.page === result.pages}
                  onPress={() => {
                    changeView({ page: result.page + 1 });
                  }}
                />
              </View>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { gap: 12 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: c.primary, fontWeight: '700' },
  create: { borderRadius: 10, backgroundColor: c.primary },
  schedule: {
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, minHeight: 52 },
  scheduleDetails: { gap: 8 },
  statusTabs: { gap: 8, paddingVertical: 2 },
  statusTab: { borderRadius: 22 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  search: { flex: 1, minWidth: 0, backgroundColor: c.white, fontSize: 13 },
  sortButton: {
    margin: 0,
    borderRadius: 12,
    borderColor: c.border,
    height: 48,
    width: 48,
    backgroundColor: c.white,
  },
  cards: { gap: 10 },
  card: {
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 14,
    overflow: 'hidden',
  },
  cardBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    padding: 12,
    minHeight: 124,
  },
  cardInfo: { flex: 1, minWidth: 0, gap: 5 },
  room: { color: c.primary, fontWeight: '700' },
  rent: { color: c.primary, marginTop: 3 },
  cardTrailing: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    maxWidth: '40%',
    gap: 12,
  },
  state: { paddingVertical: 24, gap: 10, alignItems: 'center' },
  pagination: { alignItems: 'center', gap: 2, paddingTop: 4, paddingBottom: 12 },
  pageControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
