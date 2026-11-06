import { useRef, useState } from 'react';
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

type Row = {
  key: string;
  assetId: string;
  amount: string;
  description: string;
  evidenceIds: string[];
};
export function DepositDeductionsPanel({
  api,
  id,
  summary,
  inspection,
  saved,
}: {
  api: ContractClient;
  id: string;
  summary: SettlementSummary;
  inspection: FinalInspection;
  saved: () => Promise<void>;
}) {
  const plan = summary.depositDeductions;
  const [rows, setRows] = useState<Row[]>(
    () =>
      plan?.items.map((i) => ({ ...i, assetId: i.assetId ?? '', key: crypto.randomUUID() })) ?? [],
  );
  const [reason, setReason] = useState(''),
    [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const lock = useRef(false);
  const allowed = [
    'deposit_deduction_refund_policy_required',
    'final_charges_and_damage_policy_pending',
    'deposit_deduction_reapproval_required',
  ];
  const canEdit =
    summary.calculation?.depositPositionConsistent === true &&
    [
      summary.calculation.depositAllocated,
      summary.calculation.depositRefunded,
      summary.calculation.depositReserved,
    ].every((v) => v !== null && /^0(?:\.0+)?$/.test(v)) &&
    summary.unresolvedItems.every((b) => allowed.includes(b));
  function change(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setChecked(false);
  }
  async function approve() {
    if (lock.current || !canEdit || !checked || !reason.trim()) return;
    let items;
    try {
      items = rows.map((r) => ({
        assetId: r.assetId || null,
        reasonCode: 'TenantDamage' as const,
        amount: vnd(r.amount, true),
        description: r.description.trim(),
        evidenceIds: r.evidenceIds,
      }));
      if (items.some((i) => !i.description || !i.evidenceIds.length))
        throw new Error('Mỗi khoản cần mô tả và ảnh biên bản.');
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const body = {
      expectedVersion: plan?.version ?? 0,
      expectedReference: summary.reference,
      reason: reason.trim(),
      humanConfirmed: checked,
      items,
    };
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.approveDepositDeductions(id, body, keys.get('deposit-deductions', body));
      keys.confirmed('deposit-deductions', body);
      setChecked(false);
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
        <Typography variant="h6">Quyết định khấu trừ cọc do thiệt hại</Typography>
        <Alert severity="info">
          Owner đối chiếu thiệt hại và ảnh trong biên bản, chỉ nhập khoản chưa tính trên hóa đơn.
          Không tự sinh phí phạt hoặc chi phí bảo trì.
        </Alert>
        {plan && (
          <Typography>
            Quyết định phiên bản {plan.version} · Đã duyệt: {formatContractMoney(plan.total)} ·{' '}
            {plan.reason}
          </Typography>
        )}
        {!canEdit && (
          <Alert severity="warning">
            Chờ xử lý nghĩa vụ hoặc khoản hoàn đang giữ chỗ. Không sửa quyết định sau khi đã hoàn
            tiền.
          </Alert>
        )}
        {rows.map((row, index) => (
          <Stack key={row.key} spacing={1}>
            <TextField
              select
              label={`Phạm vi thiệt hại ${index + 1}`}
              value={row.assetId}
              disabled={busy || !canEdit}
              onChange={(e) => change(row.key, { assetId: e.target.value })}
            >
              <MenuItem value="">Phòng</MenuItem>
              {inspection.observed.assets.map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  {a.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={`Số tiền khấu trừ ${index + 1} (VND)`}
              value={row.amount}
              disabled={busy || !canEdit}
              onChange={(e) => change(row.key, { amount: e.target.value })}
            />
            <TextField
              label={`Mô tả thiệt hại ${index + 1}`}
              value={row.description}
              disabled={busy || !canEdit}
              onChange={(e) => change(row.key, { description: e.target.value })}
              multiline
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
            {inspection.observed.evidenceIds.map((proof, n) => (
              <FormControlLabel
                key={proof}
                label={`Khoản ${index + 1}: dùng ảnh biên bản ${n + 1}`}
                control={
                  <Checkbox
                    checked={row.evidenceIds.includes(proof)}
                    disabled={busy || !canEdit}
                    onChange={(e) =>
                      change(row.key, {
                        evidenceIds: e.target.checked
                          ? [...row.evidenceIds, proof]
                          : row.evidenceIds.filter((p) => p !== proof),
                      })
                    }
                  />
                }
              />
            ))}
            <Button
              disabled={busy || !canEdit}
              onClick={() => {
                setRows((current) => current.filter((r) => r.key !== row.key));
                setChecked(false);
              }}
            >
              Bỏ khoản {index + 1}
            </Button>
          </Stack>
        ))}
        <Button
          disabled={busy || !canEdit || rows.length >= 20}
          onClick={() => {
            setRows((current) => [
              ...current,
              {
                key: crypto.randomUUID(),
                assetId: '',
                amount: '',
                description: '',
                evidenceIds: [],
              },
            ]);
            setChecked(false);
          }}
        >
          Thêm khoản thiệt hại
        </Button>
        {!rows.length && (
          <Typography>
            Không ghi khoản khấu trừ. Owner vẫn cần ghi căn cứ và xác nhận quyết định này.
          </Typography>
        )}
        <TextField
          label="Căn cứ quyết định khấu trừ"
          value={reason}
          disabled={busy || !canEdit}
          onChange={(e) => {
            setReason(e.target.value);
            setChecked(false);
          }}
          multiline
          slotProps={{ htmlInput: { maxLength: 2000 } }}
        />
        <FormControlLabel
          label="Tôi đã đối chiếu thiệt hại, chứng từ và xác nhận khoản này chưa tính trên hóa đơn trước khi duyệt khấu trừ"
          control={
            <Checkbox
              disabled={busy || !canEdit}
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
          }
        />
        <Button
          disabled={busy || !canEdit || !checked || !reason.trim()}
          onClick={() => void approve()}
        >
          Duyệt quyết định khấu trừ
        </Button>
        {!!error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Paper>
  );
}
