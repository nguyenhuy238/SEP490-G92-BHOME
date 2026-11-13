import React from 'react';
import { Text } from 'react-native-paper';
import { Action, Box, Heading, Pill, ui } from '../../components/WorkspaceKit';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import { useSession } from '../../lib/SessionProvider';
import type { WorkspaceScreen } from '../workspace/navigation';
import type { QueryPolicy } from '../../lib/queryCache';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { formatContractMoney } from '../../../../../packages/client-core/src/contracts';

export const ownerQueuePolicy: QueryPolicy = {
  staleTime: 30_000,
  gcTime: 20 * 60_000,
  tags: ['contracts', 'tasks', 'incidents', 'invoices', 'payments', 'notifications'],
};
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
  const query = useWorkspaceQuery<{ items: QueueRecord[]; totalCount: number }>(
    allowed ? `/api/v1${queue.path}&page=1&pageSize=3` : null,
    { cache: ownerQueuePolicy },
  );
  if (!allowed) return null;
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
      {(compact ? query.data?.items.slice(0, 1) : query.data?.items)?.map((item) => {
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
    </Box>
  );
}

export function OwnerApprovalQueue({ compact = false }: { compact?: boolean }) {
  return (
    <>
      {ownerQueues.map((queue) => (
        <Queue key={queue.path} queue={queue} compact={compact} />
      ))}
    </>
  );
}
