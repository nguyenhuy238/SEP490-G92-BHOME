import { useRef, useState } from 'react';
import { Alert, Button, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import {
  paymentError,
  type PaymentModeView,
} from '../../../../../packages/client-core/src/payments';
import { usePaymentApi } from './usePaymentApi';
import { usePaymentMode } from './usePaymentMode';

export function PaymentModeSwitch() {
  const api = usePaymentApi();
  const cache = useQueryClient();
  const state = usePaymentMode();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  if (state.isPending) return <Typography role="status">Đang tải chế độ thanh toán…</Typography>;
  if (state.isError || !state.data)
    return (
      <Alert
        severity="error"
        action={<Button onClick={() => void state.refetch()}>Thử lại</Button>}
      >
        {state.error ? paymentError(state.error) : 'Không tải được chế độ thanh toán. Hãy thử lại.'}
      </Alert>
    );
  const current = state.data;
  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={current.mode}
        aria-label="Chế độ nhận tiền SePay"
        sx={{ alignSelf: 'flex-start' }}
        disabled={busy}
        onChange={(_, selected: 'Test' | 'Live' | null) => {
          if (!selected || selected === current.mode || lock.current) return;
          lock.current = true;
          setBusy(true);
          setError('');
          void api
            .request<PaymentModeView>('/api/v1/receiving-bank-accounts/owner/mode', {
              method: 'PUT',
              body: JSON.stringify({
                mode: selected,
                expectedMode: current.mode,
              }),
            })
            .then(async () => {
              await cache.invalidateQueries({ queryKey: ['sepay-payment-mode'] });
              await cache.invalidateQueries({ queryKey: ['receiving-account'] });
              await cache.invalidateQueries({ queryKey: ['owner-sepay-connection'] });
            })
            .catch((e) => setError(paymentError(e)))
            .finally(() => {
              lock.current = false;
              setBusy(false);
            });
        }}
      >
        <ToggleButton value="Test">Test Mode</ToggleButton>
        <ToggleButton value="Live">Live Mode</ToggleButton>
      </ToggleButtonGroup>
      <Typography variant="body2" color="text.secondary">
        {current.mode === 'Test'
          ? 'Nhận giao dịch qua SePay Test.'
          : 'Chuyển khoản ngân hàng thật.'}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Chuyển chế độ chỉ áp dụng cho nghĩa vụ mới; QR đã phát hành giữ nguyên chế độ và tài khoản
        nhận.
      </Typography>
      {busy && (
        <Typography role="status" variant="body2">
          Đang lưu chế độ…
        </Typography>
      )}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
}
