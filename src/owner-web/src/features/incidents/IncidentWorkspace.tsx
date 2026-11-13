import { useState } from 'react';
import { Link, useInRouterContext, useSearchParams } from 'react-router';
import { Alert, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { PageHeader, ChartCard, FilterToolbar, StatusChip } from '../../components/common/PortalUI';
import { OwnerLocationPicker, OwnerRoomPicker } from '../../components/common/OwnerSelectors';
import { OwnerFeedback, OwnerPagination, OwnerTable } from '../../components/common/OwnerWorkspace';
import {
  ownerQuery,
  useOwnerAction,
  useOwnerQuery,
  type OwnerPage,
} from '../../hooks/useOwnerWorkspace';
import { downloadOwnerFile } from '../../services/ownerDownloads';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { mutationKeys } from '../../../../../packages/client-core/src/contracts';
import { todayVietnam, type StaffAssignment, type Staff } from '../staff/staffContracts';
import { IncidentCommandDialog, type IncidentCommand } from './IncidentCommandDialog';
import {
  incidentStatuses,
  workStatuses,
  statusText,
  formatIncidentMoney,
  type Incident,
  type WorkOrder,
  type IncidentEvidence,
} from './incidentContracts';

const root = '/api/v1/incidents',
  workRoot = '/api/v1/work-orders';
const reason = [{ name: 'reason', label: 'Lý do quyết định' }];
const assetFields: IncidentCommand['fields'] = [
  { name: 'assetStatus', label: 'Trạng thái tài sản sau xử lý', type: 'asset' },
  { name: 'assetCondition', label: 'Tình trạng tài sản sau xử lý' },
];
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
        title={maintenance ? 'Bảo trì & Lệnh sửa chữa' : 'Sự cố & Xử lý khẩn cấp'}
        subtitle="Owner phân loại, phân công, duyệt phương án/chi phí và xác minh kết quả."
      />
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
        <TextField
          select
          label="Trạng thái cần lọc"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <MenuItem value="">Tất cả trạng thái</MenuItem>
          {Object.entries(maintenance ? workStatuses : incidentStatuses).map(([key, label]) => (
            <MenuItem key={key} value={key}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Mức độ sự cố"
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value);
            setPage(1);
          }}
        >
          <MenuItem value="">Tất cả</MenuItem>
          <MenuItem value="Normal">Thông thường</MenuItem>
          <MenuItem value="Emergency">Khẩn cấp</MenuItem>
        </TextField>
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
            { label: 'Kết quả yêu cầu', render: (w) => w.expectedOutcome },
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
            { label: 'Mã / Nội dung', render: (i) => `${i.code} · ${i.description}` },
            { label: 'Trạng thái', render: (i) => <StatusChip label={statusText(i.status)} /> },
            {
              label: 'Ngày báo cáo',
              render: (i) => (i.createdAt ? formatInstant(i.createdAt) : 'Chưa có'),
            },
            {
              label: 'Mức độ',
              render: (i) => (
                <StatusChip label={i.severity === 'Emergency' ? 'Khẩn cấp' : 'Thông thường'} />
              ),
            },
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
  const action = useOwnerAction();
  const i = q.data;
  const currentStaff = assignments.data?.find(
    (x) => x.startDate <= todayVietnam() && x.endDate >= todayVietnam(),
  )?.staffUserId;
  function open(
    operation: string,
    title: string,
    fields: IncidentCommand['fields'],
    extra?: Record<string, unknown>,
  ) {
    if (i)
      setCommand({ title, path: `${root}/${id}/${operation}`, version: i.version, fields, extra });
  }
  const editable =
    !!i && !q.isFetching && !q.error && ['Submitted', 'InProgress'].includes(i.status);
  return (
    <ChartCard title={i ? `${i.code} · ${statusText(i.status)}` : 'Chi tiết sự cố'}>
      <Stack spacing={2}>
        <OwnerFeedback
          busy={q.isFetching || action.busy}
          error={
            q.error ||
            action.error ||
            history.error ||
            evidence.error ||
            works.error ||
            emergency.error ||
            expenses.error ||
            assignments.error
          }
        />
        <Button
          disabled={q.isFetching}
          onClick={() => void action.run(async () => undefined, 'Đã tải lại dữ liệu.')}
        >
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
            <Typography>{i.description}</Typography>
            <RecordContext
              locationId={i.locationId}
              roomId={i.roomId}
              incidentId={i.id}
              staffId={currentStaff}
            />
            <Typography>
              {i.commonArea || ''}
              {i.createdAt ? ` · Báo cáo lúc ${formatInstant(i.createdAt)}` : ''}
            </Typography>
            <Typography>
              Phân loại: {i.type || 'Chưa phân loại'} · Nhóm: {i.category || 'Chưa có'} · Phiên bản{' '}
              {i.version}
            </Typography>
            <Typography>{i.resolutionNote}</Typography>
            {editable && (
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                <Button
                  onClick={() =>
                    open('review', 'Phân loại sự cố', [
                      { name: 'type', label: 'Loại sự cố' },
                      { name: 'category', label: 'Nhóm xử lý' },
                    ])
                  }
                >
                  Phân loại
                </Button>
                <Button
                  disabled={!i.type || !currentStaff}
                  onClick={() =>
                    open(
                      'work-orders',
                      'Giao lệnh sửa chữa',
                      [
                        { name: 'expectedOutcome', label: 'Kết quả yêu cầu' },
                        {
                          name: 'targetCompletionAt',
                          label: 'Hạn hoàn thành (giờ Việt Nam)',
                          type: 'instant',
                        },
                      ],
                      { staffId: currentStaff },
                    )
                  }
                >
                  Giao Staff phụ trách hiện tại
                </Button>
                <Button onClick={() => open('reject', 'Từ chối báo cáo', reason)}>Từ chối</Button>
                <Button
                  onClick={() =>
                    open('duplicate', 'Đánh dấu trùng báo cáo', [
                      ...reason,
                      {
                        name: 'duplicateOfId',
                        label: 'Sự cố gốc',
                        type: 'incident',
                        incidentScope: {
                          id: i.id,
                          locationId: i.locationId,
                          roomId: i.roomId,
                          assetId: i.assetId,
                        },
                      },
                    ])
                  }
                >
                  Trùng báo cáo
                </Button>
                <Button onClick={() => open('cancel', 'Hủy xử lý sự cố', reason)}>Hủy sự cố</Button>
                <Button onClick={() => open('resolve', 'Đóng sự cố không cần sửa chữa', reason)}>
                  Đóng theo quyết định Owner
                </Button>
                <Button
                  disabled={!i.type}
                  onClick={() =>
                    open(
                      'direct-completion',
                      'Xác nhận Owner xử lý trực tiếp',
                      [
                        { name: 'actualCost', label: 'Chi phí thực tế (VND)', type: 'money' },
                        { name: 'result', label: 'Kết quả xử lý' },
                        ...(i.assetId ? assetFields : []),
                      ],
                      {
                        evidenceIds:
                          evidence.data
                            ?.filter((e) => e.kind === 'Direct' && !e.activityId)
                            .map((e) => e.id) ?? [],
                      },
                    )
                  }
                >
                  Hoàn tất xử lý trực tiếp
                </Button>
              </Stack>
            )}
            {editable && (
              <Alert severity="info">
                {currentStaff
                  ? 'Đã có Staff phụ trách hiện tại.'
                  : 'Chưa có phân công Staff hiệu lực.'}{' '}
                Máy chủ kiểm tra các lệnh sửa chữa và chi phí tồn đọng trước khi đóng sự cố.
              </Alert>
            )}
            <Typography variant="h6">Bằng chứng báo cáo, kiểm tra và hoàn tất</Typography>
            {evidence.data?.map((e) => (
              <Button
                key={e.id}
                onClick={() =>
                  void action.run(
                    () =>
                      downloadOwnerFile(
                        action.request,
                        `${root}/${id}/evidence/${e.id}`,
                        `su-co-${e.kind}-${e.id}`,
                      ),
                    'Đã tải bằng chứng.',
                  )
                }
              >
                {e.kind} · {e.length} byte · {e.workOrderId ? 'Lệnh sửa chữa' : 'Sự cố'}
              </Button>
            ))}
            {editable && <DirectEvidenceUpload id={id} />}
            <Typography variant="h6">Ứng phó khẩn cấp và quyết định chi phí</Typography>
            {editable && i.severity === 'Emergency' && (
              <>
                <DirectEvidenceUpload id={id} kind="EmergencyAction" />
                <Button
                  onClick={() =>
                    open(
                      'emergency-actions',
                      'Ghi nhận ứng phó của Owner',
                      [
                        { name: 'note', label: 'Hành động ứng phó an toàn đã thực hiện' },
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
                  Hoạt động {e.activityId} · Yêu cầu{' '}
                  {e.requestedCost == null ? 'Không có' : formatIncidentMoney(e.requestedCost)} ·{' '}
                  {e.costApproved == null
                    ? 'Chưa quyết định'
                    : e.costApproved
                      ? 'Đã duyệt'
                      : 'Đã từ chối'}
                </Typography>
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
            <Typography variant="h6">Lệnh sửa chữa liên quan</Typography>
            <OwnerTable
              loading={works.isFetching}
              error={works.error}
              retry={() => void works.refetch()}
              label="Lệnh sửa chữa của sự cố"
              rows={works.data?.items ?? []}
              id={(w) => w.id}
              select={(w) => setSelectedWork(w.id)}
              columns={[
                { label: 'Kết quả yêu cầu', render: (w) => w.expectedOutcome },
                { label: 'Trạng thái', render: (w) => statusText(w.status) },
              ]}
            />
            <OwnerPagination
              page={workPage}
              total={works.data?.totalCount ?? 0}
              change={setWorkPage}
            />
            {selectedWork && <WorkOrderDetail key={selectedWork} id={selectedWork} />}
            <Typography variant="h6">Chi phí đã ghi nhận</Typography>
            {expenses.data?.map((e) => (
              <Typography key={e.id}>
                {e.category} · {e.expenseDate.split('-').reverse().join('/')} ·{' '}
                {formatIncidentMoney(e.amount)}
              </Typography>
            ))}
            <Typography variant="h6">Lịch sử và ghi nhận khó khăn</Typography>
            {history.data?.items.map((h) => (
              <Typography key={h.id}>
                {formatInstant(h.occurredAt)} · {h.action} · {h.note} · {h.actorId}
              </Typography>
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
      <input
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
              throw new Error('Chọn ảnh PNG/JPEG không quá 5 MB.');
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
  const history = useOwnerQuery<
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
    ['work-maintenance', w?.incidentId, page],
    `${workRoot}/maintenance-history?incidentId=${w?.incidentId}&page=${page}&pageSize=20`,
    !!w,
  );
  const assignments = useOwnerQuery<StaffAssignment[]>(
    ['incident-responsibility', w?.locationId],
    `/api/v1/staff-location-assignments?locationId=${w?.locationId}`,
    !!w,
  );
  const currentStaff = assignments.data?.find(
    (x) => x.startDate <= todayVietnam() && x.endDate >= todayVietnam(),
  )?.staffUserId;
  function open(
    operation: string,
    title: string,
    fields: IncidentCommand['fields'],
    extra?: Record<string, unknown>,
  ) {
    if (w)
      setCommand({
        title,
        path: `${workRoot}/${id}/${operation}`,
        version: w.version,
        fields,
        extra,
      });
  }
  const action = useOwnerAction();
  return (
    <ChartCard title="Chi tiết lệnh sửa chữa">
      <Stack spacing={2}>
        <OwnerFeedback
          busy={q.isFetching}
          error={q.error || history.error || assignments.error || action.error}
        />
        <Button
          disabled={q.isFetching}
          onClick={() => void action.run(async () => undefined, 'Đã tải lại lệnh sửa chữa.')}
        >
          Tải lại lệnh sửa chữa
        </Button>
        {w && (
          <>
            <RecordContext
              locationId={w.locationId}
              roomId={w.roomId}
              incidentId={w.incidentId}
              staffId={w.assignedStaffId}
            />
            <Typography>
              {w.expectedOutcome} · {statusText(w.status)} · {w.isOverdue ? 'Quá hạn' : 'Hạn'}{' '}
              {formatInstant(w.targetCompletionAt)}
            </Typography>
            <Typography>
              Phiên bản {w.version} ·{' '}
              {w.planApproved ? 'Phương án đã được duyệt' : 'Phương án chưa được duyệt'}
            </Typography>
            {w.canStart && (
              <Alert severity="info">
                Máy chủ xác nhận Staff có thể bắt đầu thực hiện phương án đã duyệt.
              </Alert>
            )}
            <Typography>
              Kiểm tra: {w.inspectionResult || 'Chưa có'} · Phương án v{w.proposalVersion}:{' '}
              {w.proposedSolution || 'Chưa có'} · {w.estimatedMinutes ?? '—'} phút
            </Typography>
            <Typography>
              Dự toán: {formatIncidentMoney(w.estimatedCost)} · Đơn vị thực hiện:{' '}
              {w.vendor || 'Chưa có'}
            </Typography>
            <Typography>
              Người duyệt: {w.approvedById || 'Chưa duyệt'} ·{' '}
              {w.approvedAt ? formatInstant(w.approvedAt) : ''}
            </Typography>
            <Typography>
              Kết quả: {w.result || 'Chưa có'} · Thực tế:{' '}
              {w.actualCost == null ? 'Chưa xác minh' : formatIncidentMoney(w.actualCost)}
            </Typography>
            <Typography>
              Xác minh: {w.verifiedById || 'Chưa có'} ·{' '}
              {w.verifiedAt ? formatInstant(w.verifiedAt) : ''}
            </Typography>
            {!q.isFetching && !q.error && w.status === 'PendingApproval' && (
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
            {!q.isFetching && !q.error && w.status === 'PendingVerification' && (
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
              <Stack direction="row">
                <Button
                  disabled={!currentStaff || currentStaff === w.assignedStaffId}
                  onClick={() =>
                    open('reassign', 'Phân công lại Staff hiện phụ trách', reason, {
                      staffId: currentStaff,
                    })
                  }
                >
                  Phân công lại
                </Button>
                <Button
                  onClick={() =>
                    open('cancel', 'Hủy lệnh sửa chữa', [
                      ...reason,
                      ...(w.assetId ? assetFields : []),
                    ])
                  }
                >
                  Hủy lệnh sửa chữa
                </Button>
              </Stack>
            )}
            <Typography variant="h6">Lịch sử bảo trì của sự cố</Typography>
            {history.data?.items.map((h) => (
              <Typography key={h.id}>
                {formatInstant(h.verifiedAt)} · {h.action} · {h.conditionBefore} →{' '}
                {h.conditionAfter} · {h.statusBefore} → {h.statusAfter} ·{' '}
                {formatIncidentMoney(h.actualCost)}
              </Typography>
            ))}
            <OwnerPagination page={page} total={history.data?.totalCount ?? 0} change={setPage} />
            {showIncident && <IncidentDetail id={w.incidentId} />}
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
  incidentId,
  staffId,
}: {
  locationId: string;
  roomId?: string | null;
  incidentId: string;
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
  const staff = useOwnerQuery<Staff>(
    ['staff-detail', staffId],
    `/api/v1/staff/${staffId}`,
    !!staffId,
  );
  return (
    <Stack spacing={1}>
      <Typography>
        {location.data?.name ?? 'Cơ sở liên quan'}
        {roomId ? ` · Phòng ${room.data?.roomNumber ?? 'liên quan'}` : ' · Khu vực chung'} ·{' '}
        {staffId
          ? (staff.data?.fullName ?? 'Nhân viên đã phân công')
          : 'Chưa có nhân viên phụ trách'}
      </Typography>
      <OwnerFeedback error={location.error || room.error || staff.error} />
      {routed && (
        <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Button component={Link} to={`/incidents?incidentId=${encodeURIComponent(incidentId)}`}>
            Mở sự cố
          </Button>
          <Button component={Link} to={`/maintenance?incidentId=${encodeURIComponent(incidentId)}`}>
            Các lệnh sửa chữa
          </Button>
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
