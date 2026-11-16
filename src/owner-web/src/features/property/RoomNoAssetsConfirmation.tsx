import { useState } from 'react';
import { Alert, Button, Checkbox, FormControlLabel, Stack, TextField } from '@mui/material';
import { contractError } from '../../../../../packages/client-core/src/contracts';
import { usePropertySetupApi } from './usePropertySetupApi';

export function RoomNoAssetsConfirmation({
  locationId,
  roomId,
  onChanged,
}: {
  locationId: string;
  roomId: string;
  onChanged: () => void;
}) {
  const api = usePropertySetupApi();
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(''),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  async function confirm() {
    if (busy || !checked) return;
    setBusy(true);
    setError('');
    try {
      const inventory = await api.handoverInventory(locationId, roomId);
      await api.confirmNoAssets(locationId, roomId, { stateToken: inventory.stateToken, reason });
      setMessage('Đã xác nhận không có tài sản bàn giao.');
      setOpen(false);
      onChanged();
    } catch (e) {
      setError(contractError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack spacing={1} sx={{ alignItems: 'flex-start', textAlign: 'left' }}>
      <Button disabled={busy} onClick={() => setOpen(!open)}>
        Xác nhận phòng không có tài sản
      </Button>
      {open && (
        <>
          <TextField
            label="Căn cứ xác nhận không có tài sản"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            multiline
            disabled={busy}
          />
          <FormControlLabel
            control={
              <Checkbox checked={checked} onChange={(_, v) => setChecked(v)} disabled={busy} />
            }
            label="Tôi đã kiểm tra phòng thực tế và xác nhận không có tài sản bàn giao"
          />
          <Button disabled={busy || !checked || !reason.trim()} onClick={() => void confirm()}>
            Lưu xác nhận không có tài sản
          </Button>
        </>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {message && <Alert severity="success">{message}</Alert>}
    </Stack>
  );
}
