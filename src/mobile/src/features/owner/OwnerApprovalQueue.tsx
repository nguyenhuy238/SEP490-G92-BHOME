import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { Filters, Row } from '../../components/WorkspaceKit';
import { DashboardSummary } from '../../components/DashboardKit';
import {
  OwnerEmpty,
  OwnerFailure,
  OwnerLoading,
  OwnerRecordRow,
} from '../../components/OwnerMobileKit';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { useSession } from '../../lib/SessionProvider';
import { useWorkspaceHeaderRefresh } from '../../components/WorkspaceHeaderContext';
import { useOwnerAttention } from './useOwnerAttention';
import { OwnerPlaceLabel } from './OwnerPlaceLabel';
import {
  attentionPageSize,
  attentionTitle,
  type AttentionCategory,
} from '../../services/ownerAttention';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
export { ownerQueuePolicy } from './ownerQueryPolicy';

const labels: Record<AttentionCategory, string> = {
  emergency: 'Khẩn cấp',
  maintenance: 'Bảo trì',
  task: 'Công việc',
  contract: 'Hợp đồng',
};

export function OwnerApprovalQueue({ compact = false }: { compact?: boolean }) {
  const { session } = useSession();
  const { go } = useWorkspace();
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('Tất cả');
  const queue = useOwnerAttention(page);
  useWorkspaceHeaderRefresh(queue.reload, queue.fetching, { title: 'Cần xử lý' });
  if (!session?.roles.includes('Owner')) return null;
  const available = Object.entries(labels).filter(([key]) =>
    queue.buckets.some(({ source, query }) => source.category === key && !!query.data?.totalCount),
  );
  const selected = available.some(([, label]) => label === category) ? category : 'Tất cả';
  const visible = queue.items.filter(
    ({ source }) => selected === 'Tất cả' || labels[source.category] === selected,
  );
  const pages = Math.max(
    1,
    ...queue.buckets
      .filter(({ source }) => selected === 'Tất cả' || labels[source.category] === selected)
      .map(({ query }) => Math.ceil((query.data?.totalCount ?? 0) / attentionPageSize)),
  );
  return (
    <>
      {!compact && (
        <DashboardSummary
          title="Cần xử lý"
          detail={
            queue.complete
              ? `${queue.totalKnown} mục cần theo dõi hoặc quyết định`
              : 'Đang tổng hợp các mục cần chú ý'
          }
        />
      )}
      {queue.error && <OwnerFailure retry={queue.reload} busy={queue.fetching} />}
      {!compact && available.length > 1 && (
        <Filters
          options={['Tất cả', ...available.map(([, label]) => label)]}
          selected={selected}
          onChange={(value) => {
            setCategory(value);
            setPage(1);
          }}
        />
      )}
      {queue.loading && !queue.items.length && <OwnerLoading />}
      {visible.slice(0, compact ? 3 : undefined).map(({ item, source }) => {
        const date = item.dueAt || item.targetCompletionAt || item.createdAt;
        return (
          <OwnerRecordRow
            key={`${source.path}:${item.id}`}
            title={attentionTitle(item, source)}
            status={source.status}
            urgent={source.category === 'emergency' || item.isOverdue}
            detail={
              date
                ? `${item.dueAt || item.targetCompletionAt ? 'Hạn' : 'Ghi nhận'}: ${formatInstant(date)}`
                : undefined
            }
            action={source.action}
            onPress={() =>
              go(source.screen, {
                [source.parameter]: item.id,
                ...(source.screen === 'signing' ? { section: 'signing' } : {}),
              })
            }
          >
            <OwnerPlaceLabel item={item} />
          </OwnerRecordRow>
        );
      })}
      {queue.complete && queue.totalKnown === 0 && (
        <OwnerEmpty
          title="Không còn mục cần xử lý"
          detail="Bạn đã xem hết yêu cầu hiện tại. Các cảnh báo và yêu cầu mới sẽ xuất hiện ở đây."
        />
      )}
      {!queue.loading && queue.totalKnown > 0 && !visible.length && (
        <OwnerEmpty
          title="Chưa có mục trong trang này"
          detail="Quay về trang trước để xem các yêu cầu còn lại."
        />
      )}
      {!compact && (pages > 1 || page > 1) && (
        <Row spread>
          <Button
            disabled={queue.fetching || page === 1}
            onPress={() => setPage((value) => value - 1)}
          >
            Trước
          </Button>
          <Text>
            Trang {page}/{pages}
          </Text>
          <Button
            disabled={queue.fetching || page >= pages}
            onPress={() => setPage((value) => value + 1)}
          >
            Sau
          </Button>
        </Row>
      )}
      {compact && queue.totalKnown > 0 && (
        <View>
          <Button onPress={() => go('approvals')}>Xem tất cả</Button>
        </View>
      )}
    </>
  );
}
