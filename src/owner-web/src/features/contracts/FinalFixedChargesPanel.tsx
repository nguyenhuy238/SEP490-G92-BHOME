import { useRef, useState } from 'react';
import { Alert, Button, Checkbox, FormControlLabel, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import {
  contractError,
  formatContractMoney,
  mutationKeys,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import {
  formatBillingDecimal,
  missingBillingInput,
} from '../../../../../packages/client-core/src/invoices';

export function FinalFixedChargesPanel({
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
    queryKey: ['final-fixed-charges', id, reference],
    queryFn: ({ signal }) => api.finalFixedCharges(id, signal),
  });
  const [confirmed, setConfirmed] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  async function approve(code: string) {
    const row = query.data?.find((r) => r.chargeCode === code);
    if (
      lock.current ||
      !row ||
      row.missingInputs.length ||
      row.amount == null ||
      row.existingReceivableId ||
      confirmed[code] !== row.reference
    )
      return;
    const body = {
      chargeCode: code,
      expectedReference: row.reference,
      policyAppliesToSignedTermsConfirmed: true,
    };
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.approveFinalFixedCharge(id, body, keys.get(code, body));
      keys.confirmed(code, body);
      setConfirmed({});
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
    <Stack spacing={2}>
      <Typography variant="subtitle1">Tiền thuê và phí cố định tháng cuối</Typography>
      <Alert severity="info">
        Đối chiếu chính sách hiển thị với điều khoản đã ký trước khi duyệt. Khoản này là nghĩa vụ
        chung của phòng; không tự chia tiền cho từng hợp đồng. Nếu điều khoản khác chính sách hiện
        tại, cần xử lý đúng chính sách áp dụng trước khi xác nhận.
      </Alert>
      {query.isPending && <Typography>Đang đối chiếu tiền thuê và phí…</Typography>}
      {(error || query.error) && (
        <Alert severity="error">{error || contractError(query.error)}</Alert>
      )}
      {(Array.isArray(query.data) ? query.data : []).map((row) => (
        <Paper key={row.chargeCode} variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">
              {row.name} · {row.billingPeriod.slice(0, 7).split('-').reverse().join('/')}
            </Typography>
            {row.calculation && (
              <>
                <Typography>
                  Đơn giá tháng: {formatBillingDecimal(row.calculation.rate)} ₫
                  {row.calculation.residentCount != null ? '/người' : '/phòng'} ·{' '}
                  {row.calculation.partialMonth === 0
                    ? 'Tính đủ tháng theo chính sách'
                    : `Theo ${row.calculation.occupiedDays}/${row.calculation.periodDays} ngày phòng có người ở`}
                </Typography>
                {row.calculation.residentCount != null && (
                  <Typography>
                    Người thuê: {row.calculation.residentCount} · {row.calculation.personDays}{' '}
                    người-ngày trong kỳ.{' '}
                    {row.calculation.partialMonth === 1
                      ? 'Tính theo người-ngày thực tế.'
                      : 'Tính đủ tháng cho từng người.'}
                  </Typography>
                )}
                <Typography>
                  Giá trị lũy kế: {formatContractMoney(row.calculation.cumulativePricedAmount)} · Đã
                  ghi nhận: {formatContractMoney(row.calculation.alreadyPricedAmount)}
                </Typography>
                {!!row.calculation.approvedAdjustmentIds?.length && (
                  <Typography>
                    Đã đối chiếu phần giảm Owner duyệt:{' '}
                    {formatContractMoney(row.calculation.approvedReduction ?? '0')} · Giá theo số
                    ngày thực tế:{' '}
                    {formatContractMoney(
                      row.calculation.policyCalculatedAmount ??
                        row.calculation.cumulativePricedAmount,
                    )}
                  </Typography>
                )}
              </>
            )}
            <Typography>
              Phải thu thêm:{' '}
              {row.amount == null ? 'Chưa đủ dữ liệu' : formatContractMoney(row.amount)}
            </Typography>
            {row.missingInputs.map((code) => (
              <Alert severity="warning" key={code}>
                {missingBillingInput(code)}
              </Alert>
            ))}
            {row.existingReceivableId ? (
              <Alert severity="success">Đã ghi nhận trong sổ phải thu.</Alert>
            ) : (
              <>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={confirmed[row.chargeCode] === row.reference}
                      disabled={busy || row.amount == null || !!row.missingInputs.length}
                      onChange={(_, checked) =>
                        setConfirmed((c) => ({
                          ...c,
                          [row.chargeCode]: checked ? row.reference : '',
                        }))
                      }
                    />
                  }
                  label={`Tôi xác nhận chính sách ${row.name} áp dụng đúng điều khoản đã ký và chưa thu trùng`}
                />
                <Button
                  disabled={
                    busy ||
                    row.amount == null ||
                    !!row.missingInputs.length ||
                    confirmed[row.chargeCode] !== row.reference
                  }
                  onClick={() => void approve(row.chargeCode)}
                >
                  Duyệt {row.name}
                </Button>
              </>
            )}
          </Stack>
        </Paper>
      ))}
      <Button disabled={busy || query.isFetching} onClick={() => void query.refetch()}>
        Tải lại tiền thuê và phí
      </Button>
    </Stack>
  );
}
