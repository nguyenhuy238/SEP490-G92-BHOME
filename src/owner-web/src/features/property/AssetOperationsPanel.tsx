import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import type {
  AssetMetadata,
  PhysicalAsset,
  SetupDocument,
} from '../../../../../packages/client-core/src/propertySetup';
import { ConfirmDialog, ErrorState, LoadingState } from '../../components/common/PortalUI';
import { usePropertySetupApi } from './usePropertySetupApi';
import { useSetupAction } from './useSetupAction';

export function AssetOperationsPanel({
  asset,
  onClose,
}: {
  asset: PhysicalAsset;
  onClose: () => void;
}) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const history = useQuery({
    queryKey: ['property-setup', 'asset-history', session?.userId, asset.id],
    queryFn: ({ signal }) => api.assetHistory(asset.id, signal),
  });
  const metadata = useQuery({
    queryKey: ['property-setup', 'asset-metadata', session?.userId, asset.id],
    queryFn: ({ signal }) => api.assetMetadata(asset.id, signal),
    enabled: owner,
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        {asset.name} · {asset.code}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography>{asset.condition}</Typography>
          <Typography variant="h6">Lịch sử tài sản</Typography>
          {history.isPending ? (
            <LoadingState />
          ) : history.error ? (
            <ErrorState error={history.error} retry={() => void history.refetch()} />
          ) : (
            history.data.map((item) => (
              <Typography key={item.id}>
                {new Date(item.occurredAt).toLocaleString('vi-VN')} · {item.action} · {item.reason}
              </Typography>
            ))
          )}
          {owner &&
            (metadata.isPending ? (
              <LoadingState />
            ) : metadata.error ? (
              <ErrorState error={metadata.error} retry={() => void metadata.refetch()} />
            ) : (
              <MetadataEditor key={metadata.data.version} asset={asset} document={metadata.data} />
            ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Đóng thông tin tài sản</Button>
      </DialogActions>
    </Dialog>
  );
}

function MetadataEditor({
  asset,
  document,
}: {
  asset: PhysicalAsset;
  document: SetupDocument<AssetMetadata>;
}) {
  const api = usePropertySetupApi();
  const action = useSetupAction();
  const [tracking, setTracking] = useState(document.data.trackingMode);
  const [quantity, setQuantity] = useState(String(document.data.quantity));
  const [cost, setCost] = useState(String(document.data.purchaseCost ?? ''));
  const [date, setDate] = useState(document.data.purchaseDate ?? '');
  const [life, setLife] = useState(String(document.data.usefulLifeMonths ?? ''));
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [condition, setCondition] = useState('');
  const [confirm, setConfirm] = useState(false);
  return (
    <Stack spacing={2}>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => {
          event.preventDefault();
          action.run(
            () =>
              api.saveMetadata(
                asset.id,
                {
                  trackingMode: tracking,
                  quantity: Number(quantity),
                  purchaseCost: cost || null,
                  purchaseDate: date || null,
                  usefulLifeMonths: life ? Number(life) : null,
                },
                document.version,
                reason,
              ),
            'Máy chủ đã lưu thông tin tài sản.',
          );
        }}
      >
        <Typography variant="h6">Thông tin mua và theo dõi</Typography>
        <TextField
          select
          label="Cách theo dõi"
          value={tracking}
          onChange={(event) => setTracking(event.target.value as AssetMetadata['trackingMode'])}
        >
          <MenuItem value="Serialized">Theo từng mã</MenuItem>
          <MenuItem value="BulkQuantity">Theo số lượng</MenuItem>
        </TextField>
        <TextField
          required
          type="number"
          label="Số lượng vật lý"
          value={quantity}
          slotProps={{ htmlInput: { min: 1, step: 1 } }}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <TextField
          label="Giá mua VND"
          value={cost}
          onChange={(event) => setCost(event.target.value)}
        />
        <TextField
          type="date"
          label="Ngày mua"
          slotProps={{ inputLabel: { shrink: true } }}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <TextField
          type="number"
          label="Thời gian sử dụng dự kiến (tháng)"
          value={life}
          slotProps={{ htmlInput: { min: 1, step: 1 } }}
          onChange={(event) => setLife(event.target.value)}
        />
        <TextField
          required
          label="Lý do cập nhật tài sản"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button type="submit" disabled={action.busy}>
          Lưu thông tin tài sản
        </Button>
      </Stack>
      {asset.status !== 3 && (
        <Stack
          component="form"
          spacing={2}
          onSubmit={(event) => {
            event.preventDefault();
            setConfirm(true);
          }}
        >
          <Typography variant="h6">Thay tài sản vật lý</Typography>
          <Alert severity="info">
            Tài sản cũ được giữ trong lịch sử. Tài sản thay thế cần mã và tình trạng thực tế riêng.
          </Alert>
          <TextField
            required
            label="Mã tài sản thay thế"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <TextField
            required
            label="Tình trạng tài sản thay thế"
            value={condition}
            onChange={(event) => setCondition(event.target.value)}
          />
          <Button type="submit" disabled={action.busy || !reason.trim()}>
            Thay tài sản
          </Button>
        </Stack>
      )}
      {action.error && <Alert severity="error">{action.error}</Alert>}
      {action.notice && <Alert severity="success">{action.notice}</Alert>}
      <ConfirmDialog
        open={confirm}
        title="Xác nhận thay tài sản?"
        busy={action.busy}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          action.run(async () => {
            await api.replaceAsset(asset.id, {
              code,
              condition,
              reason,
              expectedVersion: asset.version,
            });
            setConfirm(false);
          }, 'Máy chủ đã ghi nhận thay tài sản và giữ lịch sử nguồn.')
        }
      >
        Mã mới: {code}. Máy chủ sẽ kiểm tra trạng thái sửa chữa và phiên bản trước khi thay.
      </ConfirmDialog>
    </Stack>
  );
}
