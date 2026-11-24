import { useState, type MouseEvent } from 'react';
import { Link, useInRouterContext } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import {
  ArrowBackRounded,
  ArrowForwardRounded,
  CheckCircleRounded,
  KeyboardArrowDownRounded,
  RefreshRounded,
} from '@mui/icons-material';
import { ValidatedInput } from '../../components/common/ValidatedForm';
import { UserFeedbackError } from '../../../../../packages/client-core/src/api';
import { mutationKeys } from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { PrivateEvidenceViewer } from '../../components/common/PrivateEvidenceViewer';
import { IncidentEvidencePreview } from './IncidentEvidencePreview';
import { OwnerFeedback, OwnerPagination, OwnerTable } from '../../components/common/OwnerWorkspace';
import { useOwnerAction, useOwnerQuery, type OwnerPage } from '../../hooks/useOwnerWorkspace';
import { todayVietnam, type Staff, type StaffAssignment } from '../staff/staffContracts';
import { IncidentCommandDialog, type IncidentCommand } from './IncidentCommandDialog';
import { WorkOrderDetailWorkspace } from './WorkOrderDetailWorkspace';
import {
  formatIncidentMoney,
  statusText,
  type Incident,
  type IncidentEvidence,
  type WorkOrder,
} from './incidentContracts';

const incidentRoot = '/api/v1/incidents';
const workRoot = '/api/v1/work-orders';
const reasonFields: IncidentCommand['fields'] = [{ name: 'reason', label: 'Lý do quyết định' }];
const assetFields: IncidentCommand['fields'] = [
  { name: 'assetStatus', label: 'Trạng thái tài sản sau xử lý', type: 'asset' },
  { name: 'assetCondition', label: 'Tình trạng tài sản sau xử lý' },
];
const tabs = [
  { key: 'overview', label: 'Tổng quan' },
  { key: 'repair', label: 'Sửa chữa & xử lý' },
  { key: 'evidence', label: 'Ảnh & bằng chứng' },
  { key: 'cost', label: 'Chi phí' },
  { key: 'history', label: 'Lịch sử' },
] as const;
type DetailTab = (typeof tabs)[number]['key'];
type IncidentActivity = {
  id: string;
  action: string;
  note: string;
  occurredAt: string;
  actorId: string | null;
};
type EmergencyAction = {
  id: string;
  activityId: string;
  requestedCost: number | null;
  costApproved: boolean | null;
};
type IncidentExpense = {
  id: string;
  category: string;
  amount: number;
  expenseDate: string;
};
type WorkspaceAction = {
  key: string;
  label: string;
  perform: () => void;
  disabled?: boolean;
  reason?: string;
  destructive?: boolean;
};

const historyLabels: Record<string, string> = {
  submitted: 'Đã gửi báo cáo',
  reviewed: 'Đã phân loại sự cố',
  assigned: 'Đã giao nhân viên xử lý',
  acknowledged: 'Nhân viên đã tiếp nhận',
  emergency_action: 'Đã ghi nhận ứng phó khẩn cấp',
  emergency_cost_decided: 'Đã quyết định chi phí khẩn cấp',
  rejected: 'Đã từ chối báo cáo',
  duplicate: 'Đã đánh dấu báo cáo trùng',
  cancelled: 'Đã hủy sự cố',
  resolved: 'Đã xác nhận giải quyết',
  direct_completed: 'Owner đã hoàn tất xử lý trực tiếp',
  proposal_submitted: 'Nhân viên đã gửi phương án',
  plan_approved: 'Đã duyệt phương án',
  plan_rejected: 'Yêu cầu điều chỉnh phương án',
  start: 'Đã bắt đầu sửa chữa',
  progress: 'Đã cập nhật tiến độ',
  blocker: 'Đã ghi nhận vướng mắc',
  submit: 'Đã gửi yêu cầu nghiệm thu',
  verified: 'Đã xác minh hoàn tất',
  rework: 'Yêu cầu làm lại',
  reassigned: 'Đã đổi nhân viên phụ trách',
  work_order_cancelled: 'Đã hủy lệnh sửa chữa',
  fast_repair_started: 'Đã bắt đầu sửa nhanh',
  fast_repair_blocked: 'Sửa nhanh không đủ điều kiện',
  asset_proposed: 'Đã đề xuất liên kết tài sản',
  asset_confirmed: 'Đã xác nhận tài sản',
  asset_rejected: 'Đã từ chối liên kết tài sản',
};

function workflow(incident: Incident, orders: WorkOrder[], totalOrders?: number) {
  const closed = ['Rejected', 'Duplicate', 'Cancelled'].includes(incident.status);
  if (closed) {
    return {
      steps: ['Đã báo cáo', 'Owner quyết định', statusText(incident.status)],
      reached: 2,
      stopped: true,
    };
  }
  if (totalOrders === 0 && ['InProgress', 'Resolved'].includes(incident.status)) {
    return {
      steps: ['Đã báo cáo', 'Phân loại', 'Quyết định xử lý', 'Đã giải quyết'],
      reached: incident.status === 'Resolved' ? 4 : 2,
      stopped: false,
    };
  }
  const current = orders.find((order) => !['Verified', 'Cancelled'].includes(order.status));
  const currentStatus = current?.status ?? incident.openWorkOrderStatus;
  let reached = 1;
  if (incident.type) reached = 2;
  if (incident.status === 'InProgress') reached = 3;
  if (currentStatus === 'PendingApproval' || currentStatus === 'InProgress') reached = 4;
  if (
    currentStatus === 'PendingVerification' ||
    (incident.status === 'InProgress' &&
      orders.some((order) => order.status === 'Verified') &&
      !currentStatus)
  )
    reached = 5;
  if (incident.status === 'Resolved') reached = 6;
  return {
    steps: ['Đã báo cáo', 'Phân loại', 'Giao xử lý', 'Thực hiện', 'Nghiệm thu', 'Đã giải quyết'],
    reached,
    stopped: false,
  };
}

function WorkflowStrip({
  incident,
  orders,
  totalOrders,
}: {
  incident: Incident;
  orders: WorkOrder[];
  totalOrders?: number;
}) {
  const state = workflow(incident, orders, totalOrders);
  return (
    <Box aria-label="Tiến trình xử lý sự cố" sx={{ overflowX: 'auto', pb: 0.5 }}>
      <Stack direction="row" spacing={0.75} sx={{ minWidth: { xs: 640, md: 0 } }}>
        {state.steps.map((step, index) => {
          const complete = index < state.reached;
          const current = !state.stopped && index === state.reached;
          const isStop = state.stopped && index === state.steps.length - 1;
          const green = complete && !isStop;
          return (
            <Box
              key={step}
              sx={{
                minWidth: 0,
                flex: 1,
                py: 1.15,
                px: 1,
                borderRadius: 1.5,
                border: '1px solid',
                borderColor: green || current ? 'success.main' : 'divider',
                bgcolor: green || current ? 'success.light' : 'background.paper',
                color: green || current ? 'success.dark' : 'text.secondary',
              }}
            >
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                {green ? (
                  <CheckCircleRounded color="success" sx={{ fontSize: 19, flexShrink: 0 }} />
                ) : (
                  <Box
                    sx={{
                      display: 'grid',
                      placeItems: 'center',
                      width: 20,
                      height: 20,
                      flexShrink: 0,
                      fontSize: 12,
                      fontWeight: 700,
                      border: '1px solid',
                      borderColor: current ? 'success.main' : 'divider',
                      borderRadius: '50%',
                      color: current ? 'success.dark' : 'text.secondary',
                    }}
                  >
                    {index + 1}
                  </Box>
                )}
                <Typography
                  variant="body2"
                  sx={{ fontWeight: complete || current ? 700 : 500, lineHeight: 1.3 }}
                >
                  {step}
                </Typography>
              </Stack>
            </Box>
          );
        })}
      </Stack>
      {state.stopped && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
          Hồ sơ kết thúc tại quyết định của Owner; các bước sửa chữa và nghiệm thu không diễn ra.
        </Typography>
      )}
    </Box>
  );
}

function SectionHeading({ title, detail }: { title: string; detail?: string }) {
  return (
    <Stack spacing={0.25}>
      <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
        {title}
      </Typography>
      {detail && (
        <Typography variant="body2" color="text.secondary">
          {detail}
        </Typography>
      )}
    </Stack>
  );
}

function ReadValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{children}</Typography>
    </Box>
  );
}

export function IncidentDetailWorkspace({ id, onBack }: { id: string; onBack?: () => void }) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [historyPage, setHistoryPage] = useState(1);
  const [workPage, setWorkPage] = useState(1);
  const [selectedWork, setSelectedWork] = useState('');
  const [command, setCommand] = useState<IncidentCommand | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const detail = useOwnerQuery<Incident>(['incident', id], `${incidentRoot}/${id}`);
  const incident = detail.data;
  const works = useOwnerQuery<OwnerPage<WorkOrder>>(
    ['incident-works', id, workPage],
    `${workRoot}?incidentId=${id}&page=${workPage}&pageSize=20`,
  );
  const openWork = works.data?.items.find(
    (work) => !['Verified', 'Cancelled'].includes(work.status),
  );
  const editable =
    !!incident &&
    !detail.isFetching &&
    !detail.error &&
    ['Submitted', 'InProgress'].includes(incident.status);
  const canConfirmNoOpenWork =
    !!works.data &&
    !works.isFetching &&
    !works.error &&
    !openWork &&
    !incident?.openWorkOrderStatus &&
    works.data.totalCount <= works.data.items.length;
  const needStaff = editable && canConfirmNoOpenWork;
  const evidenceEnabled =
    tab === 'evidence' ||
    (editable &&
      (!canConfirmNoOpenWork || !!incident?.type || incident?.severity === 'Emergency')) ||
    (tab === 'cost' && incident?.severity === 'Emergency');
  const history = useOwnerQuery<OwnerPage<IncidentActivity>>(
    ['incident-history', id, historyPage],
    `${incidentRoot}/${id}/history?page=${historyPage}&pageSize=20`,
    tab === 'history' || (tab === 'cost' && incident?.severity === 'Emergency'),
  );
  const evidence = useOwnerQuery<IncidentEvidence[]>(
    ['incident-evidence', id],
    `${incidentRoot}/${id}/evidence`,
    evidenceEnabled,
  );
  const emergency = useOwnerQuery<EmergencyAction[]>(
    ['incident-emergency', id],
    `${incidentRoot}/${id}/emergency-actions`,
    incident?.severity === 'Emergency' && (editable || tab === 'cost'),
  );
  const expenses = useOwnerQuery<IncidentExpense[]>(
    ['incident-expenses', id],
    `${incidentRoot}/${id}/expenses`,
    tab === 'cost',
  );
  const assignments = useOwnerQuery<StaffAssignment[]>(
    ['incident-responsibility', incident?.locationId],
    `/api/v1/staff-location-assignments?locationId=${incident?.locationId}`,
    needStaff,
  );
  const staffDirectory = useOwnerQuery<OwnerPage<Staff>>(
    ['incident-staff-directory'],
    '/api/v1/staff?page=1&pageSize=100',
    needStaff,
  );
  const action = useOwnerAction();
  const today = todayVietnam();
  const eligibleStaff = new Set(
    (assignments.data ?? [])
      .filter((x) => x.startDate <= today && x.endDate >= today)
      .map((x) => x.staffUserId),
  );
  const staffOptions = (staffDirectory.data?.items ?? [])
    .filter(
      (staff) =>
        staff.isActive &&
        staff.employment?.status === 'Active' &&
        staff.employment.startDate <= today &&
        (!staff.employment.endDate || staff.employment.endDate >= today) &&
        eligibleStaff.has(staff.userId),
    )
    .map((staff) => ({ id: staff.userId, label: staff.fullName || staff.email }));
  const currentStaff = assignments.data?.find(
    (x) => x.startDate <= today && x.endDate >= today,
  )?.staffUserId;
  const responsibleStaff = openWork?.assignedStaffId ?? currentStaff;

  function open(
    operation: string,
    title: string,
    fields: IncidentCommand['fields'],
    extra?: Record<string, unknown>,
  ) {
    if (!incident) return;
    setMenuAnchor(null);
    setCommand({
      title,
      path: `${incidentRoot}/${id}/${operation}`,
      version: incident.version,
      fields,
      extra,
    });
  }

  function openRepair(workId?: string) {
    setMenuAnchor(null);
    setTab('repair');
    if (workId) setSelectedWork(workId);
  }

  const commands: WorkspaceAction[] = [];
  if (incident && editable) {
    if (incident.status === 'Submitted') {
      commands.push({
        key: 'review',
        label: incident.type && incident.category ? 'Cập nhật phân loại' : 'Phân loại sự cố',
        perform: () =>
          open('review', 'Phân loại sự cố', [
            { name: 'type', label: 'Loại sự cố' },
            { name: 'category', label: 'Nhóm xử lý' },
          ]),
      });
    }
    if (canConfirmNoOpenWork || (!openWork && !works.isFetching)) {
      const staffUnavailable = !!assignments.error || !!staffDirectory.error;
      const staffLoading =
        assignments.isFetching ||
        staffDirectory.isFetching ||
        !assignments.data ||
        !staffDirectory.data;
      commands.push({
        key: 'assign',
        label: 'Giao nhân viên xử lý',
        perform: () =>
          open('work-orders', 'Giao lệnh sửa chữa', [
            { name: 'staffId', label: 'Nhân viên phụ trách', type: 'staff', options: staffOptions },
            { name: 'expectedOutcome', label: 'Kết quả cần đạt' },
            { name: 'targetCompletionAt', label: 'Hạn hoàn thành (giờ Việt Nam)', type: 'instant' },
          ]),
        disabled:
          !canConfirmNoOpenWork ||
          !incident.type ||
          staffLoading ||
          staffUnavailable ||
          !staffOptions.length,
        reason: !canConfirmNoOpenWork
          ? 'Chưa xác nhận được tất cả lệnh sửa chữa của sự cố.'
          : !incident.type
            ? 'Cần phân loại sự cố trước.'
            : staffUnavailable
              ? 'Không tải được dữ liệu phân công. Hãy tải lại để kiểm tra nhân viên hợp lệ.'
              : staffLoading
                ? 'Đang kiểm tra nhân viên được phân công.'
                : !staffOptions.length
                  ? 'Không có nhân viên đang hoạt động và có phân công hợp lệ tại cơ sở.'
                  : undefined,
      });
      if (incident.type) {
        commands.push({
          key: 'direct',
          label: 'Owner xử lý trực tiếp',
          perform: () =>
            open(
              'direct-completion',
              'Xác nhận Owner xử lý trực tiếp',
              [
                { name: 'actualCost', label: 'Chi phí thực tế (VND)', type: 'money' },
                { name: 'result', label: 'Kết quả xử lý' },
                ...(incident.assetId ? assetFields : []),
              ],
              {
                evidenceIds:
                  evidence.data
                    ?.filter((image) => image.kind === 'Direct' && !image.activityId)
                    .map((image) => image.id) ?? [],
              },
            ),
          disabled:
            !canConfirmNoOpenWork || evidence.isFetching || !evidence.data || !!evidence.error,
          reason: !canConfirmNoOpenWork
            ? 'Còn lệnh sửa chữa hoặc danh sách lệnh chưa được xác nhận.'
            : 'Cần tải bằng chứng hiện có trước khi xác nhận xử lý trực tiếp.',
        });
      }
    }
    if (incident.severity === 'Emergency') {
      commands.push({
        key: 'emergency',
        label: 'Ghi nhận ứng phó Owner',
        perform: () =>
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
                  ?.filter((image) => image.kind === 'EmergencyAction' && !image.activityId)
                  .map((image) => image.id) ?? [],
            },
          ),
        disabled: evidence.isFetching || !evidence.data || !!evidence.error,
        reason: 'Đang tải ảnh ứng phó để bảo toàn danh sách bằng chứng.',
      });
    }
    if (incident.status === 'Submitted') {
      commands.push(
        {
          key: 'reject',
          label: 'Từ chối báo cáo',
          perform: () => open('reject', 'Từ chối báo cáo', reasonFields),
          destructive: true,
        },
        {
          key: 'duplicate',
          label: 'Đánh dấu trùng báo cáo',
          perform: () =>
            open('duplicate', 'Đánh dấu trùng báo cáo', [
              ...reasonFields,
              {
                name: 'duplicateOfId',
                label: 'Sự cố gốc',
                type: 'incident',
                incidentScope: {
                  id: incident.id,
                  locationId: incident.locationId,
                  roomId: incident.roomId,
                  assetId: incident.assetId,
                },
              },
            ]),
        },
        {
          key: 'cancel',
          label: 'Hủy sự cố',
          perform: () => open('cancel', 'Hủy xử lý sự cố', reasonFields),
          destructive: true,
        },
        {
          key: 'resolve',
          label: 'Đóng không cần sửa chữa',
          perform: () => open('resolve', 'Đóng sự cố không cần sửa chữa', reasonFields),
        },
      );
    }
  }

  const pendingEmergencyCost =
    incident?.severity === 'Emergency' &&
    emergency.data?.some((entry) => entry.requestedCost != null && entry.costApproved == null);
  let primary: WorkspaceAction | undefined;
  if (editable && incident) {
    if (pendingEmergencyCost) {
      primary = {
        key: 'emergency-cost',
        label: 'Quyết định chi phí ứng phó',
        perform: () => setTab('cost'),
      };
    } else if (incident.status === 'Submitted' && (!incident.type || !incident.category)) {
      primary = commands.find((command) => command.key === 'review');
    } else if (openWork) {
      const workLabels: Record<string, string> = {
        Assigned: 'Xem lệnh đã giao',
        PendingApproval: 'Duyệt phương án sửa chữa',
        InProgress: 'Theo dõi tiến độ sửa chữa',
        PendingVerification: 'Nghiệm thu kết quả sửa chữa',
      };
      primary = {
        key: 'open-work',
        label: workLabels[openWork.status] || 'Mở lệnh sửa chữa',
        perform: () => openRepair(openWork.id),
      };
    } else if (canConfirmNoOpenWork) {
      primary = commands.find((command) => command.key === 'assign');
    } else {
      primary = {
        key: 'browse-work',
        label: 'Kiểm tra danh sách lệnh sửa chữa',
        perform: () => openRepair(),
      };
    }
  }
  const secondary = commands.filter((command) => command.key !== primary?.key);
  const nextStep = !incident
    ? ''
    : !editable
      ? incident.status === 'Resolved'
        ? 'Sự cố đã được giải quyết. Bằng chứng, chi phí và quyết định được lưu trong hồ sơ.'
        : 'Hồ sơ đã kết thúc. Có thể xem bằng chứng và lịch sử quyết định.'
      : primary?.key === 'emergency-cost'
        ? 'Có yêu cầu chi phí ứng phó khẩn cấp đang chờ Owner quyết định.'
        : primary?.key === 'review'
          ? 'Báo cáo cần được phân loại để xác định cách xử lý.'
          : openWork?.status === 'PendingApproval'
            ? 'Phương án đang chờ Owner xem xét và quyết định.'
            : openWork?.status === 'PendingVerification'
              ? 'Staff đã gửi kết quả; Owner cần kiểm tra trước khi xác nhận.'
              : openWork?.status === 'Assigned'
                ? 'Lệnh đã giao, đang chờ Staff kiểm tra và đề xuất.'
                : openWork?.status === 'InProgress'
                  ? 'Staff đang thực hiện phương án được duyệt.'
                  : canConfirmNoOpenWork
                    ? 'Chọn người phụ trách hợp lệ hoặc xử lý trực tiếp tại cơ sở.'
                    : 'Mở danh sách lệnh để đối chiếu công việc còn đang xử lý.';

  return (
    <Stack spacing={2.25} sx={{ minWidth: 0, width: '100%' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{ alignItems: { sm: 'flex-start' }, justifyContent: 'space-between' }}
      >
        <Stack spacing={0.75} sx={{ minWidth: 0 }}>
          {onBack && (
            <Button
              startIcon={<ArrowBackRounded />}
              onClick={onBack}
              sx={{ alignSelf: 'flex-start', px: 0.5 }}
            >
              Quay lại hàng đợi
            </Button>
          )}
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap', alignItems: 'center' }}
          >
            <Typography
              variant="h5"
              sx={{ fontWeight: 760, letterSpacing: '-0.02em', overflowWrap: 'anywhere' }}
            >
              {incident?.description || 'Chi tiết sự cố'}
            </Typography>
            {incident && (
              <Chip
                size="small"
                label={statusText(incident.status)}
                color={
                  incident.status === 'Resolved'
                    ? 'success'
                    : incident.status === 'Submitted'
                      ? 'info'
                      : incident.status === 'InProgress'
                        ? 'warning'
                        : 'default'
                }
              />
            )}
            {incident && (
              <Chip
                size="small"
                variant="outlined"
                color={incident.severity === 'Emergency' ? 'error' : 'default'}
                label={incident.severity === 'Emergency' ? 'Khẩn cấp' : 'Thông thường'}
              />
            )}
          </Stack>
          {incident?.createdAt && (
            <Typography variant="body2" color="text.secondary">
              {incident.code ? `${incident.code} · ` : ''}Báo cáo lúc{' '}
              {formatInstant(incident.createdAt)}
            </Typography>
          )}
        </Stack>
        <Button
          variant="outlined"
          startIcon={<RefreshRounded />}
          disabled={detail.isFetching}
          onClick={() =>
            void Promise.all([
              detail.refetch(),
              works.refetch(),
              ...(evidenceEnabled ? [evidence.refetch()] : []),
              ...(tab === 'cost' ? [expenses.refetch()] : []),
              ...(incident?.severity === 'Emergency' && (editable || tab === 'cost')
                ? [emergency.refetch()]
                : []),
              ...(tab === 'cost' && incident?.severity === 'Emergency' ? [history.refetch()] : []),
              ...(tab === 'history' ? [history.refetch()] : []),
              ...(needStaff ? [assignments.refetch(), staffDirectory.refetch()] : []),
            ])
          }
        >
          Tải lại
        </Button>
      </Stack>
      <OwnerFeedback
        busy={detail.isFetching || action.busy}
        error={detail.error || action.error}
        notice={action.notice}
      />
      {incident && (
        <>
          {incident.severity === 'Emergency' && (
            <Alert severity="warning" variant="outlined">
              Ưu tiên an toàn; khi có nguy hiểm, liên hệ dịch vụ khẩn cấp công cộng.{' '}
              {incident.acknowledgedAt
                ? `Staff đã tiếp nhận lúc ${formatInstant(incident.acknowledgedAt)}.`
                : 'Chưa có xác nhận tiếp nhận từ Staff.'}{' '}
              {incident.staffAvailable === false ? 'Hiện chưa có Staff khả dụng. ' : ''}
              {incident.escalationEnabled
                ? 'Đã cấu hình leo thang.'
                : 'Chưa bật leo thang tự động.'}
            </Alert>
          )}
          {incident.severity === 'Emergency' && editable && (
            <OwnerFeedback error={emergency.error} />
          )}
          <WorkflowStrip
            incident={incident}
            orders={works.data?.items ?? []}
            totalOrders={works.data?.totalCount}
          />
          <Paper variant="outlined" sx={{ p: { xs: 1.75, md: 2.25 }, borderRadius: 2 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
            >
              <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                  {editable ? 'Việc cần làm tiếp theo' : 'Kết quả xử lý'}
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  {nextStep}
                </Typography>
                {incident.resolutionNote && incident.status === 'Resolved' && (
                  <Typography sx={{ fontWeight: 600 }}>{incident.resolutionNote}</Typography>
                )}
                {primary?.reason && primary.disabled && (
                  <Typography variant="caption" color="warning.dark">
                    {primary.reason}
                  </Typography>
                )}
              </Stack>
              {editable && (
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}
                >
                  {primary && (
                    <Button
                      variant="contained"
                      endIcon={<ArrowForwardRounded />}
                      disabled={primary.disabled || action.busy}
                      onClick={primary.perform}
                    >
                      {primary.label}
                    </Button>
                  )}
                  {secondary.length > 0 && (
                    <>
                      <Button
                        variant="outlined"
                        endIcon={<KeyboardArrowDownRounded />}
                        onClick={(event: MouseEvent<HTMLButtonElement>) =>
                          setMenuAnchor(event.currentTarget)
                        }
                      >
                        Thao tác khác
                      </Button>
                      <Menu
                        anchorEl={menuAnchor}
                        open={!!menuAnchor}
                        onClose={() => setMenuAnchor(null)}
                        slotProps={{ paper: { sx: { minWidth: 238, maxWidth: 350 } } }}
                      >
                        {secondary.map((entry) => (
                          <MenuItem
                            key={entry.key}
                            disabled={entry.disabled || action.busy}
                            title={entry.disabled ? entry.reason : undefined}
                            sx={{
                              color: entry.destructive ? 'error.main' : 'text.primary',
                              whiteSpace: 'normal',
                            }}
                            onClick={() => {
                              setMenuAnchor(null);
                              entry.perform();
                            }}
                          >
                            <Stack spacing={0.25}>
                              <Typography variant="body2" sx={{ color: 'inherit' }}>
                                {entry.label}
                              </Typography>
                              {entry.disabled && entry.reason && (
                                <Typography variant="caption" sx={{ whiteSpace: 'normal' }}>
                                  {entry.reason}
                                </Typography>
                              )}
                            </Stack>
                          </MenuItem>
                        ))}
                      </Menu>
                    </>
                  )}
                </Stack>
              )}
            </Stack>
            {editable && secondary.some((entry) => entry.disabled && entry.reason) && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Các thao tác chưa đủ điều kiện sẽ bị khóa kèm lý do khi mở menu.
              </Typography>
            )}
          </Paper>
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
            <Tabs
              value={tab}
              onChange={(_, value: DetailTab) => setTab(value)}
              aria-label="Nội dung hồ sơ sự cố"
              variant="scrollable"
              scrollButtons="auto"
              sx={{ px: { xs: 0.5, sm: 2 }, borderBottom: '1px solid', borderColor: 'divider' }}
            >
              {tabs.map((item) => (
                <Tab key={item.key} value={item.key} label={item.label} />
              ))}
            </Tabs>
            <Box
              role="tabpanel"
              aria-label={tabs.find((item) => item.key === tab)?.label}
              sx={{ p: { xs: 1.75, sm: 2.5 }, minWidth: 0 }}
            >
              {tab === 'overview' && (
                <Stack spacing={2}>
                  <SectionHeading title="Báo cáo ban đầu" />
                  <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {incident.description}
                  </Typography>
                  <Divider />
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                      gap: 2,
                    }}
                  >
                    <ReadValue label="Phân loại">{incident.type || 'Chưa phân loại'}</ReadValue>
                    <ReadValue label="Nhóm xử lý">{incident.category || 'Chưa có'}</ReadValue>
                    <ReadValue label="Cơ sở">
                      {incident.locationName || 'Cơ sở liên quan'}
                    </ReadValue>
                    <ReadValue label="Phòng / khu vực">
                      {incident.roomNumber
                        ? `Phòng ${incident.roomNumber}`
                        : incident.commonArea || 'Khu vực chung'}
                    </ReadValue>
                    <ReadValue label="Tài sản">
                      {incident.assetName ||
                        (incident.assetId ? 'Tài sản liên quan' : 'Chưa gắn tài sản')}
                    </ReadValue>
                    <ReadValue label="Người phụ trách">
                      {openWork?.assignedStaffName ||
                        incident.assignedStaffName ||
                        'Chưa rõ nhân viên'}
                    </ReadValue>
                  </Box>
                  <IncidentRecordContext
                    locationId={incident.locationId}
                    roomId={incident.roomId}
                    commonArea={incident.commonArea}
                    assetId={incident.assetId}
                    incidentId={incident.id}
                    staffId={responsibleStaff}
                  />
                </Stack>
              )}
              {tab === 'repair' && (
                <Stack spacing={2}>
                  {selectedWork ? (
                    <WorkOrderDetailWorkspace
                      key={selectedWork}
                      id={selectedWork}
                      onBack={() => setSelectedWork('')}
                    />
                  ) : (
                    <>
                      <SectionHeading
                        title="Lệnh sửa chữa"
                        detail="Mở lệnh để xem phương án, duyệt chi phí, theo dõi tiến độ hoặc nghiệm thu."
                      />
                      <OwnerTable
                        rows={works.data?.items ?? []}
                        loading={works.isFetching}
                        error={works.error}
                        retry={() => void works.refetch()}
                        label="Lệnh sửa chữa của sự cố"
                        id={(work) => work.id}
                        select={(work) => setSelectedWork(work.id)}
                        selectLabel="Mở lệnh"
                        columns={[
                          {
                            label: 'Công việc',
                            render: (work) => (
                              <Stack spacing={0.25}>
                                <Typography sx={{ fontWeight: 700 }}>
                                  {work.description || work.expectedOutcome}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {work.locationName ?? 'Cơ sở liên quan'} ·{' '}
                                  {work.roomNumber
                                    ? `Phòng ${work.roomNumber}`
                                    : work.commonArea || 'Khu vực chung'}
                                  {work.assetName ? ` · ${work.assetName}` : ''}
                                </Typography>
                              </Stack>
                            ),
                          },
                          {
                            label: 'Nhân viên',
                            render: (work) => work.assignedStaffName || 'Chưa rõ nhân viên',
                          },
                          { label: 'Trạng thái', render: (work) => statusText(work.status) },
                          {
                            label: 'Hạn hoàn thành',
                            render: (work) => formatInstant(work.targetCompletionAt),
                          },
                        ]}
                      />
                      {!!works.data?.totalCount && (
                        <OwnerPagination
                          page={workPage}
                          total={works.data.totalCount}
                          change={setWorkPage}
                          busy={works.isFetching}
                        />
                      )}
                    </>
                  )}
                </Stack>
              )}
              {tab === 'evidence' && (
                <Stack spacing={2}>
                  <SectionHeading
                    title="Ảnh và bằng chứng"
                    detail="Tệp riêng tư chỉ được tải qua API đã xác thực và kiểm tra quyền truy cập."
                  />
                  <OwnerFeedback busy={evidence.isFetching} error={evidence.error} />
                  {!evidence.isFetching && !evidence.error && !evidence.data?.length && (
                    <Alert severity="info">Chưa có ảnh được ghi nhận cho sự cố này.</Alert>
                  )}
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 250px), 1fr))',
                      gap: 1.5,
                    }}
                  >
                    {evidence.data?.map((item) => {
                      const path = `${incidentRoot}/${id}/evidence/${item.id}`;
                      const label = evidenceLabel(item.kind);
                      return (
                        <Paper
                          key={item.id}
                          variant="outlined"
                          sx={{ p: 1.5, borderRadius: 1.5, minWidth: 0 }}
                        >
                          <Stack spacing={1}>
                            <IncidentEvidencePreview path={path} alt={label} />
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {label}
                            </Typography>
                            <PrivateEvidenceViewer
                              label={label}
                              filename={`su-co-${item.kind}-${item.id}.jpg`}
                              contentType={item.contentType}
                              fetchBlob={(signal) => action.request<Blob>(path, { signal }, 'blob')}
                              previewButtonLabel="Xem ảnh"
                            />
                          </Stack>
                        </Paper>
                      );
                    })}
                  </Box>
                  {editable && canConfirmNoOpenWork && incident.type && (
                    <>
                      <Divider />
                      <SectionHeading title="Bằng chứng Owner xử lý trực tiếp" />
                      <DirectEvidenceUpload id={id} />
                    </>
                  )}
                  {editable && incident.severity === 'Emergency' && (
                    <>
                      <Divider />
                      <SectionHeading title="Ảnh ứng phó khẩn cấp" />
                      <DirectEvidenceUpload id={id} kind="EmergencyAction" />
                    </>
                  )}
                </Stack>
              )}
              {tab === 'cost' && (
                <Stack spacing={2}>
                  {incident.severity === 'Emergency' && (
                    <>
                      <SectionHeading
                        title="Quyết định chi phí ứng phó khẩn cấp"
                        detail="Owner xem từng yêu cầu của Staff hoặc của chính Owner trước khi duyệt hay từ chối."
                      />
                      <OwnerFeedback
                        busy={emergency.isFetching}
                        error={emergency.error || history.error}
                      />
                      {!emergency.isFetching && !emergency.error && !emergency.data?.length && (
                        <Typography variant="body2" color="text.secondary">
                          Chưa có khoản chi phí ứng phó được ghi nhận.
                        </Typography>
                      )}
                      {emergency.data?.map((entry) => {
                        const activity = history.data?.items.find(
                          (item) => item.id === entry.activityId,
                        );
                        return (
                          <Paper
                            key={entry.id}
                            variant="outlined"
                            sx={{ p: 1.75, borderRadius: 1.5 }}
                          >
                            <Stack spacing={1}>
                              <Stack
                                direction="row"
                                useFlexGap
                                sx={{
                                  gap: 1,
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  flexWrap: 'wrap',
                                }}
                              >
                                <Typography sx={{ fontWeight: 700 }}>
                                  {entry.requestedCost == null
                                    ? 'Không yêu cầu chi phí'
                                    : formatIncidentMoney(entry.requestedCost)}
                                </Typography>
                                <Chip
                                  size="small"
                                  label={
                                    entry.costApproved == null
                                      ? 'Chưa quyết định'
                                      : entry.costApproved
                                        ? 'Đã duyệt'
                                        : 'Đã từ chối'
                                  }
                                  color={
                                    entry.costApproved == null
                                      ? 'warning'
                                      : entry.costApproved
                                        ? 'success'
                                        : 'default'
                                  }
                                />
                              </Stack>
                              <Typography variant="body2" color="text.secondary">
                                {activity?.occurredAt
                                  ? formatInstant(activity.occurredAt)
                                  : 'Ứng phó khẩn cấp'}
                                {activity?.note ? ` · ${activity.note}` : ''}
                              </Typography>
                              {evidence.data
                                ?.filter((image) => image.activityId === entry.activityId)
                                .map((image) => (
                                  <PrivateEvidenceViewer
                                    key={image.id}
                                    label="Ảnh ứng phó khẩn cấp"
                                    filename={`ung-pho-khan-cap-${image.id}.jpg`}
                                    contentType={image.contentType}
                                    fetchBlob={(signal) =>
                                      action.request<Blob>(
                                        `${incidentRoot}/${id}/evidence/${image.id}`,
                                        { signal },
                                        'blob',
                                      )
                                    }
                                  />
                                ))}
                              {editable &&
                                entry.requestedCost != null &&
                                entry.costApproved == null && (
                                  <Stack
                                    direction="row"
                                    spacing={1}
                                    useFlexGap
                                    sx={{ flexWrap: 'wrap' }}
                                  >
                                    <Button
                                      variant="contained"
                                      size="small"
                                      onClick={() =>
                                        open(
                                          `emergency-actions/${entry.id}/cost-decision`,
                                          'Duyệt chi phí khẩn cấp',
                                          reasonFields,
                                          { approve: true },
                                        )
                                      }
                                    >
                                      Duyệt chi phí
                                    </Button>
                                    <Button
                                      variant="outlined"
                                      size="small"
                                      onClick={() =>
                                        open(
                                          `emergency-actions/${entry.id}/cost-decision`,
                                          'Từ chối chi phí khẩn cấp',
                                          reasonFields,
                                          { approve: false },
                                        )
                                      }
                                    >
                                      Từ chối chi phí
                                    </Button>
                                  </Stack>
                                )}
                            </Stack>
                          </Paper>
                        );
                      })}
                      <Divider />
                    </>
                  )}
                  <SectionHeading
                    title="Chi phí vận hành liên quan"
                    detail="Các khoản đã được máy chủ ghi nhận cho sự cố."
                  />
                  <OwnerFeedback busy={expenses.isFetching} error={expenses.error} />
                  {!expenses.isFetching && !expenses.error && !expenses.data?.length && (
                    <Typography variant="body2" color="text.secondary">
                      Chưa có khoản chi phí được ghi nhận.
                    </Typography>
                  )}
                  {expenses.data?.map((entry) => (
                    <Stack
                      key={entry.id}
                      direction="row"
                      spacing={1}
                      sx={{
                        py: 1.25,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Box>
                        <Typography sx={{ fontWeight: 600 }}>{entry.category}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {entry.expenseDate.split('-').reverse().join('/')}
                        </Typography>
                      </Box>
                      <Typography sx={{ fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>
                        {formatIncidentMoney(entry.amount)}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
              {tab === 'history' && (
                <Stack spacing={1.25}>
                  <SectionHeading
                    title="Lịch sử thao tác"
                    detail="Các quyết định và cập nhật đã ghi trên máy chủ."
                  />
                  <OwnerFeedback busy={history.isFetching} error={history.error} />
                  {!history.isFetching && !history.error && !history.data?.items.length && (
                    <Typography variant="body2" color="text.secondary">
                      Chưa có hoạt động được ghi nhận.
                    </Typography>
                  )}
                  {history.data?.items.map((item) => (
                    <Box
                      key={item.id}
                      sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1.5 }}
                    >
                      <Typography sx={{ fontWeight: 700 }}>
                        {historyLabels[item.action] ?? 'Đã cập nhật công việc'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatInstant(item.occurredAt)}
                      </Typography>
                      {item.note && (
                        <Typography sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                          {item.note}
                        </Typography>
                      )}
                    </Box>
                  ))}
                  <OwnerPagination
                    page={historyPage}
                    total={history.data?.totalCount ?? 0}
                    change={setHistoryPage}
                    busy={history.isFetching}
                  />
                </Stack>
              )}
            </Box>
          </Paper>
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
  );
}

function evidenceLabel(kind: string) {
  const labels: Record<string, string> = {
    Report: 'Ảnh báo cáo ban đầu',
    Direct: 'Ảnh Owner xử lý trực tiếp',
    EmergencyAction: 'Ảnh ứng phó khẩn cấp',
    Inspection: 'Ảnh kiểm tra',
    Before: 'Ảnh trước sửa chữa',
    After: 'Ảnh sau sửa chữa',
  };
  return labels[kind] || 'Bằng chứng đính kèm';
}

function DirectEvidenceUpload({
  id,
  kind = 'Direct',
}: {
  id: string;
  kind?: 'Direct' | 'EmergencyAction';
}) {
  const [file, setFile] = useState<File | null>(null);
  const [inputVersion, setInputVersion] = useState(0);
  const action = useOwnerAction();
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  return (
    <Stack spacing={1} sx={{ maxWidth: 540 }}>
      <Typography variant="body2" color="text.secondary">
        PNG/JPEG · tối đa 5 MB/ảnh và 5 ảnh theo giới hạn máy chủ.
      </Typography>
      <ValidatedInput
        key={inputVersion}
        aria-label={kind === 'Direct' ? 'Ảnh xử lý trực tiếp' : 'Ảnh ứng phó khẩn cấp'}
        type="file"
        accept="image/png,image/jpeg"
        disabled={action.busy}
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <OwnerFeedback busy={action.busy} error={action.error} notice={action.notice} />
      <Button
        sx={{ alignSelf: 'flex-start' }}
        variant="outlined"
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
              (byte) => byte.toString(16).padStart(2, '0'),
            ).join('');
            await action.request(`${incidentRoot}/${id}/evidence?kind=${kind}`, {
              method: 'PUT',
              headers: {
                'Content-Type': file.type,
                'Idempotency-Key': keys.get('direct', fingerprint),
              },
              body: bytes,
            });
            keys.confirmed('direct', fingerprint);
            setFile(null);
            setInputVersion((version) => version + 1);
          })
        }
      >
        Tải ảnh {kind === 'Direct' ? 'xử lý trực tiếp' : 'ứng phó khẩn cấp'}
      </Button>
    </Stack>
  );
}

function IncidentRecordContext({
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
      <Typography variant="body2" color="text.secondary">
        {location.data?.name ?? 'Cơ sở liên quan'} ·{' '}
        {roomId ? `Phòng ${room.data?.roomNumber ?? 'liên quan'}` : commonArea || 'Khu vực chung'}
        {' · '}
        {assetId ? `Tài sản: ${asset.data?.name ?? 'đang tải'}` : 'Chưa gắn tài sản'}
        {' · '}
        {staffId
          ? (staff.data?.fullName ?? 'Nhân viên đã phân công')
          : 'Chưa có nhân viên phụ trách'}
      </Typography>
      <OwnerFeedback error={location.error || room.error || asset.error || staff.error} />
      {routed && (
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
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
