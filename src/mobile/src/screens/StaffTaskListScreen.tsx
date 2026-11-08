import React, { useState } from 'react';
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
  taskStatusLabels,
  type OperationalTask,
  type TaskPage,
} from '../services/operationalTasks';
import { colors as c } from '../theme/theme';

const filters = [
  { id: '', label: 'Tất cả' },
  ...Object.entries(taskStatusLabels).map(([id, label]) => ({ id, label })),
];

export function StaffTaskListScreen() {
  const { go } = useWorkspace();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const query = useWorkspaceQuery<TaskPage<OperationalTask>>(
    `/api/v1/operational-tasks?page=${page}&pageSize=20${status ? `&status=${status}` : ''}`,
    { cache: queryPolicies.tasks, notifyError: false },
  );
  const inHeader = useWorkspaceHeaderRefresh(query.reload, query.fetching);
  const data = query.data;
  const items = data?.items ?? [];
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
        Công việc trong cơ sở đang được phân công
      </Text>
      <TaskFilterBar
        status={status}
        onChange={(next) => {
          setStatus(next);
          setPage(1);
        }}
      />
      {data && <TaskSummaryBar data={data} filtered={!!status} />}
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
      {items.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          onPress={() =>
            task.kind === 'MeterReading'
              ? go('meter-reading')
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
  data,
  filtered,
}: {
  data: TaskPage<OperationalTask>;
  filtered: boolean;
}) {
  // totalCount belongs to this server filter; the other counts describe only loaded items.
  const overdue = data.items.filter((task) => task.isOverdue).length;
  const assigned = data.items.filter((task) => task.status === 'Assigned').length;
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.summary}>
        <Text variant="labelLarge" style={styles.title}>
          {data.totalCount} công việc{filtered ? ' phù hợp' : ''}
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
      {data.totalCount > data.items.length && (
        <Text variant="labelSmall" style={styles.muted}>
          Số quá hạn và cần làm tính trên trang đang xem.
        </Text>
      )}
    </View>
  );
}

export function TaskCard({ task, onPress }: { task: OperationalTask; onPress: () => void }) {
  const title = task.title || (task.kind === 'MeterReading' ? 'Ghi chỉ số đồng hồ' : 'Công việc');
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
