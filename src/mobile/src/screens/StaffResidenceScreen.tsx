import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Avatar,
  Button,
  Chip,
  Divider,
  Icon,
  Modal,
  Portal,
  Searchbar,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import { useSession } from '../lib/SessionProvider';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
import { Action, Box, ui } from '../components/WorkspaceKit';
import { colors, staffColors } from '../theme/theme';
import { residenceStatus } from '../../../../packages/client-core/src/residence';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { displayContractDate } from '../../../../packages/client-core/src/contracts';

const PAGE_SIZE = 20;
type Filter = 'All' | 'Pending' | 'AwaitingReview' | 'Completed' | 'Overdue';
interface TrackingSummary {
  contractId: string;
  residentId: string;
  locationId: string;
  roomNumber: string;
  residentLabel: string;
  residentRole: string;
  actualResidenceFrom: string | null;
  status: string;
  registrationRequired: boolean;
  registrationDeadline: string | null;
  registrationExpiresOn: string | null;
  resultAt: string | null;
  ownerConfirmed: boolean;
  ownerConfirmedAt: string | null;
}
interface TrackingResponse {
  items: TrackingSummary[];
  page: number;
  pageSize: number;
  totalCount: number;
  loadedCount: number;
  stats: { totalResidents: number; notStarted: number; completed: number; overdue: number };
}
const filters: { id: Filter; label: string }[] = [
  { id: 'All', label: 'Tất cả' },
  { id: 'Pending', label: 'Chưa cập nhật' },
  { id: 'AwaitingReview', label: 'Chờ chủ nhà xem xét' },
  { id: 'Completed', label: 'Đã xác nhận' },
  { id: 'Overdue', label: 'Quá hạn cập nhật' },
];

function localToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}
function daysFromToday(date: string) {
  const from = new Date(`${localToday()}T00:00:00+07:00`).getTime();
  const to = new Date(`${date}T00:00:00+07:00`).getTime();
  return Math.round((to - from) / 86_400_000);
}
function itemStatus(item: TrackingSummary) {
  if (!item.registrationRequired)
    return { label: 'Không thuộc diện đăng ký', tone: 'neutral' as const };
  if (item.status === 'Completed' && item.ownerConfirmed)
    return { label: 'Đã xác nhận', tone: 'green' as const };
  if (item.status === 'Completed') return { label: 'Chờ chủ nhà xem xét', tone: 'amber' as const };
  if (item.registrationDeadline && daysFromToday(item.registrationDeadline) < 0)
    return { label: 'Quá hạn cập nhật', tone: 'red' as const };
  if (item.status === 'InProgress')
    return { label: residenceStatus.InProgress, tone: 'blue' as const };
  return { label: 'Chưa cập nhật', tone: 'neutral' as const };
}
function roleLabel(role: string) {
  return role === 'Representative' || role === '0' ? 'Người thuê chính' : 'Thành viên cùng ở';
}

export function StaffResidenceScreen() {
  const { session } = useSession();
  const { staffLocationId } = useWorkspace();
  const allowed = session?.roles.includes('Staff') ?? false;
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>('All');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<TrackingSummary | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [loadedResponses, setLoadedResponses] = useState<Record<string, TrackingResponse>>({});
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const queryPath = useMemo(() => {
    if (!allowed) return null;
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), filter });
    if (staffLocationId) params.set('locationId', staffLocationId);
    if (search) params.set('search', search);
    return `/api/v1/residence-tasks/tracking?${params.toString()}`;
  }, [allowed, filter, page, search, staffLocationId]);
  const query = useWorkspaceQuery<TrackingResponse>(queryPath, { notifyError: false });
  const { reload: reloadQuery, loading: queryLoading, error: queryError, data: queryData } = query;
  useEffect(() => {
    if (refreshRevision > 0) reloadQuery();
  }, [reloadQuery, refreshRevision]);
  const scope = `${staffLocationId ?? ''}:${filter}:${search}`;
  const pageKey = `${scope}:${page}`;
  const response = queryData ?? loadedResponses[pageKey] ?? loadedResponses[`${scope}:1`];
  const visibleItems = [
    ...new Map(
      Array.from(
        { length: page },
        (_, index) => loadedResponses[`${scope}:${index + 1}`]?.items ?? [],
      )
        .flat()
        .concat(queryData?.items ?? [])
        .map((item) => [`${item.contractId}/${item.residentId}`, item]),
    ).values(),
  ];
  const current = queryData;
  const reload = useCallback(() => {
    setLoadedResponses({});
    setPage(1);
    setRefreshRevision((value) => value + 1);
  }, []);
  useWorkspaceHeaderRefresh(reload, queryLoading, { title: 'Theo dõi tạm trú' });

  const applyFilter = (value: Filter) => {
    setPage(1);
    setFilter(value);
  };
  if (!allowed) return <Text>Chỉ nhân viên được phân công mới xem được danh sách này.</Text>;
  const stats = response?.stats;
  const statCards: {
    id: Filter;
    label: string;
    value: number | null;
    icon: string;
    tone: string;
  }[] = [
    {
      id: 'All',
      label: 'Người đang cư trú',
      value: stats?.totalResidents ?? null,
      icon: 'account-group-outline',
      tone: staffColors.navy,
    },
    {
      id: 'Completed',
      label: 'Đã xác nhận',
      value: stats?.completed ?? null,
      icon: 'check-circle-outline',
      tone: staffColors.green,
    },
    {
      id: 'Pending',
      label: 'Chưa cập nhật',
      value: stats?.notStarted ?? null,
      icon: 'clock-outline',
      tone: staffColors.orange,
    },
    {
      id: 'Overdue',
      label: 'Quá hạn cập nhật',
      value: stats?.overdue ?? null,
      icon: 'alert-circle-outline',
      tone: staffColors.red,
    },
  ];

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={queryLoading && !!current} onRefresh={reload} />}
    >
      <Text variant="headlineSmall" style={styles.title}>
        Theo dõi tạm trú
      </Text>
      <View style={styles.statsGrid}>
        {statCards.map((card) => (
          <TouchableRipple
            key={card.id}
            onPress={() => applyFilter(card.id)}
            accessibilityRole="button"
            accessibilityLabel={`${card.label}: ${card.value ?? 'đang tải'}`}
            style={styles.statTouch}
          >
            <View style={styles.statCard}>
              <View style={styles.statTop}>
                <Icon source={card.icon} size={20} color={card.tone} />
                <Text variant="titleLarge" style={{ color: card.tone }}>
                  {card.value ?? '—'}
                </Text>
              </View>
              <Text variant="bodySmall" style={styles.statLabel}>
                {card.label}
              </Text>
            </View>
          </TouchableRipple>
        ))}
      </View>

      <Searchbar
        placeholder="Tìm theo tên hoặc phòng"
        accessibilityLabel="Tìm theo tên hoặc phòng"
        value={searchInput}
        onChangeText={setSearchInput}
        style={styles.search}
        inputStyle={styles.searchInput}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
      >
        {filters.map((option) => (
          <Chip
            key={option.id}
            selected={filter === option.id}
            showSelectedCheck={false}
            onPress={() => applyFilter(option.id)}
            style={[styles.chip, filter === option.id && styles.chipSelected]}
            textStyle={[styles.chipText, filter === option.id && styles.chipTextSelected]}
          >
            {option.label}
          </Chip>
        ))}
      </ScrollView>

      {queryError ? (
        <Box>
          <Text accessibilityRole="alert" style={{ color: colors.red }}>
            {queryError}
          </Text>
          <Action secondary onPress={reload}>
            Thử tải lại
          </Action>
        </Box>
      ) : null}
      {queryLoading && !current ? (
        <View style={styles.loading}>
          <ActivityIndicator accessibilityLabel="Đang tải danh sách cư trú" />
          <Text style={ui.muted}>Đang tải danh sách…</Text>
        </View>
      ) : null}
      {!queryLoading && !queryError && current?.items.length === 0 ? (
        <View style={styles.empty}>
          <Icon source="account-search-outline" size={32} color={colors.muted} />
          <Text variant="titleMedium">Không có người phù hợp</Text>
          <Text variant="bodySmall" style={styles.statLabel}>
            Thử đổi từ khóa hoặc bộ lọc.
          </Text>
        </View>
      ) : null}
      {visibleItems.map((item) => {
        const status = itemStatus(item);
        const dueIn =
          item.registrationRequired && item.registrationDeadline
            ? daysFromToday(item.registrationDeadline)
            : null;
        return (
          <TouchableRipple
            key={`${item.contractId}/${item.residentId}`}
            onPress={() => setSelected(item)}
            accessibilityRole="button"
            accessibilityLabel={`Chi tiết ${item.residentLabel}, phòng ${item.roomNumber}`}
            style={styles.rowTouch}
          >
            <View style={styles.residentRow}>
              <Avatar.Text
                size={44}
                label={(
                  item.residentLabel
                    .trim()
                    .split(/\s+/)
                    .slice(-2)
                    .map((part) => part[0])
                    .join('') || '?'
                ).toLocaleUpperCase('vi')}
                style={styles.avatar}
                color={staffColors.navy}
              />
              <View style={styles.residentInfo}>
                <View style={styles.nameLine}>
                  <Text variant="titleMedium" numberOfLines={1} style={styles.name}>
                    {item.residentLabel}
                  </Text>
                  <Icon source="chevron-right" size={22} color={colors.muted} />
                </View>
                <Text variant="bodySmall" style={styles.secondary}>
                  Phòng {item.roomNumber} · {roleLabel(item.residentRole)}
                </Text>
                <View style={styles.statusLine}>
                  <View
                    style={[
                      styles.statusDot,
                      {
                        backgroundColor:
                          status.tone === 'green'
                            ? staffColors.green
                            : status.tone === 'red'
                              ? staffColors.red
                              : status.tone === 'amber'
                                ? staffColors.orange
                                : status.tone === 'blue'
                                  ? staffColors.blue
                                  : colors.muted,
                      },
                    ]}
                  />
                  <Text
                    variant="labelMedium"
                    style={{
                      color:
                        status.tone === 'red'
                          ? staffColors.red
                          : status.tone === 'green'
                            ? staffColors.green
                            : staffColors.navy,
                    }}
                  >
                    {status.label}
                  </Text>
                </View>
                {item.registrationRequired && item.registrationDeadline ? (
                  <Text
                    variant="bodySmall"
                    style={
                      dueIn !== null && dueIn < 0 && !item.ownerConfirmed
                        ? styles.overdue
                        : styles.secondary
                    }
                  >
                    {dueIn !== null && !item.ownerConfirmed
                      ? dueIn < 0
                        ? `Quá hạn ${Math.abs(dueIn)} ngày · Hạn ${displayContractDate(item.registrationDeadline)}`
                        : `Còn ${dueIn} ngày · Hạn ${displayContractDate(item.registrationDeadline)}`
                      : `Hạn cập nhật: ${displayContractDate(item.registrationDeadline)}`}
                  </Text>
                ) : null}
              </View>
            </View>
          </TouchableRipple>
        );
      })}
      {queryData && queryData.loadedCount < queryData.totalCount ? (
        <Button
          mode="outlined"
          loading={queryLoading}
          disabled={queryLoading}
          onPress={() => {
            setLoadedResponses((previous) => ({ ...previous, [pageKey]: queryData }));
            setPage((value) => value + 1);
          }}
          style={styles.loadMore}
        >
          Tải thêm ({queryData.loadedCount}/{queryData.totalCount})
        </Button>
      ) : null}
      {!current && !queryLoading && !queryError ? (
        <View style={styles.loading}>
          <Text style={styles.statLabel}>Chưa có dữ liệu để hiển thị.</Text>
        </View>
      ) : null}

      <Portal>
        <Modal
          visible={!!selected}
          onDismiss={() => setSelected(null)}
          contentContainerStyle={styles.modal}
        >
          {selected ? (
            <>
              <View style={styles.modalHeading}>
                <View style={ui.grow}>
                  <Text variant="titleLarge" style={styles.name}>
                    {selected.residentLabel}
                  </Text>
                  <Text variant="bodySmall" style={styles.secondary}>
                    Phòng {selected.roomNumber} · {roleLabel(selected.residentRole)}
                  </Text>
                </View>
                <Button
                  compact
                  onPress={() => setSelected(null)}
                  accessibilityLabel="Đóng chi tiết"
                >
                  Đóng
                </Button>
              </View>
              <Divider style={styles.divider} />
              <Text variant="labelLarge" style={styles.modalSection}>
                Tình trạng trên BHome
              </Text>
              <Text variant="bodyMedium">{itemStatus(selected).label}</Text>
              <Text variant="bodySmall" style={styles.modalDetail}>
                Ngày bắt đầu cư trú:{' '}
                {selected.actualResidenceFrom
                  ? displayContractDate(selected.actualResidenceFrom)
                  : 'Chưa có dữ liệu'}
              </Text>
              {selected.registrationDeadline ? (
                <Text variant="bodySmall" style={styles.modalDetail}>
                  Hạn cập nhật: {displayContractDate(selected.registrationDeadline)}
                </Text>
              ) : null}
              {selected.resultAt ? (
                <Text variant="bodySmall" style={styles.modalDetail}>
                  Tenant cập nhật kết quả lúc: {formatInstant(selected.resultAt)}
                </Text>
              ) : null}
              {selected.ownerConfirmedAt ? (
                <Text variant="bodySmall" style={styles.modalDetail}>
                  Chủ nhà xác nhận lúc: {formatInstant(selected.ownerConfirmedAt)}
                </Text>
              ) : null}
              {selected.registrationExpiresOn ? (
                <Text variant="bodySmall" style={styles.modalDetail}>
                  Ngày hết hạn đã ghi nhận: {displayContractDate(selected.registrationExpiresOn)}
                </Text>
              ) : null}
              <Text variant="bodySmall" style={styles.note}>
                Thông tin này phản ánh cập nhật trên BHome; việc đăng ký chính thức được thực hiện
                ngoài ứng dụng.
              </Text>
            </>
          ) : null}
        </Modal>
      </Portal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: staffColors.background },
  page: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 14,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  title: { color: staffColors.navy, marginBottom: 0 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statTouch: { width: '48%', flexGrow: 1, minWidth: 145, borderRadius: 12, overflow: 'hidden' },
  statCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 86,
    justifyContent: 'space-between',
  },
  statTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statLabel: { color: colors.muted },
  search: {
    backgroundColor: colors.white,
    borderRadius: 10,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 0,
  },
  searchInput: { minHeight: 44, fontSize: 14 },
  filters: { gap: 8, paddingRight: 4 },
  chip: {
    borderRadius: 9,
    backgroundColor: colors.white,
    borderColor: colors.border,
    minHeight: 38,
  },
  chipSelected: { backgroundColor: staffColors.navy },
  chipText: { color: staffColors.navy },
  chipTextSelected: { color: colors.white },
  loading: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 8 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 34, gap: 8 },
  rowTouch: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  residentRow: { flexDirection: 'row', gap: 12, padding: 13, alignItems: 'flex-start' },
  avatar: { backgroundColor: staffColors.blueSoft },
  residentInfo: { flex: 1, minWidth: 0, gap: 4 },
  nameLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  name: { color: staffColors.navy, flexShrink: 1 },
  secondary: { color: colors.muted },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  overdue: { color: staffColors.red },
  loadMore: { marginTop: 2, borderColor: staffColors.navy },
  modal: {
    backgroundColor: colors.white,
    marginHorizontal: 20,
    borderRadius: 16,
    padding: 20,
    gap: 8,
    maxWidth: 560,
    alignSelf: 'center',
    width: '90%',
  },
  modalHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  divider: { marginVertical: 4 },
  modalSection: { color: staffColors.navy, marginTop: 2 },
  modalDetail: { color: colors.ink },
  note: { color: colors.muted, marginTop: 8 },
});
