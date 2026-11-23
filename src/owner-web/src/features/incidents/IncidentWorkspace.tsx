import { ValidatedInput } from '../../components/common/ValidatedForm';
import { UserFeedbackError } from '../../../../../packages/client-core/src/api';
import { TextField } from '../../components/common/ValidatedForm';
import { useState } from 'react';
import { Link, useInRouterContext, useSearchParams } from 'react-router';
import { Alert, Button, MenuItem, Paper, Stack, Typography } from '@mui/material';
import { PageHeader, ChartCard, FilterToolbar, StatusChip } from '../../components/common/PortalUI';
import { OwnerLocationPicker, OwnerRoomPicker } from '../../components/common/OwnerSelectors';
import { OwnerFeedback, OwnerPagination, OwnerTable } from '../../components/common/OwnerWorkspace';
import {
  ownerQuery,
  useOwnerAction,
  useOwnerQuery,
  type OwnerPage,
} from '../../hooks/useOwnerWorkspace';
import { PrivateEvidenceViewer } from '../../components/common/PrivateEvidenceViewer';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { mutationKeys } from '../../../../../packages/client-core/src/contracts';
import { todayVietnam, type StaffAssignment, type Staff } from '../staff/staffContracts';
import { CreateProactiveMaintenance, FastRepairPolicyPanel } from './MaintenanceControls';
import { CompensationPanel } from './CompensationPanel';
import { IncidentCommandDialog, type IncidentCommand } from './IncidentCommandDialog';
import {
  workStatuses,
  statusText,
  formatIncidentMoney,
  type Incident,
  type WorkOrder,
  type IncidentEvidence,
  type IncidentNotification,
} from './incidentContracts';

const root = '/api/v1/incidents',
  workRoot = '/api/v1/work-orders';
const reason = [{ name: 'reason', label: 'Lý do quyết định' }];
const assetFields: IncidentCommand['fields'] = [
  { name: 'assetStatus', label: 'Trạng thái tài sản sau xử lý', type: 'asset' },
  { name: 'assetCondition', label: 'Tình trạng tài sản sau xử lý' },
];
const incidentNextStep = (incident: Incident) => {
  if (incident.status === 'Submitted') return 'Tiếp nhận, phân loại và giao xử lý';
  if (incident.status === 'InProgress') {
    if (incident.openWorkOrderStatus === 'Assigned') return 'Chờ nhân viên kiểm tra';
    if (incident.openWorkOrderStatus === 'PendingApproval') return 'Duyệt phương án sửa chữa';
    if (incident.openWorkOrderStatus === 'PendingVerification') return 'Kiểm tra kết quả sửa chữa';
    if (incident.openWorkOrderStatus === 'InProgress') return 'Theo dõi tiến độ sửa chữa';
    return 'Giao nhân viên xử lý';
  }
  if (incident.status === 'Resolved') return 'Đã giải quyết';
  if (incident.status === 'Rejected') return 'Đã từ chối';
  if (incident.status === 'Duplicate') return 'Đã đánh dấu trùng';
  return 'Đã đóng';
};
const activityLabels: Record<string, string> = {
  submitted: 'Đã gửi báo cáo', reviewed: 'Đã phân loại sự cố', assigned: 'Đã giao nhân viên xử lý',
  acknowledged: 'Nhân viên đã tiếp nhận', emergency_action: 'Đã ghi nhận ứng phó khẩn cấp',
  emergency_cost_decided: 'Đã quyết định chi phí khẩn cấp', rejected: 'Đã từ chối báo cáo',
  duplicate: 'Đã đánh dấu báo cáo trùng', cancelled: 'Đã hủy sự cố', resolved: 'Đã xác nhận giải quyết',
  direct_completed: 'Owner đã hoàn tất xử lý trực tiếp', proposal_submitted: 'Nhân viên đã gửi phương án',
  plan_approved: 'Đã duyệt phương án', plan_rejected: 'Yêu cầu điều chỉnh phương án',
  start: 'Đã bắt đầu sửa chữa', progress: 'Đã cập nhật tiến độ', blocker: 'Đã ghi nhận vướng mắc',
  submit: 'Đã gửi yêu cầu nghiệm thu', verified: 'Đã xác minh hoàn tất', rework: 'Yêu cầu làm lại',
  reassigned: 'Đã đổi nhân viên phụ trách', work_order_cancelled: 'Đã hủy lệnh sửa chữa',
  fast_repair_started: 'Đã bắt đầu sửa nhanh', fast_repair_blocked: 'Sửa nhanh không đủ điều kiện',
  asset_proposed: 'Đã đề xuất liên kết tài sản', asset_confirmed: 'Đã xác nhận tài sản', asset_rejected: 'Đã từ chối liên kết tài sản',
};
const activityLabel = (action: string) => activityLabels[action] ?? 'Đã cập nhật công việc';
const notificationLabel = (event: string) =>
  activityLabels[event] ?? activityLabels[event.toLocaleLowerCase('en-US')] ?? 'Có cập nhật mới về công việc';
export function IncidentWorkspace({ maintenance = false }: { maintenance?: boolean }) {
  const [params, setParams] = useSearchParams();
  const selectedKey = maintenance ? 'workOrderId' : 'incidentId';
  const selected = params.get(selectedKey) ?? '';
  const incidentFilter = maintenance ? (params.get('incidentId') ?? '') : '';
  function setSelected(id: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (id) next.set(selectedKey, id);
      else next.delete(selectedKey);
      return next;
    });
  }
  const [location, setLocation] = useState(params.get('locationId') ?? ''),
    [room, setRoom] = useState(''),
    [status, setStatus] = useState(''),
    [severity, setSeverity] = useState(''),
    [page, setPage] = useState(1);
  const path =
    (maintenance ? workRoot : root) +
    '?' +
    ownerQuery({
      locationId: location,
      roomId: room,
      severity,
      incidentId: incidentFilter,
      ...(maintenance ? { workOrderStatus: status } : { status }),
      page,
      pageSize: 20,
    });
  const incidents = useOwnerQuery<OwnerPage<Incident>>(['incidents', path], path, !maintenance);
  const works = useOwnerQuery<OwnerPage<WorkOrder>>(['work-orders', path], path, maintenance);
  const q = maintenance ? works : incidents;
  return (
    <Stack spacing={2}>
      <PageHeader
        title={maintenance ? 'Lệnh sửa chữa và bảo trì' : 'Hàng đợi sự cố'}
        subtitle={maintenance
          ? 'Theo dõi từng công việc từ lúc giao nhân viên đến khi nghiệm thu.'
          : 'Xem việc mới, việc đang xử lý và việc đang chờ bạn quyết định.'}
      />
      {!maintenance && <IncidentNotificationInbox />}
      {incidentFilter && (
        <Button
          onClick={() =>
            setParams((previous) => {
              const next = new URLSearchParams(previous);
              next.delete('incidentId');
              return next;
            })
          }
        >
          Xem tất cả lệnh sửa chữa
        </Button>
      )}
      <FilterToolbar>
        {maintenance && (
          <>
            <CreateProactiveMaintenance />
            <FastRepairPolicyPanel />
          </>
        )}
        <OwnerLocationPicker
          value={location}
          change={(id) => {
            setLocation(id);
            setRoom('');
            setPage(1);
          }}
        />
        <OwnerRoomPicker
          key={location}
          location={location}
          value={room}
          change={(id) => {
            setRoom(id);
            setPage(1);
          }}
        />
        {maintenance ? (
          <TextField select label="Trạng thái công việc" value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <MenuItem value="">Tất cả trạng thái</MenuItem>
            {Object.entries(workStatuses).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </TextField>
        ) : (
          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
            {[
              { value: '', label: 'Tất cả' },
              { value: 'Submitted', label: 'Mới báo cáo' },
              { value: 'InProgress', label: 'Đang xử lý' },
              { value: 'Resolved', label: 'Đã giải quyết' },
            ].map((item) => (
              <Button key={item.value || 'all'} size="small" variant={status === item.value ? 'contained' : 'outlined'}
                onClick={() => { setStatus(item.value); setPage(1); }}>
                {item.label}
              </Button>
            ))}
          </Stack>
        )}
        <Button disabled={q.isFetching} onClick={() => void q.refetch()}>
          Làm mới danh sách
        </Button>
        {!maintenance && (
          <Button
            variant={severity === 'Emergency' ? 'contained' : 'outlined'}
            color="error"
            onClick={() => {
              setSeverity(severity === 'Emergency' ? '' : 'Emergency');
              setPage(1);
            }}
          >
            Ưu tiên khẩn cấp
          </Button>
        )}
      </FilterToolbar>
      {maintenance ? (
        <OwnerTable
          loading={q.isFetching}
          error={q.error}
          retry={() => void q.refetch()}
          label="Lệnh sửa chữa"
          rows={works.data?.items ?? []}
          id={(w) => w.id}
          select={(w) => setSelected(w.id)}
          columns={[
            { label: 'Công việc', render: (w) => <Stack spacing={0.25}><Typography sx={{ fontWeight: 700 }}>{w.description || w.expectedOutcome}</Typography><Typography variant="body2" color="text.secondary">{w.locationName ?? 'Cơ sở liên quan'} · {w.roomNumber ? `Phòng ${w.roomNumber}` : w.commonArea || 'Khu vực chung'}{w.assetName ? ` · ${w.assetName}` : ''}</Typography></Stack> },
            { label: 'Nhân viên', render: (w) => w.assignedStaffName || 'Chưa rõ nhân viên' },
            {
              label: 'Nguồn',
              render: (w) => (w.source === 'Proactive' ? 'Bảo trì chủ động' : 'Sự cố'),
            },
            { label: 'Trạng thái', render: (w) => <StatusChip label={statusText(w.status)} /> },
            {
              label: 'Duyệt phương án',
              render: (w) => (w.planApproved ? 'Đã duyệt' : 'Chưa duyệt'),
            },
            { label: 'Dự toán', render: (w) => formatIncidentMoney(w.estimatedCost) },
            { label: 'Chi phí thực tế', render: (w) => formatIncidentMoney(w.actualCost) },
            {
              label: 'Thời hạn',
              render: (w) =>
                `${formatInstant(w.targetCompletionAt)}${w.isOverdue ? ' · Quá hạn' : ''}`,
            },
          ]}
        />
      ) : (
        <OwnerTable
          loading={q.isFetching}
          error={q.error}
          retry={() => void q.refetch()}
          label="Sự cố"
          rows={incidents.data?.items ?? []}
          id={(i) => i.id}
          select={(i) => setSelected(i.id)}
          columns={[
            { label: 'Báo cáo', render: (i) => <Stack spacing={0.25}><Typography sx={{ fontWeight: 700 }}>Báo cáo sự cố</Typography><Typography>{i.description}</Typography><Typography variant="body2" color="text.secondary">{i.locationName ?? 'Cơ sở liên quan'} · {i.roomNumber ? `Phòng ${i.roomNumber}` : i.commonArea || 'Khu vực chung'}{i.assetName ? ` · ${i.assetName}` : ''}</Typography></Stack> },
            { label: 'Mức độ', render: (i) => <StatusChip label={i.severity === 'Emergency' ? 'Khẩn cấp' : 'Thông thường'} /> },
            { label: 'Nhân viên', render: (i) => i.assignedStaffName || 'Chưa giao' },
            { label: 'Trạng thái', render: (i) => <StatusChip label={statusText(i.status)} /> },
            { label: 'Thời gian', render: (i) => i.createdAt ? formatInstant(i.createdAt) : 'Chưa có' },
            { label: 'Việc tiếp theo', render: (i) => <Typography sx={{ fontWeight: 600 }}>{incidentNextStep(i)}</Typography> },
          ]}
        />
      )}
      <OwnerPagination
        page={page}
        total={q.data?.totalCount ?? 0}
        change={setPage}
        busy={q.isFetching}
      />
      {selected && (
        <>
          <Button onClick={() => setSelected('')}>Đóng chi tiết</Button>
          {maintenance ? (
            <WorkOrderDetail key={selected} id={selected} showIncident />
          ) : (
            <IncidentDetail key={selected} id={selected} />
          )}
        </>
      )}
    </Stack>
  );
}
function IncidentNotificationInbox() {
  const query = useOwnerQuery<OwnerPage<IncidentNotification>>(
    ['incident-notifications'],
    `${root}/notifications?page=1&pageSize=10`,
  );
  const action = useOwnerAction();
  const unread = (query.data?.items ?? []).filter((item) => !item.readAt).slice(0, 5);
  if (!unread.length && !query.isFetching && !query.error) return null;
  return (
    <ChartCard title="Thông báo cần chú ý">
      <Stack spacing={1.25}>
        <OwnerFeedback busy={query.isFetching || action.busy} error={query.error || action.error} />
        {!unread.length && !query.error && (
          <Typography variant="body2" color="text.secondary">
            {query.isFetching ? 'Đang tải thông báo…' : 'Không có thông báo mới.'}
          </Typography>
        )}
        {unread.map((item) => {
          const target = item.workOrderId
            ? `/maintenance?workOrderId=${encodeURIComponent(item.workOrderId)}`
            : item.incidentId
              ? `/incidents?incidentId=${encodeURIComponent(item.incidentId)}`
              : '/incidents';
          return (
            <Paper key={item.id} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
                <Stack sx={{ flex: 1 }} spacing={0.25}>
                  <Typography sx={{ fontWeight: 600 }}>
                    {item.highPriority ? 'Ưu tiên cao · ' : ''}{notificationLabel(item.event)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {formatInstant(item.createdAt)}
                  </Typography>
                </Stack>
                <Button
                  component={Link}
                  to={target}
                  size="small"
                  onClick={() =>
                    void action.run(() =>
                      action.request(`${root}/notifications/${item.id}/read`, { method: 'POST' }),
                    )
                  }
                >
                  Mở công việc
                </Button>
              </Stack>
            </Paper>
          );
        })}
      </Stack>
    </ChartCard>
  );
}
export function IncidentDetail({ id }: { id: string }) {
  const q = useOwnerQuery<Incident>(['incident', id], `${root}/${id}`);
  const [historyPage, setHistoryPage] = useState(1),
    [workPage, setWorkPage] = useState(1),
    [selectedWork, setSelectedWork] = useState('');
  const [command, setCommand] = useState<IncidentCommand | null>(null);
  const history = useOwnerQuery<
    OwnerPage<{
      id: string;
      action: string;
      note: string;
      occurredAt: string;
      actorId: string | null;
    }>
  >(['incident-history', id, historyPage], `${root}/${id}/history?page=${historyPage}&pageSize=20`);
  const evidence = useOwnerQuery<IncidentEvidence[]>(
    ['incident-evidence', id],
    `${root}/${id}/evidence`,
  );
  const works = useOwnerQuery<OwnerPage<WorkOrder>>(
    ['incident-works', id, workPage],
    `${workRoot}?incidentId=${id}&page=${workPage}&pageSize=20`,
  );
  const emergency = useOwnerQuery<
    { id: string; activityId: string; requestedCost: number | null; costApproved: boolean | null }[]
  >(['incident-emergency', id], `${root}/${id}/emergency-actions`);
  const expenses = useOwnerQuery<
    { id: string; category: string; amount: number; expenseDate: string }[]
  >(['incident-expenses', id], `${root}/${id}/expenses`);
  const assignments = useOwnerQuery<StaffAssignment[]>(
    ['incident-responsibility', q.data?.locationId],
    `/api/v1/staff-location-assignments?locationId=${q.data?.locationId}`,
    !!q.data,
  );
  const staffDirectory = useOwnerQuery<OwnerPage<Staff>>(
    ['incident-staff-directory'],
    '/api/v1/staff?page=1&pageSize=100',
    !!q.data,
  );
  const action = useOwnerAction();
  const i = q.data;
  const today = todayVietnam();
  const eligibleIds = new Set(
    (assignments.data ?? [])
      .filter((x) => x.startDate <= today && x.endDate >= today)
      .map((x) => x.staffUserId),
  );
  const staffOptions = (staffDirectory.data?.items ?? [])
    .filter((staff) => staff.isActive && staff.employment?.status === 'Active' &&
      staff.employment.startDate <= today && (!staff.employment.endDate || staff.employment.endDate >= today) &&
      eligibleIds.has(staff.userId))
    .map((staff) => ({ id: staff.userId, label: staff.fullName || staff.email }));
  const currentStaff = assignments.data?.find(
    (x) => x.startDate <= today && x.endDate >= today,
  )?.staffUserId;
  const openWorkOrder = (works.data?.items ?? []).find((work) => !['Verified', 'Cancelled'].includes(work.status));
  const responsibleStaff = openWorkOrder?.assignedStaffId ?? currentStaff;
  function open(
    operation: string,
    title: string,
    fields: IncidentCommand['fields'],
    extra?: Record<string, unknown>,
    initialValues?: Record<string, string>,
  ) {
    if (i)
      setCommand({ title, path: `${root}/${id}/${operation}`, version: i.version, fields, extra, initialValues });
  }
  const editable =
    !!i && !q.isFetching && !q.error && ['Submitted', 'InProgress'].includes(i.status);
  return (
    <ChartCard title={i ? `Chi tiết sự cố · ${statusText(i.status)}` : 'Chi tiết sự cố'}>
      <Stack spacing={2}>
        <OwnerFeedback
          busy={q.isFetching || action.busy || history.isFetching || evidence.isFetching || works.isFetching || emergency.isFetching || expenses.isFetching || assignments.isFetching || staffDirectory.isFetching}
          error={
            q.error ||
            action.error ||
            history.error ||
            evidence.error ||
            works.error ||
            emergency.error ||
            expenses.error ||
            assignments.error ||
            staffDirectory.error
          }
        />
        <Button disabled={q.isFetching || history.isFetching || evidence.isFetching || works.isFetching} onClick={() => void Promise.all([
          q.refetch(), history.refetch(), evidence.refetch(), works.refetch(), emergency.refetch(),
          expenses.refetch(), assignments.refetch(), staffDirectory.refetch(),
        ])}>
          Tải lại chi tiết sự cố
        </Button>
        {i && (
          <>
            {i.severity === 'Emergency' && (
              <Alert severity="warning">
                Ưu tiên an toàn và liên hệ dịch vụ khẩn cấp công cộng khi có nguy hiểm.{' '}
                {i.acknowledgedAt
                  ? `Staff đã tiếp nhận: ${formatInstant(i.acknowledgedAt)}`
                  : 'Chưa có xác nhận tiếp nhận.'}{' '}
                {i.staffAvailable === false ? 'Chưa có Staff khả dụng.' : ''}{' '}
                {i.escalationEnabled ? 'Đã cấu hình leo thang.' : 'Chưa bật leo thang tự động.'}
              </Alert>
            )}
            <Typography variant="h6">Báo cáo ban đầu</Typography>
            <Typography variant="body2" color="text.secondary">
              Mức độ: {i.severity === 'Emergency' ? 'Khẩn cấp' : 'Thông thường'}
            </Typography>
            {i.status === 'Submitted' && <Alert severity="info">Việc cần làm: phân loại báo cáo và giao nhân viên phù hợp.</Alert>}
            {i.status === 'InProgress' && <Alert severity="info">Sự cố đã được tiếp nhận. Theo dõi lệnh sửa chữa bên dưới và nghiệm thu khi nhân viên gửi kết quả.</Alert>}
            <Typography>{i.description}</Typography>
            <RecordContext
              locationId={i.locationId}
              roomId={i.roomId}
              commonArea={i.commonArea}
              assetId={i.assetId}
              incidentId={i.id}
              staffId={responsibleStaff}
            />
            <Typography>
              {i.createdAt ? `Báo cáo lúc ${formatInstant(i.createdAt)}` : ''}
              {i.resolutionNote && i.status === 'Resolved' ? ` · Kết quả: ${i.resolutionNote}` : ''}
            </Typography>
            <Typography>
              Phân loại: {i.type || 'Chưa phân loại'} · Nhóm: {i.category || 'Chưa có'}
            </Typography>
            {editable && (
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                {i.status === 'Submitted' && (
                  <Button
                    variant="contained"
                    onClick={() => open('review', 'Phân loại sự cố', [
                      { name: 'type', label: 'Loại sự cố' },
                      { name: 'category', label: 'Nhóm xử lý' },
                    ])}
                  >
                    {i.type && i.category ? 'Cập nhật phân loại' : 'Phân loại sự cố'}
                  </Button>
                )}
                {!works.isFetching && !openWorkOrder && (
                  <Button
                    variant="contained"
                    disabled={!i.type || !staffOptions.length}
                    onClick={() => open(
                      'work-orders',
                      'Giao lệnh sửa chữa',
                      [
                        { name: 'staffId', label: 'Nhân viên phụ trách', type: 'staff', options: staffOptions },
                        { name: 'expectedOutcome', label: 'Kết quả cần đạt' },
                        { name: 'targetCompletionAt', label: 'Hạn hoàn thành (giờ Việt Nam)', type: 'instant' },
                      ],
                    )}
                  >
                    Giao nhân viên xử lý
                  </Button>
                )}
                {!works.isFetching && !openWorkOrder && i.type && (
                  <Button
                    onClick={() => open(
                      'direct-completion',
                      'Xác nhận Owner xử lý trực tiếp',
                      [
                        { name: 'actualCost', label: 'Chi phí thực tế (VND)', type: 'money' },
                        { name: 'result', label: 'Kết quả xử lý' },
                        ...(i.assetId ? assetFields : []),
                      ],
                      { evidenceIds: evidence.data?.filter((e) => e.kind === 'Direct' && !e.activityId).map((e) => e.id) ?? [] },
                    )}
                  >
                    Owner xử lý trực tiếp
                  </Button>
                )}
                {i.status === 'Submitted' && (
                  <details>
                    <summary>Thao tác khác</summary>
                    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, pt: 1 }}>
                      <Button onClick={() => open('reject', 'Từ chối báo cáo', reason)}>Từ chối</Button>
                      <Button onClick={() => open('duplicate', 'Đánh dấu trùng báo cáo', [
                        ...reason,
                        { name: 'duplicateOfId', label: 'Sự cố gốc', type: 'incident', incidentScope: {
                          id: i.id, locationId: i.locationId, roomId: i.roomId, assetId: i.assetId,
                        } },
                      ])}>Trùng báo cáo</Button>
                      <Button color="error" onClick={() => open('cancel', 'Hủy xử lý sự cố', reason)}>Hủy sự cố</Button>
                      <Button onClick={() => open('resolve', 'Đóng sự cố không cần sửa chữa', reason)}>Đóng không cần sửa chữa</Button>
                    </Stack>
                  </details>
                )}
              </Stack>
            )}
            {editable && !staffOptions.length && (
              <Alert severity="info">
                Cơ sở chưa có nhân viên đủ điều kiện nhận việc. Hãy kiểm tra phân công và thời gian làm việc trước khi giao xử lý.
              </Alert>
            )}
            {!!evidence.data?.filter((e) => e.kind === 'Report').length && (
              <Typography variant="h6">Ảnh Tenant gửi ban đầu</Typography>
            )}
            {evidence.data?.filter((e) => e.kind === 'Report').map((e) => (
              <PrivateEvidenceViewer
                key={e.id}
                label={`Ảnh báo cáo · ${e.length.toLocaleString('vi-VN')} byte`}
                filename={`su-co-${e.kind}-${e.id}.jpg`}
                contentType={e.contentType}
                fetchBlob={(signal) =>
                  action.request<Blob>(`${root}/${id}/evidence/${e.id}`, { signal }, 'blob')
                }
              />
            ))}
            {editable && !openWorkOrder && i.type && <DirectEvidenceUpload id={id} />}
            {i.severity === 'Emergency' && <Typography variant="h6">Ứng phó khẩn cấp</Typography>}
            {editable && i.severity === 'Emergency' && (
              <>
                <DirectEvidenceUpload id={id} kind="EmergencyAction" />
                <Button
                  onClick={() =>
                    open(
                      'emergency-actions',
                      'Ghi nhận ứng phó của Owner',
                      [
                        { name: 'note', label: 'Biện pháp an toàn đã thực hiện và khó khăn còn gặp phải' },
                        {
                          name: 'requestedCost',
                          label: 'Chi phí cần quyết định (VND)',
                          type: 'money',
                          optional: true,
                        },
                      ],
                      {
                        evidenceIds:
                          evidence.data
                            ?.filter((e) => e.kind === 'EmergencyAction' && !e.activityId)
                            .map((e) => e.id) ?? [],
                      },
                    )
                  }
                >
                  Ghi nhận ứng phó Owner
                </Button>
              </>
            )}
            {emergency.data?.map((e) => (
              <Paper key={e.id} variant="outlined" sx={{ p: 2 }}>
                <Typography>
                  {history.data?.items.find((item) => item.id === e.activityId)?.occurredAt
                    ? formatInstant(history.data.items.find((item) => item.id === e.activityId)!.occurredAt)
                    : 'Ứng phó khẩn cấp'} ·{' '}
                  {history.data?.items.find((item) => item.id === e.activityId)?.note || 'Đã ghi nhận ứng phó'} · Yêu cầu{' '}
                  {e.requestedCost == null ? 'Không có' : formatIncidentMoney(e.requestedCost)} ·{' '}
                  {e.costApproved == null
                    ? 'Chưa quyết định'
                    : e.costApproved
                      ? 'Đã duyệt'
                      : 'Đã từ chối'}
                </Typography>
                {evidence.data?.filter((image) => image.activityId === e.activityId).map((image) => (
                  <PrivateEvidenceViewer
                    key={image.id}
                    label="Ảnh ứng phó khẩn cấp"
                    filename={`ung-pho-khan-cap-${image.id}.jpg`}
                    contentType={image.contentType}
                    fetchBlob={(signal) => action.request<Blob>(`${root}/${id}/evidence/${image.id}`, { signal }, 'blob')}
                  />
                ))}
                {editable && e.requestedCost != null && e.costApproved == null && (
                  <>
                    <Button
                      onClick={() =>
                        open(
                          `emergency-actions/${e.id}/cost-decision`,
                          'Duyệt chi phí khẩn cấp',
                          reason,
                          { approve: true },
                        )
                      }
                    >
                      Duyệt chi phí
                    </Button>
                    <Button
                      onClick={() =>
                        open(
                          `emergency-actions/${e.id}/cost-decision`,
                          'Từ chối chi phí khẩn cấp',
                          reason,
                          { approve: false },
                        )
                      }
                    >
                      Từ chối chi phí
                    </Button>
                  </>
                )}
              </Paper>
            ))}
            <Typography variant="h6">Kiểm tra và xử lý</Typography>
            <OwnerTable
              loading={works.isFetching}
              error={works.error}
              retry={() => void works.refetch()}
              label="Lệnh sửa chữa của sự cố"
              rows={works.data?.items ?? []}
              id={(w) => w.id}
              select={(w) => setSelectedWork(w.id)}
              columns={[
                { label: 'Công việc', render: (w) => <Stack spacing={0.25}><Typography sx={{ fontWeight: 600 }}>{w.description || w.expectedOutcome}</Typography><Typography variant="body2" color="text.secondary">{w.locationName ?? 'Cơ sở liên quan'} · {w.roomNumber ? `Phòng ${w.roomNumber}` : w.commonArea || 'Khu vực chung'}{w.assetName ? ` · ${w.assetName}` : ''}</Typography></Stack> },
                { label: 'Nhân viên', render: (w) => w.assignedStaffName || 'Chưa rõ nhân viên' },
                { label: 'Trạng thái', render: (w) => statusText(w.status) },
                { label: 'Hạn hoàn thành', render: (w) => formatInstant(w.targetCompletionAt) },
              ]}
            />
            {!!works.data?.totalCount && <OwnerPagination page={workPage} total={works.data.totalCount} change={setWorkPage} />}
            {selectedWork && <WorkOrderDetail key={selectedWork} id={selectedWork} />}
            {!!expenses.data?.length && <Typography variant="h6">Tài chính</Typography>}
            {expenses.data?.map((e) => (
              <Typography key={e.id}>
                {e.category} · {e.expenseDate.split('-').reverse().join('/')} · {formatIncidentMoney(e.amount)}
              </Typography>
            ))}
            {!!history.data?.items.length && <Typography variant="h6">Lịch sử thao tác</Typography>}
            {history.data?.items.map((h) => (
              <Paper key={h.id} variant="outlined" sx={{ p: 1.25 }}>
                <Typography sx={{ fontWeight: 600 }}>{activityLabel(h.action)}</Typography>
                <Typography variant="body2" color="text.secondary">{formatInstant(h.occurredAt)} · Người thực hiện</Typography>
                {h.note && <Typography>{h.note}</Typography>}
              </Paper>
            ))}
            <OwnerPagination
              page={historyPage}
              total={history.data?.totalCount ?? 0}
              change={setHistoryPage}
            />
          </>
        )}
        {command && (
          <IncidentCommandDialog
            key={command.path}
            command={command}
            close={() => setCommand(null)}
          />
        )}
      </Stack>
    </ChartCard>
  );
}
function DirectEvidenceUpload({
  id,
  kind = 'Direct',
}: {
  id: string;
  kind?: 'Direct' | 'EmergencyAction';
}) {
  const [file, setFile] = useState<File | null>(null);
  const action = useOwnerAction();
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  return (
    <Stack spacing={1}>
      <Typography>
        Ảnh {kind === 'Direct' ? 'xử lý trực tiếp' : 'ứng phó khẩn cấp'}: PNG/JPEG, tối đa 5 MB/ảnh
        và 5 ảnh theo giới hạn máy chủ.
      </Typography>
      <ValidatedInput
        aria-label={kind === 'Direct' ? 'Ảnh xử lý trực tiếp' : 'Ảnh ứng phó khẩn cấp'}
        type="file"
        accept="image/png,image/jpeg"
        disabled={action.busy}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <OwnerFeedback busy={action.busy} error={action.error} notice={action.notice} />
      <Button
        disabled={!file || action.busy}
        onClick={() =>
          void action.run(async () => {
            if (
              !file ||
              file.size > 5 * 1024 * 1024 ||
              !['image/png', 'image/jpeg'].includes(file.type)
            )
              throw new UserFeedbackError('Chọn ảnh PNG/JPEG không quá 5 MB.');
            const bytes = await file.arrayBuffer();
            const fingerprint = Array.from(
              new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
              (b) => b.toString(16).padStart(2, '0'),
            ).join('');
            await action.request(`${root}/${id}/evidence?kind=${kind}`, {
              method: 'PUT',
              headers: {
                'Content-Type': file.type,
                'Idempotency-Key': keys.get('direct', fingerprint),
              },
              body: bytes,
            });
            keys.confirmed('direct', fingerprint);
            setFile(null);
          })
        }
      >
        Tải ảnh {kind === 'Direct' ? 'xử lý trực tiếp' : 'ứng phó khẩn cấp'}
      </Button>
    </Stack>
  );
}
export function WorkOrderDetail({
  id,
  showIncident = false,
}: {
  id: string;
  showIncident?: boolean;
}) {
  const q = useOwnerQuery<WorkOrder>(['work-order', id], `${workRoot}/${id}`);
  const [command, setCommand] = useState<IncidentCommand | null>(null),
    [page, setPage] = useState(1);
  const w = q.data;
  const activityHistory = useOwnerQuery<OwnerPage<{
    id: string;
    action: string;
    note: string;
    occurredAt: string;
    actorId: string | null;
  }>>(
    ['work-order-activity', id],
    `${workRoot}/${id}/history?page=1&pageSize=50`,
    !!w,
  );
  const maintenanceHistory = useOwnerQuery<
    OwnerPage<{
      id: string;
      action: string;
      conditionBefore: string | null;
      conditionAfter: string | null;
      statusBefore: string | null;
      statusAfter: string | null;
      actualCost: number;
      verifiedAt: string;
    }>
  >(
    ['work-maintenance', id, page],
    `${workRoot}/maintenance-history?workOrderId=${id}&page=${page}&pageSize=20`,
    !!w,
  );
  const assignments = useOwnerQuery<StaffAssignment[]>(
    ['incident-responsibility', w?.locationId],
    `/api/v1/staff-location-assignments?locationId=${w?.locationId}`,
    !!w,
  );
  const staffDirectory = useOwnerQuery<OwnerPage<Staff>>(
    ['work-order-staff-directory'],
    '/api/v1/staff?page=1&pageSize=100',
    !!w,
  );
  const today = todayVietnam();
  const eligibleIds = new Set(
    (assignments.data ?? [])
      .filter((x) => x.startDate <= today && x.endDate >= today)
      .map((x) => x.staffUserId),
  );
  const staffOptions = (staffDirectory.data?.items ?? [])
    .filter((staff) => staff.isActive && staff.employment?.status === 'Active' &&
      staff.employment.startDate <= today && (!staff.employment.endDate || staff.employment.endDate >= today) &&
      eligibleIds.has(staff.userId))
    .map((staff) => ({ id: staff.userId, label: staff.fullName || staff.email }));
  function open(
    operation: string,
    title: string,
    fields: IncidentCommand['fields'],
    extra?: Record<string, unknown>,
    initialValues?: Record<string, string>,
  ) {
    if (w)
      setCommand({
        title,
        path: `${workRoot}/${id}/${operation}`,
        version: w.version,
        fields,
        extra,
        initialValues,
      });
  }
  const action = useOwnerAction();
  const evidence = useOwnerQuery<IncidentEvidence[]>(
    ['work-evidence', id],
    `${workRoot}/${id}/evidence`,
    !!w,
  );
  return (
    <ChartCard title="Chi tiết lệnh sửa chữa">
      <Stack spacing={2}>
        <OwnerFeedback
          busy={q.isFetching || activityHistory.isFetching || maintenanceHistory.isFetching || assignments.isFetching || staffDirectory.isFetching || evidence.isFetching}
          error={q.error || activityHistory.error || maintenanceHistory.error || assignments.error || staffDirectory.error || evidence.error || action.error}
        />
        <Button
          disabled={q.isFetching || activityHistory.isFetching || maintenanceHistory.isFetching || evidence.isFetching}
          onClick={() => void Promise.all([q.refetch(), activityHistory.refetch(), maintenanceHistory.refetch(), assignments.refetch(), staffDirectory.refetch(), evidence.refetch()])}
        >
          Tải lại lệnh sửa chữa
        </Button>
        {w && (
          <>
            <RecordContext
              locationId={w.locationId}
              roomId={w.roomId}
              commonArea={w.commonArea}
              assetId={w.assetId}
              incidentId={w.incidentId}
              staffId={w.assignedStaffId}
            />
            <Typography>
              {w.source === 'Proactive' ? 'Bảo trì chủ động' : 'Sửa chữa từ sự cố'} ·{' '}
              {w.description}
            </Typography>
            {w.fastRepairPolicyVersion && (
              <Alert severity="info">
                Sửa nhanh theo chính sách phiên bản {w.fastRepairPolicyVersion} ·{' '}
                {w.fastRepairCategory}. Chi phí 0 VND và không sử dụng vật tư.
              </Alert>
            )}
            <Typography variant="h6">Công việc cần hoàn thành</Typography>
            <Typography>{w.expectedOutcome}</Typography>
            <Typography>{statusText(w.status)} · {w.isOverdue ? 'Quá hạn' : 'Hạn hoàn thành'} {formatInstant(w.targetCompletionAt)}</Typography>
            <Typography>{w.planApproved ? 'Phương án đã được duyệt' : 'Phương án chưa được duyệt'}</Typography>
            {w.canStart && <Alert severity="info">Phương án đã được duyệt. Nhân viên có thể bắt đầu sửa chữa.</Alert>}
            <Typography>
              Kiểm tra: {w.inspectionResult || 'Chưa có'} · Phương án:{' '}
              {w.proposedSolution || 'Chưa có'} · {w.estimatedMinutes ?? '—'} phút
            </Typography>
            <Typography>
              Dự toán: {formatIncidentMoney(w.estimatedCost)} · Đơn vị thực hiện:{' '}
              {w.vendor || 'Chưa có'}
            </Typography>
            <Typography>
              Duyệt phương án lúc {w.approvedAt ? formatInstant(w.approvedAt) : ''}
            </Typography>
            <Typography>
              Kết quả: {w.result || 'Chưa có'} · Thực tế:{' '}
              {w.actualCost == null ? 'Chưa xác minh' : formatIncidentMoney(w.actualCost)}
            </Typography>
            <Typography>
              Xác minh hoàn tất lúc {w.verifiedAt ? formatInstant(w.verifiedAt) : ''}
            </Typography>
            {!q.isFetching && !q.error && w.status === 'PendingApproval' && !w.planApproved && (
              <Stack direction="row">
                <Button
                  onClick={() =>
                    open(
                      'plan-decision',
                      'Duyệt phương án và dự toán',
                      [
                        { name: 'reason', label: 'Ghi chú', optional: true },
                        { name: 'vendor', label: 'Đơn vị thực hiện', optional: true },
                      ],
                      { approve: true },
                    )
                  }
                >
                  Duyệt phương án
                </Button>
                <Button
                  onClick={() =>
                    open('plan-decision', 'Từ chối phương án', reason, { approve: false })
                  }
                >
                  Từ chối phương án
                </Button>
              </Stack>
            )}
            {w.assetProposalPending && (
              <Stack spacing={1}>
                <Typography>
                  Nhân viên đề xuất tài sản {w.proposedAssetName || 'mới'} ·{' '}
                  {w.proposedAssetCategory} · {w.proposedAssetCondition}
                </Typography>
                {activityHistory.data?.items.find((item) => item.action === 'asset_proposed')?.note && (
                  <Typography variant="body2">Lý do đề xuất: {activityHistory.data.items.find((item) => item.action === 'asset_proposed')!.note}</Typography>
                )}
                <Stack direction="row" spacing={1}>
                  <Button
                    disabled={q.isFetching || !!q.error}
                    onClick={() =>
                      open('asset-decision', 'Xác nhận tài sản liên quan', reason, {
                        approve: true,
                      })
                    }
                  >
                    Xác nhận tài sản
                  </Button>
                  <Button
                    disabled={q.isFetching || !!q.error}
                    onClick={() =>
                      open('asset-decision', 'Từ chối liên kết tài sản', reason, { approve: false })
                    }
                  >
                    Từ chối tài sản
                  </Button>
                </Stack>
              </Stack>
            )}
            {w.status === 'PendingVerification' && w.assetProposalPending && (
              <Alert severity="warning">Cần xác nhận hoặc từ chối liên kết tài sản trước khi nghiệm thu lệnh sửa chữa.</Alert>
            )}
            {!!evidence.data?.length && <Typography variant="h6">Ảnh kiểm tra và kết quả</Typography>}
            {!!evidence.data?.length && (
              <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
                {evidence.data.map((image) => (
                  <PrivateEvidenceViewer
                    key={image.id}
                    label={image.kind === 'Completion' ? 'ảnh kết quả sửa chữa' : 'ảnh kiểm tra'}
                    filename={`sua-chua-${image.kind}-${image.id}.jpg`}
                    contentType={image.contentType}
                    fetchBlob={(signal) => action.request<Blob>(`${workRoot}/${id}/evidence/${image.id}`, { signal }, 'blob')}
                  />
                ))}
              </Stack>
            )}
            {!q.isFetching && !q.error && w.status === 'PendingVerification' && !w.assetProposalPending && (
              <Stack direction="row">
                <Button
                  onClick={() =>
                    open('verify', 'Xác minh kết quả và chi phí sửa chữa', [
                      { name: 'actualCost', label: 'Chi phí thực tế (VND)', type: 'money' },
                      { name: 'result', label: 'Kết quả xác minh' },
                      {
                        name: 'costVarianceReason',
                        label: 'Lý do chênh lệch dự toán',
                        optional: true,
                      },
                      ...(w.assetId ? assetFields : []),
                    ])
                  }
                >
                  Xác minh hoàn tất
                </Button>
                <Button
                  onClick={() =>
                    open('rework', 'Yêu cầu sửa chữa lại', [
                      { name: 'note', label: 'Yêu cầu làm lại' },
                    ])
                  }
                >
                  Yêu cầu làm lại
                </Button>
              </Stack>
            )}
            {!q.isFetching && !q.error && !['Verified', 'Cancelled'].includes(w.status) && (
              <Stack spacing={1}>
                {!assignments.isFetching && !staffDirectory.isFetching && !staffOptions.length && (
                  <Alert severity="info">
                    Không có nhân viên đang làm việc và được phân công hợp lệ tại cơ sở. Chưa thể đổi người phụ trách.
                  </Alert>
                )}
                <Button
                  disabled={!staffOptions.length}
                  onClick={() =>
                    open('reassign', 'Phân công lại nhân viên phụ trách', [
                      { name: 'staffId', label: 'Nhân viên phụ trách', type: 'staff', options: staffOptions },
                      ...reason,
                    ])
                  }
                >
                  Đổi nhân viên phụ trách
                </Button>
                <details>
                  <summary>Thao tác khác</summary>
                  <Button
                    color="error"
                    onClick={() => open('cancel', 'Hủy lệnh sửa chữa', [...reason, ...(w.assetId ? assetFields : [])])}
                  >
                    Hủy lệnh sửa chữa
                  </Button>
                </details>
              </Stack>
            )}
            {!!activityHistory.data?.items.length && <Typography variant="h6">Lịch sử xử lý</Typography>}
            {activityHistory.data?.items.map((h) => (
              <Paper key={h.id} variant="outlined" sx={{ p: 1.25 }}>
                <Typography sx={{ fontWeight: 600 }}>{activityLabel(h.action)}</Typography>
                <Typography variant="body2" color="text.secondary">{formatInstant(h.occurredAt)} · Người thực hiện</Typography>
                {h.note && <Typography>{h.note}</Typography>}
              </Paper>
            ))}
            {!!maintenanceHistory.data?.items.length && <Typography variant="h6">Tài chính và lịch sử xác minh</Typography>}
            {maintenanceHistory.data?.items.map((h) => (
              <Typography key={h.id}>
                {formatInstant(h.verifiedAt)} ·{' '}
                {h.action === 'verified'
                  ? 'Đã xác minh'
                  : h.action === 'work_order_cancelled'
                    ? 'Đã hủy công việc'
                    : 'Xử lý trực tiếp'}
                {h.conditionBefore || h.conditionAfter
                  ? ` · ${h.conditionBefore ?? 'Chưa ghi nhận'} → ${h.conditionAfter ?? 'Chưa ghi nhận'}`
                  : ''}
                {h.statusBefore || h.statusAfter
                  ? ` · ${h.statusBefore ?? 'Chưa ghi nhận'} → ${h.statusAfter ?? 'Chưa ghi nhận'}`
                  : ''}{' '}
                · {formatIncidentMoney(h.actualCost)}
              </Typography>
            ))}
            {!!maintenanceHistory.data?.totalCount && <OwnerPagination page={page} total={maintenanceHistory.data.totalCount} change={setPage} />}
            {w.status === 'Verified' && w.roomId && (w.actualCost ?? 0) > 0 && (
              <CompensationPanel work={w} evidence={evidence.data ?? []} />
            )}
            {showIncident && w.incidentId && <IncidentDetail id={w.incidentId} />}
          </>
        )}
        {command && (
          <IncidentCommandDialog
            key={command.path + command.title}
            command={command}
            close={() => setCommand(null)}
          />
        )}
      </Stack>
    </ChartCard>
  );
}
function RecordContext({
  locationId,
  roomId,
  commonArea,
  assetId,
  incidentId,
  staffId,
}: {
  locationId: string;
  roomId?: string | null;
  commonArea?: string | null;
  assetId?: string | null;
  incidentId: string | null;
  staffId?: string;
}) {
  const routed = useInRouterContext();
  const location = useOwnerQuery<{ name: string }>(
    ['incident-location-name', locationId],
    `/api/v1/locations/${locationId}`,
    !!locationId,
  );
  const room = useOwnerQuery<{ roomNumber: string }>(
    ['incident-room-name', roomId],
    `/api/v1/rooms/${roomId}`,
    !!roomId,
  );
  const asset = useOwnerQuery<{ name: string }>(
    ['incident-asset-name', assetId],
    `/api/v1/assets/${assetId}`,
    !!assetId,
  );
  const staff = useOwnerQuery<Staff>(
    ['staff-detail', staffId],
    `/api/v1/staff/${staffId}`,
    !!staffId,
  );
  return (
    <Stack spacing={1}>
      <Typography>
        {location.data?.name ?? 'Cơ sở liên quan'}
        {roomId ? ` · Phòng ${room.data?.roomNumber ?? 'liên quan'}` : ` · ${commonArea || 'Khu vực chung'}`} ·{' '}
        {assetId ? `Tài sản: ${asset.data?.name ?? 'đang tải'}` : 'Chưa gắn tài sản'} ·{' '}
        {staffId
          ? (staff.data?.fullName ?? 'Nhân viên đã phân công')
          : 'Chưa có nhân viên phụ trách'}
      </Typography>
      <OwnerFeedback error={location.error || room.error || asset.error || staff.error} />
      {routed && (
        <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
          {incidentId && (
            <>
              <Button
                component={Link}
                to={`/incidents?incidentId=${encodeURIComponent(incidentId)}`}
              >
                Mở sự cố
              </Button>
              <Button
                component={Link}
                to={`/maintenance?incidentId=${encodeURIComponent(incidentId)}`}
              >
                Các lệnh sửa chữa
              </Button>
            </>
          )}
          {roomId && (
            <Button component={Link} to={`/rooms/${encodeURIComponent(roomId)}`}>
              Mở phòng
            </Button>
          )}
          <Button component={Link} to={`/locations/${encodeURIComponent(locationId)}/investment`}>
            Chi phí tại cơ sở
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
