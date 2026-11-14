import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import { invoiceError, type Policy } from '../../../../../../packages/client-core/src/invoices';
import { useInvoiceApi } from '../../invoices/useInvoiceApi';

export function EndPolicyDialog({ policy, close }: { policy: Policy; close: () => void }) {
  const api = useInvoiceApi();
  const cache = useQueryClient();
  const lock = useRef(false);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const action = useMutation({
    mutationFn: () =>
      api.request(`/api/v1/billing-policies/${encodeURIComponent(policy.id)}/end`, {
        method: 'POST',
        body: JSON.stringify({ effectiveTo: date, version: policy.version, reason: reason.trim() }),
      }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['billing-policies'] });
      await cache.invalidateQueries({ queryKey: ['property-setup'] });
      close();
    },
  });
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={() => !action.isPending && close()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (lock.current) return;
          lock.current = true;
          void action
            .mutateAsync()
            .catch(() => {})
            .finally(() => {
              lock.current = false;
            });
        }}
      >
        <DialogTitle>Kết thúc áp dụng: {policy.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info">
              Khoản thu được giữ lại trong lịch sử. Ngày kết thúc và các nghĩa vụ liên quan sẽ được
              hệ thống kiểm tra trước khi lưu.
            </Alert>
            <TextField
              required
              type="date"
              label="Ngày kết thúc áp dụng"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: policy.effectiveFrom } }}
            />
            <TextField
              required
              label="Lý do kết thúc"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {action.error && <Alert severity="error">{invoiceError(action.error)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={action.isPending} onClick={close}>
            Hủy
          </Button>
          <Button type="submit" variant="contained" disabled={action.isPending || !reason.trim()}>
            Xác nhận kết thúc áp dụng
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
