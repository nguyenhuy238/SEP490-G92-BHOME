import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Button, IconButton, Text, TouchableRipple } from 'react-native-paper';
import { Pill } from '../components/WorkspaceKit';
import { ChoiceField } from '../components/WorkflowControls';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
import {
  groupRoomMeterTasks,
  isOverduePeriodicMeterTask,
} from '../features/workspace/roomMeterTasks';
import { useSession } from '../lib/SessionProvider';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { errorMessage, type MeterTask } from '../lib/api';
import { conciseMessage } from '../lib/toast';
import { getDemoClockState } from '../../../../packages/client-core/src/demoClock';
import { colors as c } from '../theme/theme';

const PAGE_SIZE = 10;

type RoomFloor = { id: string; floor?: string | null };
type RoomPage = { items: RoomFloor[]; totalCount: number };

function floorRank(floor: string | null | undefined): number | null {
  const value = floor?.trim().toLocaleLowerCase('vi');
  if (!value) return null;
  if (/^(trệt|tầng trệt|ground|g)$/.test(value)) return 0;
  const basement = /^(?:b|hầm\s*|tầng hầm\s*)(\d+)$/.exec(value);
  if (basement) return -Number(basement[1]);
  const number = /^(?:tầng\s*)?(-?\d+)$/.exec(value);
  return number ? Number(number[1]) : null;
}

function compareRooms(a: MeterTask, b: MeterTask, floors: Map<string, string | null | undefined>) {
  const af = floors.get(a.roomId ?? '');
  const bf = floors.get(b.roomId ?? '');
  const an = floorRank(af);
  const bn = floorRank(bf);
  return (
    (an !== null && bn !== null ? an - bn : Number(an === null) - Number(bn === null)) ||
    (an === null && bn === null && af && bf ? af.localeCompare(bf, 'vi', { numeric: true }) : 0) ||
    a.room.localeCompare(b.room, 'vi', { numeric: true }) ||
    (a.roomId ?? a.id).localeCompare(b.roomId ?? b.id)
  );
}

export function MeterTasksScreen({
  initialLocationId,
  initialBillingPeriod,
}: {
  initialLocationId?: string;
  initialBillingPeriod?: string;
} = {}) {
  const { api, session } = useSession();
  const {
    staffLocationId,
    staffLocations,
    staffLocationsLoading,
    staffLocationsError,
    reloadStaffLocations,
  } = useWorkspace();
  const staff = session?.roles.includes('Staff');
  const actor = session?.userId;
  const location = staffLocations.find((item) => item.id === staffLocationId);
  const locationId = location?.id ?? '';
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState<{ scope: string; period: string } | null>(null);
  const [pagination, setPagination] = useState<{
    scope: string;
    period: string;
    page: number;
  } | null>(null);
  const [state, setState] = useState<{
    api: typeof api;
    key: string;
    tasks: MeterTask[];
    floors: Map<string, string | null | undefined>;
    error: string;
  } | null>(null);
  const scope = `${actor ?? ''}:${locationId}`;
  const demoClock = getDemoClockState();
  const key = `${scope}:${revision}:${demoClock?.version ?? ''}:${demoClock?.businessDate ?? ''}`;
  const current = locationId && state?.key === key && state.api === api ? state : null;
  const loading = !!api && !!staff && !!locationId && !current;

  const reloadTasks = useCallback(() => setRevision((value) => value + 1), []);
  const reload = useCallback(() => {
    reloadStaffLocations();
    reloadTasks();
  }, [reloadStaffLocations, reloadTasks]);
  useFocusEffect(
    useCallback(() => {
      reloadTasks();
    }, [reloadTasks]),
  );
  const header = useWorkspaceHeaderRefresh(reload, loading || staffLocationsLoading, {
    title: 'Ghi chỉ số điện nước',
  });

  useEffect(() => {
    if (!api || !staff || !locationId) return;
    const controller = new AbortController();
    const signal = controller.signal;
    void (async () => {
      try {
        const tasks: MeterTask[] = [];
        for (let page = 1; ; page++) {
          const batch = await api.request<MeterTask[]>(
            `/api/v1/capture/meter-tasks?page=${page}&locationId=${encodeURIComponent(locationId)}`,
            { signal },
          );
          if (signal.aborted) return;
          tasks.push(...batch);
          if (batch.length < 100) break;
        }
        // Use the existing Staff-scoped room catalogue for the actual floor, not
        // the first digit of a room number (which may be an arbitrary code).
        const floors = new Map<string, string | null | undefined>();
        try {
          for (let page = 1; ; page++) {
            const result = await api.request<RoomPage>(
              `/api/v1/rooms?locationId=${encodeURIComponent(locationId)}&page=${page}&pageSize=100`,
              { signal },
            );
            if (signal.aborted) return;
            for (const room of result.items) floors.set(room.id, room.floor);
            if (!result.items.length || page * 100 >= result.totalCount) break;
          }
        } catch {
          // Room metadata is supplemental; tasks remain usable in natural room order.
          floors.clear();
        }
        if (!signal.aborted) setState({ api, key, tasks, floors, error: '' });
      } catch (cause) {
        if (!signal.aborted)
          setState({
            api,
            key,
            tasks: [],
            floors: new Map(),
            error: conciseMessage(errorMessage(cause)),
          });
      }
    })();
    return () => controller.abort();
  }, [api, key, locationId, staff]);

  const tasks = useMemo(
    () =>
      (current?.tasks ?? []).filter(
        (task) =>
          task.purpose === 1 &&
          !!task.billingPeriod &&
          task.status !== 3 &&
          (task.locationId ? task.locationId === locationId : task.location === location?.label) &&
          (!task.assignedStaffUserId || task.assignedStaffUserId === actor),
      ),
    [current, locationId, location?.label, actor],
  );
  const requestedPeriod =
    initialLocationId === locationId &&
    initialBillingPeriod &&
    /^\d{4}-(0[1-9]|1[0-2])-01$/.test(initialBillingPeriod)
      ? initialBillingPeriod
      : '';
  const periods = useMemo(
    () =>
      [
        ...new Set([
          ...tasks.map((task) => task.billingPeriod!),
          ...(requestedPeriod ? [requestedPeriod] : []),
        ]),
      ]
        .sort()
        .reverse(),
    [tasks, requestedPeriod],
  );
  const period =
    selection?.scope === scope && periods.includes(selection.period)
      ? selection.period
      : requestedPeriod || periods[0] || '';
  const rooms = useMemo(
    () =>
      groupRoomMeterTasks(tasks.filter((task) => task.billingPeriod === period)).sort((a, b) =>
        compareRooms(a[0]!, b[0]!, current?.floors ?? new Map()),
      ),
    [tasks, period, current],
  );

  const pageCount = Math.max(1, Math.ceil(rooms.length / PAGE_SIZE));
  const page =
    pagination?.scope === scope && pagination.period === period
      ? Math.min(pagination.page, pageCount)
      : 1;
  const visibleRooms = rooms.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const changePage = (next: number) =>
    setPagination({ scope, period, page: Math.max(1, Math.min(next, pageCount)) });

  if (!staff) return <Text>Chỉ Staff được phép ghi chỉ số điện nước.</Text>;

  return (
    <View style={styles.screen}>
      {!header && (
        <View style={styles.header}>
          <Text variant="titleMedium" style={styles.title}>
            Ghi chỉ số điện nước
          </Text>
          <IconButton
            icon="refresh"
            accessibilityLabel="Tải lại danh sách ghi chỉ số"
            disabled={loading || staffLocationsLoading}
            onPress={reload}
          />
        </View>
      )}
      {staffLocationsLoading && !location ? (
        <ActivityIndicator accessibilityLabel="Đang tải cơ sở được phân công" />
      ) : staffLocationsError && !location ? (
        <View style={styles.state}>
          <Text>Không tải được cơ sở được phân công</Text>
          <Text accessibilityRole="alert">{staffLocationsError}</Text>
          <Button onPress={reload}>Thử lại</Button>
        </View>
      ) : !location ? (
        <View style={styles.state}>
          <Text>Chưa có cơ sở được phân công</Text>
          <Button onPress={reload}>Tải lại</Button>
        </View>
      ) : loading ? (
        <View style={styles.state}>
          <ActivityIndicator accessibilityLabel="Đang tải danh sách phòng" />
          <Text>Đang tải danh sách phòng cần ghi chỉ số…</Text>
        </View>
      ) : current?.error ? (
        <View style={styles.state}>
          <Text accessibilityRole="alert">{current.error}</Text>
          <Button onPress={reload}>Thử lại</Button>
        </View>
      ) : (
        <>
          <ChoiceField
            label="Kỳ ghi chỉ số"
            value={period}
            options={periods.map((id) => ({ id, label: `${id.slice(5, 7)}/${id.slice(0, 4)}` }))}
            onChange={(value) => {
              setSelection({ scope, period: value });
              setPagination({ scope, period: value, page: 1 });
            }}
            disabled={!periods.length}
            placeholder="Chưa có kỳ ghi"
          />
          <View style={styles.grid}>
            {visibleRooms.map((group) => {
              const first = group[0]!;
              const done = group.every((task) => task.status === 2 && !!task.confirmedReadingId);
              const overdue = group.some(isOverduePeriodicMeterTask);
              const label = done ? 'Đã ghi' : overdue ? 'Quá hạn' : 'Chưa ghi';
              return (
                <TouchableRipple
                  key={first.id}
                  style={[styles.tile, overdue && styles.overdueTile]}
                  accessibilityRole="button"
                  accessibilityLabel={`Phòng ${first.room}, ${label}`}
                  onPress={() => router.push({ pathname: '/meter', params: { taskId: first.id } })}
                >
                  <View style={styles.tileContent}>
                    <Text variant="titleMedium" style={styles.room}>
                      Phòng {first.room}
                    </Text>
                    <Pill tone={done ? 'green' : overdue ? 'red' : 'amber'}>{label}</Pill>
                  </View>
                </TouchableRipple>
              );
            })}
          </View>
          {pageCount > 1 && (
            <View style={styles.pagination}>
              <IconButton
                icon="chevron-left"
                accessibilityLabel="Trang trước"
                disabled={page === 1}
                onPress={() => changePage(page - 1)}
                style={styles.pageButton}
              />
              <Text accessibilityLiveRegion="polite" variant="labelLarge" style={styles.pageText}>
                Trang {page} / {pageCount}
              </Text>
              <IconButton
                icon="chevron-right"
                accessibilityLabel="Trang sau"
                disabled={page === pageCount}
                onPress={() => changePage(page + 1)}
                style={styles.pageButton}
              />
            </View>
          )}
          {!rooms.length && (
            <View style={styles.state}>
              <Text>Chưa có tác vụ ghi chỉ số được giao</Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, color: c.primary, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48%',
    flexGrow: 0,
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  tileContent: {
    padding: 12,
    gap: 8,
    alignItems: 'flex-start',
    minHeight: 84,
    justifyContent: 'center',
  },
  overdueTile: { borderColor: c.red, backgroundColor: c.redSoft },
  room: { color: c.ink, fontWeight: '700', flexShrink: 1 },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  pageButton: { margin: 0 },
  pageText: { color: c.primary },
  state: { alignItems: 'center', padding: 16, gap: 8 },
});
