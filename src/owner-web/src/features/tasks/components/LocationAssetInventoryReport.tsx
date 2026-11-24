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
  ToggleButton,
  ToggleButtonGroup,
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
  condition?: 'Unassessed' | 'Intact' | 'Missing' | 'Damaged' | 'NotAccessible';
  inherited: boolean;
  sourceHandoverContractId: string | null;
  note: string | null;
  incidentId: string | null;
  priorStaffTaskId?: string | null;
  priorStaffUserId?: string | null;
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
const conditionLabels: Record<string, string> = {
  Unassessed: 'Chưa ghi nhận hiện trạng',
  Intact: 'Đủ và nguyên vẹn',
  Missing: 'Thiếu tài sản',
  Damaged: 'Tài sản hư hỏng',
  NotAccessible: 'Không thể kiểm tra',
};
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

type ItemFilter = 'all' | 'unchecked' | 'noted';

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
  const [scopeExpanded, setScopeExpanded] = useState(false);
  const [roomsExpanded, setRoomsExpanded] = useState(false);
  const [itemFilter, setItemFilter] = useState<ItemFilter>('all');
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
  const items = data?.items ?? [];
  const uncheckedCount = items.filter((item) => !item.checked).length;
  const notedCount = items.filter((item) => !!item.note?.trim()).length;
  const visibleItems = items.filter((item) =>
    itemFilter === 'all' ? true : itemFilter === 'unchecked' ? !item.checked : !!item.note?.trim(),
  );
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
      () =>
        action.command(taskRoot + '/' + taskId + '/location-asset-inventory/reconcile', 'POST', {
          version: preview.version,
          confirmed: true,
        }),
      'Đã đồng bộ danh sách theo các mục tài sản Owner xác nhận.',
    );
    if (ok) {
      setConfirmScope(false);
      await Promise.all([report.refetch(), reconcile.refetch()]);
    }
  }
  const groups = new Map<string, { title: string; items: InventoryItem[] }>();
  for (const item of visibleItems) {
    const key = item.roomId ? `room:${item.roomId}` : `common:${item.commonArea || ''}`;
    if (!groups.has(key))
      groups.set(key, {
        title: item.roomId
          ? `Phòng ${item.roomNumber || 'chưa rõ số'}`
          : `Khu vực chung${item.commonArea ? ` · ${item.commonArea}` : ''}`,
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
      <OwnerFeedback
        busy={reconcile.isFetching || action.busy}
        error={reconcile.error || action.error}
      />
      {preview && (
        <Stack spacing={1.5} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 2 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
          >
            <Typography sx={{ fontSize: 15, fontWeight: 700 }}>
              Phạm vi kiểm kê của Owner
            </Typography>
            <Button
              size="small"
              variant="outlined"
              aria-expanded={scopeExpanded}
              onClick={() => setScopeExpanded((value) => !value)}
              sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, flexShrink: 0 }}
            >
              {scopeExpanded ? 'Thu gọn đối chiếu' : 'Đối chiếu / đồng bộ'}
            </Button>
          </Stack>
          <Stack
            direction="row"
            spacing={{ xs: 2, sm: 4 }}
            useFlexGap
            sx={{ flexWrap: 'wrap', alignItems: 'center' }}
          >
            <Box>
              <Typography variant="caption" color="text.secondary">
                Checklist hiện tại
              </Typography>
              <Typography
                sx={{
                  fontSize: 22,
                  fontWeight: 750,
                  lineHeight: 1.3,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {preview.currentCount}{' '}
                <Box
                  component="span"
                  sx={{ fontSize: 13, fontWeight: 500, color: 'text.secondary' }}
                >
                  mục
                </Box>
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Owner đã xác nhận
              </Typography>
              <Typography
                sx={{
                  fontSize: 22,
                  fontWeight: 750,
                  lineHeight: 1.3,
                  fontVariantNumeric: 'tabular-nums',
                  color:
                    preview.ownerConfirmedCount === preview.currentCount &&
                    preview.addedCount === 0 &&
                    preview.removedCount === 0
                      ? 'success.main'
                      : 'warning.main',
                }}
              >
                {preview.ownerConfirmedCount}{' '}
                <Box component="span" sx={{ fontSize: 13, fontWeight: 500 }}>
                  mục
                </Box>
              </Typography>
            </Box>
            {(preview.addedCount > 0 || preview.removedCount > 0) && (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label="Có thay đổi cần đối chiếu"
              />
            )}
          </Stack>
          {scopeExpanded && (
            <Stack spacing={1.5} sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
              <Typography variant="body2" color="text.secondary">
                {preview.removedCount > 0 &&
                  `${preview.removedCount} mục chưa được Owner xác nhận sẽ được loại khỏi checklist. `}
                {preview.addedCount > 0 && `${preview.addedCount} mục mới sẽ được bổ sung. `}
                {preview.preservedChecks > 0 &&
                  `Giữ nguyên ${preview.preservedChecks} kết quả Staff đã nhập. `}
                {preview.removedCount === 0 &&
                  preview.addedCount === 0 &&
                  'Không có thay đổi danh sách tài sản.'}
              </Typography>
              {!preview.canApply ? (
                <Alert severity="info" variant="outlined">
                  {blockedReasons[preview.blockedReason || ''] ||
                    'Cần kiểm tra lại phiên bản và kết quả Staff trước khi thay đổi checklist.'}
                </Alert>
              ) : (
                <>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={confirmScope}
                        onChange={(_, checked) => setConfirmScope(checked)}
                      />
                    }
                    label="Tôi đã đối chiếu và đồng ý cập nhật checklist theo kết quả kiểm kê Owner"
                  />
                  <Button
                    variant="outlined"
                    disabled={!confirmScope || action.busy}
                    onClick={() => void applyOwnerScope()}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    Đồng bộ checklist đã xác nhận
                  </Button>
                </>
              )}
            </Stack>
          )}
        </Stack>
      )}
      {data && (
        <>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Chip
              size="small"
              variant="outlined"
              label={`${data.checkedCount}/${data.totalCount} mục đã kiểm tra`}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`${data.items.filter((item) => item.inherited).length} mục kế thừa từ Tenant`}
            />
            {data.items.some((item) => !!item.priorStaffTaskId) && (
              <Chip
                size="small"
                variant="outlined"
                label={`${data.items.filter((item) => item.priorStaffTaskId && item.checked).length} mục đã kiểm tra từ Staff trước`}
              />
            )}
            {notedCount > 0 && (
              <Chip
                size="small"
                variant="outlined"
                color="warning"
                label={`${notedCount} mục có ghi chú`}
              />
            )}
          </Stack>
          <LinearProgress
            variant="determinate"
            value={data.totalCount ? (data.checkedCount / data.totalCount) * 100 : 100}
          />
          {data.items.some((item) => item.checked && !!item.note?.trim()) && (
            <Alert severity="warning" variant="outlined">
              Có ghi chú hiện trạng do Staff nhập. Owner cần mở các phòng hoặc khu vực liên quan để
              đọc ghi chú cùng trạng thái tài sản trước khi duyệt biên bản.
            </Alert>
          )}
          {data.totalCount === 0 && (
            <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
              Chưa có tài sản được Owner kiểm kê và xác nhận để bàn giao. Không thể ký nhận nếu
              không có phạm vi kiểm kê hợp lệ.
            </Typography>
          )}
          {(pendingOwnerRooms.length > 0 || pendingOwnerCommonAssets) && (
            <Alert severity="warning" variant="outlined">
              <Stack spacing={0.5}>
                <Typography variant="body2">
                  Cần Owner xác nhận {pendingOwnerRooms.length} phòng
                  {pendingOwnerCommonAssets ? ' và tài sản khu vực chung' : ''} trước khi hoàn tất
                  bàn giao.
                </Typography>
                <Button
                  component={Link}
                  to={`/locations/${data.locationId}/assets?tab=review`}
                  size="small"
                  variant="text"
                  sx={{ p: 0, alignSelf: 'flex-start' }}
                >
                  Mở kiểm kê tài sản của Owner
                </Button>
                {pendingOwnerRooms.length > 0 && (
                  <Box>
                    <Button
                      size="small"
                      aria-expanded={roomsExpanded}
                      sx={{ p: 0, minHeight: 28 }}
                      onClick={() => setRoomsExpanded((value) => !value)}
                    >
                      {roomsExpanded ? 'Ẩn danh sách phòng' : 'Xem các phòng chưa xác nhận'}
                    </Button>
                    {roomsExpanded && (
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        {pendingOwnerRooms.join(', ')}
                      </Typography>
                    )}
                  </Box>
                )}
              </Stack>
            </Alert>
          )}
          {uncheckedCount > 0 && (
            <Typography variant="caption" color="text.secondary">
              Staff còn {uncheckedCount} mục cần kiểm tra.
            </Typography>
          )}
          {selectable && data.totalCount > 0 && (
            <Typography variant="body2" color="text.secondary">
              Mở phòng/khu vực để chọn mục cần Staff kiểm tra lại.
            </Typography>
          )}
          <Box sx={{ overflowX: 'auto' }}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={itemFilter}
              aria-label="Lọc mục tài sản"
              onChange={(_, value: ItemFilter | null) => {
                if (value) setItemFilter(value);
              }}
              sx={{ '& .MuiToggleButton-root': { textTransform: 'none', fontSize: 13, px: 1.5 } }}
            >
              <ToggleButton value="all">Tất cả ({items.length})</ToggleButton>
              <ToggleButton value="unchecked">Chưa kiểm tra ({uncheckedCount})</ToggleButton>
              <ToggleButton value="noted">Có ghi chú ({notedCount})</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          {itemFilter !== 'all' && visibleItems.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Không có mục tài sản phù hợp với bộ lọc.
            </Typography>
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
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ flexWrap: 'wrap', alignItems: 'center', width: '100%' }}
                >
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{group.title}</Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={group.items.every((item) => item.checked) ? 'success' : 'default'}
                    label={`${group.items.filter((item) => item.checked).length}/${group.items.length} đã kiểm tra`}
                  />
                  {group.items.some((item) => !!item.note?.trim()) && (
                    <Typography variant="caption" color="warning.main">
                      Có ghi chú cần đọc
                    </Typography>
                  )}
                  {selectable && group.items.some((item) => selectedIds.includes(item.id)) && (
                    <Chip
                      size="small"
                      color="warning"
                      variant="outlined"
                      label={`${group.items.filter((item) => selectedIds.includes(item.id)).length} mục chọn kiểm tra lại`}
                    />
                  )}
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1.5}>
                  {group.items.map((item) => (
                    <Box key={item.id} sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5 }}>
                      <Stack
                        direction="row"
                        spacing={1}
                        useFlexGap
                        sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                      >
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
                        <Chip
                          size="small"
                          color={item.checked ? 'success' : 'default'}
                          variant="outlined"
                          label={item.checked ? 'Đã kiểm tra' : 'Chưa kiểm tra'}
                        />
                        {item.checked && (
                          <Chip
                            size="small"
                            variant="outlined"
                            color={
                              item.condition === 'Intact'
                                ? 'success'
                                : item.condition === 'Missing' || item.condition === 'Damaged'
                                  ? 'warning'
                                  : 'default'
                            }
                            label={
                              conditionLabels[item.condition ?? 'Unassessed'] ??
                              'Chưa ghi nhận hiện trạng'
                            }
                          />
                        )}
                        {item.inherited && (
                          <Chip size="small" variant="outlined" label="Kế thừa bàn giao Tenant" />
                        )}
                        {!!item.priorStaffTaskId && (
                          <Chip size="small" variant="outlined" label="Tiếp nhận từ Staff trước" />
                        )}
                      </Stack>
                      <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                        Số lượng theo hồ sơ: {item.quantity}
                      </Typography>
                      {item.note && (
                        <Box
                          sx={{ px: 1.5, py: 1, borderRadius: 1, bgcolor: 'action.hover', mt: 1 }}
                        >
                          <Typography
                            sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary' }}
                          >
                            Ghi chú Staff
                          </Typography>
                          <Typography
                            sx={{ fontSize: 14, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                          >
                            {item.note}
                          </Typography>
                        </Box>
                      )}
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
