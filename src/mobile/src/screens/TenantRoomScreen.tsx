import React from 'react';
import { Text } from 'react-native-paper';
import { displayContractDate, text } from '../../../../packages/client-core/src/contracts';
import { Action, Box, Heading } from '../components/WorkspaceKit';
import { ChoiceField } from '../components/WorkflowControls';
import { Pagination, QueryState } from '../components/WorkspaceQueryState';
import { useTenantTenancy } from '../features/tenant/useTenantTenancy';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';

export function TenantRoomScreen() {
  const scope = useTenantTenancy();
  const { go } = useWorkspace();
  const record = scope.handover.data;
  return (
    <>
      <Heading
        title="Phòng của tôi"
        detail="Thông tin từ hợp đồng và biên bản bàn giao được cấp quyền"
      />
      <QueryState {...scope.contracts} />
      {!scope.contracts.loading && !scope.contracts.error && !scope.items.length && (
        <Box>
          <Text>Chưa có hợp đồng đang hiệu lực trên trang này.</Text>
          <Action onPress={() => go('contract')}>Xem hợp đồng của tôi</Action>
        </Box>
      )}
      {!!scope.items.length && (
        <ChoiceField
          label="Phòng đang thuê"
          value={scope.current?.id ?? ''}
          options={scope.items.map((item) => ({
            id: item.id,
            label: `Phòng ${item.roomNumber} · ${item.locationName}`,
          }))}
          onChange={scope.select}
        />
      )}
      {scope.current && (
        <>
          <Box>
            <Heading
              title={`Phòng ${scope.current.roomNumber}`}
              detail={scope.current.locationName}
            />
            <Text>Trạng thái hợp đồng: {text(scope.current.status)}</Text>
            <Text>
              Kỳ thuê: {displayContractDate(scope.current.startDate)} –{' '}
              {displayContractDate(scope.current.endDate)}
            </Text>
            <Action onPress={() => go('contract', { contractId: scope.current!.id })}>
              Xem hợp đồng phòng này
            </Action>
          </Box>
          <QueryState {...scope.detail} />
          {!!scope.detail.data?.occupants?.length && (
            <Box>
              <Heading title="Người ở được phép xem" />
              {scope.detail.data.occupants.map((person) => (
                <Text key={person.id}>
                  {person.label}
                  {person.representative ? ' · Người đại diện' : ''}
                </Text>
              ))}
            </Box>
          )}
          <QueryState {...scope.handover} />
          {record && (
            <Box>
              <Heading
                title="Hiện trạng ghi nhận khi bàn giao"
                detail={`Ngày ${displayContractDate(record.snapshot.date)}`}
              />
              <Text>{record.snapshot.roomCondition}</Text>
              <Text>Biên bản: {text(record.status)}</Text>
              {record.snapshot.assets.map((asset) => (
                <Text key={asset.id}>
                  {asset.name}: {asset.observedCondition}
                </Text>
              ))}
              {!record.snapshot.assets.length && (
                <Text>Biên bản không có tài sản được ghi nhận.</Text>
              )}
              <Text>
                Đây là hiện trạng tại ngày bàn giao, chưa phải kiểm kê cập nhật của phòng.
              </Text>
            </Box>
          )}
          {!scope.handover.loading && !scope.handover.error && !record && (
            <Box>
              <Text>Chưa có biên bản bàn giao cho phòng này.</Text>
            </Box>
          )}
          <Action onPress={() => go('checklist', { contractId: scope.current!.id })}>
            Xem và xác nhận bàn giao / trả phòng
          </Action>
        </>
      )}
      {scope.contracts.data && (
        <Pagination
          page={scope.page}
          total={scope.contracts.data.totalCount}
          loading={scope.contracts.loading}
          onChange={scope.setPage}
        />
      )}
    </>
  );
}
