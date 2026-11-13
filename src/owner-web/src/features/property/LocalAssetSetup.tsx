import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
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
import { ErrorState, LoadingState } from '../../components/common/PortalUI';
import { usePropertySetupApi } from './usePropertySetupApi';
import { useSetupAction } from './useSetupAction';
import { SetupEvidenceField } from './SetupEvidenceField';

export function LocalAssetSetup({
  locationId,
  mode = 'all',
}: {
  locationId: string;
  mode?: 'all' | 'templates' | 'inventory';
}) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const [editing, setEditing] = useState<SetupDocument<LocalAssetTemplate> | null | undefined>(
    undefined,
  );
  const [roomId, setRoomId] = useState('');
  const [run, setRun] = useState<AssetSyncRun | null>(null);
  const action = useSetupAction();
  const showTemplates = mode !== 'inventory';
  const showInventory = mode !== 'templates';
  const templates = useQuery({
    queryKey: ['property-setup', 'asset-templates', session?.userId, locationId],
    queryFn: ({ signal }) => api.templates(locationId, signal),
    enabled: owner,
  });
  const rooms = useQuery({
    queryKey: ['property-setup', 'room-options', session?.userId, locationId],
    queryFn: ({ signal }) => api.roomOptions(locationId, signal),
  });
  return (
    <Stack spacing={2}>
      {mode === 'all' && (
        <Box>
          <Typography variant="h6" component="h2">
            Bộ mẫu trang bị & Kiểm kê phòng
          </Typography>
        </Box>
      )}
      {action.error && <Alert severity="error">{action.error}</Alert>}
      {action.notice && <Alert severity="success">{action.notice}</Alert>}
      {showTemplates && !owner && (
        <Alert severity="info">
          Owner quản lý bộ định mức trang bị. Chọn mục kiểm kê phòng để xem thông tin được cấp
          quyền.
        </Alert>
      )}
      {showTemplates && owner && (
        <>
          <Button
            variant="contained"
            sx={{ alignSelf: 'flex-start' }}
            disabled={action.busy}
            onClick={() => setEditing(null)}
          >
            Tạo bộ mẫu trang bị
          </Button>
          {templates.isPending ? (
            <LoadingState />
          ) : templates.error ? (
            <ErrorState error={templates.error} retry={() => void templates.refetch()} />
          ) : (
            <>
              {!templates.data?.length && (
                <Alert severity="info">
                  Chưa có bộ mẫu. Tạo bộ mẫu để quy định các thiết bị cần trang bị cho phòng.
                </Alert>
              )}
              {templates.data?.map((template) => (
                <Paper key={template.id} variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
                  <Stack spacing={2}>
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
                        label={template.status === 'Draft' ? 'Bản nháp' : 'Đã công bố'}
                        color={template.status === 'Draft' ? 'default' : 'success'}
                      />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {template.data.items.length} loại thiết bị
                    </Typography>
                    <TableContainer>
                      <Table size="small" aria-label={`Định mức ${template.data.name}`}>
                        <TableHead>
                          <TableRow>
                            <TableCell>Thiết bị</TableCell>
                            <TableCell>Nhóm</TableCell>
                            <TableCell align="right">Định mức</TableCell>
                            <TableCell>Cách theo dõi</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {template.data.items.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>{item.name}</TableCell>
                              <TableCell>{item.category}</TableCell>
                              <TableCell align="right">{item.quantity}</TableCell>
                              <TableCell>
                                {item.trackingMode === 'Serialized'
                                  ? 'Theo từng mã'
                                  : 'Theo số lượng'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    {template.status === 'Draft' && (
                      <Typography variant="caption" color="text.secondary">
                        Công bố chỉ cập nhật định mức; tài sản thực tế được ghi nhận qua kiểm kê.
                      </Typography>
                    )}
                    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                      {template.status === 'Draft' ? (
                        <>
                          <Button
                            disabled={action.busy}
                            variant="outlined"
                            onClick={() => setEditing(template)}
                          >
                            Sửa bản nháp
                          </Button>
                          <Button
                            disabled={action.busy}
                            variant="contained"
                            onClick={() =>
                              action.run(
                                async () =>
                                  setRun(await api.publishTemplate(template.id, template.version)),
                                'Máy chủ đã công bố bộ mẫu; kiểm tra kết quả đồng bộ từng phòng.',
                              )
                            }
                          >
                            Công bố bộ mẫu
                          </Button>
                        </>
                      ) : (
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
                        onClick={() =>
                          action.run(
                            async () => setEditing(await api.cloneTemplate(template.id)),
                            'Máy chủ đã tạo bản sao nháp.',
                          )
                        }
                      >
                        Nhân bản
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
        <DialogTitle>{editing ? 'Chỉnh sửa bộ mẫu nháp' : 'Tạo bộ mẫu trang bị'}</DialogTitle>
        <DialogContent>
          {editing !== undefined && (
            <LocalTemplateEditor
              key={editing?.id ?? 'new'}
              locationId={locationId}
              value={editing}
              onClose={() => setEditing(undefined)}
            />
          )}
        </DialogContent>
      </Dialog>
      {showTemplates && run && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Kết quả đồng bộ · phiên bản {run.templateVersion}
            </Typography>
            {run.rooms.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Không có phòng trong kết quả đồng bộ.
              </Typography>
            )}
            {run.rooms.map((room) => (
              <Alert key={room.roomId} severity={room.status === 'Applied' ? 'success' : 'warning'}>
                {rooms.data?.find((r) => r.id === room.roomId)?.label ?? 'Phòng'}:{' '}
                {room.status === 'Applied'
                  ? 'Đã tạo định mức'
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
      {showInventory && (
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
          {roomId && (
            <RoomAssetInventory
              key={roomId}
              roomId={roomId}
              locationId={locationId}
              templates={templates.data ?? []}
              templatesAvailable={templates.isSuccess}
            />
          )}
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

function LocalTemplateEditor({
  locationId,
  value,
  onClose,
}: {
  locationId: string;
  value: SetupDocument<LocalAssetTemplate> | null;
  onClose: () => void;
}) {
  const api = usePropertySetupApi();
  const action = useSetupAction();
  const [name, setName] = useState(value?.data.name ?? '');
  const [items, setItems] = useState<LocalAssetItem[]>(value?.data.items ?? []);
  const change = (id: string, changes: Partial<LocalAssetItem>) =>
    setItems((old) => old.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  return (
    <Box>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          action.run(async () => {
            await api.saveTemplate(value?.id ?? null, {
              locationId,
              name,
              items,
              expectedVersion: value?.version ?? 0,
            });
            onClose();
          }, 'Máy chủ đã lưu bản nháp trang bị.');
        }}
      >
        <TextField
          required
          label="Tên bộ mẫu"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {items.map((item, index) => (
          <Box
            key={item.id}
            sx={{
              p: 2,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: '12px',
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1.5fr 1fr 1fr' },
              gap: 2,
            }}
          >
            <TextField
              required
              label={`Tên tài sản ${index + 1}`}
              value={item.name}
              onChange={(event) => change(item.id, { name: event.target.value })}
            />
            <TextField
              required
              label={`Nhóm tài sản ${index + 1}`}
              value={item.category}
              onChange={(event) => change(item.id, { category: event.target.value })}
            />
            <TextField
              type="number"
              required
              label={`Số lượng ${index + 1}`}
              value={item.quantity}
              slotProps={{ htmlInput: { min: 1, max: 10000, step: 1 } }}
              onChange={(event) => change(item.id, { quantity: Number(event.target.value) })}
            />
            <TextField
              select
              label={`Theo dõi ${index + 1}`}
              value={item.trackingMode}
              onChange={(event) =>
                change(item.id, {
                  trackingMode: event.target.value as LocalAssetItem['trackingMode'],
                })
              }
            >
              <MenuItem value="Serialized">Theo từng mã</MenuItem>
              <MenuItem value="BulkQuantity">Theo số lượng</MenuItem>
            </TextField>
            <Button onClick={() => setItems((old) => old.filter((row) => row.id !== item.id))}>
              Bỏ tài sản {index + 1}
            </Button>
          </Box>
        ))}
        <Button
          disabled={items.length >= 100}
          onClick={() =>
            setItems((old) => [
              ...old,
              {
                id: crypto.randomUUID(),
                name: '',
                category: '',
                trackingMode: 'Serialized',
                quantity: 1,
              },
            ])
          }
        >
          Thêm tài sản vào mẫu
        </Button>
        {action.error && <Alert severity="error">{action.error}</Alert>}
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Button disabled={action.busy} type="submit" variant="contained">
            Lưu bộ mẫu nháp
          </Button>
          <Button disabled={action.busy} onClick={onClose}>
            Đóng
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}

function RoomAssetInventory({
  roomId,
  locationId,
  templates,
  templatesAvailable,
}: {
  roomId: string;
  locationId: string;
  templates: SetupDocument<LocalAssetTemplate>[];
  templatesAvailable: boolean;
}) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const action = useSetupAction();
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const inventory = useQuery({
    queryKey: ['property-setup', 'inventory', session?.userId, roomId],
    queryFn: ({ signal }) => api.inventory(roomId, signal),
  });
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
        {owner && (
          <>
            <TextField
              select
              label="Bộ mẫu của phòng"
              disabled={action.busy || !templatesAvailable}
              value={selected ?? inventory.data.assignedTemplateId ?? ''}
              onChange={(event) => setSelected(event.target.value)}
            >
              <MenuItem value="">Bộ mẫu mặc định của cơ sở</MenuItem>
              {inventory.data.assignedTemplateId &&
                !templates.some(
                  (template) =>
                    template.id === inventory.data.assignedTemplateId &&
                    template.status === 'Published',
                ) && (
                  <MenuItem value={inventory.data.assignedTemplateId} disabled>
                    Gói đã gán · chưa có trong danh sách công bố
                  </MenuItem>
                )}
              {templates
                .filter((template) => template.status === 'Published')
                .map((template) => (
                  <MenuItem key={template.id} value={template.id}>
                    {template.data.name}
                  </MenuItem>
                ))}
            </TextField>
            <Button
              variant="outlined"
              sx={{ alignSelf: 'flex-start' }}
              disabled={action.busy || !templatesAvailable}
              onClick={() =>
                action.run(
                  () =>
                    api.assignTemplate(
                      roomId,
                      (selected ?? inventory.data.assignedTemplateId) || null,
                      inventory.data.assignmentVersion,
                    ),
                  'Máy chủ đã lưu lựa chọn bộ mẫu.',
                )
              }
            >
              Gán bộ mẫu cho phòng
            </Button>
          </>
        )}
        <Divider />
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Tài sản vật lý đã ghi nhận
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {inventory.data.physical.length} bản ghi thực tế của phòng. Số lượng vật lý chỉ hiển thị
          khi có dữ liệu theo dõi.
        </Typography>
        {!inventory.data.physical.length && <Typography>Chưa có tài sản vật lý.</Typography>}
        {!!inventory.data.physical.length && (
          <TableContainer>
            <Table size="small" aria-label="Tài sản vật lý của phòng">
              <TableHead>
                <TableRow>
                  <TableCell>Tài sản / mã</TableCell>
                  <TableCell>Tình trạng</TableCell>
                  <TableCell align="right">Số lượng vật lý</TableCell>
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
          Định mức mong muốn
        </Typography>
        {current ? (
          <>
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
              <Table size="small" aria-label="Định mức mong muốn của phòng">
                <TableHead>
                  <TableRow>
                    <TableCell>Thiết bị</TableCell>
                    <TableCell>Nhóm</TableCell>
                    <TableCell align="right">Số lượng yêu cầu</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {current.data.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.name}</TableCell>
                      <TableCell>{item.category}</TableCell>
                      <TableCell align="right">{item.quantity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
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
            Chưa có định mức cho phòng đủ điều kiện. Kiểm tra trạng thái phòng và kết quả đồng bộ.
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
      component="form"
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
