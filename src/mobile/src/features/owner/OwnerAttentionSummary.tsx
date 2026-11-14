import React from 'react';
import { Text } from 'react-native-paper';
import { Action, Box, Heading, Pill, ui } from '../../components/WorkspaceKit';
import { useSession } from '../../lib/SessionProvider';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import { ownerQueuePolicy } from './ownerQueryPolicy';
import type { DebtSummary } from '../../../../../packages/client-core/src/payments';
import { formatContractMoney } from '../../../../../packages/client-core/src/contracts';
import type { Incident, IncidentPage } from '../../services/incidents';

export function OwnerAttentionSummary() {
  const { session } = useSession();
  const { go } = useWorkspace();
  const owner = !!session?.roles.includes('Owner');
  const submitted = useWorkspaceQuery<IncidentPage<Incident>>(
    owner ? '/api/v1/incidents?severity=Emergency&status=Submitted&page=1&pageSize=3' : null,
    { cache: ownerQueuePolicy },
  );
  const progress = useWorkspaceQuery<IncidentPage<Incident>>(
    owner ? '/api/v1/incidents?severity=Emergency&status=InProgress&page=1&pageSize=3' : null,
    { cache: ownerQueuePolicy },
  );
  const debt = useWorkspaceQuery<DebtSummary>(owner ? '/api/v1/debts/summary' : null, {
    cache: ownerQueuePolicy,
  });
  if (!owner) return null;
  return (
    <>
      <Box>
        <Heading title="Sự cố khẩn cấp" />
        <Pill tone="red">
          {submitted.data && progress.data
            ? `${submitted.data.totalCount + progress.data.totalCount} đang mở`
            : 'Chưa đủ dữ liệu'}
        </Pill>
        {!!(submitted.error || progress.error) && (
          <Text style={ui.red}>{submitted.error || progress.error}</Text>
        )}
        {[...(submitted.data?.items ?? []), ...(progress.data?.items ?? [])]
          .slice(0, 3)
          .map((item) => (
            <React.Fragment key={item.id}>
              <Text numberOfLines={2}>
                {item.code} · {item.description}
              </Text>
              <Action secondary onPress={() => go('incident-detail', { incidentId: item.id })}>
                Mở sự cố
              </Action>
            </React.Fragment>
          ))}
        <Action secondary onPress={() => go('owner-emergencies')}>
          Tất cả sự cố khẩn cấp
        </Action>
      </Box>
      <Box>
        <Heading title="Công nợ cần theo dõi" />
        {debt.loading && <Text>Đang tải số dư…</Text>}
        {!!debt.error && <Text style={ui.red}>{debt.error}</Text>}
        {debt.data && (
          <>
            <Text>Còn phải thu: {formatContractMoney(debt.data.outstandingAmount)}</Text>
            <Text>
              Quá hạn: {debt.data.overdueInvoiceCount} hóa đơn ·{' '}
              {formatContractMoney(debt.data.overdueAmount)}
            </Text>
          </>
        )}
        <Action secondary onPress={() => go('owner-finance')}>
          Xem tài chính
        </Action>
      </Box>
    </>
  );
}
