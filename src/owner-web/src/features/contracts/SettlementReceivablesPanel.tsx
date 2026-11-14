import { MoneyField } from '../../components/common/MoneyField';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  contractError,
  formatContractMoney,
  mutationKeys,
  vnd,
  type ContractClient,
  type FinalInspection,
  type SettlementSummary,
} from '../../../../../packages/client-core/src/contracts';
import { SettlementBankPanel } from './SettlementBankPanel';
import { FinalUtilitiesPanel } from './FinalUtilitiesPanel';
import { FinalFixedChargesPanel } from './FinalFixedChargesPanel';
import { FinalChargeReviewPanel } from './FinalChargeReviewPanel';

export function SettlementReceivablesPanel({
  api,
  id,
  inspection,
  summary,
  saved,
}: {
  api: ContractClient;
  id: string;
  inspection: FinalInspection;
  summary: SettlementSummary;
  saved: () => Promise<void>;
}) {
  const query = useQuery({
    queryKey: ['settlement-receivables', id, summary.reference],
    queryFn: ({ signal }) => api.settlementReceivables(id, signal),
  });
  const [asset, setAsset] = useState(''),
    [amount, setAmount] = useState(''),
    [description, setDescription] = useState('');
  const [proofs, setProofs] = useState<string[]>([]),
    [chargeConfirmation, setChargeConfirmation] = useState<string | null>(null);
  const [target, setTarget] = useState(''),
    [offsetAmount, setOffsetAmount] = useState(''),
    [reason, setReason] = useState(''),
    [offsetConfirmation, setOffsetConfirmation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const lock = useRef(false);
  const data = query.data;
  const checked = !!data && chargeConfirmation === data.reference;
  const offsetChecked = !!data && offsetConfirmation === data.reference;
  const setChecked = (value: boolean) =>
    setChargeConfirmation(value ? (data?.reference ?? null) : null);
  const setOffsetChecked = (value: boolean) =>
    setOffsetConfirmation(value ? (data?.reference ?? null) : null);
  async function submit(kind: 'damage' | 'offset') {
    if (lock.current || !data) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (kind === 'damage') {
        const body = {
          expectedReference: data.reference,
          inspectionId: inspection.id,
          inspectionVersion: inspection.version,
          assetId: asset || null,
          amount: vnd(amount, true),
          description: description.trim(),
          evidenceIds: proofs,
          humanConfirmed: checked,
        };
        await api.approveDamageCharge(id, body, keys.get(kind, body));
        keys.confirmed(kind, body);
        setAmount('');
        setDescription('');
        setProofs([]);
        setChecked(false);
      } else {
        const body = {
          expectedReference: data.reference,
          receivableId: target.startsWith('charge:') ? target.slice(7) : null,
          invoiceId: target.startsWith('invoice:') ? target.slice(8) : null,
          amount: vnd(offsetAmount, true),
          reason: reason.trim(),
          humanConfirmed: offsetChecked,
        };
        await api.approveDepositOffset(id, body, keys.get(kind, body));
        keys.confirmed(kind, body);
        setOffsetAmount('');
        setReason('');
        setOffsetChecked(false);
        setTarget('');
      }
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
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Khoản phải thu & cấn trừ cọc</Typography>
        <Alert severity="info">
          Khoản phải thu giữ riêng với cọc. Thiệt hại có thể lớn hơn cọc; phần còn thiếu vẫn là nợ
          phòng sau bàn giao. Mỗi lần cấn trừ cần Owner duyệt đúng nguồn và khoản đích.
        </Alert>
        {query.isPending && <Typography>Đang tải sổ phải thu…</Typography>}
        {(error || query.error) && (
          <Alert severity="error">{error || contractError(query.error)}</Alert>
        )}
        {data && (
          <>
            <FinalFixedChargesPanel
              api={api}
              id={id}
              reference={data.reference}
              saved={async () => {
                await query.refetch();
                await saved();
              }}
            />
            <FinalUtilitiesPanel
              api={api}
              id={id}
              reference={data.reference}
              saved={async () => {
                await query.refetch();
                await saved();
              }}
            />
            <Typography>
              Cọc chưa dùng hoặc giữ cho hoàn tiền: {formatContractMoney(data.availableDeposit)}
            </Typography>
            <FinalChargeReviewPanel
              api={api}
              id={id}
              reference={data.reference}
              saved={async () => {
                await query.refetch();
                await saved();
              }}
            />
            {data.receivables.map((r) => (
              <Alert key={r.charge.id} severity={r.status === 'Paid' ? 'success' : 'warning'}>
                {r.charge.description} · Phải thu {formatContractMoney(r.charge.amount)} · Đã phân
                bổ {formatContractMoney(r.allocated)} · Còn nợ {formatContractMoney(r.outstanding)}
              </Alert>
            ))}
            {data.offsets.map((o) => (
              <Typography key={o.id} variant="body2">
                Đã cấn {formatContractMoney(o.amount)} · {o.reason}
              </Typography>
            ))}
            {summary.unresolvedItems.includes('final_charges_and_damage_policy_pending') && (
              <>
                <Typography variant="subtitle1">Ghi nhận thiệt hại theo biên bản</Typography>
                <TextField
                  select
                  label="Nguồn thiệt hại"
                  value={asset}
                  disabled={busy}
                  onChange={(e) => {
                    setAsset(e.target.value);
                    setChecked(false);
                  }}
                >
                  <MenuItem value="">Phòng</MenuItem>
                  {inspection.observed.assets.map((a) => (
                    <MenuItem key={a.id} value={a.id}>
                      {a.name}
                    </MenuItem>
                  ))}
                </TextField>
                <MoneyField
                  label="Số tiền phải thu thiệt hại (VND)"
                  value={amount}
                  disabled={busy}
                  onValueChange={(raw) => {
                    setAmount(raw);
                    setChecked(false);
                  }}
                />
                <TextField
                  label="Mô tả và căn cứ chi phí"
                  value={description}
                  disabled={busy}
                  multiline
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setChecked(false);
                  }}
                />
                {inspection.observed.evidenceIds.map((proof, i) => (
                  <FormControlLabel
                    key={proof}
                    control={
                      <Checkbox
                        disabled={busy}
                        checked={proofs.includes(proof)}
                        onChange={(_, selected) => {
                          setProofs((v) =>
                            selected ? [...v, proof] : v.filter((p) => p !== proof),
                          );
                          setChecked(false);
                        }}
                      />
                    }
                    label={`Dùng ảnh biên bản ${i + 1}`}
                  />
                ))}
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={checked}
                      disabled={busy}
                      onChange={(_, value) => setChecked(value)}
                    />
                  }
                  label="Tôi xác nhận thiệt hại, chứng từ và khoản này chưa được tính trên hóa đơn hoặc khoản phải thu khác"
                />
                <Button
                  disabled={busy || !checked || !amount || !description.trim() || !proofs.length}
                  onClick={() => void submit('damage')}
                >
                  Duyệt khoản phải thu thiệt hại
                </Button>
              </>
            )}
            <Typography variant="subtitle1">Duyệt cấn trừ từ cọc</Typography>
            <TextField
              select
              label="Khoản đích cấn trừ"
              value={target}
              disabled={busy}
              onChange={(e) => {
                setTarget(e.target.value);
                setOffsetChecked(false);
              }}
            >
              {data.receivables
                .filter((r) => r.status !== 'Paid')
                .map((r) => (
                  <MenuItem key={r.charge.id} value={`charge:${r.charge.id}`}>
                    {r.charge.description} · {formatContractMoney(r.outstanding)}
                  </MenuItem>
                ))}
              {(data.invoices ?? [])
                .filter((i) => !/^0(?:\.0+)?$/.test(i.outstanding))
                .map((i) => (
                  <MenuItem key={i.id} value={`invoice:${i.id}`}>
                    Hóa đơn kỳ {i.billingPeriod} · {formatContractMoney(i.outstanding)}
                  </MenuItem>
                ))}
            </TextField>
            <MoneyField
              label="Số tiền cấn trừ (VND)"
              value={offsetAmount}
              disabled={busy}
              onValueChange={(raw) => {
                setOffsetAmount(raw);
                setOffsetChecked(false);
              }}
            />
            <TextField
              label="Căn cứ duyệt cấn trừ"
              value={reason}
              disabled={busy}
              onChange={(e) => {
                setReason(e.target.value);
                setOffsetChecked(false);
              }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={offsetChecked}
                  disabled={busy}
                  onChange={(_, value) => setOffsetChecked(value)}
                />
              }
              label="Tôi xác nhận nguồn cọc, khoản đích và số tiền cấn trừ"
            />
            <Button
              disabled={busy || !offsetChecked || !target || !offsetAmount || !reason.trim()}
              onClick={() => void submit('offset')}
            >
              Duyệt cấn trừ
            </Button>
            <Button disabled={busy} onClick={() => void query.refetch()}>
              Tải lại sổ phải thu
            </Button>
            <SettlementBankPanel
              api={api}
              data={data}
              saved={async () => {
                await query.refetch();
                await saved();
              }}
            />
          </>
        )}
      </Stack>
    </Paper>
  );
}
