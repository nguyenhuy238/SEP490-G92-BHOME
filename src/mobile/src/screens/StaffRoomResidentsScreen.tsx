import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Button,
  Icon,
  IconButton,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import { ChoiceField } from '../components/WorkflowControls';
import { useSession } from '../lib/SessionProvider';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useCaptureScope } from '../features/onboarding/useCaptureScope';
import { residentStatus } from '../features/onboarding/residentPresentation';
import { colors as c, staffColors as s } from '../theme/theme';
import type { Resident } from '../lib/api';
import { householdClient, type HouseholdView } from '../../../../packages/client-core/src/households';

const PAGE_SIZE = 12;
type RoomFilter = 'pending' | 'all';
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();

export function RoomOverview() {
  const { roomId, locationId } = useLocalSearchParams<{ roomId?: string; locationId?: string }>();
  return roomId ? (
    <RoomResidents key={`${locationId}:${roomId}`} roomId={roomId} locationId={locationId} />
  ) : (
    <RoomDirectory />
  );
}

function useRoomScope(initialLocationId = '') {
  const scope = useCaptureScope({
    autoSelectAssignedLocation: true,
    inlineErrors: true,
    initialLocationId,
  });
  const { reload } = scope;
  const hasFocused = useRef(false);
  // Refresh after verification/onboarding, while retaining the directory's local filters.
  useFocusEffect(
    useCallback(() => {
      if (hasFocused.current) reload();
      hasFocused.current = true;
    }, [reload]),
  );
  return scope;
}

function StateMessage({
  loading,
  error,
  title,
  onRetry,
}: {
  loading?: boolean;
  error?: string;
  title: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.state}>
      {loading ? (
        <ActivityIndicator accessibilityLabel="Đang tải danh sách" />
      ) : (
        <Icon
          source={error ? 'cloud-alert-outline' : 'account-group-outline'}
          size={28}
          color={c.muted}
        />
      )}
      <Text style={styles.stateTitle}>
        {loading ? 'Đang tải dữ liệu…' : error ? 'Chưa tải được dữ liệu' : title}
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.muted}>
          {error}
        </Text>
      )}
      {!!error && (
        <Button onPress={onRetry} contentStyle={styles.touch}>
          Thử lại
        </Button>
      )}
    </View>
  );
}

function roomStatus(value?: string | null) {
  switch (value) {
    case 'Available':
      return { label: 'Phòng trống', color: '#64748B', background: '#F1F5F9' };
    case 'Occupied':
      return { label: 'Đang thuê', color: s.green, background: s.greenSoft };
    case 'OnHold':
      return { label: 'Đã giữ chỗ', color: s.blue, background: s.blueSoft };
    case 'Unavailable':
      return { label: 'Không khả dụng', color: s.red, background: s.redSoft };
    default:
      return { label: 'Chưa có trạng thái', color: c.muted, background: c.soft };
  }
}

function RoomDirectory() {
  const { go, staffLocationId, preview } = useWorkspace();
  const scope = useRoomScope();
  const { width } = useWindowDimensions();
  const columns = width >= 360 ? 2 : 1;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RoomFilter>('all');
  const [page, setPage] = useState(1);
  const list = useRef<FlatList>(null);
  const rooms = useMemo(() => {
    const grouped = new Map<string, Resident[]>();
    for (const resident of scope.residents) {
      const group = grouped.get(resident.roomId) ?? [];
      group.push(resident);
      grouped.set(resident.roomId, group);
    }
    return scope.rooms
      .map((room) => {
        const residents = grouped.get(room.id) ?? [];
        return {
          ...room,
          residents,
          pending: residents.filter((r) => r.verificationStatus === 0).length,
        };
      })
      .sort(
        (a, b) =>
          Number(b.pending > 0) - Number(a.pending > 0) ||
          a.label.localeCompare(b.label, 'vi', { numeric: true }),
      );
  }, [scope.rooms, scope.residents]);
  const filtered = useMemo(() => {
    const search = normalize(query);
    return rooms.filter(
      (room) =>
        (filter === 'all' || room.pending > 0) &&
        (!search ||
          normalize(room.label).includes(search) ||
          room.residents.some((resident) => normalize(resident.displayLabel).includes(search))),
    );
  }, [rooms, filter, query]);
  const totalResidents = rooms.reduce((sum, room) => sum + room.residents.length, 0);
  const totalPending = rooms.reduce((sum, room) => sum + room.pending, 0);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const ready = !scope.loading && !scope.error;
  function changePage(next: number) {
    setPage(next);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }

  return (
    <View style={styles.screen}>
      <View style={styles.controls}>
        <View style={styles.heading}>
          <Text variant="titleLarge" style={styles.title}>
            Quản lý phòng
          </Text>
          <IconButton
            icon="refresh"
            accessibilityLabel="Tải lại danh sách"
            disabled={scope.loading}
            onPress={scope.reload}
            style={styles.iconButton}
            size={22}
          />
        </View>
        <View style={styles.quickActions}>
          <Button compact icon="file-document-outline" style={styles.quickAction}
            contentStyle={styles.quickActionContent} onPress={() => go('signing')}>
            Hợp đồng
          </Button>
          <Button compact icon="plus" style={styles.quickAction}
            contentStyle={styles.quickActionContent} onPress={() => go('prepare-contract')}>
            Tạo hợp đồng
          </Button>
          <Button compact icon="bookmark-outline" style={styles.quickAction}
            contentStyle={styles.quickActionContent} onPress={() => go('prepare-contract', { kind: 'Holding' })}>
            Giữ chỗ
          </Button>
        </View>
        {scope.locations.length > 1 ? (
          <ChoiceField
            label="Cơ sở"
            value={scope.location}
            options={scope.locations}
            onChange={(id) => { scope.selectLocation(id); changePage(1); }}
            placeholder="Chọn cơ sở được phân công"
          />
        ) : preview || scope.location !== staffLocationId || !staffLocationId ? (
          <Text numberOfLines={1} style={styles.muted}>
            {scope.locations.find((l) => l.id === scope.location)?.label ?? 'Cơ sở được phân công'}
          </Text>
        ) : null}
        <View style={styles.summary}>
          {[
            [ready ? rooms.length : '—', 'phòng'],
            [ready ? totalResidents : '—', 'cư dân'],
            [ready ? totalPending : '—', 'cư dân chờ xác minh'],
          ].map(([count, label], index) => (
            <View key={label} style={styles.metric}>
              <Text variant="titleLarge" style={[styles.title, index === 2 && { color: s.orange }]}>
                {count}
              </Text>
              <Text style={styles.metricLabel}>{label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.search}>
          <Icon source="magnify" size={21} color={c.muted} />
          <TextInput
            accessibilityLabel="Tìm phòng hoặc cư dân"
            placeholder="Số phòng hoặc tên cư dân"
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              changePage(1);
            }}
            style={styles.searchInput}
            placeholderTextColor={c.muted}
            returnKeyType="search"
          />
          {!!query && (
            <IconButton
              icon="close"
              size={18}
              style={styles.iconButton}
              accessibilityLabel="Xóa tìm kiếm"
              onPress={() => {
                setQuery('');
                changePage(1);
              }}
            />
          )}
        </View>
        <View style={styles.filters}>
          {(
            [
              { id: 'pending', label: 'Cần xử lý' },
              { id: 'all', label: 'Tất cả phòng' },
            ] as const
          ).map((tab) => (
            <TouchableRipple
              key={tab.id}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: filter === tab.id }}
              onPress={() => {
                setFilter(tab.id);
                changePage(1);
              }}
              style={[styles.filter, filter === tab.id && styles.filterSelected]}
            >
              <Text style={[styles.filterText, filter === tab.id && styles.selectedText]}>
                {tab.label}
              </Text>
            </TouchableRipple>
          ))}
        </View>
      </View>
      <FlatList
        ref={list}
        data={ready ? filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) : []}
        numColumns={columns}
        key={columns}
        keyExtractor={(room) => room.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        columnWrapperStyle={columns === 2 ? styles.roomColumns : undefined}
        initialNumToRender={PAGE_SIZE}
        ListEmptyComponent={
          <StateMessage
            loading={scope.loading}
            error={scope.error}
            onRetry={scope.reload}
            title={
              !scope.location
                ? 'Chưa có cơ sở được phân công'
                : query
                  ? 'Không tìm thấy phòng phù hợp'
                  : filter === 'pending'
                    ? 'Không có cư dân chờ xác minh'
                    : 'Chưa có phòng trong cơ sở này'
            }
          />
        }
        renderItem={({ item: room }) => {
          const status = roomStatus(room.status);
          return (
            <TouchableRipple
              onPress={() => go('rooms', { roomId: room.id, locationId: scope.location })}
              accessibilityRole="button"
              accessibilityLabel={`Phòng ${room.label}, ${status.label}, ${room.residents.length} cư dân${room.capacity != null ? ` trên sức chứa ${room.capacity}` : ''}, ${room.pending} chờ xác minh`}
              style={[styles.roomCard, { width: columns === 2 ? '48.5%' : '100%' }]}
            >
              <View style={styles.roomCardContent}>
                <View style={styles.roomCardTop}>
                  <Text numberOfLines={1} style={styles.roomCardTitle}>Phòng {room.label}</Text>
                  <Icon source="chevron-right" size={21} color={c.muted} />
                </View>
                <View style={styles.badgeRow}>
                  <View style={[styles.statusBadge, { backgroundColor: status.background }]}>
                    <View style={[styles.statusDot, { backgroundColor: status.color }]} />
                    <Text style={{ color: status.color, fontSize: 11, fontWeight: '600' }}>{status.label}</Text>
                  </View>
                  {room.pending > 0 && (
                    <View style={[styles.statusBadge, { backgroundColor: s.orangeSoft }]}>
                      <Text style={{ color: s.orange, fontSize: 11, fontWeight: '600' }}>{room.pending} chờ xác minh</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.muted}>
                  {room.residents.length} cư dân{room.capacity != null ? ` · Sức chứa ${room.capacity}` : ''}
                </Text>
              </View>
            </TouchableRipple>
          );
        }}
      />
      {ready && filtered.length > 0 && (
        <View style={styles.pagination}>
          <IconButton
            icon="chevron-left"
            accessibilityLabel="Trang trước"
            disabled={currentPage === 1}
            onPress={() => changePage(currentPage - 1)}
            style={styles.iconButton}
          />
          <Text accessibilityLiveRegion="polite" style={styles.pageText}>
            {currentPage}/{pageCount} · {filtered.length} phòng
          </Text>
          <IconButton
            icon="chevron-right"
            accessibilityLabel="Trang sau"
            disabled={currentPage === pageCount}
            onPress={() => changePage(currentPage + 1)}
            style={styles.iconButton}
          />
        </View>
      )}
    </View>
  );
}

function RoomResidents({ roomId, locationId }: { roomId: string; locationId?: string }) {
  const { go, requestNavigation } = useWorkspace();
  const { api } = useSession();
  const scope = useRoomScope(locationId);
  const room =
    scope.location === locationId ? scope.rooms.find((item) => item.id === roomId) : undefined;
  const residents = useMemo(
    () =>
      scope.residents
        .filter((r) => r.roomId === roomId)
        .sort(
          (a, b) =>
            Number(b.verificationStatus === 0) - Number(a.verificationStatus === 0) ||
            a.displayLabel.localeCompare(b.displayLabel, 'vi'),
        ),
    [scope.residents, roomId],
  );
  const ready = !scope.loading && !scope.error;
  const [expandedResident, setExpandedResident] = useState('');
  const [household, setHousehold] = useState<HouseholdView | null>(null);
  const [householdRequest, setHouseholdRequest] = useState<{ key: string; error: string }>({ key: '', error: '' });
  const roomLocation = scope.locations.find((item) => item.id === locationId);
  const roomState = roomStatus(room?.status);
  const verifiedCount = residents.filter((item) => item.verificationStatus === 1).length;
  const pendingCount = residents.filter((item) => item.verificationStatus === 0).length;
  const activeExpandedResident = residents.length === 1 ? residents[0].id : expandedResident;
  useEffect(() => {
    const representative = residents.find(
      (item) => item.residentType === 0 && item.verificationStatus === 1,
    );
    if (!api || !representative) return;
    const controller = new AbortController();
    void householdClient((path, init) => api.request(path, init)).get(representative.id, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted)
          setHousehold({
            ...result,
            representative: result.representative
              ? { ...result.representative, phone: result.representative.phone ?? null, maskedCitizenNumber: null }
              : null,
            members: result.members.map((member) => ({
              ...member,
              citizenNumber: null,
            })),
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setHouseholdRequest({ key: representative.id, error: 'Ch�a t?i ��?c th�ng tin c� d�n m? r?ng.' });
      });
    return () => controller.abort();
  }, [api, residents]);
  const householdRepresentativeId = residents.find(
    (item) => item.residentType === 0 && item.verificationStatus === 1,
  )?.id;
  const householdLoading = !!householdRepresentativeId &&
    household?.representativeResidentId !== householdRepresentativeId &&
    householdRequest.key !== householdRepresentativeId;
  const householdError = householdRequest.key === householdRepresentativeId ? householdRequest.error : '';
  const tenantDetails = (resident: Resident) => {
    if (resident.id === household?.representativeResidentId) return household.representative ?? undefined;
    return household?.members.find((item) => item.residentId === resident.id);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.controls}>
        <View style={styles.heading}>
          <IconButton
            icon="arrow-left"
            accessibilityLabel="Quay lại danh sách phòng"
            onPress={() =>
              requestNavigation(() => (router.canGoBack() ? router.back() : go('rooms')))
            }
            style={styles.iconButton}
          />
          <View style={styles.flex}>
            <Text variant="titleLarge" style={styles.title}>
              {room ? `Phòng ${room.label}` : 'Chi tiết phòng'}
            </Text>
            <Text style={styles.muted}>{roomLocation?.label ?? 'Phạm vi cơ sở được phân công'}</Text>
          </View>
          <IconButton
            icon="refresh"
            accessibilityLabel="Tải lại cư dân"
            disabled={scope.loading}
            onPress={scope.reload}
            style={styles.iconButton}
          />
        </View>
      </View>
      <FlatList
        data={ready && room ? residents : []}
        keyExtractor={(resident) => resident.id}
        initialNumToRender={12}
        contentContainerStyle={styles.list}
        ListHeaderComponent={room && ready ? (
          <View style={styles.detailSummary}>
            <View style={styles.summaryTop}>
              <View style={[styles.statusBadge, { backgroundColor: roomState.background }]}>
                <View style={[styles.statusDot, { backgroundColor: roomState.color }]} />
                <Text style={{ color: roomState.color, fontWeight: '600' }}>{roomState.label}</Text>
              </View>
              <Text style={styles.summaryCount}>
                {room.capacity != null ? `${residents.length}/${room.capacity} người` : `${residents.length} người`}
              </Text>
            </View>
            <View style={styles.detailCounts}>
              <View style={styles.detailCountItem}>
                <Text style={styles.detailCountValue}>{verifiedCount}</Text>
                <Text style={styles.metricLabel}>Đã xác minh</Text>
              </View>
              <View style={styles.detailCountItem}>
                <Text style={[styles.detailCountValue, pendingCount > 0 && { color: s.orange }]}>{pendingCount}</Text>
                <Text style={styles.metricLabel}>Chờ xác minh</Text>
              </View>
            </View>
            <Text style={styles.sectionLabel}>Cư dân trong phòng</Text>
          </View>
        ) : undefined}
        ListEmptyComponent={
          <StateMessage
            loading={scope.loading}
            error={scope.error}
            onRetry={scope.reload}
            title={
              room ? 'Phòng chưa có người ở' : 'Phòng không còn khả dụng trong cơ sở được phân công'
            }
          />
        }
        renderItem={({ item: resident }) => {
          const status = residentStatus(resident.verificationStatus);
          const detail = tenantDetails(resident);
                const expanded = activeExpandedResident === resident.id;
          const displayName = detail?.fullName || resident.displayLabel;
          const initials = residentInitials(displayName);
          const familyResidentRole =
            resident.residentType === 0
              ? household?.members.length
                ? 'Người đại diện'
                : ''
              : 'Thành viên cùng ở';
          return (
            <View style={styles.residentCard}>
              <TouchableRipple
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={`${expanded ? 'Thu gọn' : 'Mở'} cư dân ${displayName}, ${familyResidentRole || 'cư dân'}, ${status.label}`}
                onPress={() => setExpandedResident(expanded ? '' : resident.id)}
                style={styles.residentHeader}
              >
                <>
                  <View style={[styles.avatar, { backgroundColor: status.background }]}>
                    <Text style={[styles.initials, { color: status.color }]}>{initials}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text numberOfLines={1} style={styles.roomName}>{displayName}</Text>
                    {!!familyResidentRole && <Text style={styles.muted}>{familyResidentRole}</Text>}
                    <Text style={{ color: status.color, fontSize: 12 }}>{status.label}</Text>
                </View>
                  <Icon source={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={c.muted} />
                </>
              </TouchableRipple>
              {expanded && (
                <View style={styles.residentExpanded}>
                  {!!detail?.phone && <DetailLine label="Điện thoại" value={detail.phone} />}
                  {!!resident.email && <DetailLine label="Email" value={resident.email} />}
                  {!!resident.confirmedAt && <DetailLine label="Xác minh lúc" value={new Date(resident.confirmedAt).toLocaleDateString('vi-VN')} />}
                  {!!familyResidentRole && <DetailLine label="Vai trò" value={familyResidentRole} />}
                  {householdLoading && resident.residentType === 0 && <Text style={styles.muted}>Đang tải thông tin…</Text>}
                  {!!householdError && resident.residentType === 0 && <Text style={styles.muted}>{householdError}</Text>}
                  <Button compact icon="account-box-outline" contentStyle={styles.profileButton}
                    onPress={() => go('onboarding', {
                      residentId: resident.id,
                      locationId: scope.location,
                      roomId,
                      ...(household?.representativeResidentId ? { representativeResidentId: household.representativeResidentId } : {}),
                    })}>
                    Xem hồ sơ cư dân
                  </Button>
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function residentInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length || /^người ở \d+$/i.test(name.trim())) return '?';
  return parts.length === 1
    ? parts[0].slice(0, 2).toLocaleUpperCase('vi')
    : `${parts[0][0]}${parts[parts.length - 1][0]}`.toLocaleUpperCase('vi');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  controls: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 8,
    backgroundColor: c.background,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: c.ink, fontWeight: '700', flexShrink: 1 },
  iconButton: { margin: 0, minWidth: 44, minHeight: 44 },
  flex: { flex: 1, minWidth: 0, gap: 3 },
  muted: { color: c.muted, fontSize: 12 },
  quickActions: { flexDirection: 'row', gap: 4 },
  quickAction: { flex: 1, borderRadius: 10, marginHorizontal: 0 },
  quickActionContent: { minHeight: 42, paddingHorizontal: 0 },
  summary: { flexDirection: 'row', paddingVertical: 6, backgroundColor: c.white, borderRadius: 10 },
  metric: { flex: 1, alignItems: 'center', paddingHorizontal: 4, gap: 2 },
  metricLabel: { fontSize: 11, color: c.muted, textAlign: 'center' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 10,
    backgroundColor: c.white,
    paddingLeft: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: c.ink,
    minHeight: 44,
    paddingVertical: 8,
  },
  filters: { flexDirection: 'row', gap: 6 },
  filter: {
    flex: 1,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.white,
  },
  filterSelected: { backgroundColor: c.primary, borderColor: c.primary },
  filterText: { fontSize: 12, fontWeight: '600', color: c.ink },
  selectedText: { color: c.white, fontWeight: '600' },
  touch: { minHeight: 44 },
  list: { paddingHorizontal: 12, paddingBottom: 16, flexGrow: 1, gap: 8 },
  roomColumns: { justifyContent: 'space-between', gap: 8 },
  roomRow: {
    backgroundColor: c.white,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    minHeight: 68,
  },
  pendingRow: { backgroundColor: s.orangeSoft, borderLeftWidth: 3, borderLeftColor: s.orange },
  roomCard: { backgroundColor: c.white, borderWidth: 1, borderColor: c.border, borderRadius: 14, marginBottom: 8 },
  roomCardContent: { minHeight: 112, padding: 10, gap: 8, justifyContent: 'center' },
  roomCardTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  roomCardTitle: { flex: 1, minWidth: 0, color: c.ink, fontSize: 15, fontWeight: '700' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  statusBadge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 68,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  roomName: { color: c.ink, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  roomCounts: { alignItems: 'flex-end', gap: 3 },
  pendingText: { color: s.orange, fontWeight: '600', fontSize: 12 },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  state: { alignItems: 'center', padding: 24, gap: 12 },
  stateTitle: { fontWeight: '600', textAlign: 'center', color: c.ink },
  detailSummary: { padding: 12, gap: 12, backgroundColor: c.white, borderRadius: 14, borderWidth: 1, borderColor: c.border, marginBottom: 8 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  summaryCount: { color: c.ink, fontWeight: '600' },
  detailCounts: { flexDirection: 'row', gap: 10 },
  detailCountItem: { flex: 1, padding: 8, borderRadius: 10, backgroundColor: c.background, alignItems: 'center', gap: 2 },
  detailCountValue: { color: c.ink, fontSize: 18, fontWeight: '700' },
  sectionLabel: { color: c.ink, fontWeight: '700', marginTop: 2 },
  residentCard: { backgroundColor: c.white, borderRadius: 14, borderWidth: 1, borderColor: c.border, marginBottom: 8, overflow: 'hidden' },
  residentHeader: { minHeight: 68, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 14, fontWeight: '700' },
  residentExpanded: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, borderTopWidth: 1, borderTopColor: c.border, gap: 2 },
  detailLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 34 },
  detailValue: { flex: 1, textAlign: 'right', color: c.ink, fontSize: 13 },
  profileButton: { minHeight: 44, alignSelf: 'flex-start' },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.white,
  },
  pageText: { color: c.muted, fontSize: 12 },
});
