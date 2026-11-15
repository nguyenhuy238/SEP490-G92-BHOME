import React, { useCallback, useState } from 'react';
import { Text } from 'react-native-paper';
import { DashboardSummary } from '../components/DashboardKit';
import {
  OwnerEmpty,
  OwnerFailure,
  OwnerLoading,
  OwnerRecordRow,
} from '../components/OwnerMobileKit';
import { Filters } from '../components/WorkspaceKit';
import { Pagination } from '../components/WorkspaceQueryState';
import { ChoiceField } from '../components/WorkflowControls';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
import { useSession } from '../lib/SessionProvider';
import { ownerQueuePolicy } from '../features/owner/ownerQueryPolicy';
import { OwnerPlaceLabel } from '../features/owner/OwnerPlaceLabel';
import { OwnerStaffName } from '../features/owner/OwnerStaffName';
import { queryPolicies } from '../lib/queryPolicies';
import type { Named } from '../lib/api';
import { loadOwnerPage, type AttentionRecord } from '../services/ownerAttention';
import { incidentLabels } from '../services/incidents';
import { taskStatusLabels } from '../services/operationalTasks';
import { text as contractText } from '../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../packages/client-core/src/localization';

const sections = ['Sự cố', 'Khẩn cấp', 'Bảo trì', 'Công việc', 'Hợp đồng'];
type RecordItem = AttentionRecord & {
  status: string;
  assignedStaffId?: string;
  currentResponsibleStaffUserId?: string | null;
  severity?: string;
  onboardingDraft?: boolean;
};
const states: Record<string, { id: string; label: string }[]> = {
  'Sự cố': ['Submitted', 'InProgress', 'Resolved', 'Rejected', 'Duplicate', 'Cancelled'].map(
    (id) => ({ id, label: incidentLabels[id] }),
  ),
  'Khẩn cấp': ['Submitted', 'InProgress', 'Resolved'].map((id) => ({
    id,
    label: incidentLabels[id],
  })),
  'Bảo trì': [
    'Assigned',
    'PendingApproval',
    'InProgress',
    'PendingVerification',
    'Verified',
    'Cancelled',
  ].map((id) => ({ id, label: incidentLabels[id] })),
  'Công việc': Object.entries(taskStatusLabels).map(([id, label]) => ({ id, label })),
  'Hợp đồng': [
    'Draft',
    'PendingSigning',
    'PendingActivation',
    'Active',
    'Terminated',
    'Cancelled',
  ].map((id) => ({ id, label: contractText(id) })),
};

export function OwnerOperationsScreen({ initialSection = 'Sự cố' }: { initialSection?: string }) {
  const { session } = useSession();
  const { go } = useWorkspace();
  const owner = !!session?.roles.includes('Owner');
  const [section, setSection] = useState(initialSection);
  const [status, setStatus] = useState('');
  const [locationId, setLocationId] = useState('');
  const [page, setPage] = useState(1);
  const locations = useWorkspaceQuery<Named[]>(owner ? '/api/v1/capture/locations' : null, {
    cache: queryPolicies.rooms,
  });
  const root =
    section === 'Bảo trì'
      ? 'work-orders'
      : section === 'Công việc'
        ? 'operational-tasks'
        : section === 'Hợp đồng'
          ? 'contracts'
          : 'incidents';
  const params = new URLSearchParams({ page: String(page), pageSize: '12' });
  if (status) params.set(section === 'Bảo trì' ? 'workOrderStatus' : 'status', status);
  if (section === 'Khẩn cấp') params.set('severity', 'Emergency');
  if (locationId) params.set('locationId', locationId);
  const query = useWorkspaceQuery<{ items: RecordItem[]; totalCount: number }>(
    owner ? `/api/v1/${root}?${params}` : null,
    { cache: ownerQueuePolicy, load: loadOwnerPage },
  );
  const { reload: reloadQuery } = query,
    { reload: reloadLocations } = locations;
  const refresh = useCallback(() => {
    reloadQuery();
    reloadLocations();
  }, [reloadQuery, reloadLocations]);
  useWorkspaceHeaderRefresh(refresh, query.fetching || locations.fetching, { title: 'Vận hành' });
  if (!owner) return null;
  return (
    <>
      <DashboardSummary title="Vận hành" detail="Theo dõi tiến độ và kiểm tra kết quả tại cơ sở" />
      <Filters
        minTouchSize={48}
        options={sections}
        selected={section}
        onChange={(value) => {
          setSection(value);
          setStatus('');
          setPage(1);
        }}
      />
      {!!locations.error && <OwnerFailure retry={reloadLocations} busy={locations.fetching} />}
      {!!locations.data?.length && (
        <ChoiceField
          label="Cơ sở"
          value={locationId}
          options={[{ id: '', label: 'Tất cả cơ sở' }, ...locations.data]}
          onChange={(value) => {
            setLocationId(value);
            setPage(1);
          }}
        />
      )}
      <ChoiceField
        label="Trạng thái"
        value={status}
        options={[{ id: '', label: 'Tất cả trạng thái' }, ...states[section]]}
        onChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
      />
      {query.loading && <OwnerLoading />}
      {!!query.error && <OwnerFailure retry={reloadQuery} busy={query.fetching} />}
      {!!query.data && <Text>{query.data.totalCount} mục</Text>}
      {query.data?.items.map((item) => {
        const title =
          item.title ||
          item.description ||
          item.expectedOutcome ||
          (item.roomNumber ? `Hợp đồng phòng ${item.roomNumber}` : 'Hợp đồng');
        const date = item.dueAt || item.targetCompletionAt || item.createdAt;
        return (
          <OwnerRecordRow
            key={item.id}
            title={title}
            status={
              item.isOverdue
                ? 'Quá hạn'
                : `${item.severity === 'Emergency' ? 'Khẩn cấp · ' : ''}${states[section].find((state) => state.id === item.status)?.label || 'Đang theo dõi'}`
            }
            urgent={
              item.isOverdue ||
              (item.severity === 'Emergency' && ['Submitted', 'InProgress'].includes(item.status))
            }
            detail={
              date
                ? `${item.dueAt || item.targetCompletionAt ? 'Hạn' : 'Ghi nhận'}: ${formatInstant(date)}`
                : undefined
            }
            action={item.onboardingDraft ? 'Xem trạng thái hồ sơ' : 'Xem chi tiết'}
            onPress={() =>
              go(
                root === 'contracts'
                  ? 'signing'
                  : root === 'work-orders'
                    ? 'maintenance-detail'
                    : root === 'operational-tasks'
                      ? 'task-detail'
                      : 'incident-detail',
                {
                  [root === 'contracts'
                    ? 'contractId'
                    : root === 'work-orders'
                      ? 'workOrderId'
                      : root === 'operational-tasks'
                        ? 'taskId'
                        : 'incidentId']: item.id,
                },
              )
            }
          >
            <OwnerPlaceLabel item={item} />
            {(root === 'work-orders' || root === 'operational-tasks') && (
              <OwnerStaffName
                staffId={item.assignedStaffId || item.currentResponsibleStaffUserId}
              />
            )}
          </OwnerRecordRow>
        );
      })}
      {query.data?.items.length === 0 && (
        <OwnerEmpty
          title="Chưa có mục phù hợp"
          detail="Thay đổi cơ sở hoặc trạng thái để xem các hồ sơ khác."
        />
      )}
      {!!query.data && query.data.totalCount > 12 && (
        <Pagination
          page={page}
          pageSize={12}
          total={query.data.totalCount}
          loading={query.fetching}
          onChange={setPage}
        />
      )}
    </>
  );
}
