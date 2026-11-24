import { useQuery } from '@tanstack/react-query';
import { Box, Button, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Link } from 'react-router';
import { AlertTriangle, Check, CheckCircle2, ShieldAlert } from 'lucide-react';
import { ApiError } from '../../../../../../packages/client-core/src/api';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import { useOwnerQuery } from '../../../hooks/useOwnerWorkspace';
import { useMeterApi } from '../../meters/useMeterApi';
import type { OwnerTask } from '../taskContracts';
import { taskRoot } from '../useOperationalTasksApi';
import type { LocationAssetHandoverReport } from './LocationAssetHandoverPanel';

type HandoverTab = 'inventory' | 'handover' | 'history';
type MilestoneState = 'done' | 'current' | 'pending' | 'unknown';

interface InventorySnapshot {
  totalCount: number;
  checkedCount: number;
  locationId: string;
  pendingOwnerRooms?: string[];
  pendingOwnerCommonAssets?: boolean;
  items: {
    checked: boolean;
    condition?: string;
    note?: string | null;
    incidentId?: string | null;
  }[];
}

interface ReconciliationSnapshot {
  currentCount: number;
  ownerConfirmedCount: number;
  addedCount: number;
  removedCount: number;
}

const milestones = [
  { title: 'Owner xác nhận', caption: 'Phạm vi tài sản' },
  { title: 'Staff kiểm kê', caption: 'Kiểm tra và nộp' },
  { title: 'Owner duyệt', caption: 'Đối soát kết quả' },
  { title: 'Owner ký', caption: 'Ký trên Web' },
  { title: 'Staff ký', caption: 'Ký trên Mobile' },
];

function Kpi({
  id,
  value,
  label,
  detail,
  tone = 'default',
}: {
  id: string;
  value: string;
  label: string;
  detail: string;
  tone?: 'default' | 'success' | 'warning';
}) {
  return (
    <Box
      data-testid={`handover-kpi-${id}`}
      data-tone={tone}
      sx={{
        border: 1,
        borderColor: tone === 'default' ? 'divider' : `${tone}.main`,
        bgcolor: (theme) =>
          tone === 'default' ? 'background.paper' : alpha(theme.palette[tone].main, 0.07),
        borderRadius: 1.5,
        p: 1.75,
        minWidth: 0,
      }}
    >
      <Typography
        sx={{
          fontSize: { xs: 22, md: 26 },
          fontWeight: 750,
          lineHeight: 1.3,
          color: tone === 'default' ? 'text.primary' : `${tone}.dark`,
        }}
      >
        {value}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {detail}
      </Typography>
    </Box>
  );
}

function AttentionItem({
  id,
  count,
  label,
  detail,
  severity,
}: {
  id: string;
  count: number | string;
  label: string;
  detail: string;
  severity: 'warning' | 'error';
}) {
  return (
    <Box
      data-testid={`handover-attention-${id}`}
      data-severity={severity}
      sx={{
        display: 'flex',
        gap: 1.25,
        alignItems: 'flex-start',
        flex: 1,
        minWidth: 210,
        border: 1,
        borderColor: `${severity}.main`,
        bgcolor: (theme) => alpha(theme.palette[severity].main, 0.07),
        borderRadius: 1.5,
        p: 1.5,
      }}
    >
      <Box sx={{ display: 'flex', color: `${severity}.dark`, pt: 0.25 }}>
        {severity === 'error' ? <ShieldAlert size={20} /> : <AlertTriangle size={20} />}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 14, color: `${severity}.dark`, fontWeight: 700 }}>
          {count} {label}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {detail}
        </Typography>
      </Box>
    </Box>
  );
}

export function LocationAssetHandoverOverview({
  task,
  onOpenTab,
}: {
  task: OwnerTask;
  onOpenTab: (tab: HandoverTab) => void;
}) {
  const { session } = useAuth();
  const { request } = useMeterApi();
  const inventory = useOwnerQuery<InventorySnapshot>(
    ['task-location-asset-inventory', task.id],
    `${taskRoot}/${task.id}/location-asset-inventory`,
  );
  const reconciliation = useOwnerQuery<ReconciliationSnapshot>(
    ['task-location-asset-inventory-reconcile-preview', task.id],
    `${taskRoot}/${task.id}/location-asset-inventory/reconcile-preview`,
  );
  // Same key/404 semantics as the signing panel: a not-yet-approved report is expected.
  const handover = useQuery({
    queryKey: ['owner-workspace', session?.userId, 'location-asset-handover', task.id],
    enabled: !!session?.roles.includes('Owner'),
    retry: (attempt, error) => !(error instanceof ApiError && error.status === 404) && attempt < 1,
    queryFn: async ({ signal }): Promise<LocationAssetHandoverReport | null> => {
      try {
        return await request<LocationAssetHandoverReport>(
          `${taskRoot}/${task.id}/location-asset-handover`,
          { signal },
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });

  const checklist = inventory.data;
  const scopePreview = reconciliation.data;
  const report = handover.data;
  const isArchive = task.status === 'Cancelled';
  const scopePending =
    !!checklist && (!!checklist.pendingOwnerRooms?.length || !!checklist.pendingOwnerCommonAssets);
  const activeReport = !!report && report.status !== 'Superseded';
  const scopeMismatch =
    !activeReport &&
    !!scopePreview &&
    (scopePreview.ownerConfirmedCount !== scopePreview.currentCount ||
      scopePreview.addedCount !== 0 ||
      scopePreview.removedCount !== 0);
  const signedCount = Number(!!report?.ownerSignature) + Number(!!report?.staffSignature);
  const fullySigned =
    report?.status === 'Completed' && !!report.ownerSignature && !!report.staffSignature;
  const completed = task.status === 'Completed' && fullySigned;
  const signatureMismatch =
    (!handover.isPending && task.status === 'Completed' && !fullySigned) ||
    (fullySigned && task.status !== 'Completed' && !isArchive);
  const notes = checklist?.items.filter((item) => !!item.note?.trim()).length ?? 0;
  const exceptions =
    checklist?.items.filter(
      (item) =>
        item.checked &&
        (item.condition === 'Missing' ||
          item.condition === 'Damaged' ||
          item.condition === 'NotAccessible'),
    ).length ?? 0;
  const incidents = checklist?.items.filter((item) => !!item.incidentId).length ?? 0;
  const pendingOwnerCount = checklist?.pendingOwnerRooms?.length ?? 0;
  const issueCount =
    notes +
    exceptions +
    incidents +
    pendingOwnerCount +
    Number(!!checklist?.pendingOwnerCommonAssets) +
    Number(scopeMismatch);

  const phase =
    isArchive || completed || signatureMismatch
      ? -1
      : (scopePending || scopeMismatch) && !activeReport
        ? 0
        : report?.status === 'PendingStaffSignature'
          ? 4
          : report?.status === 'PendingOwnerSignature'
            ? 3
            : task.status === 'PendingVerification'
              ? 2
              : checklist
                ? 1
                : -1;
  const confirmedScope =
    activeReport ||
    (!!checklist && !!scopePreview && checklist.totalCount > 0 && !scopePending && !scopeMismatch);
  const isSubmitted =
    task.status === 'PendingVerification' || (!!report && report.status !== 'Superseded');
  const approved = !!report && report.status !== 'Superseded';
  const stageDone = [
    confirmedScope,
    isSubmitted,
    approved,
    !!report?.ownerSignature,
    !!report?.staffSignature,
  ];

  const milestoneState = (index: number): MilestoneState => {
    if (completed) return 'done';
    if (stageDone[index]) return 'done';
    if (index === 0 && !activeReport && !scopePending && !scopePreview) return 'unknown';
    if (phase === index) return 'current';
    if (phase === -1 && !completed && !isArchive) return 'unknown';
    return 'pending';
  };

  let heading = 'Đang xác minh trạng thái bàn giao';
  let guidance =
    'Đối chiếu tiến độ kiểm kê và trạng thái biên bản trước khi thực hiện bước tiếp theo.';
  let action: HandoverTab | 'scope' = 'inventory';
  let actionLabel = 'Xem kiểm kê tài sản';
  if (isArchive) {
    heading = 'Công việc đã chuyển giao';
    guidance =
      'Phiên phân công này không còn hiệu lực. Hồ sơ và các mốc xử lý đã ghi nhận vẫn có thể tra cứu.';
    action = 'history';
    actionLabel = 'Xem lịch sử';
  } else if (completed) {
    heading = 'Hai bên đã hoàn tất bàn giao';
    guidance = `Biên bản đã có đủ chữ ký Owner và Staff${report.staffSignature ? `, ký cuối lúc ${formatInstant(report.staffSignature.signedAt)}` : ''}.`;
    action = 'handover';
    actionLabel = 'Xem biên bản đã ký';
  } else if (signatureMismatch) {
    heading = 'Cần đối chiếu trạng thái công việc và biên bản';
    guidance =
      'Trạng thái công việc chưa khớp với hai chữ ký trên biên bản, hoặc dữ liệu biên bản chưa được xác minh. Không coi hồ sơ là đã ký đủ cho đến khi đối chiếu.';
    action = 'handover';
    actionLabel = 'Kiểm tra biên bản';
  } else if (scopePending && !activeReport) {
    heading = 'Owner cần xác nhận phạm vi tài sản';
    guidance = `Còn ${pendingOwnerCount} phòng${checklist?.pendingOwnerCommonAssets ? ' và tài sản khu vực chung' : ''} chưa xác nhận. Hoàn tất kiểm kê của Owner trước khi bàn giao tiếp.`;
    action = 'scope';
    actionLabel = 'Mở kiểm kê của Owner';
  } else if (scopeMismatch) {
    heading = 'Owner cần đối chiếu và đồng bộ checklist';
    guidance = `Checklist đang có ${scopePreview!.currentCount} mục, trong khi Owner xác nhận ${scopePreview!.ownerConfirmedCount} mục. Xem phần Đối chiếu / đồng bộ trước khi tiếp tục bàn giao.`;
    action = 'inventory';
    actionLabel = 'Đối chiếu checklist';
  } else if (report?.status === 'PendingOwnerSignature') {
    heading = 'Owner cần xem và ký biên bản';
    guidance =
      'Kết quả đã được duyệt thành biên bản. Đọc PDF và ký tay trên Web trước khi chuyển Staff ký.';
    action = 'handover';
    actionLabel = 'Xem và ký biên bản';
  } else if (report?.status === 'PendingStaffSignature') {
    heading = 'Đang chờ Staff ký nhận';
    guidance =
      'Owner đã ký biên bản. Staff cần xem và ký trên Mobile; Owner chỉ theo dõi ở bước này.';
    action = 'handover';
    actionLabel = 'Xem biên bản chờ ký';
  } else if (task.status === 'PendingVerification') {
    heading = 'Owner cần đối soát kết quả Staff';
    guidance =
      'Staff đã nộp kiểm kê. Xem hiện trạng và ghi chú, chọn mục cần kiểm tra lại nếu có; sau đó duyệt hoặc yêu cầu làm lại trong Biên bản & ký.';
    action = 'inventory';
    actionLabel = 'Đối soát kiểm kê';
  } else if (checklist) {
    heading = 'Staff đang thực hiện kiểm kê';
    guidance = `Staff đã kiểm tra ${checklist.checkedCount}/${checklist.totalCount} mục. Owner theo dõi tiến độ; chưa thể ký trước khi Staff nộp và Owner duyệt.`;
    action = 'inventory';
    actionLabel = 'Xem tiến độ kiểm kê';
  }

  return (
    <Stack spacing={2.5}>
      <Box component="section">
        <Typography sx={{ fontWeight: 700, fontSize: 17, mb: 1.25 }}>Quy trình bàn giao</Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              md: 'repeat(5, minmax(0, 1fr))',
            },
            gap: 1,
          }}
        >
          {milestones.map((step, index) => {
            const state = milestoneState(index);
            const isDone = state === 'done';
            const isCurrent = state === 'current';
            return (
              <Box
                key={step.title}
                data-testid={`handover-step-${index + 1}`}
                data-state={state}
                aria-current={isCurrent ? 'step' : undefined}
                sx={{
                  p: 1.5,
                  minWidth: 0,
                  border: 1,
                  borderColor: isCurrent ? 'success.dark' : isDone ? 'success.main' : 'divider',
                  borderRadius: 1.5,
                  bgcolor: (theme) =>
                    isCurrent
                      ? alpha(theme.palette.success.main, 0.13)
                      : isDone
                        ? alpha(theme.palette.success.main, 0.08)
                        : 'background.paper',
                  boxShadow: isCurrent ? 1 : 'none',
                }}
              >
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minHeight: 22 }}>
                  {(isDone || isCurrent) && (
                    <Box
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        bgcolor: 'success.main',
                        color: 'common.white',
                        flexShrink: 0,
                      }}
                    >
                      {isDone ? (
                        <Check
                          size={15}
                          strokeWidth={3}
                          aria-label={`Đã hoàn tất bước ${index + 1}`}
                        />
                      ) : (
                        <Typography
                          component="span"
                          sx={{ fontSize: 12, fontWeight: 700, color: 'inherit' }}
                        >
                          {index + 1}
                        </Typography>
                      )}
                    </Box>
                  )}
                  <Typography
                    variant="caption"
                    sx={{
                      color: isDone || isCurrent ? 'success.dark' : 'text.secondary',
                      fontWeight: isDone || isCurrent ? 700 : 400,
                    }}
                  >
                    Bước {index + 1} ·{' '}
                    {isDone
                      ? 'Hoàn tất'
                      : isCurrent
                        ? 'Đang xử lý'
                        : state === 'unknown'
                          ? 'Chưa xác minh'
                          : 'Chưa tới'}
                  </Typography>
                </Stack>
                <Typography
                  sx={{
                    fontSize: 14,
                    fontWeight: isDone || isCurrent ? 750 : 600,
                    color: isDone || isCurrent ? 'success.dark' : 'text.primary',
                    mt: 0.5,
                  }}
                >
                  {step.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {step.caption}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box
        component="section"
        data-testid="handover-next-action"
        data-state={completed ? 'completed' : 'in-progress'}
        sx={{
          border: 1,
          borderColor: completed
            ? 'success.main'
            : signatureMismatch || scopePending
              ? 'warning.main'
              : 'divider',
          bgcolor: (theme) =>
            completed ? alpha(theme.palette.success.main, 0.09) : 'background.paper',
          borderRadius: 1.5,
          p: 2,
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {!completed && !isArchive && (
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                {phase >= 0 ? 'Việc cần xử lý · bước ' + (phase + 1) : 'Trạng thái cần đối chiếu'}
              </Typography>
            )}
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {completed && (
                <Box sx={{ display: 'inline-flex', color: 'success.main', flexShrink: 0 }}>
                  <CheckCircle2 size={21} aria-label="Bàn giao đã hoàn tất" />
                </Box>
              )}
              <Typography
                sx={{
                  fontWeight: 700,
                  fontSize: 16,
                  color: completed ? 'success.dark' : 'text.primary',
                }}
              >
                {heading}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {guidance}
            </Typography>
          </Box>
          {action === 'scope' && checklist ? (
            <Button
              variant="outlined"
              component={Link}
              to={`/locations/${checklist.locationId}/assets?tab=review`}
              sx={{ flexShrink: 0 }}
            >
              {actionLabel}
            </Button>
          ) : (
            <Button
              variant={completed ? 'contained' : 'outlined'}
              onClick={() => onOpenTab(action as HandoverTab)}
              sx={{ flexShrink: 0 }}
            >
              {actionLabel}
            </Button>
          )}
        </Stack>
      </Box>

      <Box component="section">
        <Typography sx={{ fontWeight: 700, fontSize: 17, mb: 1.25 }}>Kết quả bàn giao</Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'minmax(0, 1fr)',
              sm: 'repeat(3, minmax(0, 1fr))',
            },
            gap: 1,
          }}
        >
          <Kpi
            id="assets"
            value={checklist ? `${checklist.checkedCount}/${checklist.totalCount}` : '—'}
            label="Tài sản đã kiểm tra"
            detail={checklist ? 'Theo checklist của Staff' : 'Chưa tải kiểm kê'}
            tone={
              checklist?.totalCount && checklist.checkedCount === checklist.totalCount
                ? 'success'
                : checklist?.checkedCount
                  ? 'warning'
                  : 'default'
            }
          />
          <Kpi
            id="notes"
            value={checklist ? String(notes) : '—'}
            label="Mục có ghi chú"
            detail={notes > 0 ? 'Cần mở để đọc và đối chiếu' : 'Không có ghi chú cần đọc'}
            tone={notes > 0 ? 'warning' : checklist ? 'success' : 'default'}
          />
          <Kpi
            id="signatures"
            value={report ? `${signedCount}/2` : '—'}
            label="Chữ ký hoàn tất"
            detail="Owner và Staff"
            tone={fullySigned ? 'success' : signedCount > 0 ? 'warning' : 'default'}
          />
        </Box>
      </Box>

      {checklist && issueCount > 0 && (
        <Box
          component="section"
          sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 2 }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
          >
            <Box>
              <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1 }}>
                Thông tin cần chú ý
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {notes > 0 && (
                  <AttentionItem
                    id="notes"
                    severity="warning"
                    count={notes}
                    label="mục có ghi chú"
                    detail="Cần đọc và đối chiếu hiện trạng, không mặc định là tài sản thiếu hoặc hỏng."
                  />
                )}
                {incidents > 0 && (
                  <AttentionItem
                    id="incidents"
                    severity="error"
                    count={incidents}
                    label="mục liên quan sự cố"
                    detail="Mở kiểm kê để xem tài sản và báo cáo sự cố liên quan."
                  />
                )}
                {exceptions > 0 && (
                  <AttentionItem
                    id="exceptions"
                    severity="error"
                    count={exceptions}
                    label="mục thiếu, hỏng hoặc không thể kiểm tra"
                    detail="Cần đối chiếu hiện trạng đã được Staff ghi nhận."
                  />
                )}
                {(scopePending || scopeMismatch) && (
                  <AttentionItem
                    id="scope"
                    severity="warning"
                    count={
                      scopePending
                        ? pendingOwnerCount > 0
                          ? pendingOwnerCount
                          : 'Tài sản'
                        : 'Checklist'
                    }
                    label={
                      scopePending
                        ? pendingOwnerCount > 0
                          ? 'phòng chưa xác nhận'
                          : 'khu vực chung chưa xác nhận'
                        : 'cần đối chiếu phạm vi Owner'
                    }
                    detail={
                      checklist.pendingOwnerCommonAssets
                        ? 'Bao gồm tài sản khu vực chung.'
                        : 'Xem lại phạm vi kiểm kê của Owner.'
                    }
                  />
                )}
              </Stack>
            </Box>
            <Button variant="text" onClick={() => onOpenTab('inventory')} sx={{ flexShrink: 0 }}>
              Xem chi tiết kiểm kê
            </Button>
          </Stack>
        </Box>
      )}

      {(inventory.error || handover.error) && (
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Typography variant="body2" color="text.secondary">
            {inventory.error
              ? 'Chưa tải được kết quả kiểm kê.'
              : 'Chưa tải được trạng thái biên bản.'}
          </Typography>
          <Button
            size="small"
            onClick={() => void (inventory.error ? inventory.refetch() : handover.refetch())}
          >
            Thử tải lại
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
