import { useState, type ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router';
import { Building2, CalendarDays, Check, MapPinned, UserRound } from 'lucide-react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { PrivateEvidenceViewer } from '../../components/common/PrivateEvidenceViewer';
import { OwnerFeedback, OwnerPagination } from '../../components/common/OwnerWorkspace';
import { useOwnerAction, useOwnerQuery, type OwnerPage } from '../../hooks/useOwnerWorkspace';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { todayVietnam, type Staff, type StaffAssignment } from '../staff/staffContracts';
import { CompensationPanel } from './CompensationPanel';
import { IncidentCommandDialog, type IncidentCommand } from './IncidentCommandDialog';
import { IncidentEvidencePreview } from './IncidentEvidencePreview';
import { operationalTabs } from '../tasks/components/operationalDetailLayout';
import {
  formatIncidentMoney,
  statusText,
  type IncidentEvidence,
  type WorkOrder,
} from './incidentContracts';

const workRoot = '/api/v1/work-orders';
const reason: IncidentCommand['fields'] = [{ name: 'reason', label: 'Lý do quyết định' }];
const assetFields: IncidentCommand['fields'] = [
  { name: 'assetStatus', label: 'Trạng thái tài sản sau xử lý', type: 'asset' },
  { name: 'assetCondition', label: 'Tình trạng tài sản sau xử lý' },
];

type DetailTab = 'overview' | 'plan' | 'photos' | 'costs' | 'history';
type EmbeddedSection = 'repair' | 'photos' | 'costs' | 'history';
type Activity = {
  id: string;
  action: string;
  note: string;
  occurredAt: string;
  actorId: string | null;
};
type MaintenanceEvent = {
  id: string;
  action: string;
  conditionBefore: string | null;
  conditionAfter: string | null;
  statusBefore: string | null;
  statusAfter: string | null;
  actualCost: number;
  verifiedAt: string;
};

const activityLabels: Record<string, string> = {
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

function nextAction(work: WorkOrder) {
  if (work.assetProposalPending) {
    return {
      title: 'Xem xét tài sản được đề xuất',
      description: 'Xác nhận hoặc từ chối tài sản liên quan trước khi nghiệm thu công việc.',
    };
  }
  if (work.status === 'PendingApproval' && !work.planApproved) {
    return {
      title: 'Duyệt phương án sửa chữa',
      description: 'Kiểm tra kết quả khảo sát, phương án và dự toán nhân viên đã gửi.',
    };
  }
  if (work.status === 'PendingApproval' && work.planApproved) {
    return {
      title: 'Chờ nhân viên bắt đầu sửa chữa',
      description: 'Owner đã duyệt phương án. Nhân viên có thể bắt đầu thực hiện.',
    };
  }
  if (work.status === 'PendingVerification') {
    return {
      title: 'Nghiệm thu kết quả sửa chữa',
      description: 'Đối chiếu ảnh hoàn tất, kết quả và chi phí thực tế trước khi xác minh.',
    };
  }
  if (work.status === 'Assigned') {
    return {
      title: 'Chờ nhân viên kiểm tra',
      description: 'Nhân viên phụ trách sẽ khảo sát, ghi nhận kết quả và đề xuất phương án.',
    };
  }
  if (work.status === 'InProgress') {
    return {
      title: 'Theo dõi tiến độ thực hiện',
      description: 'Nhân viên đang xử lý công việc và sẽ gửi kết quả để nghiệm thu.',
    };
  }
  if (work.status === 'Verified') {
    return {
      title: 'Đã hoàn tất nghiệm thu',
      description: 'Kết quả và chi phí đã được Owner xác minh. Hồ sơ được lưu trong lịch sử.',
    };
  }
  if (work.status === 'Cancelled') {
    return {
      title: 'Lệnh sửa chữa đã hủy',
      description: 'Thông tin và các quyết định trước khi hủy vẫn được giữ trong lịch sử.',
    };
  }
  return {
    title: statusText(work.status),
    description: 'Xem phương án và lịch sử để biết các bước đã được thực hiện.',
  };
}

function workStatusColor(status: string): 'success' | 'warning' | 'info' | 'default' {
  if (status === 'Verified') return 'success';
  if (status === 'PendingApproval' || status === 'PendingVerification') return 'warning';
  if (status === 'InProgress') return 'info';
  return 'default';
}

function WorkOrderProgress({ work }: { work: WorkOrder }) {
  const fast = (work.fastRepairPolicyVersion ?? 0) > 0;
  const steps = [
    'Giao công việc',
    'Staff khảo sát',
    fast ? 'Áp dụng sửa nhanh' : 'Owner duyệt phương án',
    'Staff thực hiện',
    'Owner nghiệm thu',
  ];
  const reached =
    work.status === 'Assigned'
      ? 1
      : work.status === 'PendingApproval'
        ? work.planApproved
          ? 3
          : 2
        : work.status === 'InProgress'
          ? 3
          : work.status === 'PendingVerification'
            ? 4
            : work.status === 'Verified'
              ? steps.length
              : 0;
  if (work.status === 'Cancelled') {
    return (
      <Alert severity="info" variant="outlined">
        Công việc đã hủy. Xem lịch sử để biết các bước đã thực hiện.
      </Alert>
    );
  }
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        Quy trình xử lý
      </Typography>
      <Box
        aria-label="Tiến trình công việc"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2,minmax(0,1fr))', sm: 'repeat(5,minmax(0,1fr))' },
          gap: 0.75,
        }}
      >
        {steps.map((label, index) => {
          const done = index < reached;
          const current = index === reached;
          return (
            <Stack
              key={label}
              direction="row"
              spacing={0.75}
              aria-current={current ? 'step' : undefined}
              data-step-state={done ? 'completed' : current ? 'current' : 'pending'}
              sx={{
                alignItems: 'center',
                p: 0.75,
                minWidth: 0,
                border: '1px solid',
                borderRadius: 1.25,
                borderColor: current ? 'success.main' : done ? 'success.light' : 'divider',
                bgcolor: 'background.paper',
              }}
            >
              <Box
                sx={{
                  width: 20,
                  height: 20,
                  flexShrink: 0,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: '50%',
                  bgcolor: 'background.paper',
                  color: done ? 'success.main' : 'text.secondary',
                  border: '1px solid',
                  borderColor: done || current ? 'success.main' : 'divider',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {done ? <Check size={15} aria-label="Đã hoàn thành" /> : index + 1}
              </Box>
              <Stack spacing={0.1} sx={{ minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: current || done ? 650 : 500, lineHeight: 1.2 }}
                >
                  {label}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                  {done ? 'Hoàn thành' : current ? 'Hiện tại' : 'Chưa đến bước'}
                </Typography>
              </Stack>
            </Stack>
          );
        })}
      </Box>
    </Stack>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack spacing={0.4} sx={{ minWidth: 0 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
        {typeof children === 'string' || typeof children === 'number' ? (
          <Typography sx={{ fontWeight: 550 }}>{children}</Typography>
        ) : (
          children
        )}
      </Box>
    </Stack>
  );
}

function Fields({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2,minmax(0,1fr))' },
        gap: 2,
      }}
    >
      {children}
    </Box>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

export function WorkOrderDetailWorkspace({
  id,
  onBack,
  showIncident = false,
  embedded,
  onOpenIncident,
  inDialog = false,
}: {
  id: string;
  onBack?: () => void;
  showIncident?: boolean;
  onOpenIncident?: (id: string) => void;
  inDialog?: boolean;
  embedded?: {
    incidentId: string;
    section: EmbeddedSection;
    onSectionChange: (section: EmbeddedSection) => void;
  };
}) {
  const [standaloneTab, setStandaloneTab] = useState<DetailTab>('overview');
  const tab = embedded?.section === 'repair' ? 'plan' : (embedded?.section ?? standaloneTab);
  const showRepair = embedded ? embedded.section === 'repair' : tab === 'overview';
  function setTab(next: DetailTab) {
    if (embedded) {
      embedded.onSectionChange(next === 'overview' || next === 'plan' ? 'repair' : next);
    } else {
      setStandaloneTab(next);
    }
  }
  const [page, setPage] = useState(1);
  const [command, setCommand] = useState<IncidentCommand | null>(null);
  const workPath = workRoot + '/' + id;
  const q = useOwnerQuery<WorkOrder>(['work-order', id], workPath, !!id);
  const mismatchedIncident = !!embedded && !!q.data && q.data.incidentId !== embedded.incidentId;
  const w = mismatchedIncident ? undefined : q.data;
  const active = !!w && !['Verified', 'Cancelled'].includes(w.status);
  const canAct = !!w && !q.isFetching && !q.error;
  const compensationEligible =
    !!w && w.status === 'Verified' && !!w.roomId && (w.actualCost ?? 0) > 0;
  const activityHistory = useOwnerQuery<OwnerPage<Activity>>(
    ['work-order-activity', id],
    workPath + '/history?page=1&pageSize=50',
    !!w && (tab === 'history' || !!w.assetProposalPending),
  );
  const maintenanceHistory = useOwnerQuery<OwnerPage<MaintenanceEvent>>(
    ['work-maintenance', id, page],
    workRoot +
      '/maintenance-history?workOrderId=' +
      encodeURIComponent(id) +
      '&page=' +
      page +
      '&pageSize=20',
    !!w && tab === 'history',
  );
  const evidence = useOwnerQuery<IncidentEvidence[]>(
    ['work-evidence', id],
    workPath + '/evidence',
    !!w && (tab === 'photos' || (tab === 'costs' && compensationEligible)),
  );
  const assignments = useOwnerQuery<StaffAssignment[]>(
    ['incident-responsibility', w?.locationId],
    '/api/v1/staff-location-assignments?locationId=' + (w?.locationId ?? ''),
    active && showRepair,
  );
  const staffDirectory = useOwnerQuery<OwnerPage<Staff>>(
    ['work-order-staff-directory'],
    '/api/v1/staff?page=1&pageSize=100',
    active && showRepair,
  );
  const location = useOwnerQuery<{ name: string }>(
    ['incident-location-name', w?.locationId],
    '/api/v1/locations/' + (w?.locationId ?? ''),
    !!w && showRepair && !w.locationName,
  );
  const room = useOwnerQuery<{ roomNumber: string }>(
    ['incident-room-name', w?.roomId],
    '/api/v1/rooms/' + (w?.roomId ?? ''),
    !!w?.roomId && showRepair && !w.roomNumber,
  );
  const asset = useOwnerQuery<{ name: string }>(
    ['incident-asset-name', w?.assetId],
    '/api/v1/assets/' + (w?.assetId ?? ''),
    !!w?.assetId && showRepair && !w.assetName,
  );
  const staff = useOwnerQuery<Staff>(
    ['staff-detail', w?.assignedStaffId],
    '/api/v1/staff/' + (w?.assignedStaffId ?? ''),
    !!w?.assignedStaffId && showRepair && !w.assignedStaffName,
  );
  const action = useOwnerAction();
  const routed = useInRouterContext();
  const today = todayVietnam();
  const eligibleIds = new Set(
    (assignments.data ?? [])
      .filter((assignment) => assignment.startDate <= today && assignment.endDate >= today)
      .map((assignment) => assignment.staffUserId),
  );
  const staffOptions = (staffDirectory.data?.items ?? [])
    .filter(
      (person) =>
        person.isActive &&
        person.employment?.status === 'Active' &&
        person.employment.startDate <= today &&
        (!person.employment.endDate || person.employment.endDate >= today) &&
        eligibleIds.has(person.userId),
    )
    .map((person) => ({ id: person.userId, label: person.fullName || person.email }));

  function open(
    operation: string,
    title: string,
    fields: IncidentCommand['fields'],
    extra?: Record<string, unknown>,
    initialValues?: Record<string, string>,
  ) {
    if (!canAct || !w) return;
    setCommand({
      title,
      path: workPath + '/' + operation,
      version: w.version,
      fields,
      extra,
      initialValues,
      source:
        operation === 'plan-decision' || operation === 'verify' ? (
          <Stack spacing={1} sx={{ borderBottom: 1, borderColor: 'divider', pb: 1.5 }}>
            <Field label="Dự toán">{formatIncidentMoney(w.estimatedCost)}</Field>
            <Field label="Đơn vị thực hiện đã ghi nhận">{w.vendor || 'Chưa có'}</Field>
            {operation === 'plan-decision' ? (
              <Field label="Phương án đề xuất">{w.proposedSolution || 'Chưa có phương án'}</Field>
            ) : (
              <Field label="Kết quả thực hiện">{w.result || 'Chưa có kết quả'}</Field>
            )}
          </Stack>
        ) : undefined,
    });
  }

  const planPending = w?.status === 'PendingApproval' && !w.planApproved;
  const verifyPending = w?.status === 'PendingVerification' && !w.assetProposalPending;
  const next = w ? nextAction(w) : null;
  const assetProposalReason = activityHistory.data?.items.find(
    (event) => event.action === 'asset_proposed',
  )?.note;

  const approvePlan = () =>
    open(
      'plan-decision',
      'Duyệt phương án và dự toán',
      [
        { name: 'reason', label: 'Ghi chú', optional: true },
        { name: 'vendor', label: 'Đơn vị thực hiện', optional: true },
      ],
      { approve: true },
    );
  const rejectPlan = () => open('plan-decision', 'Từ chối phương án', reason, { approve: false });
  const decideAsset = (approve: boolean) =>
    open(
      'asset-decision',
      approve ? 'Xác nhận tài sản liên quan' : 'Từ chối liên kết tài sản',
      reason,
      { approve },
    );
  const verify = () =>
    open('verify', 'Xác minh kết quả và chi phí sửa chữa', [
      { name: 'actualCost', label: 'Chi phí thực tế (VND)', type: 'money' },
      { name: 'result', label: 'Kết quả xác minh' },
      { name: 'costVarianceReason', label: 'Lý do chênh lệch dự toán', optional: true },
      ...(w?.assetId ? assetFields : []),
    ]);
  const requestRework = () =>
    open('rework', 'Yêu cầu sửa chữa lại', [{ name: 'note', label: 'Yêu cầu làm lại' }]);

  return (
    <Stack
      spacing={2.25}
      sx={{
        border: embedded || inDialog ? 0 : 1,
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
        p: embedded || inDialog ? 0 : { xs: 1.75, sm: 2.5 },
        minWidth: 0,
      }}
    >
      {!embedded && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{
            alignItems: { sm: 'flex-start' },
            justifyContent: 'space-between',
            pr: inDialog ? 5 : 0,
          }}
        >
          <Stack spacing={1} sx={{ minWidth: 0, flex: 1 }}>
            {onBack && (
              <Button size="small" sx={{ alignSelf: 'flex-start', px: 0 }} onClick={onBack}>
                Quay lại danh sách
              </Button>
            )}
            <Typography
              variant={inDialog ? 'h5' : 'h6'}
              component="h2"
              sx={{ fontWeight: 750, overflowWrap: 'anywhere' }}
            >
              {w?.description || w?.expectedOutcome || 'Chi tiết lệnh sửa chữa'}
            </Typography>
            {w && (
              <Stack
                direction="row"
                useFlexGap
                spacing={1}
                sx={{ flexWrap: 'wrap', alignItems: 'center' }}
              >
                <Chip
                  size="small"
                  color={
                    w.status === 'Assigned' || (w.status === 'PendingApproval' && w.planApproved)
                      ? 'info'
                      : workStatusColor(w.status)
                  }
                  label={
                    w.status === 'PendingApproval' && w.planApproved
                      ? 'Đã duyệt, chờ bắt đầu'
                      : w.status === 'Assigned' && inDialog
                        ? 'Chờ khảo sát'
                        : statusText(w.status)
                  }
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={w.source === 'Proactive' ? 'Bảo trì chủ động' : 'Từ báo cáo sự cố'}
                />
                {w.fastRepairPolicyVersion != null && (
                  <Chip size="small" variant="outlined" label="Sửa nhanh" />
                )}
                {w.isOverdue && w.status !== 'Verified' && w.status !== 'Cancelled' && (
                  <Chip size="small" color="warning" label="Quá hạn" />
                )}
                {w.incidentId && onOpenIncident && (
                  <Button size="small" onClick={() => onOpenIncident(w.incidentId!)}>
                    Xem báo cáo sự cố gốc
                  </Button>
                )}
                {w.incidentId && !onOpenIncident && routed && (
                  <Button
                    size="small"
                    component={Link}
                    to={'/incidents?incidentId=' + encodeURIComponent(w.incidentId)}
                  >
                    Mở sự cố
                  </Button>
                )}
              </Stack>
            )}
          </Stack>
          <Button
            size="small"
            variant="outlined"
            disabled={q.isFetching}
            onClick={() => void q.refetch()}
          >
            Tải lại lệnh
          </Button>
        </Stack>
      )}

      <OwnerFeedback busy={q.isFetching} error={q.error} notice={action.notice} />
      {mismatchedIncident && (
        <Alert severity="error">Lệnh sửa chữa không thuộc hồ sơ sự cố này.</Alert>
      )}
      {!w && !mismatchedIncident && !q.isFetching && !q.error && (
        <Alert severity="info">Chưa có dữ liệu lệnh sửa chữa. Hãy tải lại để kiểm tra.</Alert>
      )}
      {embedded && (q.error || !w) && !mismatchedIncident && (
        <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => void q.refetch()}>
          Tải lại lệnh
        </Button>
      )}
      {w && next && (
        <>
          {inDialog && !embedded && (
            <>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: 'repeat(2,minmax(0,1fr))',
                    lg: 'repeat(4,minmax(0,1fr))',
                  },
                  gap: 1.5,
                  px: 1.5,
                  py: 1,
                  borderBottom: 1,
                  borderColor: 'divider',
                }}
              >
                {[
                  {
                    label: 'Cơ sở',
                    value: w.locationName || location.data?.name || 'Cơ sở liên quan',
                    icon: Building2,
                  },
                  {
                    label: 'Vị trí',
                    value: w.roomId
                      ? 'Phòng ' + (w.roomNumber || room.data?.roomNumber || 'liên quan')
                      : w.commonArea || 'Khu vực chung',
                    icon: MapPinned,
                  },
                  {
                    label: 'Người phụ trách',
                    value: w.assignedStaffName || staff.data?.fullName || 'Chưa rõ nhân viên',
                    icon: UserRound,
                  },
                  {
                    label: 'Thời hạn',
                    value: w.targetCompletionAt
                      ? formatInstant(w.targetCompletionAt)
                      : 'Chưa có hạn',
                    icon: CalendarDays,
                  },
                ].map(({ label, value, icon: Icon }) => (
                  <Stack key={label} direction="row" spacing={1} sx={{ minWidth: 0 }}>
                    <Box sx={{ color: 'text.secondary', flexShrink: 0, pt: 0.25 }}>
                      <Icon size={18} />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary">
                        {label}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 650,
                          overflowWrap: 'anywhere',
                          color:
                            label === 'Thời hạn' && w.isOverdue && active
                              ? 'error.main'
                              : 'text.primary',
                        }}
                      >
                        {value}
                      </Typography>
                    </Box>
                  </Stack>
                ))}
              </Box>
            </>
          )}
          {!embedded && (
            <Box
              sx={{
                borderBottom: 1,
                borderColor: 'divider',
                ...(inDialog
                  ? { position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.paper' }
                  : {}),
              }}
            >
              <Tabs
                value={tab}
                onChange={(_, value: DetailTab) => setTab(value)}
                variant="scrollable"
                scrollButtons="auto"
                allowScrollButtonsMobile
                aria-label="Các phần của lệnh sửa chữa"
                sx={operationalTabs}
              >
                <Tab value="overview" label="Tổng quan" />
                <Tab value="plan" label="Phương án & sửa chữa" />
                <Tab value="photos" label="Ảnh" />
                <Tab value="costs" label="Chi phí" />
                <Tab value="history" label="Lịch sử" />
              </Tabs>
            </Box>
          )}

          {!embedded && tab === 'overview' && <WorkOrderProgress work={w} />}
          {showRepair && (
            <Paper
              variant="outlined"
              sx={{
                px: { xs: 1.5, sm: 2 },
                py: 1.75,
                borderColor: 'divider',
              }}
            >
              <Stack spacing={1.25}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{ justifyContent: 'space-between' }}
                >
                  <Stack spacing={0.4}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                      {next.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {next.description}
                    </Typography>
                  </Stack>
                </Stack>
                {w.assetProposalPending && (
                  <Stack spacing={0.75}>
                    <Typography variant="body2">
                      Tài sản được đề xuất: <strong>{w.proposedAssetName || 'Tài sản mới'}</strong>
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {w.proposedAssetCategory || 'Chưa phân loại'} ·{' '}
                      {w.proposedAssetCondition || 'Chưa ghi nhận tình trạng'}
                    </Typography>
                    {!!assetProposalReason && (
                      <Typography variant="body2">Lý do: {assetProposalReason}</Typography>
                    )}
                    <OwnerFeedback error={activityHistory.error} />
                    {activityHistory.error && (
                      <Button
                        size="small"
                        onClick={() => void activityHistory.refetch()}
                        sx={{ alignSelf: 'flex-start' }}
                      >
                        Tải lại lý do đề xuất
                      </Button>
                    )}
                  </Stack>
                )}
                {w.status === 'PendingVerification' && w.assetProposalPending && (
                  <Alert severity="warning">
                    Cần quyết định liên kết tài sản trước khi nghiệm thu.
                  </Alert>
                )}
                {canAct && (planPending || !!w.assetProposalPending || verifyPending) && (
                  <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
                    {planPending && (
                      <>
                        <Button variant="contained" onClick={approvePlan}>
                          Duyệt phương án
                        </Button>
                        <Button variant="outlined" onClick={rejectPlan}>
                          Từ chối phương án
                        </Button>
                      </>
                    )}
                    {w.assetProposalPending && (
                      <>
                        <Button variant="contained" onClick={() => decideAsset(true)}>
                          Xác nhận tài sản
                        </Button>
                        <Button variant="outlined" onClick={() => decideAsset(false)}>
                          Từ chối tài sản
                        </Button>
                      </>
                    )}
                    {verifyPending && (
                      <>
                        <Button variant="contained" onClick={verify}>
                          Xác minh hoàn tất
                        </Button>
                        <Button variant="outlined" onClick={requestRework}>
                          Yêu cầu làm lại
                        </Button>
                        <Button variant="text" onClick={() => setTab('photos')}>
                          Xem ảnh kết quả
                        </Button>
                      </>
                    )}
                  </Stack>
                )}
              </Stack>
            </Paper>
          )}

          {(tab === 'overview' || embedded?.section === 'repair') && (
            <Stack spacing={3}>
              <Section title={inDialog ? 'Yêu cầu xử lý' : 'Thông tin công việc'}>
                <Fields>
                  {!inDialog && (
                    <Field label="Cơ sở">
                      {w.locationName || location.data?.name || 'Cơ sở liên quan'}
                    </Field>
                  )}
                  {!inDialog && (
                    <Field label="Vị trí">
                      {w.roomId
                        ? 'Phòng ' + (w.roomNumber || room.data?.roomNumber || 'liên quan')
                        : w.commonArea || 'Khu vực chung'}
                    </Field>
                  )}
                  <Field label="Tài sản">
                    {w.assetId
                      ? w.assetName || asset.data?.name || 'Tài sản liên quan'
                      : 'Chưa gắn tài sản'}
                  </Field>
                  {!inDialog && (
                    <Field label="Nhân viên phụ trách">
                      {w.assignedStaffName || staff.data?.fullName || 'Chưa rõ nhân viên'}
                    </Field>
                  )}
                  <Field label="Kết quả cần đạt">{w.expectedOutcome || 'Chưa có'}</Field>
                  {!inDialog && (
                    <Field label="Thời hạn">{formatInstant(w.targetCompletionAt)}</Field>
                  )}
                </Fields>
                <OwnerFeedback error={location.error || room.error || asset.error || staff.error} />
                {routed && (
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    {w.incidentId && !embedded && !onOpenIncident && (
                      <Button
                        size="small"
                        component={Link}
                        to={'/maintenance?incidentId=' + encodeURIComponent(w.incidentId)}
                      >
                        Các lệnh của sự cố
                      </Button>
                    )}
                    {w.roomId && (
                      <Button
                        size="small"
                        component={Link}
                        to={'/rooms/' + encodeURIComponent(w.roomId)}
                      >
                        Mở phòng
                      </Button>
                    )}
                    <Button
                      size="small"
                      component={Link}
                      to={'/locations/' + encodeURIComponent(w.locationId) + '/investment'}
                    >
                      Chi phí tại cơ sở
                    </Button>
                  </Stack>
                )}
                {showIncident && !w.incidentId && (
                  <Typography variant="body2" color="text.secondary">
                    Bảo trì chủ động không gắn với báo cáo sự cố.
                  </Typography>
                )}
              </Section>
              {active && (
                <>
                  <Divider />
                  <Section title="Điều phối công việc">
                    <OwnerFeedback
                      busy={assignments.isFetching || staffDirectory.isFetching}
                      error={assignments.error || staffDirectory.error}
                    />
                    {!assignments.isFetching &&
                      !staffDirectory.isFetching &&
                      !assignments.error &&
                      !staffDirectory.error &&
                      !staffOptions.length && (
                        <Alert severity="info">
                          Không có nhân viên đang làm việc và được phân công hợp lệ tại cơ sở. Chưa
                          thể đổi người phụ trách.
                        </Alert>
                      )}
                    {(assignments.error || staffDirectory.error) && (
                      <Button
                        size="small"
                        sx={{ alignSelf: 'flex-start' }}
                        onClick={() => {
                          void assignments.refetch();
                          void staffDirectory.refetch();
                        }}
                      >
                        Tải lại nhân viên hợp lệ
                      </Button>
                    )}
                    <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
                      <Button
                        variant="outlined"
                        disabled={!canAct || !staffOptions.length}
                        onClick={() =>
                          open('reassign', 'Phân công lại nhân viên phụ trách', [
                            {
                              name: 'staffId',
                              label: 'Nhân viên phụ trách',
                              type: 'staff',
                              options: staffOptions,
                            },
                            ...reason,
                          ])
                        }
                      >
                        Đổi nhân viên phụ trách
                      </Button>
                      <Button
                        color="error"
                        variant="text"
                        disabled={!canAct}
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
                  </Section>
                </>
              )}
            </Stack>
          )}

          {tab === 'plan' && (
            <Stack spacing={3}>
              <Section title="Khảo sát và phương án">
                <Fields>
                  <Field label="Kết quả kiểm tra">
                    {w.inspectionResult || 'Chưa có kết quả kiểm tra'}
                  </Field>
                  <Field label="Phương án đề xuất">
                    {w.proposedSolution || 'Chưa có phương án'}
                  </Field>
                  <Field label="Thời lượng dự kiến">
                    {w.estimatedMinutes == null ? 'Chưa có' : w.estimatedMinutes + ' phút'}
                  </Field>
                  <Field label="Phê duyệt phương án">
                    {w.planApproved ? 'Đã duyệt' : 'Chưa duyệt'}
                  </Field>
                  <Field label="Thời điểm phê duyệt">
                    {w.approvedAt ? formatInstant(w.approvedAt) : 'Chưa duyệt'}
                  </Field>
                </Fields>
                {w.canStart && (
                  <Alert severity="info">
                    Phương án đã được duyệt. Nhân viên có thể bắt đầu sửa chữa.
                  </Alert>
                )}
                {w.fastRepairPolicyVersion != null && (
                  <Alert severity="info">
                    Sửa nhanh theo chính sách phiên bản {w.fastRepairPolicyVersion}.
                    {w.fastRepairCategory ? ' Nhóm: ' + w.fastRepairCategory + '.' : ''} Chi phí 0
                    VND và không sử dụng vật tư.
                  </Alert>
                )}
              </Section>
              <Divider />
              <Section title="Kết quả thực hiện">
                <Fields>
                  <Field label="Kết quả sửa chữa">{w.result || 'Chưa có kết quả'}</Field>
                  <Field label="Xác minh hoàn tất">
                    {w.verifiedAt ? formatInstant(w.verifiedAt) : 'Chưa xác minh'}
                  </Field>
                </Fields>
                <Button
                  size="small"
                  sx={{ alignSelf: 'flex-start' }}
                  onClick={() => setTab('costs')}
                >
                  Xem chi phí thực hiện
                </Button>
                <Button
                  size="small"
                  sx={{ alignSelf: 'flex-start' }}
                  onClick={() => setTab('photos')}
                >
                  Xem bằng chứng hình ảnh
                </Button>
              </Section>
            </Stack>
          )}

          {tab === 'photos' && (
            <Section title="Ảnh kiểm tra và kết quả">
              <OwnerFeedback busy={evidence.isFetching} error={evidence.error || action.error} />
              {evidence.error && (
                <Button
                  size="small"
                  sx={{ alignSelf: 'flex-start' }}
                  onClick={() => void evidence.refetch()}
                >
                  Tải lại ảnh
                </Button>
              )}
              {!evidence.isFetching && !evidence.error && !evidence.data?.length && (
                <Typography color="text.secondary">
                  Chưa có hình ảnh kiểm tra hoặc hoàn tất.
                </Typography>
              )}
              {!!evidence.data?.length && (
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
                    gap: 1.5,
                  }}
                >
                  {evidence.data.map((item) => (
                    <Stack
                      key={item.id}
                      spacing={1}
                      sx={{
                        minWidth: 0,
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 1.5,
                        p: 1.25,
                      }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 650 }}>
                        {item.kind === 'Completion' ? 'Ảnh kết quả sửa chữa' : 'Ảnh kiểm tra'}
                      </Typography>
                      <Box
                        sx={{
                          minHeight: 160,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <IncidentEvidencePreview
                          path={workPath + '/evidence/' + item.id}
                          alt={
                            item.kind === 'Completion'
                              ? 'Bằng chứng kết quả sửa chữa'
                              : 'Bằng chứng kiểm tra'
                          }
                        />
                      </Box>
                      <PrivateEvidenceViewer
                        label={item.kind === 'Completion' ? 'ảnh kết quả sửa chữa' : 'ảnh kiểm tra'}
                        filename={'sua-chua-' + item.kind + '-' + item.id + '.jpg'}
                        contentType={item.contentType}
                        fetchBlob={(signal) =>
                          action.request<Blob>(
                            workPath + '/evidence/' + item.id,
                            { signal },
                            'blob',
                          )
                        }
                      />
                    </Stack>
                  ))}
                </Box>
              )}
            </Section>
          )}

          {tab === 'costs' && (
            <Stack spacing={3}>
              <Section title="Chi phí thực hiện">
                <Fields>
                  <Field label="Dự toán">{formatIncidentMoney(w.estimatedCost)}</Field>
                  <Field label="Chi phí thực tế đã xác minh">
                    {w.actualCost == null ? 'Chưa xác minh' : formatIncidentMoney(w.actualCost)}
                  </Field>
                  <Field label="Đơn vị thực hiện">{w.vendor || 'Chưa có'}</Field>
                  <Field label="Trạng thái nghiệm thu">
                    {w.verifiedAt
                      ? 'Đã xác minh ngày ' + formatInstant(w.verifiedAt)
                      : 'Chưa xác minh'}
                  </Field>
                </Fields>
              </Section>
              {compensationEligible && (
                <>
                  <Divider />
                  <OwnerFeedback busy={evidence.isFetching} error={evidence.error} />
                  {evidence.error && (
                    <Button
                      size="small"
                      sx={{ alignSelf: 'flex-start' }}
                      onClick={() => void evidence.refetch()}
                    >
                      Tải lại bằng chứng bồi thường
                    </Button>
                  )}
                  <CompensationPanel work={w} evidence={evidence.data ?? []} />
                </>
              )}
            </Stack>
          )}

          {tab === 'history' && (
            <Stack spacing={3}>
              <Section title="Lịch sử xử lý của lệnh">
                <OwnerFeedback busy={activityHistory.isFetching} error={activityHistory.error} />
                {activityHistory.error && (
                  <Button
                    size="small"
                    sx={{ alignSelf: 'flex-start' }}
                    onClick={() => void activityHistory.refetch()}
                  >
                    Tải lại lịch sử xử lý
                  </Button>
                )}
                {!activityHistory.isFetching &&
                  !activityHistory.error &&
                  !activityHistory.data?.items.length && (
                    <Typography color="text.secondary">Chưa có cập nhật xử lý.</Typography>
                  )}
                {activityHistory.data?.items.map((event) => (
                  <Box key={event.id} sx={{ borderBottom: 1, borderColor: 'divider', pb: 1.25 }}>
                    <Typography sx={{ fontWeight: 650 }}>
                      {activityLabels[event.action] ?? 'Đã cập nhật công việc'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatInstant(event.occurredAt)}
                    </Typography>
                    {!!event.note && (
                      <Typography
                        sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                      >
                        {event.note}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Section>
              <Divider />
              <Section title="Lịch sử tài sản và xác minh chi phí">
                <OwnerFeedback
                  busy={maintenanceHistory.isFetching}
                  error={maintenanceHistory.error}
                />
                {maintenanceHistory.error && (
                  <Button
                    size="small"
                    sx={{ alignSelf: 'flex-start' }}
                    onClick={() => void maintenanceHistory.refetch()}
                  >
                    Tải lại lịch sử xác minh
                  </Button>
                )}
                {!maintenanceHistory.isFetching &&
                  !maintenanceHistory.error &&
                  !maintenanceHistory.data?.items.length && (
                    <Typography color="text.secondary">Chưa có lịch sử xác minh.</Typography>
                  )}
                {maintenanceHistory.data?.items.map((event) => (
                  <Box key={event.id} sx={{ borderBottom: 1, borderColor: 'divider', pb: 1.25 }}>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1}
                      sx={{ justifyContent: 'space-between' }}
                    >
                      <Typography sx={{ fontWeight: 650 }}>
                        {event.action === 'verified'
                          ? 'Đã xác minh'
                          : event.action === 'work_order_cancelled'
                            ? 'Đã hủy công việc'
                            : 'Xử lý trực tiếp'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {formatInstant(event.verifiedAt)}
                      </Typography>
                    </Stack>
                    <Fields>
                      <Field label="Chi phí thực tế">{formatIncidentMoney(event.actualCost)}</Field>
                      {(event.conditionBefore || event.conditionAfter) && (
                        <Field label="Tình trạng tài sản">
                          {(event.conditionBefore ?? 'Chưa ghi nhận') +
                            ' → ' +
                            (event.conditionAfter ?? 'Chưa ghi nhận')}
                        </Field>
                      )}
                      {(event.statusBefore || event.statusAfter) && (
                        <Field label="Trạng thái tài sản">
                          {(event.statusBefore ?? 'Chưa ghi nhận') +
                            ' → ' +
                            (event.statusAfter ?? 'Chưa ghi nhận')}
                        </Field>
                      )}
                    </Fields>
                  </Box>
                ))}
                {!!maintenanceHistory.data?.totalCount && (
                  <OwnerPagination
                    page={page}
                    total={maintenanceHistory.data.totalCount}
                    change={setPage}
                    busy={maintenanceHistory.isFetching}
                  />
                )}
              </Section>
            </Stack>
          )}
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
