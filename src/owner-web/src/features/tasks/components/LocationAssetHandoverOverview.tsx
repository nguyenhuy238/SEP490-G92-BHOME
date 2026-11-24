import { useQuery } from '@tanstack/react-query';
import { Box, Button, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Link } from 'react-router';
import { Check, CheckCircle2 } from 'lucide-react';
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
  blockedReason?: string | null;
}

const milestones = [
  { title: 'Owner xác nhận' },
  { title: 'Staff kiểm kê' },
  { title: 'Owner duyệt' },
  { title: 'Owner ký' },
  { title: 'Staff ký' },
];

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
  const activeReport = !!report && report.status !== 'Superseded';
  const scopePending =
    !activeReport &&
    !!checklist &&
    (!!checklist.pendingOwnerRooms?.length || !!checklist.pendingOwnerCommonAssets);
  const staffConflict =
    !activeReport &&
    scopePreview?.blockedReason === 'location_asset_inventory_staff_work_conflict';
  const scopeMismatch =
    !activeReport &&
    !!scopePreview &&
    (scopePreview.ownerConfirmedCount !== scopePreview.currentCount ||
      (!!checklist && scopePreview.currentCount !== checklist.totalCount) ||
      scopePreview.addedCount !== 0 ||
      scopePreview.removedCount !== 0);
  const ownerConfirmationRequired =
    scopePending ||
    (!activeReport &&
      scopePreview?.blockedReason === 'location_asset_inventory_owner_confirmation_required');
  const confirmedScope =
    activeReport ||
    (!!checklist &&
      !!scopePreview &&
      checklist.totalCount > 0 &&
      !ownerConfirmationRequired &&
      !scopeMismatch &&
      !staffConflict);
  const fullySigned =
    report?.status === 'Completed' && !!report.ownerSignature && !!report.staffSignature;
  const completed = task.status === 'Completed' && fullySigned;
  const signatureMismatch =
    (!handover.isPending && task.status === 'Completed' && !fullySigned) ||
    (fullySigned && task.status !== 'Completed' && !isArchive);
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

  const phase =
    isArchive || completed || signatureMismatch
      ? -1
      : !confirmedScope && (ownerConfirmationRequired || scopeMismatch || staffConflict ||
          (task.status === 'Completed' && fullySigned))
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
  const isSubmitted =
    task.status === 'PendingVerification' || (!!report && report.status !== 'Superseded');
  const approved = !!report && report.status !== 'Superseded';
  const stageDone = [
    confirmedScope,
    confirmedScope && isSubmitted,
    confirmedScope && approved,
    confirmedScope && !!report?.ownerSignature,
    confirmedScope && !!report?.staffSignature,
  ];

  const milestoneState = (index: number): MilestoneState => {
    if (completed) return 'done';
    if (stageDone[index]) return 'done';
    if (index === 0 && !ownerConfirmationRequired && !scopePreview) return 'unknown';
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
  } else if (ownerConfirmationRequired) {
    heading = 'Owner cần xác nhận phạm vi tài sản';
    guidance = scopePending
      ? `Còn ${[
          pendingOwnerCount > 0 ? `${pendingOwnerCount} phòng` : null,
          checklist?.pendingOwnerCommonAssets ? 'tài sản khu vực chung' : null,
        ]
          .filter(Boolean)
          .join(' và ')} chưa xác nhận. Hoàn tất kiểm kê của Owner trước khi bàn giao tiếp.`
      : 'Owner chưa xác nhận phạm vi tài sản. Cần hoàn tất kiểm kê ban đầu trước khi bàn giao tiếp.';
    action = 'scope';
    actionLabel = 'Mở kiểm kê của Owner';
  } else if (staffConflict) {
    heading = 'Phạm vi Owner xung đột với kết quả Staff';
    guidance =
      'Một số tài sản Owner thay đổi đã có kết quả Staff kiểm tra hoặc ghi chú. Các ghi nhận Staff được giữ lại; cần kiểm tra sai lệch trước khi bàn giao.';
    action = 'inventory';
    actionLabel = 'Xem kết quả kiểm kê';
  } else if (scopeMismatch) {
    heading = 'Phạm vi Owner và checklist chưa khớp';
    guidance = `Checklist hiện có ${scopePreview!.currentCount} mục, Owner xác nhận ${scopePreview!.ownerConfirmedCount} mục. Kiểm tra phạm vi và kết quả Staff; hệ thống chỉ tự đồng bộ khi đủ điều kiện để bảo toàn dữ liệu.`;
    action = 'inventory';
    actionLabel = 'Xem kiểm kê tài sản';
  } else if (task.status === 'Completed' && fullySigned && !confirmedScope) {
    heading = 'Biên bản đã ký, cần xác minh phạm vi hiện tại';
    guidance =
      'Biên bản có đủ hai chữ ký, nhưng thông tin xác nhận phạm vi hiện tại chưa được xác minh. Xem lại kiểm kê trước khi coi toàn bộ quy trình đã hoàn tất.';
    action = 'inventory';
    actionLabel = 'Xem kiểm kê tài sản';
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
    guidance = exceptions || incidents
      ? `Có ${exceptions} mục hiện trạng bất thường và ${incidents} mục liên quan sự cố. Xem chi tiết trước khi duyệt.`
      : 'Staff đã nộp kiểm kê. Xem kết quả để duyệt hoặc chọn mục cần kiểm tra lại.';
    action = 'inventory';
    actionLabel = 'Đối soát kiểm kê';
  } else if (checklist) {
    heading = 'Staff đang thực hiện kiểm kê';
    guidance = 'Theo dõi tiến độ trong tab Kiểm kê tài sản.';
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
            {guidance && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {guidance}
              </Typography>
            )}
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
