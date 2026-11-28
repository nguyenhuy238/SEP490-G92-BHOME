import React, { useState } from 'react';
import { Text } from 'react-native-paper';
import { useSession } from '../lib/SessionProvider';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { Box, Heading } from '../components/WorkspaceKit';
import { Pagination, QueryState } from '../components/WorkspaceQueryState';
import { displayContractDate } from '../../../../packages/client-core/src/contracts';
import { residenceStatus } from '../../../../packages/client-core/src/residence';
import { colors, staffColors } from '../theme/theme';

interface TrackingSummary {
  contractId: string;
  residentId: string;
  roomNumber: string;
  residentLabel: string;
  status: string;
  registrationRequired: boolean;
  registrationDeadline: string | null;
  registrationExpiresOn: string | null;
}
export function StaffResidenceScreen() {
  const { session } = useSession();
  const { staffLocationId } = useWorkspace();
  const [page, setPage] = useState(1);
  const allowed = session?.roles.includes('Staff');
  const query = useWorkspaceQuery<{ items: TrackingSummary[]; totalCount: number }>(
    allowed
      ? `/api/v1/residence-tasks/tracking?page=${page}&pageSize=20${staffLocationId ? `&locationId=${encodeURIComponent(staffLocationId)}` : ''}`
      : null,
  );
  if (!allowed) return <Text>Chỉ nhân viên được phân công được xem theo dõi tạm trú.</Text>;
  return (
    <>
      <Heading title="Theo dõi tạm trú" />
      <Text variant="bodySmall" style={{ color: colors.muted }}>
        Tenant đăng ký tạm trú; Owner kiểm tra kết quả. Staff theo dõi trạng thái và thời hạn.
      </Text>
      <QueryState loading={query.loading} error={query.error} reload={query.reload} />
      {query.data?.items.map((item) => (
        <Box key={`${item.contractId}/${item.residentId}`} style={{ padding: 12, gap: 4 }}>
          <Text variant="titleMedium" style={{ color: staffColors.navy }}>
            Phòng {item.roomNumber} · {item.residentLabel}
          </Text>
          <Text variant="labelLarge" style={{ color: colors.ink }}>
            {item.registrationRequired
              ? residenceStatus[item.status]
              : 'Owner ghi nhận không thuộc diện đăng ký'}
          </Text>
          {!!item.registrationDeadline && (
            <Text variant="bodySmall" style={{ color: colors.muted }}>
              Hạn đăng ký: {displayContractDate(item.registrationDeadline)}
            </Text>
          )}
          {!!item.registrationExpiresOn && (
            <Text variant="bodySmall" style={{ color: colors.muted }}>
              Hết hạn tạm trú: {displayContractDate(item.registrationExpiresOn)}
            </Text>
          )}
        </Box>
      ))}
      {query.data?.totalCount === 0 && (
        <Text>Chưa có thành viên đang cư trú trong phạm vi phân công.</Text>
      )}
      {!!query.data && (
        <Pagination
          page={page}
          total={query.data.totalCount}
          loading={query.loading}
          onChange={setPage}
        />
      )}
    </>
  );
}
