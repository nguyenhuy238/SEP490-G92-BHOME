import React, { useState } from 'react';
import { Text } from 'react-native-paper';
import { Box, Heading } from '../components/WorkspaceKit';
import { Pagination, QueryState } from '../components/WorkspaceQueryState';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import type { RecordPage } from '../../../../packages/client-core/src/assetLifecycle';
import {
  taxTrackingStatuses,
  type BusinessProfile,
  type TaxTracking,
} from '../../../../packages/client-core/src/taxPrivacy';
import {
  displayContractDate,
  formatContractMoney,
} from '../../../../packages/client-core/src/contracts';

export function OwnerTaxRecordsScreen() {
  const [page, setPage] = useState(1);
  const [profilePage, setProfilePage] = useState(1);
  const profiles = useWorkspaceQuery<RecordPage<BusinessProfile>>(
    `/api/v1/finance/business-profiles?page=${profilePage}`,
  );
  const taxes = useWorkspaceQuery<RecordPage<TaxTracking>>(
    `/api/v1/finance/tax-obligations?page=${page}`,
  );
  return (
    <>
      <Heading title="Thuế & chứng từ" />
      <QueryState {...profiles} />
      {profiles.data?.items.map((item) => (
        <Box key={item.id}>
          <Heading title={item.data.name} detail={item.data.subjectType} />
          <Text>
            {item.data.taxIdentifier} · {item.data.locationIds.length} cơ sở
          </Text>
        </Box>
      ))}
      {profiles.data && profiles.data.totalCount > 20 && (
        <Pagination
          page={profilePage}
          total={profiles.data.totalCount}
          loading={profiles.loading}
          onChange={setProfilePage}
        />
      )}
      <QueryState {...taxes} />
      {taxes.data?.totalCount === 0 && <Text>Chưa ghi nhận kỳ nghĩa vụ thuế.</Text>}
      {taxes.data?.items.map((item) => (
        <Box key={item.id}>
          <Heading
            title={item.data.details.obligationType}
            detail={taxTrackingStatuses[item.status]}
          />
          <Text>
            Kỳ {displayContractDate(item.data.details.periodFrom)} –{' '}
            {displayContractDate(item.data.details.periodTo)}
          </Text>
          <Text>
            Khai báo {formatContractMoney(item.data.details.declaredAmount)} · Đã nộp{' '}
            {formatContractMoney(item.data.details.paidAmount)}
          </Text>
          <Text>Hạn {displayContractDate(item.data.details.deadline)}</Text>
          <Text>Thực thu tham chiếu {formatContractMoney(item.data.referenceRevenue)}</Text>
          <Text>{item.data.details.note}</Text>
        </Box>
      ))}
      {taxes.data && (
        <Pagination
          page={page}
          total={taxes.data.totalCount}
          loading={taxes.loading}
          onChange={setPage}
        />
      )}
    </>
  );
}
