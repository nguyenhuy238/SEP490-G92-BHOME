import { useState } from 'react';
import { Link } from 'react-router';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { ChevronDown } from 'lucide-react';
import { OwnerFeedback } from '../../../components/common/OwnerWorkspace';
import { useOwnerAction, useOwnerQuery } from '../../../hooks/useOwnerWorkspace';
import { taskRoot } from '../useOperationalTasksApi';

interface InventoryItem {
  id: string;
  roomId: string | null;
  roomNumber: string | null;
  assetId: string | null;
  name: string;
  quantity: number;
  commonArea: string | null;
  checked: boolean;
  inherited: boolean;
  sourceHandoverContractId: string | null;
  note: string | null;
  incidentId: string | null;
}
interface InventoryView {
  taskId: string;
  locationId: string;
  assignmentId: string;
  status: string;
  version: number;
  totalCount: number;
  checkedCount: number;
  items: InventoryItem[];
  pendingOwnerRooms?: string[];
  pendingOwnerCommonAssets?: boolean;
}
interface ReconcilePreview {
  taskId: string;
  version: number;
  currentCount: number;
  ownerConfirmedCount: number;
  removedCount: number;
  addedCount: number;
  preservedChecks: number;
  canApply: boolean;
  blockedReason: string | null;
}

export function LocationAssetInventoryReport({
  taskId,
  selectable = false,
  selectedIds = [],
  onSelectedIdsChange,
}: {
  taskId: string;
  selectable?: boolean;
  selectedIds?: string[];
  onSelectedIdsChange?: (ids: string[]) => void;
}) {
  const [opened, setOpened] = useState<string | null>(null);
  const [confirmScope, setConfirmScope] = useState(false);
  const action = useOwnerAction();
  const report = useOwnerQuery<InventoryView>(
    ['task-location-asset-inventory', taskId],
    `${taskRoot}/${taskId}/location-asset-inventory`,
  );
  const reconcile = useOwnerQuery<ReconcilePreview>(
    ['task-location-asset-inventory-reconcile-preview', taskId],
    taskRoot + '/' + taskId + '/location-asset-inventory/reconcile-preview',
  );
  const data = report.data;
  const preview = reconcile.data;
  const pendingOwnerRooms = data?.pendingOwnerRooms ?? [];
  const pendingOwnerCommonAssets = !!data?.pendingOwnerCommonAssets;
  const blockedReasons: Record<string, string> = {
    location_asset_inventory_reconciliation_locked:
      'Công việc đã sang bước đối soát hoặc ký nên không thể thay đổi phạm vi kiểm kê.',
    location_asset_inventory_owner_confirmation_required:
      'Chủ cơ sở chưa xác nhận tài sản nào. Cần hoàn tất kiểm kê ban đầu.',
    location_asset_inventory_staff_work_conflict:
      'Một số mục Staff đã xác nhận hoặc ghi chú không còn khớp hồ sơ Owner. Cần đối soát thủ công để tránh mất dữ liệu.',
  };
  async function applyOwnerScope() {
    if (!preview?.canApply || !confirmScope || action.busy) return;
    const ok = await action.run(
      () => action.command(taskRoot + '/' + taskId + '/location-asset-inventory/reconcile',
        'POST', { version: preview.version, confirmed: true }),
      'Đã đồng bộ danh sách theo các mục tài sản Owner xác nhận.',
    );
    if (ok) {
      setConfirmScope(false);
      await Promise.all([report.refetch(), reconcile.refetch()]);
    }
  }
  const groups = new Map<string, { title: string; items: InventoryItem[] }>();
  for (const item of data?.items ?? []) {
    const key = item.roomId ? `room:${item.roomId}` : `common:${item.commonArea || ''}`;
    if (!groups.has(key))
      groups.set(key, {
        title: item.roomId ? `Phòng ${item.roomNumber || 'chưa rõ số'}` :
          `Khu vực chung${item.commonArea ? ` · ${item.commonArea}` : ''}`,
        items: [],
      });
    groups.get(key)!.items.push(item);
  }
  const sorted = [...groups.entries()].sort(([a, av], [b, bv]) => {
    if (a.startsWith('room:') !== b.startsWith('room:')) return a.startsWith('room:') ? -1 : 1;
    return av.title.localeCompare(bv.title, 'vi', { numeric: true });
  });

  return (
    <Stack spacing={1.5}>
      <Typography variant="h6" sx={{ fontSize: 16 }}>
        Kiểm kê và bàn giao tài sản toàn cơ sở
      </Typography>
      <OwnerFeedback busy={report.isFetching} error={report.error} />
      {report.error && <Button onClick={() => void report.refetch()}>Tải lại kiểm kê</Button>}
      <OwnerFeedback busy={reconcile.isFetching || action.busy} error={reconcile.error || action.error} />
      {preview && (
        <Stack spacing={1.2} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
            Phạm vi tài sản Owner đã xác nhận
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            Checklist hiện tại: {preview.currentCount} mục · Đã được Owner kiểm kê: {preview.ownerConfirmedCount} mục.
            {preview.removedCount > 0 &&
              ' Có ' + preview.removedCount + ' mục chưa đủ xác nhận sẽ được bỏ khỏi checklist.'}
            {preview.addedCount > 0 &&
              ' Có ' + preview.addedCount + ' mục được bổ sung từ xác nhận Owner.'}
            {preview.preservedChecks > 0 &&
              ' Bảo toàn ' + preview.preservedChecks + ' kết quả Staff đã nhập.'}
          </Typography>
          {!preview.canApply ? (
            <Alert severity="warning" variant="outlined">
              {blockedReasons[preview.blockedReason || ''] ||
                'Cần kiểm tra lại phiên bản và kết quả Staff trước khi thay đổi checklist.'}
            </Alert>
          ) : (
            <>
              <FormControlLabel
                control={
                  <Checkbox checked={confirmScope}
                    onChange={(_, checked) => setConfirmScope(checked)} />
                }
                label="Tôi đã đối chiếu và đồng ý cập nhật danh sách theo kết quả kiểm kê ban đầu của Owner"
              />
              <Button variant="outlined" disabled={!confirmScope || action.busy}
                onClick={() => void applyOwnerScope()}>
                Đồng bộ checklist đã xác nhận
              </Button>
            </>
          )}
        </Stack>
      )}
      {data && (
        <>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Chip size="small" variant="outlined" label={`${data.checkedCount}/${data.totalCount} mục đã kiểm tra`} />
            <Chip size="small" variant="outlined"
              label={`${data.items.filter((item) => item.inherited).length} mục kế thừa từ Tenant`} />
          </Stack>
          <LinearProgress variant="determinate" value={data.totalCount ? data.checkedCount / data.totalCount * 100 : 100} />
          {data.totalCount === 0 && (
            <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
              Chưa có tài sản được Owner kiểm kê và xác nhận để bàn giao. Không thể
              ký nhận nếu không có phạm vi kiểm kê hợp lệ.
            </Typography>
          )}
          {(pendingOwnerRooms.length > 0 || pendingOwnerCommonAssets) && (
            <Alert severity="warning" variant="outlined">
              Còn {pendingOwnerRooms.length} phòng
              {pendingOwnerRooms.length > 0 && ' (' + pendingOwnerRooms.join(', ') + ')'} chờ Owner kiểm kê xác nhận
              {pendingOwnerCommonAssets ? ' và tài sản khu vực chung chưa xác nhận' : ''}.
              Staff có thể cập nhật tiến độ và báo vướng mắc, nhưng chưa được hoàn tất bàn giao.
            </Alert>
          )}
          {data.checkedCount < data.totalCount && (
            <Alert severity="info" variant="outlined">
              Nhân viên đang kiểm kê; còn {data.totalCount - data.checkedCount} mục chưa xác nhận.
            </Alert>
          )}
          {selectable && data.totalCount > 0 && (
            <Alert severity="info" variant="outlined">
              Muốn yêu cầu Staff kiểm tra lại, mở từng phòng/khu vực và chọn mục cần đối soát.
              Các mục kế thừa từ biên bản Tenant cũng có thể được yêu cầu kiểm tra trực tiếp.
            </Alert>
          )}
          {sorted.map(([key, group]) => (
            <Accordion
              key={key}
              expanded={opened === key}
              onChange={(_, value) => setOpened(value ? key : null)}
              variant="outlined"
              disableGutters
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{group.title}</Typography>
                  <Chip size="small" variant="outlined"
                    label={`${group.items.filter((item) => item.checked).length}/${group.items.length}`} />
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1.5}>
                  {group.items.map((item) => (
                    <Box key={item.id} sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5 }}>
                      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                        {selectable && (
                          <FormControlLabel
                            sx={{ mr: 0 }}
                            control={
                              <Checkbox
                                size="small"
                                checked={selectedIds.includes(item.id)}
                                onChange={(_, checked) =>
                                  onSelectedIdsChange?.(
                                    checked
                                      ? [...new Set([...selectedIds, item.id])]
                                      : selectedIds.filter((id) => id !== item.id),
                                  )
                                }
                              />
                            }
                            label="Kiểm tra lại"
                          />
                        )}
                        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{item.name}</Typography>
                        <Chip size="small" color={item.checked ? 'success' : 'default'}
                          variant="outlined" label={item.checked ? 'Đã kiểm tra' : 'Chưa kiểm tra'} />
                        {item.inherited && <Chip size="small" variant="outlined" label="Kế thừa bàn giao Tenant" />}
                      </Stack>
                      <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                        Số lượng theo hồ sơ: {item.quantity}
                      </Typography>
                      {item.note && <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{item.note}</Typography>}
                      {item.incidentId && (
                        <Button
                          component={Link}
                          to={`/incidents?locationId=${encodeURIComponent(data.locationId)}&incidentId=${encodeURIComponent(item.incidentId)}`}
                        >
                          Xem báo cáo sự cố
                        </Button>
                      )}
                    </Box>
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
          ))}
        </>
      )}
    </Stack>
  );
}
