import { TextField } from '../../components/common/ValidatedForm';
import { ConfirmActionButton } from '../../components/common/ConfirmActionButton';
import { MoneyField } from '../../components/common/MoneyField';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
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
import { PrivateEvidenceViewer } from '../../components/common/PrivateEvidenceViewer';
import { FinalUtilitiesPanel } from './FinalUtilitiesPanel';
import { FinalFixedChargesPanel } from './FinalFixedChargesPanel';
import { FinalChargeReviewPanel } from './FinalChargeReviewPanel';
import { offsetAmountError } from './termination';
import { MoveOutFinancialClosePanel, type MoveOutPricingIssue } from './MoveOutFinancialClosePanel';

const roomCheckNames: Record<string, string> = {
  walls_ceiling_floor: 'Tường, trần và sàn',
  doors_windows_locks: 'Cửa, cửa sổ và khóa',
  electrical_lighting_outlets: 'Đèn, công tắc và ổ điện',
  water_plumbing_drainage: 'Cấp nước, vòi và thoát nước',
  bathroom_toilet: 'Nhà vệ sinh và thiết bị vệ sinh',
  cleanliness: 'Vệ sinh và hiện trạng phòng',
  safety_equipment: 'Thiết bị an toàn',
};

function assetHasDamage(
  asset: FinalInspection['observed']['assets'][number],
  inspection: FinalInspection,
) {
  const prior = inspection.baseline?.assets.find((item) => item.id === asset.id);
  // Match the server's HandoverChecklist.NewDamageAgainstBaseline. Existing
  // damage at move-in is not a new financial liability for this Tenant.
  return (
    !!asset.checked &&
    prior?.handedOverQuantity != null &&
    ((asset.missingQuantity != null && asset.missingQuantity > (prior.missingQuantity ?? 0)) ||
      (asset.damagedQuantity != null &&
        prior.damagedQuantity != null &&
        asset.damagedQuantity > prior.damagedQuantity) ||
      (asset.handedOverQuantity != null &&
        prior.handedOverQuantity != null &&
        asset.handedOverQuantity < prior.handedOverQuantity))
  );
}

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
  const damageBalances =
    data?.receivables.filter((item) => item.charge.kind === 'TenantDamage') ?? [];
  const damageOutstanding = damageBalances.every((item) => /^\d+$/.test(item.outstanding))
    ? damageBalances.reduce((sum, item) => sum + BigInt(item.outstanding), 0n).toString()
    : null;
  const damagedAssets = inspection.observed.assets.filter((item) =>
    assetHasDamage(item, inspection),
  );
  const roomIssues = (inspection.observed.roomChecks ?? []).filter(
    (check) => check.status === 'Issue',
  );
  const baselineRoomKeys = inspection.baseline?.accessItems?.find(
    (item) => item.type === 'RoomKey',
  )?.quantity;
  const returnedRoomKeys = inspection.observed.accessItems?.find(
    (item) => item.type === 'RoomKey',
  )?.quantity;
  const missingRoomKeys =
    baselineRoomKeys !== undefined &&
    returnedRoomKeys !== undefined &&
    returnedRoomKeys < baselineRoomKeys;
  const pricedRoomKeys = data?.receivables.find(
    (entry) => entry.charge.roomCheckCode === 'access_room_key',
  );
  const legacyRoomInspection = !inspection.observed.roomChecks?.length;
  const selectedRoomCheckCode = asset.startsWith('room-check:')
    ? asset.slice('room-check:'.length)
    : null;
  const selectedAsset = damagedAssets.find((item) => item.id === asset);
  const selectedRoomCheck = roomIssues.find((check) => check.code === selectedRoomCheckCode);
  const selectedMissingKeys = selectedRoomCheckCode === 'access_room_key' && missingRoomKeys;
  const availableProofs = selectedRoomCheck
    ? (selectedRoomCheck.evidenceIds ?? [])
    : selectedMissingKeys
      ? (inspection.observed.keyEvidenceIds ?? [])
      : selectedAsset
        ? (selectedAsset.evidenceIds ?? [])
        : legacyRoomInspection
          ? inspection.observed.evidenceIds
          : [];
  const canPriceSelection =
    !!selectedAsset ||
    (!!selectedRoomCheck && data?.roomCheckChargesSupported === true) ||
    (selectedMissingKeys && data?.roomCheckChargesSupported === true) ||
    (legacyRoomInspection && !asset);
  const closingIssues: MoveOutPricingIssue[] = [
    ...damagedAssets.map((item) => ({
      key: `asset:${item.id}`,
      label: item.name,
      charged: data?.receivables.some((entry) => entry.charge.assetId === item.id) ?? false,
    })),
    ...roomIssues.map((item) => ({
      key: `room:${item.code}`,
      label: roomCheckNames[item.code] ?? item.code,
      charged: data?.receivables.some((entry) => entry.charge.roomCheckCode === item.code) ?? false,
    })),
    ...(missingRoomKeys
      ? [{ key: 'room:access_room_key', label: 'Chìa khóa trả thiếu', charged: !!pricedRoomKeys }]
      : []),
  ];
  const targetOutstanding = target.startsWith('charge:')
    ? data?.receivables.find((r) => r.charge.id === target.slice(7))?.outstanding
    : data?.invoices?.find((i) => i.id === target.slice(8))?.outstanding;
  const offsetError = data
    ? offsetAmountError(offsetAmount, data.availableDeposit, targetOutstanding ?? null)
    : null;
  const checked = !!data && chargeConfirmation === data.reference;
  const offsetChecked = !!data && offsetConfirmation === data.reference;
  const setChecked = (value: boolean) =>
    setChargeConfirmation(value ? (data?.reference ?? null) : null);
  const setOffsetChecked = (value: boolean) =>
    setOffsetConfirmation(value ? (data?.reference ?? null) : null);
  async function submit(kind: 'damage' | 'offset') {
    if (
      lock.current ||
      query.isFetching ||
      !!query.error ||
      !data ||
      (kind === 'offset' && offsetError)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (kind === 'damage') {
        const body = {
          expectedReference: data.reference,
          inspectionId: inspection.id,
          inspectionVersion: inspection.version,
          assetId: selectedRoomCheckCode ? null : asset || null,
          ...(selectedRoomCheckCode ? { roomCheckCode: selectedRoomCheckCode } : {}),
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
        setAsset('');
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
      if ((e as { status?: number })?.status === 409) {
        setChecked(false);
        setOffsetChecked(false);
        await query.refetch();
        await saved();
      }
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
            {damageOutstanding !== null && damageOutstanding !== '0' && (
              <Alert severity="warning">
                Bồi thường còn phải thu sau các khoản đã thanh toán/cấn trừ:{' '}
                <strong>{formatContractMoney(damageOutstanding)}</strong>. Khoản này đã nằm trong sổ
                phải thu của Tenant và có thể đối soát chuyển khoản phía dưới; không lập thêm khoản
                nợ thứ hai cho cùng thiệt hại.
              </Alert>
            )}
            {data.offsets.map((o) => (
              <Typography key={o.id} variant="body2">
                Đã cấn {formatContractMoney(o.amount)} · {o.reason}
              </Typography>
            ))}
            {summary.unresolvedItems.includes('final_charges_and_damage_policy_pending') && (
              <>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Định giá từng hạng mục hỏng, thiếu
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Owner xem kết quả Staff đã ghi nhận, xác nhận số tiền và ảnh của từng hạng mục.
                  Khoản được duyệt sẽ xuất hiện trên sổ phải thu của Tenant; không tạo thêm nghĩa vụ
                  trùng với hóa đơn.
                </Typography>
                {!damagedAssets.length &&
                  !roomIssues.length &&
                  !missingRoomKeys &&
                  !legacyRoomInspection && (
                    <Alert severity="success">
                      Không có tài sản hoặc hạng mục phòng ghi nhận hư hỏng, thiếu cần định giá.
                    </Alert>
                  )}
                {(!!roomIssues.length || missingRoomKeys) &&
                  data.roomCheckChargesSupported !== true && (
                    <Alert severity="warning">
                      API hiện tại chưa hỗ trợ định giá độc lập từng hạng mục phòng. Cần cập nhật
                      Backend để tránh ghi nhầm nhiều thiệt hại thành một khoản chung.
                    </Alert>
                  )}
                {damagedAssets.map((item) => {
                  const charged = data.receivables.find(
                    (entry) => entry.charge.assetId === item.id,
                  );
                  return (
                    <Box key={item.id} sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}>
                      <Stack
                        direction="row"
                        spacing={1}
                        useFlexGap
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {item.name}
                        </Typography>
                        <Chip
                          size="small"
                          color={charged ? 'success' : 'warning'}
                          label={
                            charged
                              ? `Đã duyệt ${formatContractMoney(charged.charge.amount)}`
                              : 'Cần định giá'
                          }
                        />
                        {!charged && (
                          <Button
                            size="small"
                            onClick={() => {
                              setAsset(item.id);
                              setDescription(item.notes?.trim() || `Bồi thường ${item.name}`);
                              setProofs([]);
                              setChecked(false);
                            }}
                          >
                            Nhập giá
                          </Button>
                        )}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        Thiếu {item.missingQuantity ?? 0} · Hỏng {item.damagedQuantity ?? 0} ·{' '}
                        {item.notes?.trim() || 'Xem ảnh kiểm kê Staff'}
                      </Typography>
                    </Box>
                  );
                })}
                {roomIssues.map((item) => {
                  const charged = data.receivables.find(
                    (entry) =>
                      entry.charge.roomCheckCode === item.code ||
                      entry.charge.sourceKey.endsWith(`:${item.code}`),
                  );
                  return (
                    <Box key={item.code} sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}>
                      <Stack
                        direction="row"
                        spacing={1}
                        useFlexGap
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {roomCheckNames[item.code] ?? item.code}
                        </Typography>
                        <Chip
                          size="small"
                          color={charged ? 'success' : 'warning'}
                          label={
                            charged
                              ? `Đã duyệt ${formatContractMoney(charged.charge.amount)}`
                              : 'Cần xem xét'
                          }
                        />
                        {!charged && data.roomCheckChargesSupported === true && (
                          <Button
                            size="small"
                            onClick={() => {
                              setAsset(`room-check:${item.code}`);
                              setDescription(
                                item.notes?.trim() ||
                                  `Bồi thường ${roomCheckNames[item.code] ?? item.code}`,
                              );
                              setProofs([]);
                              setChecked(false);
                            }}
                          >
                            Nhập giá
                          </Button>
                        )}
                      </Stack>
                      {!!item.notes?.trim() && (
                        <Typography variant="caption" color="text.secondary">
                          {item.notes}
                        </Typography>
                      )}
                    </Box>
                  );
                })}
                {missingRoomKeys && (
                  <Box sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}>
                    <Stack
                      direction="row"
                      spacing={1}
                      useFlexGap
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        Chìa khóa trả thiếu
                      </Typography>
                      <Chip
                        size="small"
                        color={pricedRoomKeys ? 'success' : 'warning'}
                        label={
                          pricedRoomKeys
                            ? `Đã duyệt ${formatContractMoney(pricedRoomKeys.charge.amount)}`
                            : 'Cần định giá'
                        }
                      />
                      {!pricedRoomKeys &&
                        data.roomCheckChargesSupported === true &&
                        !!inspection.observed.keyEvidenceIds?.length && (
                          <Button
                            size="small"
                            onClick={() => {
                              setAsset('room-check:access_room_key');
                              setDescription(
                                `Bồi thường ${baselineRoomKeys! - returnedRoomKeys!} chìa khóa chưa trả`,
                              );
                              setProofs([]);
                              setChecked(false);
                            }}
                          >
                            Nhập giá
                          </Button>
                        )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      Bàn giao {baselineRoomKeys} · Nhận lại {returnedRoomKeys}. Cần ảnh chìa khóa
                      riêng để duyệt giá.
                    </Typography>
                  </Box>
                )}
                <TextField
                  select
                  label="Nguồn thiệt hại"
                  value={asset}
                  disabled={busy}
                  onChange={(e) => {
                    setAsset(e.target.value);
                    setProofs([]);
                    setChecked(false);
                  }}
                >
                  <MenuItem value="">
                    {legacyRoomInspection ? 'Phòng (biên bản cũ)' : 'Chọn hạng mục cần định giá'}
                  </MenuItem>
                  {damagedAssets.map((a) => (
                    <MenuItem key={a.id} value={a.id}>
                      {a.name} · hư hỏng/thiếu
                    </MenuItem>
                  ))}
                  {data.roomCheckChargesSupported === true &&
                    roomIssues.map((check) => (
                      <MenuItem key={check.code} value={`room-check:${check.code}`}>
                        {roomCheckNames[check.code] ?? check.code} · có vấn đề
                      </MenuItem>
                    ))}
                  {data.roomCheckChargesSupported === true &&
                    missingRoomKeys &&
                    !!inspection.observed.keyEvidenceIds?.length && (
                      <MenuItem value="room-check:access_room_key">Chìa khóa trả thiếu</MenuItem>
                    )}
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
                {availableProofs.map((proof, i) => (
                  <Stack
                    key={proof}
                    direction={{ xs: 'column', sm: 'row' }}
                    sx={{ alignItems: { sm: 'center' }, gap: 1 }}
                  >
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
                    <PrivateEvidenceViewer
                      label={`ảnh biên bản ${i + 1}`}
                      filename={`bien-ban-thiet-hai-${i + 1}.jpg`}
                      fetchBlob={(signal) => api.evidence(id, proof, signal)}
                      errorMessage={contractError}
                    />
                  </Stack>
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
                <ConfirmActionButton
                  title="Duyệt bồi thường"
                  description={`Ghi nhận ${amount ? formatContractMoney(amount) : 'chưa nhập số tiền'} cho ${description}. Kiểm tra khoản bồi thường bảo trì liên quan để tránh thu trùng.`}
                  confirmationKey={JSON.stringify([
                    data.reference,
                    asset,
                    amount,
                    description,
                    proofs,
                    checked,
                  ])}
                  disabled={
                    busy ||
                    query.isFetching ||
                    !!query.error ||
                    !checked ||
                    !canPriceSelection ||
                    !amount ||
                    !description.trim() ||
                    !proofs.length
                  }
                  onConfirm={() => submit('damage')}
                >
                  Duyệt khoản phải thu thiệt hại
                </ConfirmActionButton>
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
              error={!!offsetError}
              helperText={offsetError}
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
            <ConfirmActionButton
              title="Duyệt sử dụng tiền cọc"
              description={`Dùng ${offsetAmount ? formatContractMoney(offsetAmount) : 'chưa nhập số tiền'} từ cọc để thanh toán khoản đích đã chọn. Căn cứ: ${reason}.`}
              confirmationKey={JSON.stringify([
                data.reference,
                target,
                offsetAmount,
                reason,
                offsetChecked,
              ])}
              disabled={
                busy ||
                query.isFetching ||
                !!query.error ||
                query.isFetching ||
                !!query.error ||
                !!offsetError ||
                !offsetChecked ||
                !target ||
                !offsetAmount ||
                !reason.trim()
              }
              onConfirm={() => submit('offset')}
            >
              Duyệt cấn trừ
            </ConfirmActionButton>
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
            {data.roomCheckChargesSupported === true && (
              <MoveOutFinancialClosePanel
                api={api}
                id={id}
                data={data}
                issues={closingIssues}
                saved={async () => {
                  await query.refetch();
                  await saved();
                }}
              />
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}
