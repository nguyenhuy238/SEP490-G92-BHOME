import React, { useState } from 'react';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import {
  inspectionLabels,
  type EquipmentInspection,
} from '../../../../packages/client-core/src/equipmentInspections';
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
import type { SetupDocument } from '../../../../packages/client-core/src/propertySetup';
import { PrivateFileDownload } from '../components/PrivateFileDownload';

export function OwnerLocationRecordsScreen() {
  const { go } = useWorkspace();
  const [location, setLocation] = useState('');
  const [page, setPage] = useState(1);
  const [assetId, setAssetId] = useState('');
  const [assetPage, setAssetPage] = useState(1);
  const [unitPage, setUnitPage] = useState(1);
  const [inspectionPage, setInspectionPage] = useState(1);
  const [historyId, setHistoryId] = useState('');
  const history = useWorkspaceQuery<SetupDocument<LegalRecord>[]>(
    historyId ? `/api/v1/location-legal-records/${historyId}/versions` : null,
  );
  const locations = useWorkspaceQuery<Named[]>('/api/v1/capture/locations');
  const records = useWorkspaceQuery<RecordPage<LegalRecord>>(
    location ? `/api/v1/locations/${location}/legal-records?page=${page}` : null,
  );
  const assets = useWorkspaceQuery<{ items: PhysicalAsset[]; totalCount: number }>(
    location ? `/api/v1/assets?locationId=${location}&pageSize=20&page=${assetPage}` : null,
  );
  const units = useWorkspaceQuery<RecordPage<EquipmentUnit>>(
    assetId ? `/api/v1/assets/${assetId}/equipment-units?page=${unitPage}` : null,
  );
  const summary = useWorkspaceQuery<LifecycleSummary>(
    assetId ? `/api/v1/assets/${assetId}/lifecycle-summary` : null,
  );
  const inspections = useWorkspaceQuery<RecordPage<EquipmentInspection>>(
    assetId ? `/api/v1/assets/${assetId}/inspections?page=${inspectionPage}` : null,
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
          setAssetPage(1);
          setUnitPage(1);
          setInspectionPage(1);
          setHistoryId('');
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
          <PrivateFileDownload
            path={`/api/v1/location-legal-records/${item.id}/versions/${item.version}/file`}
            contentType={item.data.contentType}
            label="Mở hoặc lưu tài liệu"
          />
          <Action secondary onPress={() => setHistoryId(historyId === item.id ? '' : item.id)}>
            Lịch sử phiên bản
          </Action>
          {historyId === item.id && (
            <>
              <QueryState {...history} />
              {history.data?.map((version) => (
                <PrivateFileDownload
                  key={version.version}
                  path={`/api/v1/location-legal-records/${version.id}/versions/${version.version}/file`}
                  contentType={version.data.contentType}
                  label={`Tải phiên bản ${version.version}`}
                />
              ))}
            </>
          )}
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
        onChange={(value) => {
          setAssetId(value);
          setUnitPage(1);
          setInspectionPage(1);
        }}
      />
      {assets.data && assets.data.totalCount > 20 && (
        <Pagination
          page={assetPage}
          total={assets.data.totalCount}
          loading={assets.loading}
          onChange={(value) => {
            setAssetPage(value);
            setAssetId('');
          }}
        />
      )}
      <QueryState {...summary} />
      <QueryState {...units} />
      {summary.data && (
        <Text>
          Số lượng {summary.data.quantity} · Đã ghi nhận {summary.data.activeUnits} · Không được sử
          dụng {summary.data.failedUnits}
        </Text>
      )}
      {summary.data?.applicablePolicies?.map((policy) => (
        <Text key={policy.id}>
          Chính sách phù hợp · {policy.name} · Phiên bản {policy.version}
        </Text>
      ))}
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
      {units.data && units.data.totalCount > 20 && (
        <Pagination
          page={unitPage}
          total={units.data.totalCount}
          loading={units.loading}
          onChange={setUnitPage}
        />
      )}
      <QueryState {...inspections} />
      {inspections.data?.items.map((item) => (
        <Box key={item.id}>
          <Heading
            title={`Kiểm tra ${displayContractDate(item.data.period)}`}
            detail={`${inspectionLabels[item.status]} · ${inspectionLabels[item.data.outcome]}`}
          />
          <Action secondary onPress={() => go('task-detail', { taskId: item.data.taskId })}>
            Xem và xác minh kiểm tra
          </Action>
        </Box>
      ))}
      {inspections.data && inspections.data.totalCount > 20 && (
        <Pagination
          page={inspectionPage}
          total={inspections.data.totalCount}
          loading={inspections.loading}
          onChange={setInspectionPage}
        />
      )}
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
