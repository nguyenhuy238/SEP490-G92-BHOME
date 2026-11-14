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
import { useQuery } from '@tanstack/react-query';
import {
  contractError,
  mutationKeys,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import { missingBillingInput } from '../../../../../packages/client-core/src/invoices';

export function FinalChargeReviewPanel({
  api,
  id,
  reference,
  saved,
}: {
  api: ContractClient;
  id: string;
  reference: string;
  saved: () => Promise<void>;
}) {
  const query = useQuery({
    queryKey: ['settlement-charge-review', id, reference],
    queryFn: ({ signal }) => api.settlementChargeReview(id, signal),
  });
  const [confirmation, setConfirmation] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const validData =
    query.data &&
    Array.isArray(query.data.missingInputs) &&
    typeof query.data.reference === 'string'
      ? query.data
      : null;
  async function approve() {
    if (
      lock.current ||
      !validData ||
      validData.missingInputs.length ||
      validData.isCurrent ||
      confirmation !== validData.reference ||
      !reason.trim()
    )
      return;
    const body = {
      expectedReference: validData.reference,
      reason: reason.trim(),
      allChargesConfirmed: true,
    };
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.approveSettlementChargeReview(id, body, keys.get('review', body));
      keys.confirmed('review', body);
      setConfirmation('');
      await query.refetch();
      await saved();
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1">Xác nhận đủ danh sách khoản thu trả phòng</Typography>
      <Alert severity="info">
        Kiểm tra điện, nước, tiền thuê, phí và thiệt hại đã ghi nhận. Xác nhận này giữ nguyên các
        khoản nợ và chưa xác nhận đã nhận tiền hay hoàn cọc.
      </Alert>
      {query.isPending && <Typography>Đang kiểm tra nguồn các khoản thu…</Typography>}
      {(error || query.error) && (
        <Alert severity="error">{error || contractError(query.error)}</Alert>
      )}
      {validData?.missingInputs.map((code) => (
        <Alert key={code} severity="warning">
          {code.startsWith('final_utility_charge_review_required:')
            ? 'Cần ghi nhận khoản chốt điện/nước, kể cả khi đã tính đủ trên hóa đơn.'
            : code.startsWith('final_fixed_charge_review_required:')
              ? 'Cần ghi nhận căn cứ tiền thuê/phí tháng cuối.'
              : missingBillingInput(code)}
        </Alert>
      ))}
      {validData?.isCurrent ? (
        <Alert severity="success">
          Owner đã xác nhận danh sách hiện tại. Thêm khoản thu sẽ yêu cầu xác nhận lại.
        </Alert>
      ) : (
        validData && (
          <>
            <TextField
              label="Căn cứ xác nhận đủ khoản thu"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setConfirmation('');
              }}
              disabled={busy}
              multiline
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={confirmation === validData.reference}
                  disabled={busy || !!validData.missingInputs.length}
                  onChange={(_, checked) => setConfirmation(checked ? validData.reference : '')}
                />
              }
              label="Tôi đã đối chiếu biên bản và xác nhận danh sách khoản thu đầy đủ"
            />
            <Button
              disabled={
                busy ||
                !!validData.missingInputs.length ||
                confirmation !== validData.reference ||
                !reason.trim()
              }
              onClick={() => void approve()}
            >
              Xác nhận đủ khoản thu
            </Button>
          </>
        )
      )}
      <Button disabled={busy || query.isFetching} onClick={() => void query.refetch()}>
        Tải lại đối chiếu khoản thu
      </Button>
    </Stack>
  );
}
