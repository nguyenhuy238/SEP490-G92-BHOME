import { MoneyField } from '../../components/common/MoneyField';
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
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
  const status =
    ['Đang sử dụng', 'Hư hỏng', 'Đang sửa chữa', 'Đã ngừng sử dụng'][asset.status] ??
    'Chưa xác định';
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{asset.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Chip
              label={status}
              size="small"
              color={
                asset.status === 0
                  ? 'success'
                  : asset.status === 1 || asset.status === 2
                    ? 'warning'
                    : 'default'
              }
            />
            <Typography variant="body2" color="text.secondary">
              {asset.code || 'Chưa có mã'} · {asset.category} · Phiên bản {asset.version}
            </Typography>
          </Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Tình trạng thực tế
              </Typography>
              <Typography>{asset.condition}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Vị trí
              </Typography>
              <Typography>
                {asset.roomId ? 'Trong phòng đã gán' : asset.commonArea || 'Chưa ghi nhận khu vực'}
              </Typography>
            </Box>
          </Box>
          <Divider />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Lịch sử tài sản
          </Typography>
          {history.isPending ? (
            <LoadingState />
          ) : history.error ? (
            <ErrorState error={history.error} retry={() => void history.refetch()} />
          ) : (
            <Stack spacing={1.5} divider={<Divider flexItem />}>
              {history.data.map((item) => (
                <Box key={item.id}>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(item.occurredAt).toLocaleString('vi-VN')}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>
                    {item.action}
                  </Typography>
                  <Typography variant="body2">{item.reason}</Typography>
                </Box>
              ))}
              {!history.data.length && (
                <Typography variant="body2" color="text.secondary">
                  Chưa có lịch sử được ghi nhận.
                </Typography>
              )}
            </Stack>
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
  const [replacementReason, setReplacementReason] = useState('');
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
        <Divider />
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Thông tin mua và theo dõi
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Thông tin của tài sản đã ghi nhận. Phiên bản dữ liệu theo dõi: {document.version}.
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
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
          <MoneyField
            allowDecimal
            label="Giá mua VND"
            value={cost}
            onValueChange={(raw) => setCost(raw)}
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
        </Box>
        <TextField
          required
          label="Lý do cập nhật tài sản"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button
          type="submit"
          variant="contained"
          sx={{ alignSelf: 'flex-start' }}
          disabled={action.busy}
        >
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
          <Divider />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Thay tài sản vật lý
          </Typography>
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
          <TextField
            required
            label="Lý do thay tài sản"
            value={replacementReason}
            onChange={(event) => setReplacementReason(event.target.value)}
          />
          <Button
            type="submit"
            variant="outlined"
            sx={{ alignSelf: 'flex-start' }}
            disabled={action.busy || !replacementReason.trim()}
          >
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
              reason: replacementReason,
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
