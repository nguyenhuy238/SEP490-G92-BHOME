import React, { useState } from 'react';
import { Text } from 'react-native-paper';
import { formatContractMoney } from '../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { type TenantRefund } from '../../../../packages/client-core/src/refunds';
import { Box, Action, ui } from '../components/WorkspaceKit';
import { InvoiceFeedback, InvoicePager } from '../components/InvoiceDetailUi';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import { loadTenantRefunds } from '../services/tenantRefunds';
import type { Page } from '../../../../packages/client-core/src/invoices';

const statuses = {
  REQUESTED: 'Chờ Owner duyệt',
  APPROVED: 'Đã duyệt · chờ hoàn thực tế',
  REJECTED: 'Yêu cầu bị từ chối',
  COMPLETED: 'Đã hoàn thực tế',
};
const sources = {
  ReceiptExcess: 'Hoàn tiền chuyển dư',
  SecurityDeposit: 'Hoàn cọc thuê phòng',
  HoldingDeposit: 'Hoàn cọc giữ chỗ',
};
export function TenantRefundPanel() {
  const { session } = useSession();
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(1);
  const allowed = session?.roles.includes('Tenant');
  const query = useWorkspaceQuery<Page<TenantRefund>>(
    allowed && open ? `/api/v1/tenant/refunds?page=${page}&pageSize=20` : null,
    { load: loadTenantRefunds, notifyError: false },
  );
  if (!allowed) return null;
  return (
    <Box>
      <Action onPress={() => setOpen((value) => !value)}>
        {open ? 'Ẩn hoàn tiền của tôi' : 'Xem hoàn tiền của tôi'}
      </Action>
      {open && (
        <>
          <Text style={ui.muted}>
            Chỉ hiển thị khoản hoàn cho chính bạn. Đã duyệt vẫn cần Owner thực hiện và xác minh hoàn
            tiền.
          </Text>
          <InvoiceFeedback {...query} />
          <Action onPress={query.reload} disabled={query.loading}>
            Tải lại hoàn tiền
          </Action>
          {query.data && !query.data.items.length && (
            <Text>Chưa có yêu cầu hoàn tiền cho bạn.</Text>
          )}
          {query.data?.items.map((row) => (
            <Box key={row.id}>
              <Text>
                {sources[row.sourceKind]} · {formatContractMoney(row.amount)}
              </Text>
              <Text>{statuses[row.status]}</Text>
              <Text style={ui.muted}>Lập yêu cầu: {formatInstant(row.requestedAt)}</Text>
              {row.executedAt && <Text>Hoàn thực tế: {formatInstant(row.executedAt)}</Text>}
              {row.isDevelopmentDemo && <Text style={ui.muted}>Dữ liệu minh họa Development</Text>}
            </Box>
          ))}
          {query.data && (
            <InvoicePager
              page={query.data.page}
              total={query.data.totalCount}
              loading={query.loading}
              onChange={setPage}
            />
          )}
        </>
      )}
    </Box>
  );
}
