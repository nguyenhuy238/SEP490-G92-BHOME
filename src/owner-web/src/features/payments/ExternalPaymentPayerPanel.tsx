import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { paymentError, paymentText } from '../../../../../packages/client-core/src/payments';
import { usePaymentApi } from './usePaymentApi';

export function ExternalPaymentPayerPanel({
  transferId,
  onChanged,
}: {
  transferId: string;
  onChanged?: () => void;
}) {
  const api = usePaymentApi(),
    { session } = useAuth(),
    cache = useQueryClient();
  const [open, setOpen] = useState(false),
    [label, setLabel] = useState(''),
    [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['external-payment-payer', session?.userId, transferId],
    enabled: open,
    queryFn: ({ signal }) => api.externalPayer(transferId, signal),
  });
  const signature = JSON.stringify([transferId, query.data?.transferFingerprint, label, reason]);
  const checked = confirmation === signature;
  const key = useRef({ signature: '', value: crypto.randomUUID() }),
    lock = useRef(false);
  async function confirm() {
    if (
      lock.current ||
      !query.data ||
      query.isFetching ||
      query.data.payer ||
      query.data.problems.length ||
      !checked ||
      !label.trim() ||
      !reason.trim()
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (key.current.signature !== signature)
        key.current = { signature, value: crypto.randomUUID() };
      await api.confirmExternalPayer(
        transferId,
        {
          expectedTransferFingerprint: query.data.transferFingerprint,
          payerLabel: label.trim(),
          reason: reason.trim(),
          payerHasNoResidentProfile: true,
          humanConfirmed: true,
        },
        key.current.value,
      );
      setConfirmation('');
      await Promise.all(
        [
          'external-payment-payer',
          'receipt-excess-context',
          'refund-source',
          'payment-history',
          'invoice-payment',
        ].map((name) => cache.invalidateQueries({ queryKey: [name] })),
      );
      onChanged?.();
    } catch (e) {
      setError(paymentError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Stack spacing={2}>
      <Button disabled={busy} onClick={() => setOpen((value) => !value)}>
        {open ? 'Ẩn hồ sơ người trả bên ngoài' : 'Xác minh người trả bên ngoài'}
      </Button>
      {open && (
        <>
          {query.data?.isDevelopmentDemo && (
            <Alert severity="warning">
              DEVELOPMENT · Dữ liệu minh họa, không xác nhận tiền thật.
            </Alert>
          )}
          {(error || query.error) && (
            <Alert severity="error">{error || paymentError(query.error)}</Alert>
          )}
          <Button disabled={query.isFetching || busy} onClick={() => void query.refetch()}>
            {query.isFetching ? 'Đang tải người trả…' : 'Tải lại người trả'}
          </Button>
          {query.data?.payer ? (
            <Alert severity="info">
              Người thực trả bên ngoài đã xác minh: {query.data.payer.payerLabel} ·{' '}
              {formatInstant(query.data.payer.verifiedAt)}. Thông tin này chưa xác nhận đã hoàn
              tiền.
            </Alert>
          ) : (
            query.data && (
              <>
                <Alert severity="info">
                  Chỉ dùng khi người thực trả không có hồ sơ Resident. Đối chiếu sao kê{' '}
                  {query.data.statementReference}; không nhập CCCD hoặc tài khoản đầy đủ vào nhãn/lý
                  do.
                </Alert>
                {query.data.problems.map((problem) => (
                  <Alert key={problem} severity="warning">
                    {paymentText(problem)}
                  </Alert>
                ))}
                <TextField
                  label="Nhãn người thực trả theo sao kê"
                  value={label}
                  disabled={busy}
                  slotProps={{ htmlInput: { maxLength: 150 } }}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <TextField
                  label="Căn cứ xác minh người trả bên ngoài"
                  multiline
                  value={reason}
                  disabled={busy}
                  slotProps={{ htmlInput: { maxLength: 2000 } }}
                  onChange={(e) => setReason(e.target.value)}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={checked}
                      disabled={busy || query.isFetching}
                      onChange={(_, value) => setConfirmation(value ? signature : '')}
                    />
                  }
                  label="Tôi đã đối chiếu đúng người thực trả trên sao kê và người này không có hồ sơ Resident trong BHOME"
                />
                <Button
                  disabled={
                    busy ||
                    query.isFetching ||
                    !checked ||
                    !label.trim() ||
                    !reason.trim() ||
                    !!query.data.problems.length
                  }
                  onClick={() => void confirm()}
                >
                  Lưu xác minh người trả bên ngoài
                </Button>
                <Typography variant="caption">
                  Sau xác minh, đối soát số tiền và dùng hồ sơ hoàn tiền để duyệt, ghi nhận thực chi
                  cho đúng người trả.
                </Typography>
              </>
            )
          )}
        </>
      )}
    </Stack>
  );
}
