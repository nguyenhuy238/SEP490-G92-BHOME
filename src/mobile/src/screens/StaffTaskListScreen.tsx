import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Icon,
  IconButton,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { queryPolicies } from '../lib/queryPolicies';
import {
  isEmbeddedInitialMeterTask,
  isEmbeddedMoveInInventory,
  isMainMoveInWork,
  taskStatusLabels,
  type OperationalTask,
  type TaskPage,
} from '../services/operationalTasks';
import { colors as c } from '../theme/theme';

const filters = [
  { id: '', label: 'Tất cả' },
  ...Object.entries(taskStatusLabels).map(([id, label]) => ({ id, label })),
];
type AssignedLocation = { id: string; name: string };

export function StaffTaskListScreen() {
  const { go, staffLocationId } = useWorkspace();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const query = useWorkspaceQuery<TaskPage<OperationalTask>>(
    staffLocationId
      ? `/api/v1/operational-tasks?page=${page}&pageSize=20&locationId=${encodeURIComponent(staffLocationId)}${status ? `&status=${status}` : ''}`
      : null,
    { cache: queryPolicies.tasks, notifyError: false },
  );
  // The directory is fetched once through the shared query cache. Page
  // transitions can unsubscribe briefly without losing the cached names.
  const needsLocationLabels = (query.data?.items.length ?? 0) > 0;
  // This endpoint returns every currently assigned Location. The capture
  // directory is capped at 100 results and could omit names for visible tasks.
  const locations = useWorkspaceQuery<AssignedLocation[]>(
    needsLocationLabels ? '/api/v1/locations/assigned-to-me' : null,
    {
      cache: queryPolicies.rooms,
      notifyError: false,
    },
  );
  const inHeader = useWorkspaceHeaderRefresh(query.reload, query.fetching);
  const data = staffLocationId ? query.data : null;
  const items = (data?.items ?? []).filter(
    (task) => !isEmbeddedMoveInInventory(task) && !isEmbeddedInitialMeterTask(task),
  );
  const locationNames = useMemo(
    () =>
      new Map(
        (Array.isArray(locations.data) ? locations.data : [])
          .filter((location) => location.id && location.name?.trim())
          .map((location) => [location.id, location.name.trim()] as const),
      ),
    [locations.data],
  );
  const missingLocationName = locations.fetching
    ? 'Đang tải tên cơ sở…'
    : locations.error
      ? 'Chưa tải được tên cơ sở'
      : 'Chưa xác định tên cơ sở';
  return (
    <>
      {!inHeader && (
        <View style={styles.between}>
          <Text variant="titleLarge" style={styles.title}>
            Công việc vận hành
          </Text>
          <IconButton
            icon="refresh"
            accessibilityLabel="Tải lại công việc"
            disabled={query.fetching}
            onPress={query.reload}
          />
        </View>
      )}
      <Text variant="bodySmall" style={styles.muted}>
        Công việc thuộc cơ sở đang chọn trên trang chủ
      </Text>
      {!staffLocationId && (
        <Text accessibilityRole="alert" variant="bodySmall" style={styles.muted}>
          Chưa có cơ sở được phân công để xem công việc.
        </Text>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button icon="wrench-clock" mode="contained-tonal" onPress={() => go('staff-maintenance')}>
          Lệnh sửa chữa / Bảo trì
        </Button>
        <Button icon="file-document-check-outline" mode="outlined" onPress={() => go('staff-handover-archive')}>
          Biên bản đã ký
        </Button>
      </View>
      <Button icon="calendar-month-outline" onPress={() => go('shifts')}>
        Lịch làm việc
      </Button>
      <TaskFilterBar
        status={status}
        onChange={(next) => {
          setStatus(next);
          setPage(1);
        }}
      />
      {data && (
        <TaskSummaryBar totalCount={data.totalCount} visibleItems={items} filtered={!!status} />
      )}
      {query.fetching && (
        <View
          style={styles.loading}
          accessibilityRole="progressbar"
          accessibilityLabel={data ? 'Đang cập nhật công việc' : 'Đang tải công việc'}
        >
          <ActivityIndicator size="small" color={c.primary} />
          <Text variant="bodySmall" style={styles.muted}>
            {data ? 'Đang cập nhật…' : 'Đang tải công việc…'}
          </Text>
        </View>
      )}
      {!!query.error && (
        <View style={styles.state}>
          <Text variant="titleMedium">
            {data ? 'Chưa cập nhật được danh sách' : 'Không tải được công việc'}
          </Text>
          <Text accessibilityRole="alert" variant="bodySmall" style={styles.muted}>
            {query.error}
          </Text>
          <Button compact mode="text" onPress={query.reload} disabled={query.fetching}>
            Thử lại
          </Button>
        </View>
      )}
      {!!locations.error && items.length > 0 && (
        <View style={styles.state}>
          <Text accessibilityRole="alert" variant="bodySmall" style={styles.muted}>
            Không tải được tên cơ sở: {locations.error}
          </Text>
          <Button compact mode="text" onPress={locations.reload} disabled={locations.fetching}>
            Tải lại tên cơ sở
          </Button>
        </View>
      )}
      {items.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          locationName={locationNames.get(task.locationId) ?? missingLocationName}
          onPress={() =>
            isMainMoveInWork(task)
              ? go('move-in', { contractId: task.target!.contractId!, section: 'handover' })
              : task.kind === 'MeterReading'
                ? go('meter-reading')
                : task.kind === 'MoveInInventory'
                  ? go('move-in-inventory', { taskId: task.id })
                  : go('task-detail', { taskId: task.id })
          }
        />
      ))}
      {data && !items.length && !query.error && (
        <View style={styles.state}>
          <Icon source="clipboard-text-outline" size={30} color={c.muted} />
          <Text variant="titleMedium">
            {status ? 'Không có công việc phù hợp' : 'Chưa có công việc được giao'}
          </Text>
          <Text variant="bodySmall" style={styles.muted}>
            {status
              ? 'Thử chọn trạng thái khác để xem công việc.'
              : 'Công việc mới sẽ xuất hiện tại đây khi được phân công.'}
          </Text>
          {!!status && (
            <Button
              compact
              onPress={() => {
                setStatus('');
                setPage(1);
              }}
            >
              Xem tất cả
            </Button>
          )}
        </View>
      )}
      {data && data.totalCount > data.pageSize && (
        <View style={styles.between}>
          <IconButton
            icon="chevron-left"
            accessibilityLabel="Trang công việc trước"
            disabled={query.fetching || page <= 1}
            onPress={() => setPage(page - 1)}
          />
          <Text variant="bodySmall" style={styles.muted}>
            Trang {data.page} / {Math.ceil(data.totalCount / data.pageSize)}
          </Text>
          <IconButton
            icon="chevron-right"
            accessibilityLabel="Trang công việc sau"
            disabled={query.fetching || page * data.pageSize >= data.totalCount}
            onPress={() => setPage(page + 1)}
          />
        </View>
      )}
    </>
  );
}

function TaskFilterBar({
  status,
  onChange,
}: {
  status: string;
  onChange: (status: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filters}
    >
      {filters.map((filter) => (
        <TouchableRipple
          key={filter.id}
          accessibilityRole="tab"
          accessibilityLabel={filter.label}
          accessibilityState={{ selected: status === filter.id }}
          onPress={() => onChange(filter.id)}
          style={[styles.filter, status === filter.id && styles.filterSelected]}
        >
          <Text variant="labelLarge" style={{ color: status === filter.id ? c.white : c.muted }}>
            {filter.label}
          </Text>
        </TouchableRipple>
      ))}
    </ScrollView>
  );
}

function TaskSummaryBar({
  totalCount,
  visibleItems,
  filtered,
}: {
  totalCount: number;
  visibleItems: OperationalTask[];
  filtered: boolean;
}) {
  // The API already excludes embedded inventory checkpoints for Staff before
  // pagination; its total count is authoritative across all pages.
  const overdue = visibleItems.filter((task) => task.isOverdue).length;
  const assigned = visibleItems.filter((task) => task.status === 'Assigned').length;
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.summary}>
        <Text variant="labelLarge" style={styles.title}>
          {totalCount} công việc{filtered ? ' phù hợp' : ''}
        </Text>
        {overdue > 0 && (
          <Text variant="bodySmall" style={styles.overdue}>
            {overdue} quá hạn
          </Text>
        )}
        {assigned > 0 && (
          <Text variant="bodySmall" style={styles.muted}>
            {assigned} cần làm
          </Text>
        )}
      </View>
    </View>
  );
}

export function TaskCard({
  task,
  onPress,
  locationName,
}: {
  task: OperationalTask;
  onPress: () => void;
  locationName?: string;
}) {
  const title =
    task.title ||
    (task.kind === 'MeterReading'
      ? 'Ghi chỉ số đồng hồ'
      : task.kind === 'MoveInInventory'
        ? 'Kiểm kê trước nhận phòng'
        : task.kind === 'LocationAssetHandover'
          ? 'Kiểm kê và nhận bàn giao cơ sở'
          : 'Công việc');
  const status = taskStatusLabels[task.status] ?? task.status;
  const due =
    task.dueAt && Number.isFinite(Date.parse(task.dueAt)) ? formatInstant(task.dueAt) : null;
  return (
    <TouchableRipple
      accessibilityRole="button"
      accessibilityLabel={`Xem chi tiết: ${title}`}
      onPress={onPress}
      style={styles.card}
    >
      <View style={styles.cardContent}>
        <View style={styles.cardTop}>
          <Text
            variant="titleMedium"
            numberOfLines={2}
            ellipsizeMode="tail"
            style={styles.taskTitle}
          >
            {title}
          </Text>
          <TaskBadge status={task.status} label={status} />
        </View>
        <View style={styles.dueRow}>
          <Icon source="map-marker-outline" size={15} color={c.muted} />
          <Text variant="bodySmall" style={styles.title}>
            Cơ sở: {locationName?.trim() || 'Chưa xác định tên cơ sở'}
          </Text>
        </View>
        {!!task.target?.label && (
          <Text variant="bodySmall" style={styles.preview}>
            Vị trí / thiết bị: {task.target.label}
          </Text>
        )}
        <View style={styles.dueRow}>
          <Icon
            source={task.isOverdue ? 'clock-alert-outline' : 'clock-outline'}
            size={15}
            color={task.isOverdue ? c.red : c.muted}
          />
          <Text variant="bodySmall" style={task.isOverdue ? styles.overdue : styles.muted}>
            {task.isOverdue ? 'Quá hạn · ' : due ? 'Hạn · ' : ''}
            {due ?? 'Chưa có thời hạn'}
          </Text>
        </View>
        {!!task.requirements && (
          <Text variant="bodySmall" numberOfLines={2} ellipsizeMode="tail" style={styles.preview}>
            {task.requirements}
          </Text>
        )}
        {task.kind === 'LocationAssetHandover' && (
          <Text variant="labelMedium" style={styles.link}>
            Kiểm kê toàn bộ phòng và tài sản chung
          </Text>
        )}
        {!!task.result && (
          <Text variant="bodySmall" numberOfLines={1} ellipsizeMode="tail" style={styles.muted}>
            <Text variant="labelMedium">Kết quả gần nhất: </Text>
            {task.result}
          </Text>
        )}
        {!task.responsibilityAvailable && (
          <Text variant="bodySmall" style={styles.overdue}>
            Chưa có người phụ trách có hiệu lực
          </Text>
        )}
        <View style={styles.cardFooter}>
          <View style={styles.metadata}>
            <Text
              variant="labelMedium"
              style={task.priority === 'High' ? styles.highPriority : styles.muted}
            >
              {task.priority === 'High' ? 'Ưu tiên cao' : 'Bình thường'}
            </Text>
            {task.evidenceRequired && (
              <View style={styles.evidence}>
                <Icon source="camera-outline" size={13} color={c.muted} />
                <Text variant="labelSmall" style={styles.muted}>
                  Cần ảnh minh chứng
                </Text>
              </View>
            )}
          </View>
          <View style={styles.open}>
            <Text variant="labelMedium" style={styles.link}>
              Chi tiết
            </Text>
            <Icon source="chevron-right" size={18} color={c.blue} />
          </View>
        </View>
      </View>
    </TouchableRipple>
  );
}

function TaskBadge({ status, label }: { status: string; label: string }) {
  const pending = status === 'PendingVerification';
  const completed = status === 'Completed';
  return (
    <View
      style={[
        styles.badge,
        pending && { backgroundColor: c.amberSoft },
        completed && { backgroundColor: c.greenSoft },
      ]}
    >
      <Text
        variant="labelMedium"
        style={{ color: pending ? c.amber : completed ? c.green : c.primary }}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { color: c.primary },
  muted: { color: c.muted },
  filters: { gap: 8, paddingVertical: 2 },
  filter: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderRadius: 8,
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.border,
  },
  filterSelected: { backgroundColor: c.primary, borderColor: c.primary },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 14,
    rowGap: 4,
  },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  state: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 24,
    backgroundColor: c.white,
    borderRadius: 12,
  },
  card: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    backgroundColor: c.white,
    overflow: 'hidden',
  },
  cardContent: { padding: 14, gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  taskTitle: { flex: 1, minWidth: 0, color: c.ink },
  badge: {
    maxWidth: '48%',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 4,
    backgroundColor: c.soft,
  },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  overdue: { color: c.red },
  preview: { color: c.muted, lineHeight: 18 },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 2,
  },
  metadata: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 10,
    rowGap: 6,
  },
  evidence: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  highPriority: { color: c.amber },
  open: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 },
  link: { color: c.blue },
});
