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
import { useOwnerQuery } from '../../../hooks/useOwnerWorkspace';
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
  currentCount: number;
  ownerConfirmedCount: number;
  removedCount: number;
  addedCount: number;
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
  const [roomsExpanded, setRoomsExpanded] = useState(false);
  const [itemFilter, setItemFilter] = useState<ItemFilter>('all');
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
  const pendingOwnerDescription = [
    pendingOwnerRooms.length > 0 ? `${pendingOwnerRooms.length} phòng` : null,
    pendingOwnerCommonAssets ? 'tài sản khu vực chung' : null,
  ]
    .filter(Boolean)
    .join(' và ');
  const scopePending = pendingOwnerRooms.length > 0 || pendingOwnerCommonAssets;
  const staffConflict =
    preview?.blockedReason === 'location_asset_inventory_staff_work_conflict';
  const scopeMismatch =
    !!preview &&
    (preview.currentCount !== preview.ownerConfirmedCount ||
      preview.currentCount !== data?.totalCount ||
      preview.addedCount !== 0 ||
      preview.removedCount !== 0);
  const scopeReady =
    !!data &&
    !!preview &&
    data.totalCount > 0 &&
    !scopePending &&
    !scopeMismatch &&
    !staffConflict &&
    preview.ownerConfirmedCount > 0;
  const requiresOwnerConfirmation =
    scopePending ||
    preview?.blockedReason === 'location_asset_inventory_owner_confirmation_required';
  const staffComplete = !!data && data.totalCount > 0 && data.checkedCount === data.totalCount;
  const historicalComplete = data?.status === 'Completed';
  const progressComplete = staffComplete && (scopeReady || historicalComplete);
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
      <OwnerFeedback busy={report.isFetching} error={report.error} />
      {report.error && <Button onClick={() => void report.refetch()}>Tải lại kiểm kê</Button>}
      <OwnerFeedback busy={reconcile.isFetching} error={reconcile.error} />
      {data && (
        <Stack spacing={0.75} component="section">
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 14, fontWeight: 700 }}>Staff đã kiểm tra</Typography>
            <Typography sx={{ fontSize: 17, fontWeight: 750, color: progressComplete ? 'success.dark' : 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
              {data.checkedCount}/{data.totalCount}
            </Typography>
          </Stack>
          <LinearProgress
            color={progressComplete ? 'success' : 'primary'}
            variant="determinate"
            value={data.totalCount ? (data.checkedCount / data.totalCount) * 100 : 0}
          />
          {historicalComplete ? (
            <Typography variant="caption" color="text.secondary">
              Phạm vi bàn giao đã hoàn tất được lưu theo biên bản đã ký.
            </Typography>
          ) : scopeReady ? (
            <Typography variant="caption" sx={{ color: 'success.dark', fontWeight: 600 }}>
              Owner đã xác nhận đủ phạm vi
            </Typography>
          ) : !preview && !reconcile.isFetching ? (
            <Typography variant="caption" sx={{ color: 'warning.dark' }}>
              Chưa xác minh được phạm vi Owner.
            </Typography>
          ) : null}
        </Stack>
      )}
      {!historicalComplete && data && (scopeMismatch || requiresOwnerConfirmation || staffConflict) && (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 650 }}>
            Phạm vi Owner: {preview?.ownerConfirmedCount ?? '—'} mục xác nhận · checklist {data.totalCount} mục
          </Typography>
          {staffConflict && (
            <Alert severity="warning" variant="outlined" sx={{ mt: 1 }}>
              Phạm vi Owner đang xung đột với tài sản Staff đã xác nhận hoặc ghi chú.
              Kết quả Staff được giữ nguyên; cần kiểm tra sai lệch trước khi bàn giao.
            </Alert>
          )}
          {scopeMismatch && !staffConflict && !requiresOwnerConfirmation && (
            <Alert severity="warning" variant="outlined" sx={{ mt: 1 }}>
              Checklist hiện tại chưa khớp phạm vi Owner đã xác nhận. Chỉ tự đồng bộ khi
              bảo toàn được kết quả Staff.
            </Alert>
          )}
        </Box>
      )}
      {data && (
        <>
          {notedCount > 0 && (
            <Alert severity="warning" variant="outlined">
              Có {notedCount} mục có ghi chú Staff. Dùng bộ lọc “Có ghi chú” để đọc hiện trạng
              trước khi duyệt.
            </Alert>
          )}
          {data.totalCount === 0 && (
            <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
              Chưa có tài sản được Owner kiểm kê và xác nhận để bàn giao. Không thể ký nhận nếu
              không có phạm vi kiểm kê hợp lệ.
            </Typography>
          )}
          {requiresOwnerConfirmation && !historicalComplete && (
            <Alert severity="warning" variant="outlined">
              <Stack spacing={0.5}>
                <Typography variant="body2">
                  {scopePending
                    ? `Cần Owner xác nhận ${pendingOwnerDescription} trước khi hoàn tất bàn giao.`
                    : 'Owner chưa xác nhận phạm vi tài sản. Cần hoàn tất kiểm kê ban đầu trước khi bàn giao.'}
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
                          color={
                            !item.checked
                              ? 'default'
                              : item.condition === 'Intact'
                                ? 'success'
                                : item.condition === 'Missing' || item.condition === 'Damaged'
                                  ? 'warning'
                                  : 'default'
                          }
                          variant="outlined"
                          label={
                            item.checked
                              ? conditionLabels[item.condition ?? 'Unassessed'] ??
                                'Đã kiểm tra'
                              : 'Chưa kiểm tra'
                          }
                        />
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
