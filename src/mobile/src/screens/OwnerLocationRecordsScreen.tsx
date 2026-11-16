import React, { useState } from 'react';
import { Text } from 'react-native-paper';
import { Action, Box, Heading } from '../components/WorkspaceKit';
import { ChoiceField } from '../components/WorkflowControls';
import { Pagination, QueryState } from '../components/WorkspaceQueryState';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import type { Named } from '../lib/api';
import type {
  LegalRecord,
  RecordPage,
  EquipmentUnit,
  LifecycleSummary,
} from '../../../../packages/client-core/src/assetLifecycle';
import type { PhysicalAsset } from '../../../../packages/client-core/src/propertySetup';
import { displayContractDate } from '../../../../packages/client-core/src/contracts';

export function OwnerLocationRecordsScreen() {
  const [location, setLocation] = useState('');
  const [page, setPage] = useState(1);
  const [assetId, setAssetId] = useState('');
  const locations = useWorkspaceQuery<Named[]>('/api/v1/capture/locations');
  const records = useWorkspaceQuery<RecordPage<LegalRecord>>(
    location ? `/api/v1/locations/${location}/legal-records?page=${page}` : null,
  );
  const assets = useWorkspaceQuery<{ items: PhysicalAsset[]; totalCount: number }>(
    location ? `/api/v1/assets?locationId=${location}&pageSize=100` : null,
  );
  const units = useWorkspaceQuery<RecordPage<EquipmentUnit>>(
    assetId ? `/api/v1/assets/${assetId}/equipment-units` : null,
  );
  const summary = useWorkspaceQuery<LifecycleSummary>(
    assetId ? `/api/v1/assets/${assetId}/lifecycle-summary` : null,
  );
  return (
    <>
      <Heading title="Hồ sơ và thiết bị cơ sở" />
      <QueryState {...locations} />
      <ChoiceField
        label="Cơ sở"
        value={location}
        options={(locations.data ?? []).map((item) => ({ id: item.id, label: item.label }))}
        onChange={(value) => {
          setLocation(value);
          setPage(1);
          setAssetId('');
        }}
      />
      <QueryState {...records} />
      {records.data?.items.map((item) => (
        <Box key={item.id}>
          <Heading title={item.data.details.name} detail={`Phiên bản ${item.version}`} />
          <Text>Ngày cấp {displayContractDate(item.data.details.issuedOn)}</Text>
          <Text>
            {item.data.details.expiresOn
              ? `Hết hạn ${displayContractDate(item.data.details.expiresOn)}`
              : 'Không có ngày hết hạn'}
          </Text>
          <Text>{item.status === 'Active' ? 'Đang sử dụng' : 'Lưu trữ'}</Text>
        </Box>
      ))}
      {records.data?.totalCount === 0 && <Text>Chưa có hồ sơ pháp lý.</Text>}
      {records.data && (
        <Pagination
          page={page}
          total={records.data.totalCount}
          loading={records.loading}
          onChange={setPage}
        />
      )}
      <QueryState {...assets} />
      <ChoiceField
        label="Nhóm thiết bị"
        value={assetId}
        options={(assets.data?.items ?? [])
          .filter((item) =>
            [
              'FireSafetyEquipment',
              'SafetyEquipment',
              'ElectricalEquipment',
              'TechnicalEquipment',
            ].includes(item.category),
          )
          .map((item) => ({ id: item.id, label: item.name }))}
        onChange={setAssetId}
      />
      <QueryState {...summary} />
      <QueryState {...units} />
      {summary.data && (
        <Text>
          Số lượng {summary.data.quantity} · Đã ghi nhận {summary.data.activeUnits} · Không được sử
          dụng {summary.data.failedUnits}
        </Text>
      )}
      {units.data?.items.map((item) => (
        <Box key={item.id}>
          <Heading title={item.data.details.label} detail={item.data.details.position} />
          <Text>
            {item.status === 'InService'
              ? 'Đang sử dụng'
              : item.status === 'Unsafe'
                ? 'Không được sử dụng'
                : 'Đã ngừng sử dụng'}
          </Text>
          <Text>Serial {item.data.details.serialNumber || 'Chưa xác định'}</Text>
        </Box>
      ))}
      {assetId && (
        <Action
          secondary
          onPress={() => {
            units.reload();
            summary.reload();
          }}
        >
          Tải lại thiết bị
        </Action>
      )}
    </>
  );
}
