import React, { useState } from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { Action, Box, Heading, Pill, ui } from '../../components/WorkspaceKit';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import { useSession } from '../../lib/SessionProvider';
import type { WorkspaceScreen } from '../workspace/navigation';
export { ownerQueuePolicy } from './ownerQueryPolicy';
import { ownerQueuePolicy } from './ownerQueryPolicy';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { formatContractMoney } from '../../../../../packages/client-core/src/contracts';
import { Pagination } from '../../components/WorkspaceQueryState';

type QueueRecord = {
  id: string;
  title?: string;
  locationName?: string;
  roomNumber?: string;
  expectedOutcome?: string;
  reason?: string;
  submittedAt?: string;
  dueAt?: string | null;
  targetCompletionAt?: string;
  occurredAt?: string;
  bankReference?: string;
  amount?: string;
};
export const ownerQueues: {
  title: string;
  path: string;
  screen: WorkspaceScreen;
  parameter: string;
  params?: Record<string, string>;
}[] = [
  {
    title: 'Hồ sơ hợp đồng nháp',
    path: '/contracts?status=Draft',
    screen: 'signing',
    parameter: 'contractId',
  },
  {
    title: 'Hợp đồng chờ ký',
    path: '/contracts?status=PendingSigning',
    screen: 'signing',
    parameter: 'contractId',
    params: { section: 'signing' },
  },
  {
    title: 'Hợp đồng chờ kích hoạt',
    path: '/contracts?status=PendingActivation',
    screen: 'signing',
    parameter: 'contractId',
    params: { section: 'signing' },
  },
  {
    title: 'Công việc chờ nghiệm thu',
    path: '/operational-tasks?status=PendingVerification',
    screen: 'task-detail',
    parameter: 'taskId',
  },
  {
    title: 'Phương án sửa chữa chờ duyệt',
    path: '/work-orders?workOrderStatus=PendingApproval',
    screen: 'maintenance-detail',
    parameter: 'workOrderId',
  },
  {
    title: 'Bảo trì chờ nghiệm thu',
    path: '/work-orders?workOrderStatus=PendingVerification',
    screen: 'maintenance-detail',
    parameter: 'workOrderId',
  },
  {
    title: 'Điều chỉnh hóa đơn chờ duyệt',
    path: '/invoice-adjustments?status=Pending',
    screen: 'owner-adjustment-detail',
    parameter: 'adjustmentId',
  },
  {
    title: 'Giao dịch chờ đối soát',
    path: '/payment-transactions?paymentStatus=PendingReview',
    screen: 'owner-payment-detail',
    parameter: 'paymentId',
  },
];

function Queue({ queue, compact }: { queue: (typeof ownerQueues)[number]; compact: boolean }) {
  const { api, session } = useSession();
  const { go } = useWorkspace();
  const allowed = !!api && !!session?.roles.includes('Owner');
  const [page, setPage] = useState(1);
  const query = useWorkspaceQuery<{ items: QueueRecord[]; totalCount: number }>(
    allowed ? `/api/v1${queue.path}&page=${page}&pageSize=3` : null,
    { cache: ownerQueuePolicy },
  );
  if (!allowed) return null;
  if (compact)
    return (
      <Box style={ui.half}>
        <Text variant="labelMedium">{queue.title}</Text>
        <Pill>
          {query.data
            ? `${query.data.totalCount} hồ sơ`
            : query.loading
              ? 'Đang tải…'
              : 'Chưa tải được'}
        </Pill>
        {!!query.error && <Text style={ui.red}>{query.error}</Text>}
        <Action
          secondary
          disabled={query.fetching}
          onPress={query.error ? query.reload : () => go('approvals')}
        >
          {query.error ? 'Thử lại' : 'Xem hàng chờ'}
        </Action>
      </Box>
    );
  return (
    <Box>
      <Heading title={queue.title} />
      <Pill>
        {query.data
          ? `${query.data.totalCount} hồ sơ`
          : query.loading
            ? 'Đang tải…'
            : 'Chưa tải được'}
      </Pill>
      {!!query.error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {query.error}
        </Text>
      )}
      {query.data?.totalCount === 0 && <Text>Không có hồ sơ chờ xử lý.</Text>}
      {query.data?.items.map((item) => {
        const date = item.submittedAt ?? item.occurredAt ?? item.dueAt ?? item.targetCompletionAt;
        return (
          <React.Fragment key={item.id}>
            <Text>
              {item.title ||
                item.expectedOutcome ||
                item.reason ||
                item.bankReference ||
                'Hợp đồng'}
              {item.roomNumber ? ` · Phòng ${item.roomNumber}` : ''}
              {item.locationName ? ` · ${item.locationName}` : ''}
            </Text>
            {date && <Text style={ui.muted}>{formatInstant(date)}</Text>}
            {item.amount && <Text style={ui.money}>{formatContractMoney(item.amount)}</Text>}
            <Action
              onPress={() => go(queue.screen, { ...queue.params, [queue.parameter]: item.id })}
            >
              Xem hồ sơ
            </Action>
          </React.Fragment>
        );
      })}
      <Action secondary disabled={query.fetching} onPress={query.reload}>
        Cập nhật
      </Action>
      {query.data && query.data.totalCount > 3 && (
        <Pagination
          page={page}
          pageSize={3}
          total={query.data.totalCount}
          loading={query.fetching}
          onChange={setPage}
        />
      )}
    </Box>
  );
}

export function OwnerApprovalQueue({ compact = false }: { compact?: boolean }) {
  return (
    <View style={compact ? ui.wrap : { gap: 12 }}>
      {ownerQueues.map((queue) => (
        <Queue key={queue.path} queue={queue} compact={compact} />
      ))}
    </View>
  );
}
