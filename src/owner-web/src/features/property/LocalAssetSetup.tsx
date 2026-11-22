import { UserFeedbackError } from '../../../../../packages/client-core/src/api';
import { TextField, ValidatedForm } from '../../components/common/ValidatedForm';
import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import type {
  AssetInventory,
  AssetSyncRun,
  DesiredAssets,
  LocalAssetItem,
  LocalAssetTemplate,
  SetupDocument,
} from '../../../../../packages/client-core/src/propertySetup';
import { ConfirmDialog, ErrorState, LoadingState } from '../../components/common/PortalUI';
import { usePropertySetupApi } from './usePropertySetupApi';
import { useSetupAction } from './useSetupAction';
import { SetupEvidenceField } from './SetupEvidenceField';
import { AssetRequirementFields } from './AssetRequirementFields';
import { AssetCountObservationDialog } from './AssetCountObservation';
import { useAssetCounts } from './useAssetCounts';
import {
  locationSetupClient,
  type LocalRoomDefaultsData,
  type RoomDefaultsAssetRequirementsResult,
} from '../../../../../packages/client-core/src/locationSetup';
import { ConflictReload } from '../locations/components/ConflictReload';

export function LocalAssetSetup({
  locationId,
  mode = 'all',
  initialRoomId = '',
}: {
  locationId: string;
  mode?: 'all' | 'templates' | 'inventory';
  initialRoomId?: string;
}) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const [editing, setEditing] = useState<SetupDocument<LocalAssetTemplate> | null | undefined>(
    undefined,
  );
  const [editingType, setEditingType] = useState<SetupDocument<LocalRoomDefaultsData> | null>(null);
  const [copyFrom, setCopyFrom] = useState<SetupDocument<LocalAssetTemplate> | null>(null);
  const [historyFamily, setHistoryFamily] = useState<string | null>(null);
  const [roomId, setRoomId] = useState(initialRoomId);
  const [run, setRun] = useState<Pick<AssetSyncRun, 'rooms'> | null>(null);
  const action = useSetupAction();
  const showTemplates = mode !== 'inventory';
  const showInventory = mode !== 'templates';
  const templates = useQuery({
    queryKey: ['property-setup', 'asset-templates', session?.userId, locationId],
    queryFn: ({ signal }) => api.templates(locationId, signal),
    enabled: owner,
  });
  const defaults = useQuery({
    queryKey: ['property-setup', 'room-defaults', session?.userId, locationId],
    queryFn: ({ signal }) => locationSetupClient(api.request).localRoomDefaults(locationId, signal),
    enabled: owner && showTemplates,
  });
  const linkedIds = new Set(defaults.data?.map((item) => item.data.assetTemplateId));
  const standalone = (templates.data ?? []).filter(
    (item) => !linkedIds.has(item.id) && !item.data.scoped,
  );
  const latestTemplates = new Map<string, SetupDocument<LocalAssetTemplate>>();
  for (const template of standalone) {
    const key = template.data.familyId ?? template.id;
    const previous = latestTemplates.get(key);
    if (!previous || (template.data.edition ?? 1) > (previous.data.edition ?? 1))
      latestTemplates.set(key, template);
  }
  const rooms = useQuery({
    queryKey: ['property-setup', 'room-options', session?.userId, locationId],
    queryFn: ({ signal }) => api.roomOptions(locationId, signal),
  });
  return (
    <Stack spacing={2}>
      {mode === 'all' && (
        <Box>
          <Typography variant="h6" component="h2">
            Tài sản theo phòng & Kiểm kê phòng
          </Typography>
        </Box>
      )}
      {action.error && <Alert severity="error">{action.error}</Alert>}
      {action.notice && <Alert severity="success">{action.notice}</Alert>}
      {showTemplates && !owner && (
        <Alert severity="info">
          Owner cấu hình tài sản theo phòng. Chọn mục kiểm kê phòng để xem thông tin được cấp quyền.
        </Alert>
      )}
      {showTemplates && owner && (
        <>
          <Button
            variant="contained"
            sx={{ alignSelf: 'flex-start' }}
            disabled={action.busy}
            onClick={() => {
              setCopyFrom(null);
              setEditing(null);
            }}
          >
            Tạo danh sách tài sản phòng
          </Button>
          {templates.isPending ? (
            <LoadingState />
          ) : templates.error ? (
            <ErrorState error={templates.error} retry={() => void templates.refetch()} />
          ) : (
            <>
              {defaults.isPending ? (
                <LoadingState />
              ) : defaults.error ? (
                <ErrorState error={defaults.error} retry={() => void defaults.refetch()} />
              ) : (
                <>
                  <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Tài sản theo loại phòng
                  </Typography>
                  {!defaults.data?.filter((item) => item.status !== 'Archived').length ? (
                    <Typography variant="body2" color="text.secondary">
                      Chưa có loại phòng được thiết lập.
                    </Typography>
                  ) : (
                    <TableContainer
                      component={Paper}
                      variant="outlined"
                      sx={{ maxWidth: '100%', overflowX: 'auto' }}
                    >
                      <Table
                        size="small"
                        role="table"
                        aria-label="Tài sản theo loại phòng"
                        sx={{ display: { xs: 'block', sm: 'table' }, minWidth: { xs: 0, sm: 380 } }}
                      >
                        <TableHead
                          role="rowgroup"
                          sx={{
                            position: { xs: 'absolute', sm: 'static' },
                            width: { xs: '1px', sm: 'auto' },
                            height: { xs: '1px', sm: 'auto' },
                            overflow: { xs: 'hidden', sm: 'visible' },
                            clipPath: { xs: 'inset(50%)', sm: 'none' },
                          }}
                        >
                          <TableRow role="row">
                            <TableCell role="columnheader">Loại phòng</TableCell>
                            <TableCell role="columnheader">Tài sản được cấu hình</TableCell>
                            <TableCell role="columnheader" align="right">
                              Thao tác
                            </TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody
                          role="rowgroup"
                          sx={{ display: { xs: 'block', sm: 'table-row-group' } }}
                        >
                          {defaults.data
                            .filter((item) => item.status !== 'Archived')
                            .map((type) => {
                              const template = templates.data.find(
                                (item) => item.id === type.data.assetTemplateId,
                              );
                              return (
                                <TableRow
                                  key={type.id}
                                  role="row"
                                  sx={(theme) => ({
                                    [theme.breakpoints.down('sm')]: {
                                      display: 'grid',
                                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                                      alignItems: 'center',
                                      gap: theme.spacing(1),
                                      padding: theme.spacing(1.5),
                                      borderBottom: `1px solid ${theme.palette.divider}`,
                                      '&:last-child': { borderBottom: 0 },
                                      '& > td': {
                                        minWidth: 0,
                                        overflowWrap: 'anywhere',
                                        borderBottom: 0,
                                        padding: 0,
                                      },
                                    },
                                  })}
                                >
                                  <TableCell
                                    role="cell"
                                    sx={{ fontWeight: 600, gridColumn: 1, gridRow: 1 }}
                                  >
                                    {type.data.name}
                                  </TableCell>
                                  <TableCell role="cell" sx={{ gridColumn: '1 / -1', gridRow: 2 }}>
                                    {template?.data.items.length ? (
                                      <>
                                        <Typography variant="body2">
                                          {template.data.items.length} loại thiết bị
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                          {template.data.items
                                            .slice(0, 3)
                                            .map((item) => `${item.name} × ${item.quantity}`)
                                            .join(' · ')}
                                          {template.data.items.length > 3 &&
                                            ` · +${template.data.items.length - 3} loại khác`}
                                        </Typography>
                                      </>
                                    ) : (
                                      <Typography variant="body2" color="text.secondary">
                                        Chưa cấu hình tài sản
                                      </Typography>
                                    )}
                                  </TableCell>
                                  <TableCell
                                    role="cell"
                                    align="right"
                                    sx={{ gridColumn: 2, gridRow: 1 }}
                                  >
                                    <Button
                                      variant="outlined"
                                      disabled={action.busy}
                                      onClick={() => setEditingType(type)}
                                      aria-label={`Chỉnh sửa tài sản ${type.data.name}`}
                                      sx={{ minHeight: { xs: 44, sm: 36 } }}
                                    >
                                      Chỉnh sửa
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </>
              )}
              {!templates.data?.length && !defaults.data?.length && (
                <Alert severity="info">
                  Chưa có bộ mẫu. Tạo bộ mẫu để quy định các thiết bị cần trang bị cho phòng.
                </Alert>
              )}
              {defaults.isSuccess && latestTemplates.size > 0 && (
                <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Bộ mẫu khác
                </Typography>
              )}
              {defaults.isSuccess &&
                [...latestTemplates.values()].map((template) => (
                  <Paper key={template.id} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack spacing={1}>
                      <Stack
                        direction="row"
                        sx={{
                          flexWrap: 'wrap',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 1,
                        }}
                      >
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                          {template.data.name}
                        </Typography>
                        <Chip
                          size="small"
                          label={
                            template.status === 'Draft'
                              ? 'Chưa sử dụng'
                              : `Phiên bản ${template.data.edition ?? 1}`
                          }
                          color={template.status === 'Draft' ? 'default' : 'success'}
                        />
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {template.data.items.length} loại thiết bị
                      </Typography>
                      <TableContainer sx={{ maxWidth: '100%', maxHeight: 200, overflow: 'auto' }}>
                        <Table
                          size="small"
                          aria-label={`Định mức ${template.data.name}`}
                          sx={{ minWidth: 420 }}
                        >
                          <TableHead>
                            <TableRow>
                              <TableCell>Thiết bị</TableCell>
                              <TableCell>Đơn vị</TableCell>
                              <TableCell align="right">Định mức</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {template.data.items.map((item) => (
                              <TableRow key={item.id}>
                                <TableCell>{item.name}</TableCell>
                                <TableCell>{item.unit || 'Chưa ghi nhận'}</TableCell>
                                <TableCell align="right">{item.quantity}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                        <Button
                          disabled={action.busy}
                          variant="outlined"
                          onClick={() => {
                            setCopyFrom(null);
                            setEditing(template);
                          }}
                        >
                          Chỉnh sửa
                        </Button>
                        {template.status !== 'Draft' && (
                          <Button
                            disabled={action.busy}
                            variant="outlined"
                            onClick={() =>
                              action.run(async () => setRun(await api.syncTemplate(template.id)))
                            }
                          >
                            Đồng bộ lại
                          </Button>
                        )}
                        <Button
                          disabled={action.busy}
                          onClick={() => {
                            setCopyFrom(template);
                            setEditing(null);
                          }}
                        >
                          Nhân bản
                        </Button>
                        <Button
                          onClick={() => setHistoryFamily(template.data.familyId ?? template.id)}
                        >
                          Lịch sử phiên bản
                        </Button>
                      </Stack>
                    </Stack>
                  </Paper>
                ))}
            </>
          )}
        </>
      )}
      <Dialog open={editing !== undefined} fullWidth maxWidth="md">
        <DialogTitle>{editing ? 'Chỉnh sửa bộ mẫu' : 'Tạo danh sách tài sản phòng'}</DialogTitle>
        <DialogContent>
          {editing !== undefined && (
            <LocalTemplateEditor
              key={editing?.id ?? 'new'}
              locationId={locationId}
              value={editing}
              copyFrom={copyFrom}
              onClose={() => setEditing(undefined)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={historyFamily !== null}
        fullWidth
        maxWidth="sm"
        onClose={() => setHistoryFamily(null)}
      >
        <DialogTitle>Lịch sử phiên bản</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            {standalone
              .filter((row) => (row.data.familyId ?? row.id) === historyFamily)
              .sort((a, b) => (b.data.edition ?? 1) - (a.data.edition ?? 1))
              .map((row) => (
                <Box key={row.id} sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1 }}>
                  <Typography sx={{ fontWeight: 700 }}>
                    Phiên bản {row.data.edition ?? 1} · {row.data.name}
                  </Typography>
                  {row.data.items.map((item) => (
                    <Typography key={item.id} variant="body2">
                      {item.name} × {item.quantity} {item.unit ?? ''}
                    </Typography>
                  ))}
                </Box>
              ))}
            <Button onClick={() => setHistoryFamily(null)}>Đóng</Button>
          </Stack>
        </DialogContent>
      </Dialog>
      {editingType && (
        <Dialog open fullWidth maxWidth="md">
          <DialogTitle>Tài sản · {editingType.data.name}</DialogTitle>
          <DialogContent>
            <RoomTypeAssetEditor
              key={`${editingType.id}:${editingType.version}`}
              locationId={locationId}
              value={editingType}
              template={templates.data?.find(
                (item) => item.id === editingType.data.assetTemplateId,
              )}
              onClose={() => setEditingType(null)}
              onSaved={(result) => {
                setRun({ rooms: result.rooms });
                setEditingType(null);
              }}
              reload={async () => {
                const result = await defaults.refetch({ throwOnError: true });
                await templates.refetch({ throwOnError: true });
                const latest = result.data?.find((item) => item.id === editingType.id);
                if (!latest || latest.status === 'Archived')
                  throw new UserFeedbackError('Loại phòng đã ngừng sử dụng.');
                setEditingType(latest);
              }}
            />
          </DialogContent>
        </Dialog>
      )}
      {showTemplates && run && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Kết quả áp dụng định mức
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {run.rooms.filter((room) => room.status === 'Applied').length} phòng đã áp dụng ·{' '}
              {run.rooms.filter((room) => room.status.startsWith('Skipped')).length} bỏ qua ·{' '}
              {run.rooms.filter((room) => room.status.startsWith('Failed')).length} lỗi
            </Typography>
            {run.rooms.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Không có phòng được áp dụng trong lần lưu này.
              </Typography>
            )}
            {run.rooms.map((room) => (
              <Alert key={room.roomId} severity={room.status === 'Applied' ? 'success' : 'warning'}>
                {rooms.data?.find((r) => r.id === room.roomId)?.label ?? `Phòng (${room.roomId})`}:{' '}
                {room.status === 'Applied'
                  ? 'Đã cập nhật định mức'
                  : room.status === 'SkippedOtherTemplate'
                    ? 'Đang dùng mẫu khác'
                    : room.status === 'SkippedNotEligible'
                      ? 'Chưa đủ điều kiện đồng bộ'
                      : 'Đồng bộ thất bại; kiểm tra và thử lại.'}
              </Alert>
            ))}
          </Stack>
        </Paper>
      )}
      {showInventory && owner && (
        <Alert severity="info">
          Owner xác nhận kiểm kê theo danh sách tài sản đã cấu hình tại mục Kiểm kê phòng. Quy trình
          kiểm kê bàn giao có ảnh dành riêng cho Staff.
        </Alert>
      )}
      {showInventory && !owner && (
        <Stack spacing={2}>
          {owner && templates.error && (
            <ErrorState error={templates.error} retry={() => void templates.refetch()} />
          )}
          <TextField
            select
            label="Phòng kiểm kê"
            helperText={rooms.isPending ? 'Đang tải danh sách phòng…' : undefined}
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
          >
            <MenuItem value="">Chọn phòng</MenuItem>
            {rooms.isPending && <MenuItem disabled>Đang tải danh sách phòng…</MenuItem>}
            {rooms.data?.map((room) => (
              <MenuItem key={room.id} value={room.id}>
                {room.label}
              </MenuItem>
            ))}
          </TextField>
          {rooms.error && <ErrorState error={rooms.error} retry={() => void rooms.refetch()} />}
          {rooms.isSuccess && !rooms.data.length && (
            <Alert severity="info">Cơ sở chưa có phòng để kiểm kê.</Alert>
          )}
          {roomId && <RoomAssetInventory key={roomId} roomId={roomId} locationId={locationId} />}
          {!roomId && rooms.isSuccess && !!rooms.data.length && (
            <Typography variant="body2" color="text.secondary">
              Chọn một phòng để xem tài sản đã ghi nhận, định mức và các chênh lệch cần kiểm tra.
            </Typography>
          )}
        </Stack>
      )}
    </Stack>
  );
}

function RoomTypeAssetEditor({
  locationId,
  value,
  template,
  onClose,
  onSaved,
  reload,
}: {
  locationId: string;
  value: SetupDocument<LocalRoomDefaultsData>;
  template?: SetupDocument<LocalAssetTemplate>;
  onClose: () => void;
  onSaved: (result: RoomDefaultsAssetRequirementsResult) => void;
  reload: () => Promise<void>;
}) {
  const api = locationSetupClient(usePropertySetupApi().request);
  const action = useSetupAction();
  const [items, setItems] = useState<LocalAssetItem[]>(template?.data.items ?? []);
  const [apply, setApply] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [reason, setReason] = useState('');
  const valid =
    !!reason.trim() &&
    items.every(
      (item) =>
        item.name.trim() &&
        item.category.trim() &&
        Number.isInteger(item.quantity) &&
        item.quantity >= 1 &&
        item.quantity <= 10000,
    );
  function save() {
    if (!valid || action.busy) return;
    action.run(async () => {
      const result = await api.saveRoomDefaultsAssetRequirements(locationId, value.id, {
        expectedVersion: value.version,
        items,
        applyToExistingRooms: apply,
        reason: reason.trim(),
      });
      setConfirmApply(false);
      onSaved(result);
    });
  }
  return (
    <>
      <Stack
        component={ValidatedForm}
        spacing={2}
        sx={{ pt: 1 }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || action.busy) return;
          if (apply) setConfirmApply(true);
          else save();
        }}
      >
        <AssetRequirementFields items={items} onChange={setItems} disabled={action.busy} />
        <Divider />
        <FormControlLabel
          control={
            <Checkbox
              checked={apply}
              onChange={(event) => setApply(event.target.checked)}
              disabled={action.busy}
            />
          }
          label="Áp dụng cho các phòng hiện có đủ điều kiện"
        />
        <Typography variant="body2" color="text.secondary">
          {apply
            ? 'Chỉ cập nhật phòng cùng loại không bị ràng buộc bởi hợp đồng hoặc nghĩa vụ khác. Giữ nguyên tài sản đã kiểm kê.'
            : 'Cấu hình mới dùng cho phòng tạo sau này.'}
        </Typography>
        <TextField
          label="Lý do thay đổi"
          required
          multiline
          minRows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={action.busy}
        />
        {action.error && <Alert severity="error">{action.error}</Alert>}
        <ConflictReload error={action.rawError} reload={reload} />
        <Stack direction="row" sx={{ justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap' }}>
          <Button disabled={action.busy} onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={action.busy || !valid} type="submit" variant="contained">
            {apply ? 'Lưu và áp dụng' : 'Lưu tài sản phòng'}
          </Button>
        </Stack>
      </Stack>
      <ConfirmDialog
        open={confirmApply}
        title="Áp dụng định mức mới?"
        busy={action.busy}
        error={action.error || undefined}
        onClose={() => setConfirmApply(false)}
        onConfirm={save}
      >
        <Typography variant="body2">
          Áp dụng định mức mới cho các phòng hiện có thuộc loại {value.data.name} đủ điều kiện.
          Phòng bị ràng buộc bởi hợp đồng hoặc nghĩa vụ khác sẽ giữ nguyên. Không tự động thêm hoặc
          xóa tài sản thực tế.
        </Typography>
      </ConfirmDialog>
    </>
  );
}

function LocalTemplateEditor({
  locationId,
  value,
  copyFrom,
  onClose,
}: {
  locationId: string;
  value: SetupDocument<LocalAssetTemplate> | null;
  copyFrom: SetupDocument<LocalAssetTemplate> | null;
  onClose: () => void;
}) {
  const api = usePropertySetupApi();
  const action = useSetupAction();
  const [name, setName] = useState(
    value?.data.name ?? (copyFrom ? `${copyFrom.data.name} - Bản sao` : ''),
  );
  const [items, setItems] = useState<LocalAssetItem[]>(
    value?.data.items ?? copyFrom?.data.items ?? [],
  );
  return (
    <Box>
      <Stack
        component={ValidatedForm}
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          action.run(async () => {
            await api.saveReadyTemplate(value?.id ?? null, {
              locationId,
              name,
              items,
              expectedVersion: value?.version ?? 0,
            });
            onClose();
          }, 'Đã lưu bộ mẫu.');
        }}
      >
        <TextField
          required
          label="Tên bộ mẫu"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <AssetRequirementFields items={items} onChange={setItems} disabled={action.busy} />
        {action.error && <Alert severity="error">{action.error}</Alert>}
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Button
            disabled={
              action.busy ||
              !name.trim() ||
              !items.length ||
              items.some(
                (item) =>
                  !item.name.trim() ||
                  !Number.isInteger(item.quantity) ||
                  item.quantity < 1 ||
                  item.quantity > 10000,
              )
            }
            type="submit"
            variant="contained"
          >
            Lưu
          </Button>
          <Button disabled={action.busy} onClick={onClose}>
            Đóng
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}

function RoomAssetInventory({ roomId, locationId }: { roomId: string; locationId: string }) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const action = useSetupAction();
  const [countItemId, setCountItemId] = useState('');
  const inventory = useQuery({
    queryKey: ['property-setup', 'inventory', session?.userId, roomId],
    queryFn: ({ signal }) => api.inventory(roomId, signal),
  });
  const counts = useAssetCounts(roomId, inventory.data?.currentDesiredId ?? undefined);
  if (inventory.isPending) return <LoadingState />;
  if (inventory.error)
    return <ErrorState error={inventory.error} retry={() => void inventory.refetch()} />;
  const current = inventory.data.desired.find(
    (desired) => desired.id === inventory.data.currentDesiredId,
  );
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
      <Stack spacing={2}>
        <Button
          sx={{ alignSelf: 'flex-end' }}
          disabled={inventory.isFetching || action.busy}
          onClick={() => void inventory.refetch()}
        >
          Tải lại kiểm kê
        </Button>
        {action.error && <Alert severity="error">{action.error}</Alert>}
        {action.notice && <Alert severity="success">{action.notice}</Alert>}
        <Divider />
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Tài sản vật lý đã ghi nhận
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {inventory.data.physical.length} bản ghi thực tế của phòng. Số lượng chỉ hiển thị khi đã
          được ghi nhận; chưa có dữ liệu không đồng nghĩa với không có tài sản.
        </Typography>
        {!inventory.data.physical.length && <Typography>Chưa có tài sản vật lý.</Typography>}
        {!!inventory.data.physical.length && (
          <TableContainer>
            <Table size="small" aria-label="Tài sản vật lý của phòng">
              <TableHead>
                <TableRow>
                  <TableCell>Tài sản / mã</TableCell>
                  <TableCell>Tình trạng</TableCell>
                  <TableCell align="right">Số lượng thực tế</TableCell>
                  <TableCell>Đơn vị</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {inventory.data.physical.map((asset) => (
                  <TableRow key={asset.id}>
                    <TableCell>
                      {asset.name}
                      <Typography
                        variant="caption"
                        sx={{ display: 'block' }}
                        color="text.secondary"
                      >
                        {asset.code || 'Chưa có mã'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {asset.condition} ·{' '}
                      {['Đang sử dụng', 'Hư hỏng', 'Đang sửa chữa', 'Đã ngừng sử dụng'][
                        asset.status
                      ] ?? 'Chưa xác định'}
                    </TableCell>
                    <TableCell align="right">
                      {inventory.data.metadata?.[asset.id]?.quantity ?? '—'}
                    </TableCell>
                    <TableCell>
                      {inventory.data.metadata?.[asset.id]?.unit || 'Chưa ghi nhận'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {inventory.data.discrepancies?.map((item, index) => (
          <Alert key={index} severity="warning">
            {inventory.data.physical.find((asset) => asset.id === item.assetId)?.name ?? 'Tài sản'}:{' '}
            {item.action === 'PendingRemovalReview'
              ? 'Cần kiểm tra sau thay đổi định mức; không tự xóa tài sản.'
              : 'Chưa được liên kết với định mức.'}
          </Alert>
        ))}
        <Divider />
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Tài sản được cấu hình
        </Typography>
        {current ? (
          <>
            {counts.error && (
              <ErrorState error={counts.error} retry={() => void counts.refetch()} />
            )}
            <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Chip
                size="small"
                label={
                  current.status === 'PendingVerification'
                    ? 'Chờ kiểm kê'
                    : current.status === 'Verified'
                      ? 'Đã xác nhận'
                      : current.status === 'PartiallyVerified'
                        ? 'Đã kiểm kê một phần'
                        : current.status
                }
              />
              <Typography variant="body2" color="text.secondary">
                Phiên bản bộ mẫu {current.data.templateVersion} · Định mức {current.version}
              </Typography>
            </Stack>
            <TableContainer>
              <Table
                size="small"
                aria-label="Tài sản được cấu hình cho phòng"
                sx={{ minWidth: 560 }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell>Thiết bị</TableCell>
                    <TableCell>Đơn vị</TableCell>
                    <TableCell align="right">Số lượng yêu cầu</TableCell>
                    <TableCell align="right">Đã xác minh</TableCell>
                    <TableCell>Kiểm đếm thực tế</TableCell>
                    <TableCell align="right">Thao tác</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {current.data.items.map((item) => {
                    const observed = counts.data?.find((row) => row.data.itemId === item.id);
                    const verified = inventory.data.progress?.find(
                      (row) => row.itemId === item.id,
                    )?.verifiedQuantity;
                    return (
                      <TableRow key={item.id}>
                        <TableCell>{item.name}</TableCell>
                        <TableCell>{item.unit || 'Chưa ghi nhận'}</TableCell>
                        <TableCell align="right">{item.quantity}</TableCell>
                        <TableCell align="right">{verified ?? '—'}</TableCell>
                        <TableCell>
                          {observed ? (
                            <>
                              <Typography variant="body2">
                                {observed.data.quantity} {item.unit ?? ''}
                              </Typography>
                              <Typography
                                variant="caption"
                                color={
                                  observed.data.quantity === item.quantity
                                    ? 'success.main'
                                    : 'warning.dark'
                                }
                              >
                                {observed.data.quantity === item.quantity
                                  ? 'Đủ'
                                  : observed.data.quantity < item.quantity
                                    ? `Thiếu ${item.quantity - observed.data.quantity}`
                                    : `Thừa ${observed.data.quantity - item.quantity}`}
                              </Typography>
                            </>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              {counts.isPending
                                ? 'Đang tải…'
                                : counts.error
                                  ? 'Không tải được'
                                  : 'Chưa kiểm đếm'}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            disabled={counts.isFetching || !!counts.error}
                            onClick={() => setCountItemId(item.id)}
                          >
                            {observed ? 'Cập nhật' : 'Kiểm đếm'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            {current.data.items.some((item) => item.id === countItemId) && (
              <AssetCountObservationDialog
                key={`${current.id}:${countItemId}`}
                roomId={roomId}
                locationId={locationId}
                desired={current}
                item={current.data.items.find((item) => item.id === countItemId)!}
                current={counts.data?.find((row) => row.data.itemId === countItemId)}
                close={() => setCountItemId('')}
              />
            )}
            <AssetVerificationForm
              key={`${current.id}:${current.version}`}
              roomId={roomId}
              locationId={locationId}
              desired={current}
              inventory={inventory.data}
            />
          </>
        ) : (
          <Typography>
            Chưa cấu hình tài sản cho phòng đủ điều kiện. Kiểm tra trạng thái phòng và kết quả đồng
            bộ.
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}

function AssetVerificationForm({
  roomId,
  locationId,
  desired,
  inventory,
}: {
  roomId: string;
  locationId: string;
  desired: SetupDocument<DesiredAssets>;
  inventory: AssetInventory;
}) {
  const api = usePropertySetupApi();
  const action = useSetupAction();
  const [itemId, setItemId] = useState(desired.data.items[0]?.id ?? '');
  const [existing, setExisting] = useState('');
  const [code, setCode] = useState('');
  const [condition, setCondition] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [file, setFile] = useState<File | null>(null);
  const uploaded = useRef<{ file: File; key: string } | null>(null);
  return (
    <Stack
      component={ValidatedForm}
      spacing={2}
      sx={{ p: 2, bgcolor: 'background.default', borderRadius: '12px' }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!file) return;
        action.run(async () => {
          if (uploaded.current?.file !== file)
            uploaded.current = {
              file,
              key: (await api.uploadEvidence(locationId, file)).objectKey,
            };
          return api.verifyAsset(roomId, {
            templateId: desired.data.templateId,
            itemId,
            code,
            condition,
            quantity: Number(quantity),
            expectedVersion: desired.version,
            evidenceObjectKey: uploaded.current.key,
            existingAssetId: existing || null,
          });
        }, 'Máy chủ đã xác nhận kiểm kê tài sản.');
      }}
    >
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        Xác nhận kiểm kê
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Chọn thiết bị theo định mức, liên kết tài sản đã ghi nhận hoặc nhập tài sản mới, rồi cung
        cấp ảnh bằng chứng.
      </Typography>
      <TextField
        select
        label="Tài sản theo định mức"
        value={itemId}
        onChange={(event) => setItemId(event.target.value)}
      >
        {desired.data.items.map((item) => (
          <MenuItem key={item.id} value={item.id}>
            {item.name}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Tài sản vật lý để liên kết"
        value={existing}
        onChange={(event) => {
          const id = event.target.value;
          setExisting(id);
          const asset = inventory.physical.find((row) => row.id === id);
          if (asset) {
            setCode(asset.code ?? '');
            setCondition(asset.condition);
            setQuantity(String(inventory.metadata?.[id]?.quantity ?? 1));
          } else {
            setCode('');
            setCondition('');
            setQuantity('1');
          }
        }}
      >
        <MenuItem value="">Ghi nhận tài sản mới đã kiểm tra</MenuItem>
        {inventory.physical
          .filter((asset) => asset.status !== 3)
          .map((asset) => (
            <MenuItem key={asset.id} value={asset.id}>
              {asset.code} · {asset.name}
            </MenuItem>
          ))}
      </TextField>
      <TextField
        required
        disabled={!!existing}
        label="Mã tài sản kiểm kê"
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />
      <TextField
        required
        disabled={!!existing}
        label="Tình trạng kiểm kê"
        value={condition}
        onChange={(event) => setCondition(event.target.value)}
      />
      <TextField
        required
        disabled={!!existing}
        type="number"
        label="Số lượng kiểm kê"
        value={quantity}
        slotProps={{ htmlInput: { min: 1, step: 1 } }}
        onChange={(event) => setQuantity(event.target.value)}
      />
      <SetupEvidenceField value={file} onChange={setFile} />
      {action.error && <Alert severity="error">{action.error}</Alert>}
      {action.notice && <Alert severity="success">{action.notice}</Alert>}
      <Button type="submit" variant="contained" disabled={action.busy || !file || !itemId}>
        Xác nhận đã kiểm tra tài sản thực tế
      </Button>
    </Stack>
  );
}
