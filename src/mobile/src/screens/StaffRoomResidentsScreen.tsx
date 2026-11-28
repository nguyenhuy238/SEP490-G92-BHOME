import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Button,
  Icon,
  IconButton,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useCaptureScope } from '../features/onboarding/useCaptureScope';
import { residentRole, residentStatus } from '../features/onboarding/residentPresentation';
import { colors as c, staffColors as s } from '../theme/theme';
import type { Resident } from '../lib/api';

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

function RoomDirectory() {
  const { go, staffLocationId, preview } = useWorkspace();
  const scope = useRoomScope();
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
            Phòng được phân công
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
        <View style={styles.contractActions}>
          <Button
            compact
            icon="file-document-outline"
            onPress={() => go('signing')}
            contentStyle={styles.touch}
          >
            Hợp đồng thuê
          </Button>
          <Button compact icon="plus" onPress={() => go('onboarding')} contentStyle={styles.touch}>
            Tạo hợp đồng thuê
          </Button>
          <Button
            compact
            onPress={() => go('prepare-contract', { kind: 'Holding' })}
            contentStyle={styles.touch}
          >
            Tạo hợp đồng giữ chỗ
          </Button>
        </View>
        {scope.locations.length > 1 ? (
          <View style={styles.locations}>
            {scope.locations.map((location) => (
              <TouchableRipple
                key={location.id}
                onPress={() => {
                  scope.selectLocation(location.id);
                  changePage(1);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: scope.location === location.id }}
                accessibilityLabel={`Cơ sở ${location.label}`}
                style={[styles.location, scope.location === location.id && styles.locationSelected]}
              >
                <Text
                  numberOfLines={1}
                  style={scope.location === location.id ? styles.selectedText : styles.muted}
                >
                  {location.label}
                </Text>
              </TouchableRipple>
            ))}
          </View>
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
        <Button
          mode="contained"
          icon="account-plus-outline"
          disabled={!scope.location || !ready}
          onPress={() => go('onboarding', { locationId: scope.location })}
          contentStyle={styles.touch}
        >
          Tiếp nhận cư dân
        </Button>
      </View>
      <FlatList
        ref={list}
        data={ready ? filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) : []}
        keyExtractor={(room) => room.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
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
        renderItem={({ item: room }) => (
          <TouchableRipple
            onPress={() => go('rooms', { roomId: room.id, locationId: scope.location })}
            accessibilityRole="button"
            accessibilityLabel={`Phòng ${room.label}, ${room.residents.length} cư dân, ${room.pending} chờ xác minh`}
            style={styles.roomRow}
          >
            <View style={styles.rowInner}>
              <View style={styles.flex}>
                <Text numberOfLines={1} style={styles.roomName}>
                  Phòng {room.label}
                </Text>
                <Text style={styles.muted}>{room.residents.length} cư dân</Text>
              </View>
              {room.pending > 0 && (
                <View style={styles.pendingTag}>
                  <Text style={styles.pendingText}>{room.pending} chờ xác minh</Text>
                </View>
              )}
              <Icon source="chevron-right" size={22} color={c.muted} />
            </View>
          </TouchableRipple>
        )}
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
              {room ? `Phòng ${room.label}` : 'Cư dân trong phòng'}
            </Text>
            <Text style={styles.muted}>
              {room && ready ? `${residents.length} cư dân` : 'Phạm vi cơ sở được phân công'}
            </Text>
          </View>
          <IconButton
            icon="refresh"
            accessibilityLabel="Tải lại cư dân"
            disabled={scope.loading}
            onPress={scope.reload}
            style={styles.iconButton}
          />
        </View>
        {room && ready && (
          <Button
            mode="contained"
            icon="account-plus-outline"
            contentStyle={styles.touch}
            onPress={() => go('onboarding', { locationId: scope.location, roomId })}
          >
            Tiếp nhận cư dân
          </Button>
        )}
      </View>
      <FlatList
        data={ready && room ? residents : []}
        keyExtractor={(resident) => resident.id}
        initialNumToRender={12}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <StateMessage
            loading={scope.loading}
            error={scope.error}
            onRetry={scope.reload}
            title={
              room ? 'Phòng chưa có cư dân' : 'Phòng không còn khả dụng trong cơ sở được phân công'
            }
          />
        }
        renderItem={({ item: resident }) => {
          const status = residentStatus(resident.verificationStatus);
          return (
            <TouchableRipple
              accessibilityRole="button"
              accessibilityLabel={`Xem cư dân ${resident.displayLabel}, ${residentRole(resident.residentType)}, ${status.label}`}
              onPress={() =>
                go('onboarding', { residentId: resident.id, locationId: scope.location, roomId })
              }
              style={styles.roomRow}
            >
              <View style={styles.rowInner}>
                <View style={[styles.statusIcon, { backgroundColor: status.background }]}>
                  <Icon source={status.icon} size={22} color={status.color} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.roomName}>{resident.displayLabel}</Text>
                  <Text style={styles.muted}>{residentRole(resident.residentType)}</Text>
                  <Text style={{ color: status.color }}>{status.label}</Text>
                </View>
                <Icon source="chevron-right" size={22} color={c.muted} />
              </View>
            </TouchableRipple>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: s.background },
  controls: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 8,
    backgroundColor: s.background,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contractActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4 },
  title: { color: s.navy, fontWeight: '700', flexShrink: 1 },
  iconButton: { margin: 0, minWidth: 44, minHeight: 44 },
  flex: { flex: 1, minWidth: 0, gap: 3 },
  muted: { color: c.muted, fontSize: 12 },
  summary: {
    flexDirection: 'row',
    paddingVertical: 8,
    backgroundColor: c.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border,
  },
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
  filters: { flexDirection: 'row', gap: 8 },
  filter: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.white,
  },
  filterSelected: { backgroundColor: s.navy, borderColor: s.navy },
  filterText: { fontSize: 13, fontWeight: '600', color: c.ink },
  selectedText: { color: c.white, fontWeight: '600' },
  locations: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  location: {
    minHeight: 44,
    maxWidth: '100%',
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
  },
  locationSelected: { backgroundColor: s.navy, borderColor: s.navy },
  touch: { minHeight: 44 },
  list: { paddingHorizontal: 16, paddingBottom: 16, flexGrow: 1 },
  roomRow: {
    backgroundColor: c.white,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    minHeight: 60,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  roomName: { color: c.ink, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  pendingTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: s.orangeSoft,
  },
  pendingText: { color: c.amber, fontWeight: '600', fontSize: 12 },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  state: { alignItems: 'center', padding: 24, gap: 12 },
  stateTitle: { fontWeight: '600', textAlign: 'center', color: c.ink },
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
