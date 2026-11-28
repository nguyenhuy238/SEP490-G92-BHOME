import { TextField } from '../../components/common/ValidatedForm';
import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import type { AssetCount } from './useAssetCounts';
import type {
  DesiredAssets,
  LocalAssetItem,
  SetupDocument,
} from '../../../../../packages/client-core/src/propertySetup';
import { invoiceError } from '../../../../../packages/client-core/src/invoices';
import { usePropertySetupApi } from './usePropertySetupApi';
import { SetupEvidenceField } from './SetupEvidenceField';

export function AssetCountObservationDialog({
  roomId,
  locationId,
  desired,
  item,
  current,
  close,
}: {
  roomId: string;
  locationId: string;
  desired: SetupDocument<DesiredAssets>;
  item: LocalAssetItem;
  current?: AssetCount;
  close: () => void;
}) {
  const api = usePropertySetupApi();
  const cache = useQueryClient();
  const [quantity, setQuantity] = useState(current ? String(current.data.quantity) : '');
  const [note, setNote] = useState(current?.data.note ?? '');
  const [file, setFile] = useState<File | null>(null);
  const uploaded = useRef<{ file: File; key: string } | null>(null);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const count = Number(quantity);
  const valid =
    quantity !== '' &&
    Number.isInteger(count) &&
    count >= 0 &&
    count <= 10000 &&
    !!file &&
    note.length <= 1000;
  const save = async () => {
    if (!valid || !file || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (uploaded.current?.file !== file)
        uploaded.current = { file, key: (await api.uploadEvidence(locationId, file)).objectKey };
      await api.request<AssetCount>(
        `/api/v1/rooms/${encodeURIComponent(roomId)}/asset-count-observations/${encodeURIComponent(item.id)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            desiredId: desired.id,
            desiredVersion: desired.version,
            quantity: count,
            evidenceObjectKey: uploaded.current.key,
            note: note.trim(),
            expectedVersion: current?.version ?? 0,
          }),
        },
      );
      await cache.invalidateQueries({ queryKey: ['property-setup', 'asset-counts'] });
      close();
    } catch (e) {
      setError(invoiceError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={() => {
        if (!busy) close();
      }}
    >
      <DialogTitle>Ghi nhận số lượng · {item.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Định mức: {item.quantity} {item.unit ?? ''}. Kết quả kiểm đếm chỉ lưu chênh lệch và bằng
            chứng, không tự tạo hoặc ngừng sử dụng tài sản.
          </Typography>
          <TextField
            label="Số lượng đếm được"
            required
            type="number"
            value={quantity}
            disabled={busy}
            onChange={(e) => setQuantity(e.target.value)}
            slotProps={{ htmlInput: { min: 0, max: 10000, step: 1 } }}
          />
          {quantity !== '' && Number.isInteger(count) && count >= 0 && (
            <Typography
              variant="body2"
              color={count === item.quantity ? 'success.main' : 'warning.dark'}
            >
              {count === item.quantity
                ? 'Đủ định mức'
                : count < item.quantity
                  ? `Thiếu ${item.quantity - count} ${item.unit ?? ''}`
                  : `Thừa ${count - item.quantity} ${item.unit ?? ''}`}
            </Typography>
          )}
          <TextField
            label="Ghi chú kiểm đếm"
            value={note}
            multiline
            minRows={2}
            onChange={(e) => setNote(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 1000 } }}
            disabled={busy}
          />
          <SetupEvidenceField value={file} onChange={setFile} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={close}>
          Hủy
        </Button>
        <Button variant="contained" disabled={!valid || busy} onClick={() => void save()}>
          {busy ? 'Đang lưu…' : 'Lưu kết quả kiểm đếm'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
