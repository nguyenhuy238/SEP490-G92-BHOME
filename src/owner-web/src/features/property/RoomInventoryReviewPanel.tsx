import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import type {
  RoomInventoryConfirmation,
  RoomInventoryReviewRow,
} from '../../../../../packages/client-core/src/propertySetup';
import { invoiceError } from '../../../../../packages/client-core/src/invoices';
import { ErrorState, LoadingState } from '../../components/common/PortalUI';
import { usePropertySetupApi } from './usePropertySetupApi';
import { ConflictReload } from '../locations/components/ConflictReload';
import { MoneyField } from '../../components/common/MoneyField';

type Evidence = {
  id: string;
  contentType: string;
  uploadedAt?: string | null;
  uploadedBy?: string | null;
  fileName?: string;
};
type ReviewItem = RoomInventoryReviewRow['items'][number];
type ItemDraft = {
  roomId: string;
  itemId: string;
  checked: boolean;
  unitCost: string;
  evidence: Evidence[];
  uploading: boolean;
  error: string;
};
type ReviewDialog = {
  rooms: RoomInventoryReviewRow[];
  requestId: string;
  scope: 'room' | 'location' | 'selected';
  attested: boolean;
  itemDrafts: ItemDraft[];
};
const states: Record<
  string,
  { label: string; color: 'default' | 'success' | 'warning' | 'error' }
> = {
  NotChecked: { label: 'Chưa kiểm kê', color: 'default' },
  PartiallyChecked: { label: 'Kiểm kê chưa đủ', color: 'error' },
  Matched: { label: 'Đã kiểm kê đủ', color: 'success' },
  NeedsReview: { label: 'Cần đối chiếu', color: 'warning' },
  // Compatibility while older snapshots are still served during rollout.
  Checked: { label: 'Đã kiểm kê đủ', color: 'success' },
  Discrepancy: { label: 'Cần đối chiếu', color: 'warning' },
};
const blockedReasons: Record<string, string> = {
  location_inactive: 'Cơ sở đang ngừng hoạt động.',
  desired_inventory_required: 'Cần đồng bộ danh sách tài sản của phòng.',
  unlinked_physical_assets: 'Có tài sản thực tế chưa được liên kết với danh sách thiết lập.',
  ambiguous_asset_mapping: 'Có nhiều hồ sơ tài sản chưa khớp. Cần Staff đối chiếu trước.',
  no_asset_requirements: 'Phòng chưa được thiết lập danh sách tài sản.',
  physical_quantity_mismatch: 'Số lượng tài sản đã ghi nhận khác với thiết lập.',
  asset_requires_attention: 'Có tài sản cần sửa chữa hoặc đang sửa chữa.',
  physical_assets_need_review: 'Tài sản thực tế có chênh lệch hoặc cần Staff đối chiếu trước.',
  inventory_evidence_missing: 'Cần bổ sung ảnh bằng chứng cho nhóm tài sản đã xác nhận.',
  detailed_review_required: 'Phòng cần được đối chiếu trước khi xác nhận.',
};
const snapshot = (room: RoomInventoryReviewRow) => ({
  roomId: room.roomId,
  desiredId: room.desiredId,
  desiredVersion: room.desiredVersion,
  stateToken: room.stateToken,
});
const itemChecked = (item: ReviewItem) => item.checked;
const itemEvidence = (item: ReviewItem): Evidence[] =>
  item.evidence.map((evidence) => ({ ...evidence }));
const defaultUnitCost = (item: ReviewItem): string => {
  const suggested = item.acquisitionUnitCost ?? item.referenceUnitCost;
  const value = suggested == null ? '' : String(suggested);
  return /^\d{1,14}$/.test(value) ? value : '';
};
const validUnitCost = (value: string): boolean =>
  value === '' || /^\d{1,14}$/.test(value) && Number(value) <= 99_999_999_999_999;
const unitCostHint = (item: ReviewItem): string =>
  item.acquisitionUnitCost != null ? 'Đã chốt giá vốn' :
    item.referenceUnitCost != null && defaultUnitCost(item) === ''
      ? 'Giá mẫu không phải số nguyên VND; vui lòng nhập đơn giá mua.'
      : item.referenceUnitCost != null ? 'Gợi ý từ mẫu' : 'Chưa có giá tham khảo';
const checkedCount = (room: RoomInventoryReviewRow) => room.items.filter(itemChecked).length;
const isCheckedRoom = (room: RoomInventoryReviewRow) =>
  (room.state as string) === 'Matched' || (room.state as string) === 'Checked';
const isBlocked = (room: RoomInventoryReviewRow) => !!room.blockedReason;

export function RoomInventoryReviewPanel({ locationId, focusRoomId }: { locationId: string; focusRoomId?: string }) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const queryKey = ['property-setup', 'room-inventory-review', session?.userId, locationId];
  const cache = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.roomInventoryReview(locationId, signal),
    enabled: owner,
  });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<ReviewDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rawError, setRawError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [focusApplied, setFocusApplied] = useState<string | null>(null);

  useEffect(() => {
    if (!focusRoomId || focusApplied === focusRoomId || !query.data) return;
    const room = query.data.rooms.find((candidate) => candidate.roomId === focusRoomId);
    if (!room) return;
    // The initial deep-link focus depends on data loaded asynchronously. Queue
    // the one-time UI transition after the current render; cancel on route/data
    // changes to avoid applying a stale room selection.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setFilter('all');
      setSearch(room.roomNumber);
      setSelected([focusRoomId]);
      setDialog({
        rooms: [room],
        scope: 'room',
        attested: false,
        requestId: crypto.randomUUID(),
        itemDrafts: room.items.map((item) => ({
          roomId: room.roomId,
          itemId: item.id,
          checked: item.checked,
          unitCost: defaultUnitCost(item),
          evidence: item.evidence.map((photo) => ({ ...photo })),
          uploading: false,
          error: '',
        })),
      });
      setFocusApplied(focusRoomId);
    });
    return () => { cancelled = true; };
  }, [focusRoomId, focusApplied, query.data]);

  if (!owner) return <Alert severity="info">Chỉ Owner được xác nhận kiểm kê theo thiết lập.</Alert>;
  if (query.isPending) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const rooms = query.data.rooms;
  const checkedRooms = rooms.filter(isCheckedRoom).length;
  const totalGroups = rooms.reduce((sum, room) => sum + room.items.length, 0);
  const verifiedGroups = rooms.reduce((sum, room) => sum + checkedCount(room), 0);
  const eligible = rooms.filter(
    (room) =>
      !isCheckedRoom(room) && room.desiredId !== null && room.items.length > 0 && !isBlocked(room),
  );
  const chosen = eligible.filter((room) => selected.includes(room.roomId));
  const visible = rooms.filter(
    (room) =>
      room.roomNumber.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi')) &&
      (filter === 'all' || (room.state as string) === filter),
  );

  const openDialog = (rows: RoomInventoryReviewRow[], scope: ReviewDialog['scope'] = 'room') => {
    setError('');
    setRawError(null);
    setDialog({
      rooms: rows,
      scope,
      attested: false,
      requestId: crypto.randomUUID(),
      itemDrafts: rows.flatMap((room) =>
        room.items.map((item) => ({
          roomId: room.roomId,
          itemId: item.id,
          checked: itemChecked(item),
          unitCost: defaultUnitCost(item),
          evidence: itemEvidence(item),
          uploading: false,
          error: '',
        })),
      ),
    });
  };
  const updateItem = (roomId: string, itemId: string, patch: Partial<ItemDraft>) =>
    setDialog((old) =>
      old
        ? {
            ...old,
            requestId: crypto.randomUUID(),
            itemDrafts: old.itemDrafts.map((draft) =>
              draft.roomId === roomId && draft.itemId === itemId ? { ...draft, ...patch } : draft,
            ),
          }
        : old,
    );

  const upload = async (roomId: string, itemId: string, fileList: FileList | File[]) => {
    const draft = dialog?.itemDrafts.find((row) => row.roomId === roomId && row.itemId === itemId);
    const files = Array.from(fileList);
    if (!draft || !draft.checked || !files.length) return;
    if (
      files.some(
        (file) => !['image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024,
      )
    ) {
      updateItem(roomId, itemId, {
        error: 'Chỉ nhận ảnh JPEG hoặc PNG, mỗi ảnh tối đa 5 MB.',
      });
      return;
    }
    if (draft.evidence.length + files.length > 5) {
      updateItem(roomId, itemId, { error: 'Mỗi nhóm tài sản chỉ được đính kèm tối đa 5 ảnh.' });
      return;
    }
    updateItem(roomId, itemId, { uploading: true, error: '' });
    try {
      const results = await Promise.allSettled(
        files.map(async (file) => {
          const result = await api.uploadEvidence(locationId, file);
          return {
            id: result.evidenceId,
            contentType: file.type,
            uploadedAt: new Date().toISOString(),
            fileName: file.name,
          } satisfies Evidence;
        }),
      );
      const uploaded = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const failed = results.find((result) => result.status === 'rejected');
      setDialog((old) =>
        old
          ? {
              ...old,
              requestId: uploaded.length ? crypto.randomUUID() : old.requestId,
              itemDrafts: old.itemDrafts.map((row) =>
                row.roomId === roomId && row.itemId === itemId
                  ? {
                      ...row,
                      evidence: [...row.evidence, ...uploaded],
                      uploading: false,
                      error: failed?.status === 'rejected' ? invoiceError(failed.reason) : '',
                    }
                  : row,
              ),
            }
          : old,
      );
    } catch (uploadError) {
      updateItem(roomId, itemId, { uploading: false, error: invoiceError(uploadError) });
    }
  };
  const removeEvidence = (roomId: string, itemId: string, evidenceId: string) => {
    const current = dialog?.itemDrafts.find(
      (row) => row.roomId === roomId && row.itemId === itemId,
    );
    updateItem(roomId, itemId, {
      evidence: current?.evidence.filter((item) => item.id !== evidenceId) ?? [],
    });
  };
  const canSubmit =
    !!dialog &&
    dialog.rooms.length > 0 &&
    dialog.rooms.every(
      (room) => !isBlocked(room) && room.desiredId !== null && room.items.length > 0,
    ) &&
    dialog.itemDrafts.length === dialog.rooms.reduce((sum, room) => sum + room.items.length, 0) &&
    dialog.itemDrafts.every(
      (draft) =>
        (dialog.scope === 'room' || dialog.attested) &&
        draft.evidence.length <= 5 &&
        (!draft.checked || validUnitCost(draft.unitCost)) &&
        !draft.uploading,
    );
  const confirm = async () => {
    if (!dialog || !canSubmit || busy) return;
    const input: RoomInventoryConfirmation = {
      requestId: dialog.requestId,
      confirmed: true,
      rooms: dialog.rooms.map((room) => ({
        ...snapshot(room),
        items: room.items.map((item) => {
          if (dialog.scope !== 'room') {
            const draft = dialog.itemDrafts.find(
              (row) => row.roomId === room.roomId && row.itemId === item.id,
            )!;
            return { itemId: item.id, checked: dialog.attested, evidenceIds: [],
              unitCost: dialog.attested && draft.unitCost !== '' ? draft.unitCost : null };
          }
          const draft = dialog.itemDrafts.find(
            (row) => row.roomId === room.roomId && row.itemId === item.id,
          )!;
          return {
            itemId: item.id,
            checked: draft.checked,
            evidenceIds: draft.checked ? draft.evidence.map((evidence) => evidence.id) : [],
            unitCost: draft.checked && draft.unitCost !== '' ? draft.unitCost : null,
          };
        }),
      })),
    };
    setBusy(true);
    setError('');
    setRawError(null);
    try {
      const result = await api.confirmRoomInventory(locationId, input);
      cache.setQueryData(queryKey, result);
      void cache.invalidateQueries({
        queryKey: ['property-setup', 'assets', session?.userId, locationId],
      });
      void cache.invalidateQueries({
        queryKey: ['location-finance', 'capital-assets', session?.userId, locationId],
      });
      void cache.invalidateQueries({
        queryKey: ['location-finance', 'report', session?.userId, locationId],
      });
      setSelected([]);
      setDialog(null);
      setNotice('Đã lưu xác nhận kiểm kê.');
    } catch (confirmError) {
      setError(invoiceError(confirmError));
      setRawError(confirmError);
    } finally {
      setBusy(false);
    }
  };

  const evidenceField = (
    roomId: string,
    itemId: string,
    evidence: Evidence[],
    uploading: boolean,
    uploadError: string,
    allowUpload = true,
  ) => (
    <Stack spacing={0.75}>
      <Button
        component="label"
        size="small"
        variant="outlined"
        disabled={!allowUpload || uploading || evidence.length >= 5 || busy}
        sx={{ alignSelf: 'flex-start' }}
      >
        {uploading ? 'Đang tải ảnh…' : evidence.length ? 'Thêm ảnh bằng chứng' : 'Chụp / tải ảnh'}
        <input
          hidden
          type="file"
          accept="image/png,image/jpeg"
          capture="environment"
          multiple
          aria-label={`Ảnh bằng chứng ${itemId}`}
          disabled={!allowUpload || uploading || evidence.length >= 5 || busy}
          onChange={(event) => {
            if (event.target.files) void upload(roomId, itemId, event.target.files);
            event.target.value = '';
          }}
        />
      </Button>
      {evidence.length > 0 && (
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          {evidence.map((item, index) => (
            <Chip
              key={item.id}
              size="small"
              variant="outlined"
              label={
                item.fileName ||
                `Ảnh ${index + 1} · ${item.contentType === 'image/png' ? 'PNG' : 'JPEG'}`
              }
              onDelete={
                busy || uploading ? undefined : () => removeEvidence(roomId, itemId, item.id)
              }
            />
          ))}
        </Stack>
      )}
      {!evidence.length && !uploading && (
        <Typography variant="caption" color="text.secondary">
          Ảnh tùy chọn, tối đa 5 ảnh
        </Typography>
      )}
      {!allowUpload && evidence.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          Nhóm chưa được xác nhận; ảnh này sẽ không được gắn vào kết quả kiểm kê.
        </Typography>
      )}
      {uploadError && <Alert severity="error">{uploadError}</Alert>}
    </Stack>
  );

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between', gap: 2 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" component="h3">
            Kiểm kê tài sản theo phòng
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Xác nhận tài sản đủ theo thiết lập sau khi kiểm tra thực tế.
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button
            variant="outlined"
            disabled={!chosen.length || query.isFetching || busy}
            onClick={() => openDialog(chosen, 'selected')}
          >
            {chosen.length
              ? `Kiểm kê nhanh ${chosen.length} phòng đã chọn`
              : 'Kiểm kê nhanh phòng đã chọn'}
          </Button>
          <Button
            variant="contained"
            disabled={!eligible.length || query.isFetching || busy}
            onClick={() => openDialog(eligible, 'location')}
          >
            Kiểm kê nhanh toàn cơ sở
          </Button>
        </Stack>
      </Stack>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Stack
            direction="row"
            sx={{
              justifyContent: 'space-between',
              alignItems: 'baseline',
              flexWrap: 'wrap',
              gap: 1,
            }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {checkedRooms}/{rooms.length} phòng đã kiểm kê đủ
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {verifiedGroups}/{totalGroups} nhóm tài sản đã xác nhận
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={totalGroups ? (verifiedGroups / totalGroups) * 100 : 0}
            aria-label="Tiến độ kiểm kê nhóm tài sản"
          />
        </Stack>
      </Paper>
      {notice && <Alert severity="success">{notice}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          size="small"
          label="Tìm phòng"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ width: { sm: 280 } }}
        />
        <TextField
          select
          size="small"
          label="Trạng thái kiểm kê"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          sx={{ minWidth: { sm: 200 } }}
        >
          <MenuItem value="all">Tất cả phòng</MenuItem>
          {Object.entries(states)
            .filter(([key]) =>
              ['NotChecked', 'PartiallyChecked', 'Matched', 'NeedsReview'].includes(key),
            )
            .map(([key, state]) => (
              <MenuItem key={key} value={key}>
                {state.label}
              </MenuItem>
            ))}
        </TextField>
        <Button disabled={query.isFetching || busy} onClick={() => void query.refetch()}>
          Tải lại
        </Button>
      </Stack>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" aria-label="Danh sách phòng kiểm kê" sx={{ minWidth: 590 }}>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  slotProps={{
                    input: { 'aria-label': 'Chọn tất cả phòng đủ điều kiện đang hiển thị' },
                  }}
                  disabled={
                    !visible.some((room) => eligible.some((item) => item.roomId === room.roomId)) ||
                    busy
                  }
                  checked={
                    visible.some((room) => eligible.some((item) => item.roomId === room.roomId)) &&
                    visible
                      .filter((room) => eligible.some((item) => item.roomId === room.roomId))
                      .every((room) => selected.includes(room.roomId))
                  }
                  indeterminate={
                    visible.some((room) => selected.includes(room.roomId)) &&
                    !visible
                      .filter((room) => eligible.some((item) => item.roomId === room.roomId))
                      .every((room) => selected.includes(room.roomId))
                  }
                  onChange={(_, value) => {
                    const ids = visible
                      .filter((room) => eligible.some((item) => item.roomId === room.roomId))
                      .map((room) => room.roomId);
                    setSelected((old) =>
                      value
                        ? [...new Set([...old, ...ids])]
                        : old.filter((id) => !ids.includes(id)),
                    );
                  }}
                />
              </TableCell>
              <TableCell>Phòng</TableCell>
              <TableCell align="right">Thiết lập</TableCell>
              <TableCell align="right">Đã kiểm tra</TableCell>
              <TableCell>Trạng thái</TableCell>
              <TableCell align="right">Thao tác</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((room) => {
              const state = states[room.state as string] ?? states.NeedsReview;
              const count = checkedCount(room);
              return (
                <TableRow key={room.roomId} hover>
                  <TableCell padding="checkbox">
                    <Checkbox
                      slotProps={{ input: { 'aria-label': `Chọn phòng ${room.roomNumber}` } }}
                      disabled={!eligible.some((item) => item.roomId === room.roomId) || busy}
                      checked={chosen.some((item) => item.roomId === room.roomId)}
                      onChange={(_, value) =>
                        setSelected((old) =>
                          value
                            ? [...new Set([...old, room.roomId])]
                            : old.filter((id) => id !== room.roomId),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {room.roomNumber}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {room.items.length} nhóm tài sản
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{room.items.length}</TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {count}/{room.items.length}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={state.color} label={state.label} />
                    {room.reviewedAt && (
                      <Typography
                        variant="caption"
                        sx={{ display: 'block' }}
                        color="text.secondary"
                      >
                        Lần kiểm kê: {formatInstant(room.reviewedAt)}
                      </Typography>
                    )}
                    {room.blockedReason && (
                      <Typography
                        variant="caption"
                        sx={{ display: 'block' }}
                        color="text.secondary"
                      >
                        {blockedReasons[room.blockedReason] ?? room.blockedReason}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {room.noAssetsConfirmed && (
                      <Typography variant="body2">Đã xác nhận không có tài sản bàn giao</Typography>
                    )}
                    {room.items.length === 0 && !room.noAssetsConfirmed && (
                      <RoomNoAssetsConfirmation
                        locationId={locationId}
                        roomId={room.roomId}
                        onChanged={() => void query.refetch()}
                      />
                    )}
                    <Button
                      variant="outlined"
                      disabled={busy || query.isFetching}
                      onClick={() => openDialog([room])}
                      aria-label={`Kiểm kê ${room.roomNumber}`}
                    >
                      Kiểm tra
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {!visible.length && (
              <TableRow>
                <TableCell colSpan={6} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                  {rooms.length ? 'Không có phòng phù hợp bộ lọc.' : 'Cơ sở chưa có phòng.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {dialog && (
        <Dialog
          open
          fullWidth
          maxWidth="lg"
          aria-labelledby="inventory-review-title"
          onClose={busy ? undefined : () => setDialog(null)}
        >
          <DialogTitle id="inventory-review-title">
            {dialog.scope === 'location'
              ? 'Kiểm kê nhanh toàn cơ sở'
              : dialog.scope === 'selected'
                ? `Kiểm kê nhanh ${dialog.rooms.length} phòng đã chọn`
                : `Kiểm kê phòng ${dialog.rooms[0].roomNumber}`}
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {dialog.scope !== 'room' ? (
                <>
                  <Typography variant="body2">
                    {dialog.rooms.length} phòng · {dialog.itemDrafts.length} nhóm tài sản
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {dialog.rooms.map((room) => room.roomNumber).join(', ')}
                  </Typography>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={dialog.attested}
                        disabled={busy}
                        onChange={(_, attested) =>
                          setDialog({ ...dialog, attested, requestId: crypto.randomUUID() })
                        }
                      />
                    }
                    label="Tôi đã kiểm tra và xác nhận tài sản đủ theo thiết lập ở các phòng trên."
                  />
                  <Typography variant="body2" color="text.secondary">
                    Đơn giá mua mặc định từ mẫu tài sản. Có thể sửa trước khi xác nhận; để trống nếu chưa biết giá.
                    Giá mua đã ghi nhận trước đó không được định giá lại.
                  </Typography>
                  <TableContainer>
                    <Table size="small" aria-label="Đơn giá mua kiểm kê nhanh">
                      <TableHead>
                        <TableRow>
                          <TableCell>Phòng / Tài sản</TableCell>
                          <TableCell align="right">Theo thiết lập</TableCell>
                          <TableCell>Đơn giá mua (VNĐ)</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {dialog.rooms.flatMap((room) => room.items.map((item) => {
                          const draft = dialog.itemDrafts.find(
                            (row) => row.roomId === room.roomId && row.itemId === item.id,
                          )!;
                          return (
                            <TableRow key={room.roomId + ':' + item.id}>
                              <TableCell>{room.roomNumber} · {item.name}</TableCell>
                              <TableCell align="right">{item.quantity} {item.unit ?? ''}</TableCell>
                              <TableCell>
                                <MoneyField size="small" label={`Đơn giá mua (VNĐ) · ${item.name} (${room.roomNumber})`}
                                  value={draft.unitCost}
                                  disabled={busy || item.acquisitionUnitCost != null}
                                  error={!validUnitCost(draft.unitCost)}
                                  helperText={unitCostHint(item)}
                                  onValueChange={(unitCost) => updateItem(room.roomId, item.id, { unitCost })} />
                              </TableCell>
                            </TableRow>
                          );
                        }))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              ) : (
                dialog.rooms.map((room) => {
                  const roomDrafts = dialog.itemDrafts.filter(
                    (draft) => draft.roomId === room.roomId,
                  );
                  const count = roomDrafts.filter((draft) => draft.checked).length;
                  return (
                    <Paper key={room.roomId} variant="outlined" sx={{ p: 2 }}>
                      <Stack spacing={1.5}>
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          sx={{
                            justifyContent: 'space-between',
                            gap: 1,
                            alignItems: { sm: 'center' },
                          }}
                        >
                          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            {room.roomNumber}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {count}/{room.items.length} nhóm đã kiểm tra
                          </Typography>
                        </Stack>
                        <LinearProgress
                          variant="determinate"
                          value={room.items.length ? (count / room.items.length) * 100 : 0}
                          aria-label={`Tiến độ kiểm tra phòng ${room.roomNumber}`}
                        />
                        {room.blockedReason && (
                          <Alert severity="warning">
                            {blockedReasons[room.blockedReason] ?? room.blockedReason}
                          </Alert>
                        )}
                        {!room.items.length ? (
                          <Alert severity="info">
                            Phòng chưa có danh sách tài sản được thiết lập.
                          </Alert>
                        ) : (
                          <TableContainer>
                            <Table
                              size="small"
                              aria-label={`Tài sản cần xác nhận phòng ${room.roomNumber}`}
                              sx={{ minWidth: 620 }}
                            >
                              <TableHead>
                                <TableRow>
                                  <TableCell>Tài sản</TableCell>
                                  <TableCell align="right">Theo thiết lập</TableCell>
                                  <TableCell>Đã kiểm tra</TableCell>
                                  <TableCell>Đơn giá mua (VNĐ)</TableCell>
                                  <TableCell>Ảnh bằng chứng</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {room.items.map((item) => {
                                  const draft = dialog.itemDrafts.find(
                                    (row) => row.roomId === room.roomId && row.itemId === item.id,
                                  )!;
                                  return (
                                    <TableRow key={item.id}>
                                      <TableCell>
                                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                          {item.name}
                                        </Typography>
                                      </TableCell>
                                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                        {item.unit
                                          ? `${item.quantity} ${item.unit}`
                                          : item.quantity}
                                      </TableCell>
                                      <TableCell>
                                        <FormControlLabel
                                          control={
                                            <Checkbox
                                              checked={draft.checked}
                                              disabled={busy || draft.uploading}
                                              onChange={(_, checked) =>
                                                updateItem(room.roomId, item.id, {
                                                  checked,
                                                  evidence: draft.evidence,
                                                  error: '',
                                                })
                                              }
                                            />
                                          }
                                          label={`Đã kiểm tra và đủ theo thiết lập · ${item.name} (${room.roomNumber})`}
                                        />
                                      </TableCell>
                                      <TableCell>
                                        <MoneyField size="small"
                                          label={`Đơn giá mua (VNĐ) · ${item.name} (${room.roomNumber})`}
                                          value={draft.unitCost}
                                          disabled={busy || !draft.checked || item.acquisitionUnitCost != null}
                                          error={!validUnitCost(draft.unitCost)}
                                          helperText={unitCostHint(item)}
                                          onValueChange={(unitCost) => updateItem(room.roomId, item.id, { unitCost })} />
                                      </TableCell>
                                      <TableCell>
                                        {draft.checked || draft.evidence.length > 0 ? (
                                          evidenceField(
                                            room.roomId,
                                            item.id,
                                            draft.evidence,
                                            draft.uploading,
                                            draft.error,
                                            draft.checked,
                                          )
                                        ) : (
                                          <Typography variant="caption" color="text.secondary">
                                            Tích sau khi kiểm tra
                                          </Typography>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        )}
                      </Stack>
                    </Paper>
                  );
                })
              )}
              {error && <Alert severity="error">{error}</Alert>}
              <ConflictReload
                error={rawError}
                reload={async () => {
                  await query.refetch({ throwOnError: true });
                  setDialog(null);
                  setRawError(null);
                  setError('');
                }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={() => setDialog(null)}>
              Hủy
            </Button>
            <Button
              variant="contained"
              disabled={!canSubmit || busy}
              onClick={() => void confirm()}
            >
              {busy ? 'Đang lưu…' : 'Xác nhận đã kiểm tra'}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}
