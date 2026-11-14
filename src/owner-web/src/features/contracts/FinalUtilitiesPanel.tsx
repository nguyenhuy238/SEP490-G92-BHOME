import { useRef, useState } from 'react';
import { Alert, Button, Checkbox, FormControlLabel, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import {
  contractError,
  displayContractDate,
  formatContractMoney,
  mutationKeys,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import {
  formatBillingDecimal,
  missingBillingInput,
} from '../../../../../packages/client-core/src/invoices';

const sourceLabels: Record<string, string> = {
  FinalInvoice: 'Hóa đơn đã phát hành',
  ConfirmedInitial: 'Mốc ban đầu đã xác nhận',
  SettlementReceivable: 'Khoản phải thu đã duyệt',
  AlreadyBilled: 'Tiêu thụ đã được ghi nhận',
};
export function FinalUtilitiesPanel({
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
    queryKey: ['final-utilities', id, reference],
    queryFn: ({ signal }) => api.finalUtilities(id, signal),
  });
  const [confirmed, setConfirmed] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const lock = useRef(false);
  async function approve(type: 'Electricity' | 'Water') {
    const row = query.data?.find((item) => item.utilityType === type);
    if (
      lock.current ||
      !row ||
      confirmed[type] !== row.reference ||
      row.missingInputs.length ||
      row.existingReceivableId ||
      row.amount == null
    )
      return;
    const body = {
      utilityType: type === 'Electricity' ? 0 : 1,
      expectedReference: row.reference,
      humanConfirmed: true,
    };
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.approveFinalUtility(id, body, keys.get(type, body));
      keys.confirmed(type, body);
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
      <Typography variant="subtitle1">Đối chiếu điện/nước chốt</Typography>
      <Alert severity="info">
        Chỉ thu phần từ mốc đã tính tiền tới chỉ số chốt. Biểu giá bậc thang và định mức miễn phí
        dùng chung vị trí của kỳ; không áp dụng lại từ đầu. Duyệt khoản phải thu chưa xác nhận đã
        nhận tiền.
      </Alert>
      {query.isPending && <Typography>Đang đối chiếu chỉ số và chính sách giá…</Typography>}
      {(error || query.error) && (
        <Alert severity="error">{error || contractError(query.error)}</Alert>
      )}
      {(Array.isArray(query.data) ? query.data : []).map((row) => {
        const name = row.utilityType === 'Electricity' ? 'Điện' : 'Nước';
        const checked = confirmed[row.utilityType] === row.reference;
        const blocked =
          row.missingInputs.length > 0 || row.amount == null || !!row.existingReceivableId;
        return (
          <Paper key={row.utilityType} variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">
                {name} · Kỳ {row.billingPeriod.slice(0, 7).split('-').reverse().join('/')}
              </Typography>
              <Typography>
                Mốc:{' '}
                {row.baseline
                  ? `${formatBillingDecimal(row.baseline.value)} · ${displayContractDate(row.baseline.date)} · ${sourceLabels[row.baseline.sourceKind] ?? 'Mốc có chứng từ'}`
                  : 'Chưa đủ chứng từ'}
              </Typography>
              <Typography>
                Chốt:{' '}
                {row.final
                  ? `${formatBillingDecimal(row.final.value)} · ${displayContractDate(row.final.date)}`
                  : 'Chưa xác nhận'}
              </Typography>
              <Typography>
                Đã ghi nhận trong kỳ: {formatBillingDecimal(row.alreadyBilledQuantity)} · Phần tăng
                thêm: {row.quantity == null ? 'Chờ đối chiếu' : formatBillingDecimal(row.quantity)}
              </Typography>
              {row.existingReceivableId ? (
                <Alert severity="success">
                  Đã ghi nhận khoản chốt. Xem số tiền và tình trạng thanh toán trong sổ phải thu.
                </Alert>
              ) : (
                <Typography>
                  Phải thu thêm:{' '}
                  {row.amount == null ? 'Chưa đủ dữ liệu' : formatContractMoney(row.amount)}
                </Typography>
              )}
              {row.missingInputs.map((code) => (
                <Alert key={code} severity="warning">
                  {missingBillingInput(code)}
                </Alert>
              ))}
              {!row.existingReceivableId && (
                <>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={checked}
                        disabled={busy || blocked}
                        onChange={(_, value) =>
                          setConfirmed((current) => ({
                            ...current,
                            [row.utilityType]: value ? row.reference : '',
                          }))
                        }
                      />
                    }
                    label={`Tôi xác nhận mốc đã tính tiền, chỉ số chốt và chính sách giá áp dụng cho ${name}`}
                  />
                  <Button
                    disabled={busy || blocked || !checked}
                    onClick={() => void approve(row.utilityType)}
                  >
                    Duyệt khoản chốt {name}
                  </Button>
                </>
              )}
            </Stack>
          </Paper>
        );
      })}
      <Button disabled={busy || query.isFetching} onClick={() => void query.refetch()}>
        Tải lại chỉ số và giá chốt
      </Button>
    </Stack>
  );
}
