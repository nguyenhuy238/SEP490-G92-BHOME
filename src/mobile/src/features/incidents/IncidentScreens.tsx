import React, { useCallback, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Button, Text } from 'react-native-paper';
import { Action as SharedAction, Box, Heading, Pill, ui } from '../../components/WorkspaceKit';
import { useWorkspaceHeaderRefresh } from '../../components/WorkspaceHeaderContext';
import { ChoiceField } from '../../components/WorkflowControls';
import { QueryState as SharedQueryState, Pagination } from '../../components/WorkspaceQueryState';
import { OwnerDataState } from '../../components/OwnerMobileKit';
import { OwnerStaffName } from '../owner/OwnerStaffName';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { useSession } from '../../lib/SessionProvider';
import {
  incidentRoot,
  workOrderRoot,
  incidentQuery,
  incidentText,
  incidentClient,
  type Incident,
  type IncidentPage,
  type WorkOrder,
  type IncidentActivity,
  type IncidentEvidence,
  type EmergencyAction,
  type IncidentExpense,
  type MaintenanceHistory,
  type IncidentNotification,
  type TenantIncidentProgress,
} from '../../services/incidents';
import { useIncidentQuery, useIncidentMutation } from './useIncidentData';
import {
  IncidentPlace,
  EvidenceImage,
  IncidentInfo as Info,
  IncidentTimeline,
  incidentDate,
  incidentMoney,
} from './IncidentUi';
import { IncidentActionPanel } from './IncidentActions';

const idPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
function Action(props: React.ComponentProps<typeof SharedAction>) {
  const { role } = useWorkspace();
  return <SharedAction {...props} minHeight={role === 'Owner' ? 48 : 44} />;
}
function Pager({
  query,
  page,
  setPage,
}: {
  query: { data: { totalCount: number } | null; loading: boolean };
  page: number;
  setPage: (page: number) => void;
}) {
  return query.data ? (
    <Pagination
      page={page}
      total={query.data.totalCount}
      loading={query.loading}
      onChange={setPage}
    />
  ) : null;
}
function QueryState(props: React.ComponentProps<typeof SharedQueryState>) {
  const { role } = useWorkspace();
  return role === 'Owner' ? <OwnerDataState {...props} /> : <SharedQueryState {...props} />;
}

export function IncidentListScreen({ emergency = false }: { emergency?: boolean }) {
  const { role, preview, go, staffLocationId } = useWorkspace();
  const { session } = useSession();
  const [page, setPage] = useState(1),
    [status, setStatus] = useState(''),
    [severity, setSeverity] = useState('');
  const enabled = !preview && !!session && !!role && session.roles.includes(role);
  const active = enabled && (role !== 'Staff' || !!staffLocationId);
  const query = useIncidentQuery<IncidentPage<Incident>>(
    active
      ? `${incidentRoot}?${incidentQuery({ page, status, severity: emergency ? 'Emergency' : severity, locationId: role === 'Staff' ? staffLocationId : undefined })}`
      : null,
  );
  return (
    <>
      <Heading
        title={
          emergency ? 'Sự cố khẩn cấp' : role === 'Tenant' ? 'Yêu cầu của tôi' : 'Sự cố tại cơ sở'
        }
        detail="Dữ liệu theo quyền tài khoản và phân công hiện hành"
      />
      {!enabled && <Text>Đăng nhập để xem dữ liệu sự cố thật.</Text>}
      {enabled && role === 'Staff' && !staffLocationId && (
        <Text accessibilityRole="alert">Chưa có cơ sở được phân công để xem sự cố.</Text>
      )}
      {active && (
        <>
          <Button compact mode="text" icon="bell-outline" onPress={() => go('incident-inbox')}>
            Thông báo sự cố và bảo trì
          </Button>
          <ChoiceField
            label="Trạng thái báo cáo"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { id: '', label: 'Tất cả' },
              ...['Submitted', 'InProgress', 'Resolved', 'Rejected', 'Duplicate', 'Cancelled'].map(
                (id) => ({ id, label: incidentText(id) }),
              ),
            ]}
          />
          {!emergency && (
            <ChoiceField
              label="Mức độ sự cố"
              value={severity}
              onChange={(value) => {
                setSeverity(value);
                setPage(1);
              }}
              options={[
                { id: '', label: 'Tất cả' },
                { id: 'Normal', label: 'Thông thường' },
                { id: 'Emergency', label: 'Khẩn cấp' },
              ]}
            />
          )}
          <QueryState {...query} />
          {query.data?.items.length === 0 && (
            <Text>Không có báo cáo trong phạm vi và bộ lọc này.</Text>
          )}
          {query.data?.items.map((report) => (
            <Box key={report.id}>
              <Heading
                title={
                  report.roomNumber
                    ? `Phòng ${report.roomNumber}`
                    : report.commonArea || 'Báo cáo sự cố'
                }
                detail={incidentDate(report.createdAt)}
              />
              <Pill tone={report.severity === 'Emergency' ? 'red' : 'blue'}>
                {incidentText(report.severity)} · {incidentText(report.status)}
              </Pill>
              <Text numberOfLines={3}>{report.description}</Text>
              <Info label="Cơ sở" value={report.locationName} />
              <Info label="Khu vực chung" value={report.commonArea} />
              <Info label="Tài sản" value={report.assetName} />
              {role !== 'Tenant' && <Info label="Loại" value={report.type} />}
              {role !== 'Tenant' && <Info label="Nhóm" value={report.category} />}
              <Action onPress={() => go('incident-detail', { incidentId: report.id })}>
                Xem chi tiết báo cáo
              </Action>
            </Box>
          ))}
          <Pager query={query} page={page} setPage={setPage} />
        </>
      )}
      {role !== 'Owner' && (
        <Action onPress={() => go(role === 'Staff' ? 'report-incident' : 'incidents')}>
          Báo cáo sự cố mới
        </Action>
      )}
      {role !== 'Tenant' && (
        <Action
          secondary
          onPress={() => go(role === 'Owner' ? 'owner-maintenance' : 'staff-maintenance')}
        >
          Lệnh sửa chữa bảo trì
        </Action>
      )}
      {role === 'Tenant' && (
        <>
          <Action secondary onPress={() => go('invoice', { focus: 'adjustment' })}>
            Yêu cầu điều chỉnh hóa đơn
          </Action>
          <Action secondary onPress={() => go('contract-request')}>
            Yêu cầu hợp đồng / trả phòng
          </Action>
        </>
      )}
    </>
  );
}

export function IncidentDetailScreen() {
  const { incidentId } = useLocalSearchParams<{ incidentId?: string }>();
  const { session } = useSession();
  return incidentId && idPattern.test(incidentId) ? (
    <IncidentDetail key={`${session?.userId}:${incidentId}`} id={incidentId} />
  ) : (
    <Text>Không có mã báo cáo hợp lệ.</Text>
  );
}
function IncidentDetail({ id }: { id: string }) {
  const { role, preview, go, staffLocationId } = useWorkspace();
  const { session } = useSession();
  const enabled = !!session && !preview && !!role && session.roles.includes(role);
  const query = useIncidentQuery<Incident>(enabled ? `${incidentRoot}/${id}` : null);
  const inSelectedLocation =
    role !== 'Staff' || (!!staffLocationId && query.data?.locationId === staffLocationId);
  const [historyPage, setHistoryPage] = useState(1),
    [workPage, setWorkPage] = useState(1);
  const loaded = enabled && !!query.data && inSelectedLocation;
  const history = useIncidentQuery<IncidentPage<IncidentActivity>>(
    loaded && role !== 'Tenant'
      ? `${incidentRoot}/${id}/history?page=${historyPage}&pageSize=20`
      : null,
  );
  const progress = useIncidentQuery<TenantIncidentProgress>(
    loaded && role === 'Tenant' ? `${incidentRoot}/${id}/progress` : null,
  );
  const evidence = useIncidentQuery<IncidentEvidence[]>(
    loaded ? `${incidentRoot}/${id}/evidence` : null,
  );
  const visibleEvidence = evidence.data?.filter(
    (image) => role !== 'Tenant' || image.kind === 'Report',
  );
  const work = useIncidentQuery<IncidentPage<WorkOrder>>(
    loaded && role !== 'Tenant'
      ? `${workOrderRoot}?incidentId=${id}&page=${workPage}&pageSize=20`
      : null,
  );
  const emergency = useIncidentQuery<EmergencyAction[]>(
    loaded && role !== 'Tenant' && query.data?.severity === 'Emergency'
      ? `${incidentRoot}/${id}/emergency-actions`
      : null,
  );
  const expenses = useIncidentQuery<IncidentExpense[]>(
    loaded && role === 'Owner' ? `${incidentRoot}/${id}/expenses` : null,
  );
  const { reload: reloadReport } = query,
    { reload: reloadHistory } = history,
    { reload: reloadEvidence } = evidence,
    { reload: reloadWork } = work,
    { reload: reloadEmergency } = emergency,
    { reload: reloadExpenses } = expenses,
    { reload: reloadProgress } = progress;
  const refresh = useCallback(() => {
    reloadReport();
    reloadHistory();
    reloadEvidence();
    reloadWork();
    reloadEmergency();
    reloadExpenses();
    reloadProgress();
  }, [
    reloadReport,
    reloadHistory,
    reloadEvidence,
    reloadWork,
    reloadEmergency,
    reloadExpenses,
    reloadProgress,
  ]);
  useWorkspaceHeaderRefresh(
    refresh,
    query.fetching ||
      history.fetching ||
      evidence.fetching ||
      work.fetching ||
      emergency.fetching ||
      expenses.fetching ||
      progress.fetching,
  );
  return (
    <>
      <Action
        secondary
        onPress={() =>
          go(
            role === 'Tenant'
              ? 'tenant-requests'
              : role === 'Owner'
                ? 'owner-incidents'
                : 'staff-emergencies',
          )
        }
      >
        Về danh sách báo cáo
      </Action>
      <QueryState {...query} />
      {query.data && !inSelectedLocation && (
        <Text accessibilityRole="alert">
          Báo cáo này không thuộc cơ sở đang làm việc. Hãy chọn đúng cơ sở trên trang chủ.
        </Text>
      )}
      {query.data && inSelectedLocation && (
        <>
          <Box>
            <Heading title="Báo cáo sự cố" detail={incidentDate(query.data.createdAt)} />
            <Pill tone={query.data.severity === 'Emergency' ? 'red' : 'blue'}>
              {incidentText(query.data.severity)} · {incidentText(query.data.status)}
            </Pill>
            <Text>{query.data.description}</Text>
            <Info label="Khu vực chung" value={query.data.commonArea} />
            {role !== 'Tenant' && <Info label="Loại sự cố" value={query.data.type} />}
            {role !== 'Tenant' && <Info label="Nhóm sự cố" value={query.data.category} />}
            <Info
              label="Tiếp nhận khẩn cấp lúc"
              value={query.data.acknowledgedAt ? incidentDate(query.data.acknowledgedAt) : null}
            />
            <Info label="Kết quả xử lý" value={query.data.resolutionNote} />
            {role !== 'Tenant' && query.data.staffAvailable !== null && (
              <Text>
                Nhân viên tại cơ sở:{' '}
                {query.data.staffAvailable
                  ? 'Có người được phân công'
                  : 'Chưa có người được phân công'}
              </Text>
            )}
          </Box>
          <IncidentPlace report={query.data} />
          {role === 'Tenant' && (
            <Box>
              <Heading
                title="Tiến độ xử lý"
                detail={progress.data?.currentStep ?? 'Đang tải tiến độ'}
              />
              <QueryState {...progress} />
              {progress.data?.events.map((event, index) => (
                <Box key={`${event.occurredAt}:${index}`}>
                  <Text>{event.message}</Text>
                  <Text style={ui.muted}>{incidentDate(event.occurredAt)}</Text>
                </Box>
              ))}
              {progress.data?.events.length === 0 && <Text>Chưa có cập nhật thêm.</Text>}
            </Box>
          )}
          <Heading title="Ảnh minh chứng" />
          <QueryState {...evidence} />
          {visibleEvidence?.length === 0 && (
            <Text>Chưa có ảnh được trả về cho tài khoản của bạn.</Text>
          )}
          {visibleEvidence?.map((image) => (
            <EvidenceImage key={image.id} incidentId={id} evidence={image} />
          ))}
          {role !== 'Tenant' && (
            <>
              <Heading title="Lệnh sửa chữa liên quan" />
              <QueryState {...work} />
              {work.data?.items.map((order) => (
                <WorkCard key={order.id} work={order} />
              ))}
              {work.data?.items.length === 0 && <Text>Chưa có lệnh sửa chữa.</Text>}
              <Pager query={work} page={workPage} setPage={setWorkPage} />
              {query.data.severity === 'Emergency' && (
                <>
                  <Heading title="Hành động và chi phí khẩn cấp" />
                  <QueryState {...emergency} />
                  {emergency.data?.length === 0 && (
                    <Text>Chưa có hành động hoặc chi phí khẩn cấp riêng được trả về.</Text>
                  )}
                  {emergency.data?.map((entry) => (
                    <Box key={entry.id}>
                      <Info
                        label="Chi phí đề nghị"
                        value={
                          entry.requestedCost === null ? null : incidentMoney(entry.requestedCost)
                        }
                      />
                      <Text>
                        {entry.costApproved === null
                          ? 'Chưa có quyết định chi phí được phép xem'
                          : entry.costApproved
                            ? 'Đã duyệt chi phí'
                            : 'Đã từ chối chi phí'}
                      </Text>
                    </Box>
                  ))}
                </>
              )}
            </>
          )}
          {role === 'Owner' && (
            <>
              <Heading title="Chi phí đã ghi nhận" />
              <QueryState {...expenses} />
              {expenses.data?.length === 0 && <Text>Chưa có khoản chi phí được trả về.</Text>}
              {expenses.data?.map((expense) => (
                <Box key={expense.id}>
                  <Text>
                    {incidentMoney(expense.amount)} ·{' '}
                    {expense.expenseDate.split('-').reverse().join('/')}
                  </Text>
                  <Info
                    label="Loại chi phí"
                    value={expense.category === 'Maintenance' ? 'Bảo trì' : expense.category}
                  />
                </Box>
              ))}
            </>
          )}
          <IncidentActionPanel
            key={query.data.version}
            report={query.data}
            role={role!}
            emergencyActions={emergency.data ?? []}
          />
          {role !== 'Tenant' && (
            <>
              <Heading title="Lịch sử xử lý" />
              <QueryState {...history} />
              {history.data && (
                <IncidentTimeline items={history.data.items} owner={role === 'Owner'} />
              )}
              <Pager query={history} page={historyPage} setPage={setHistoryPage} />
            </>
          )}
        </>
      )}
    </>
  );
}

function WorkCard({ work }: { work: WorkOrder }) {
  const { go } = useWorkspace();
  return (
    <Box>
      <Heading title={work.description || 'Lệnh sửa chữa'} detail={incidentText(work.status)} />
      <Info label="Cơ sở" value={work.locationName} />
      <Info
        label="Vị trí"
        value={work.roomNumber ? `Phòng ${work.roomNumber}` : work.commonArea || 'Khu vực chung'}
      />
      <Info label="Tài sản" value={work.assetName} />
      <Info
        label="Nhân viên phụ trách"
        value={work.assignedStaffName || 'Nhân viên được phân công'}
      />
      <Text>{work.expectedOutcome}</Text>
      <Text>
        Hạn: {incidentDate(work.targetCompletionAt)}
        {work.isOverdue ? ' · Quá hạn' : ''}
      </Text>
      <Action onPress={() => go('maintenance-detail', { workOrderId: work.id })}>
        Xem chi tiết lệnh sửa chữa
      </Action>
    </Box>
  );
}
export function MaintenanceListScreen() {
  const { role, preview, go, staffLocationId } = useWorkspace();
  const { session } = useSession();
  const [page, setPage] = useState(1),
    [status, setStatus] = useState('');
  const enabled =
    !preview && !!session && (role === 'Staff' || role === 'Owner') && session.roles.includes(role);
  const active = enabled && (role !== 'Staff' || !!staffLocationId);
  const query = useIncidentQuery<IncidentPage<WorkOrder>>(
    active
      ? `${workOrderRoot}?${incidentQuery({ page, workOrderStatus: status, locationId: role === 'Staff' ? staffLocationId : undefined })}`
      : null,
  );
  return (
    <>
      <Heading
        title="Xử lý sự cố & Bảo trì"
        detail="Lệnh sửa chữa theo phân công và quyền truy cập"
      />
      {!enabled && <Text>Đăng nhập Staff hoặc Owner để xem lệnh sửa chữa.</Text>}
      {enabled && role === 'Staff' && !staffLocationId && (
        <Text accessibilityRole="alert">Chưa có cơ sở được phân công để xem bảo trì.</Text>
      )}
      {active && (
        <>
          <ChoiceField
            label="Trạng thái lệnh sửa chữa"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { id: '', label: 'Tất cả' },
              ...[
                'Assigned',
                'PendingApproval',
                'InProgress',
                'PendingVerification',
                'Verified',
                'Cancelled',
              ].map((id) => ({ id, label: incidentText(id) })),
            ]}
          />
          <QueryState {...query} />
          {query.data?.items.map((work) => (
            <WorkCard key={work.id} work={work} />
          ))}
          {query.data?.items.length === 0 && (
            <Text>Không có lệnh sửa chữa trong phạm vi và bộ lọc này.</Text>
          )}
          <Pager query={query} page={page} setPage={setPage} />
        </>
      )}
      <Action
        secondary
        onPress={() => go(role === 'Owner' ? 'owner-incidents' : 'staff-incidents')}
      >
        Danh sách báo cáo sự cố
      </Action>
      <Action
        secondary
        onPress={() => go(role === 'Owner' ? 'owner-emergencies' : 'staff-emergencies')}
      >
        Sự cố khẩn cấp
      </Action>
    </>
  );
}
export function MaintenanceDetailScreen() {
  const { workOrderId } = useLocalSearchParams<{ workOrderId?: string }>();
  const { session } = useSession();
  return workOrderId && idPattern.test(workOrderId) ? (
    <WorkDetail key={`${session?.userId}:${workOrderId}`} id={workOrderId} />
  ) : (
    <Text>Không có mã lệnh sửa chữa hợp lệ.</Text>
  );
}
function WorkDetail({ id }: { id: string }) {
  const { role, preview, go, staffLocationId } = useWorkspace();
  const { session } = useSession();
  const enabled =
    !preview && !!session && (role === 'Staff' || role === 'Owner') && session.roles.includes(role);
  const query = useIncidentQuery<WorkOrder>(enabled ? `${workOrderRoot}/${id}` : null);
  const work =
    role === 'Staff' && (!staffLocationId || query.data?.locationId !== staffLocationId)
      ? null
      : query.data;
  const incident = useIncidentQuery<Incident>(
    work?.incidentId ? `${incidentRoot}/${work.incidentId}` : null,
  );
  const [historyPage, setHistoryPage] = useState(1),
    [maintenancePage, setMaintenancePage] = useState(1);
  const history = useIncidentQuery<IncidentPage<IncidentActivity>>(
    work ? `${workOrderRoot}/${id}/history?page=${historyPage}&pageSize=20` : null,
  );
  const evidence = useIncidentQuery<IncidentEvidence[]>(
    work ? `${workOrderRoot}/${id}/evidence` : null,
  );
  const maintenance = useIncidentQuery<IncidentPage<MaintenanceHistory>>(
    work
      ? `${workOrderRoot}/maintenance-history?workOrderId=${id}&page=${maintenancePage}&pageSize=20`
      : null,
  );
  const { reload: reloadWork } = query,
    { reload: reloadIncident } = incident,
    { reload: reloadHistory } = history,
    { reload: reloadEvidence } = evidence,
    { reload: reloadMaintenance } = maintenance;
  const refresh = useCallback(() => {
    reloadWork();
    reloadIncident();
    reloadHistory();
    reloadEvidence();
    reloadMaintenance();
  }, [reloadWork, reloadIncident, reloadHistory, reloadEvidence, reloadMaintenance]);
  useWorkspaceHeaderRefresh(
    refresh,
    query.fetching ||
      incident.fetching ||
      history.fetching ||
      evidence.fetching ||
      maintenance.fetching,
  );
  return (
    <>
      <Action
        secondary
        onPress={() => go(role === 'Owner' ? 'owner-maintenance' : 'staff-maintenance')}
      >
        Về danh sách lệnh sửa chữa
      </Action>
      <QueryState {...query} />
      {query.data && !work && (
        <Text accessibilityRole="alert">
          Lệnh sửa chữa này không thuộc cơ sở đang làm việc. Hãy chọn đúng cơ sở trên trang chủ.
        </Text>
      )}
      {work && (
        <>
          <Box>
            <Heading title="Chi tiết lệnh sửa chữa" detail={incidentText(work.status)} />
            <Info
              label="Nguồn công việc"
              value={work.source === 'Proactive' ? 'Bảo trì chủ động' : 'Sự cố'}
            />
            <Info label="Nội dung bảo trì" value={work.description} />
            <Info label="Cơ sở" value={work.locationName} />
            <Info label="Phòng" value={work.roomNumber} />
            <Info label="Khu vực chung" value={work.commonArea} />
            <Info label="Tài sản" value={work.assetName} />
            {work.isOverdue && <Pill tone="red">Quá hạn hoàn thành</Pill>}
            <Info label="Kết quả yêu cầu" value={work.expectedOutcome} />
            {role === 'Owner' ? (
              <OwnerStaffName staffId={work.assignedStaffId} />
            ) : (
              <Text>
                Người phụ trách:{' '}
                {work.assignedStaffId === session?.userId
                  ? 'Bạn'
                  : work.assignedStaffName || 'Nhân viên được phân công'}
              </Text>
            )}
            <Info label="Hạn hoàn thành" value={incidentDate(work.targetCompletionAt)} />
            <Info label="Kết quả kiểm tra" value={work.inspectionResult} />
            <Info label="Phương án" value={work.proposedSolution} />
            <Info label="Thời gian dự kiến (phút)" value={work.estimatedMinutes} />
            {work.estimatedCost !== null && (
              <Info label="Chi phí dự kiến" value={incidentMoney(work.estimatedCost)} />
            )}
            <Info label="Đơn vị sửa chữa" value={work.vendor} />
            {!!work.fastRepairPolicyVersion && (
              <Text>
                Sửa nhanh theo chính sách phiên bản {work.fastRepairPolicyVersion} ·{' '}
                {work.fastRepairCategory}. Chi phí 0 VND, không dùng vật tư, chờ Owner nghiệm thu
                kết quả.
              </Text>
            )}
            <Text>
              Phương án: {work.planApproved ? 'Đã được duyệt' : 'Chưa được duyệt'} ·{' '}
              {work.canStart ? 'Được phép bắt đầu' : 'Chưa ở bước bắt đầu'}
            </Text>
            <Info
              label="Duyệt lúc"
              value={work.approvedAt ? incidentDate(work.approvedAt) : null}
            />
            <Info label="Kết quả sửa chữa" value={work.result} />
            {work.actualCost !== null && (
              <Info label="Chi phí thực tế" value={incidentMoney(work.actualCost)} />
            )}
            <Info
              label="Nghiệm thu lúc"
              value={work.verifiedAt ? incidentDate(work.verifiedAt) : null}
            />
          </Box>
          <QueryState {...incident} />
          {incident.data && (
            <>
              <Heading title="Sự cố liên quan" detail={incident.data.description} />
              <IncidentPlace report={incident.data} />
              <Action
                secondary
                onPress={() => go('incident-detail', { incidentId: work.incidentId! })}
              >
                Xem sự cố gốc
              </Action>
              {['Submitted', 'InProgress'].includes(incident.data.status) && (
                <IncidentActionPanel
                  key={`${work.version}:${incident.data.version}`}
                  report={incident.data}
                  work={work}
                  role={role!}
                />
              )}
            </>
          )}
          {!work.incidentId && <IncidentActionPanel key={work.version} work={work} role={role!} />}
          <Heading title="Ảnh kiểm tra và kết quả" />
          <QueryState {...evidence} />
          {evidence.data?.filter((image) => image.workOrderId === id).length === 0 && (
            <Text>Chưa có ảnh của lệnh sửa chữa này.</Text>
          )}
          {evidence.data
            ?.filter((image) => image.workOrderId === id)
            .map((image) => (
              <EvidenceImage key={image.id} incidentId={work.incidentId} evidence={image} />
            ))}
          <Heading title="Lịch sử hoạt động của lệnh sửa chữa" />
          <QueryState {...history} />
          {history.data && <IncidentTimeline items={history.data.items} owner={role === 'Owner'} />}
          <Pager query={history} page={historyPage} setPage={setHistoryPage} />
          <Heading title="Lịch sử bảo trì và hiện trạng tài sản" />
          <QueryState {...maintenance} />
          {maintenance.data?.items.filter((item) => item.workOrderId === id).length === 0 && (
            <Text>Chưa có bản ghi bảo trì của lệnh sửa chữa này.</Text>
          )}
          {maintenance.data?.items
            .filter((item) => item.workOrderId === id)
            .map((item) => (
              <Box key={item.id}>
                <Heading title={incidentText(item.action)} detail={incidentDate(item.verifiedAt)} />
                <Info label="Hiện trạng trước" value={item.conditionBefore} />
                <Info label="Hiện trạng sau" value={item.conditionAfter} />
                <Info
                  label="Trạng thái trước"
                  value={item.statusBefore ? incidentText(item.statusBefore) : null}
                />
                <Info
                  label="Trạng thái sau"
                  value={item.statusAfter ? incidentText(item.statusAfter) : null}
                />
                <Info label="Chi phí thực tế" value={incidentMoney(item.actualCost)} />
              </Box>
            ))}
          <Pager query={maintenance} page={maintenancePage} setPage={setMaintenancePage} />
        </>
      )}
    </>
  );
}

export function IncidentInbox() {
  const { api, session } = useSession();
  const { preview, go, role } = useWorkspace();
  const [page, setPage] = useState(1);
  const query = useIncidentQuery<IncidentPage<IncidentNotification>>(
    !preview && session ? `${incidentRoot}/notifications?page=${page}&pageSize=20` : null,
  );
  const mutation = useIncidentMutation();
  return (
    <>
      <Heading title="Thông báo sự cố và bảo trì" />
      <QueryState {...query} />
      {query.data?.items.length === 0 && <Text>Chưa có thông báo sự cố trên trang này.</Text>}
      {query.data?.items.map((item) => (
        <Box key={item.id}>
          <Pill tone={item.highPriority ? 'red' : 'blue'}>
            {item.highPriority ? 'Ưu tiên khẩn cấp' : 'Thông báo sự cố'} ·{' '}
            {item.readAt ? 'Đã đọc' : 'Chưa đọc'}
          </Pill>
          <Text>
            {incidentText(item.event)} · {incidentDate(item.createdAt)}
          </Text>
          <Info label="Đọc lúc" value={item.readAt ? incidentDate(item.readAt) : null} />
          <Action
            disabled={mutation.busy}
            onPress={() => {
              void (async () => {
                if (!api) return;
                if (!item.readAt) {
                  const result = await mutation.run(item.id, async () => {
                    await incidentClient(api).readNotification(item.id);
                    return true;
                  });
                  if (!result) return;
                }
                if (role !== 'Tenant' && item.workOrderId)
                  go('maintenance-detail', { workOrderId: item.workOrderId });
                else if (item.incidentId) go('incident-detail', { incidentId: item.incidentId });
              })();
            }}
          >
            Mở thông báo sự cố
          </Action>
        </Box>
      ))}
      <Pager query={query} page={page} setPage={setPage} />
      {!!mutation.error && (
        <Text style={ui.red} accessibilityRole="alert">
          {mutation.error}
        </Text>
      )}
    </>
  );
}
