import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
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

export function LocalAssetSetup({ locationId }: { locationId: string }) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const [editing, setEditing] = useState<SetupDocument<LocalAssetTemplate> | null | undefined>(
    undefined,
  );
  const [roomId, setRoomId] = useState('');
  const [run, setRun] = useState<AssetSyncRun | null>(null);
  const action = useSetupAction();
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
      <Typography variant="h5">Bộ mẫu trang bị & Kiểm kê phòng</Typography>
      <Alert severity="info">
        Công bố bộ mẫu chỉ tạo định mức mong muốn cho phòng đủ điều kiện. Tài sản thực tế chỉ được
        ghi nhận sau khi kiểm kê và xác nhận bằng chứng.
      </Alert>
      {action.error && <Alert severity="error">{action.error}</Alert>}
      {action.notice && <Alert severity="success">{action.notice}</Alert>}
      {owner && (
        <>
          <Button disabled={action.busy} onClick={() => setEditing(null)}>
            Tạo bộ mẫu trang bị
          </Button>
          {templates.isPending ? (
            <LoadingState />
          ) : templates.error ? (
            <ErrorState error={templates.error} retry={() => void templates.refetch()} />
          ) : (
            <>
              {!templates.data?.length && <Typography>Chưa có bộ mẫu.</Typography>}
              {templates.data?.map((template) => (
                <Paper key={template.id} sx={{ p: 2 }}>
                  <Stack spacing={1}>
                    <Typography variant="h6">{template.data.name}</Typography>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Chip
                        size="small"
                        label={template.status === 'Draft' ? 'Bản nháp' : 'Đã công bố'}
                        color={template.status === 'Draft' ? 'default' : 'success'}
                      />
                      <Typography variant="body2" color="text.secondary">
                        Phiên bản {template.version} · {template.data.items.length} loại thiết bị
                      </Typography>
                    </Stack>
                    {template.data.items.map((item) => (
                      <Typography key={item.id}>
                        {item.name} · {item.category} · {item.quantity} ·{' '}
                        {item.trackingMode === 'Serialized' ? 'Theo từng mã' : 'Theo số lượng'}
                      </Typography>
                    ))}
                    <Stack direction="row" spacing={1}>
                      {template.status === 'Draft' ? (
                        <>
                          <Button onClick={() => setEditing(template)}>Sửa bản nháp</Button>
                          <Button
                            disabled={action.busy}
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
      {run && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6">Kết quả đồng bộ</Typography>
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
        </Paper>
      )}
      <TextField
        select
        label="Phòng kiểm kê"
        value={roomId}
        onChange={(event) => setRoomId(event.target.value)}
      >
        <MenuItem value="">Chọn phòng</MenuItem>
        {rooms.data?.map((room) => (
          <MenuItem key={room.id} value={room.id}>
            {room.label}
          </MenuItem>
        ))}
      </TextField>
      {rooms.error && <ErrorState error={rooms.error} retry={() => void rooms.refetch()} />}
      {roomId && (
        <RoomAssetInventory
          key={roomId}
          roomId={roomId}
          locationId={locationId}
          templates={templates.data ?? []}
        />
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
    <Paper sx={{ p: 2 }}>
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
          <Stack
            key={item.id}
            spacing={1}
            sx={{
              p: 2,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
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
          </Stack>
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
        <Stack direction="row">
          <Button disabled={action.busy} type="submit" variant="contained">
            Lưu bộ mẫu nháp
          </Button>
          <Button disabled={action.busy} onClick={onClose}>
            Đóng
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function RoomAssetInventory({
  roomId,
  locationId,
  templates,
}: {
  roomId: string;
  locationId: string;
  templates: SetupDocument<LocalAssetTemplate>[];
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
    <Paper sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Button onClick={() => void inventory.refetch()}>Tải lại kiểm kê</Button>
        {action.error && <Alert severity="error">{action.error}</Alert>}
        {action.notice && <Alert severity="success">{action.notice}</Alert>}
        {owner && (
          <>
            <TextField
              select
              label="Bộ mẫu của phòng"
              value={selected ?? inventory.data.assignedTemplateId ?? ''}
              onChange={(event) => setSelected(event.target.value)}
            >
              <MenuItem value="">Bộ mẫu mặc định của cơ sở</MenuItem>
              {templates
                .filter((template) => template.status === 'Published')
                .map((template) => (
                  <MenuItem key={template.id} value={template.id}>
                    {template.data.name}
                  </MenuItem>
                ))}
            </TextField>
            <Button
              disabled={action.busy}
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
        <Typography variant="h6">Tài sản vật lý đã ghi nhận</Typography>
        {!inventory.data.physical.length && <Typography>Chưa có tài sản vật lý.</Typography>}
        {inventory.data.physical.map((asset) => (
          <Typography key={asset.id}>
            {asset.code} · {asset.name} · {asset.condition}
          </Typography>
        ))}
        {inventory.data.discrepancies?.map((item, index) => (
          <Alert key={index} severity="warning">
            {inventory.data.physical.find((asset) => asset.id === item.assetId)?.name ?? 'Tài sản'}:{' '}
            {item.action === 'PendingRemovalReview'
              ? 'Cần kiểm tra sau thay đổi định mức; không tự xóa tài sản.'
              : 'Chưa được liên kết với định mức.'}
          </Alert>
        ))}
        <Typography variant="h6">Định mức mong muốn</Typography>
        {current ? (
          <>
            <Typography>{current.status}</Typography>
            {current.data.items.map((item) => (
              <Typography key={item.id}>
                {item.name} · Số lượng {item.quantity}
              </Typography>
            ))}
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
      sx={{ p: 2, bgcolor: 'background.default', borderRadius: 2 }}
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
