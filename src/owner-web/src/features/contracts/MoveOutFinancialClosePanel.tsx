import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
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
  type ContractClient,
  type SettlementChargeReviewPreview,
  type SettlementReceivables,
} from '../../../../../packages/client-core/src/contracts';
import type { RefundSource } from '../../../../../packages/client-core/src/refunds';
import { ConfirmActionButton } from '../../components/common/ConfirmActionButton';

export interface MoveOutPricingIssue {
  key: string;
  label: string;
  charged: boolean;
}

export interface MoveOutFinancialCloseResult {
  contractId: string;
  reference: string;
  offsetIds: string[];
  refundRequestId: string | null;
  refundStatus: string | null;
  outstandingAmount: string;
  remainingDeposit: string;
}

function wholeVnd(value: string | null | undefined): bigint | null {
  return value != null && /^\d+(?:\.0+)?$/.test(value) ? BigInt(value.split('.')[0]) : null;
}

/**
 * Financial closure is an explicit authenticated Owner decision. The API (not
 * the browser) is responsible for allocating money and creating a real
 * REQUESTED refund only when the verified ledger and recipient are eligible.
 * This is deliberately separate from Staff inspection and physical move-out.
 */
export function MoveOutFinancialClosePanel({
  api,
  id,
  data,
  issues,
  saved,
}: {
  api: ContractClient;
  id: string;
  data: SettlementReceivables;
  issues: MoveOutPricingIssue[];
  saved: () => Promise<void>;
}) {
  const source = useQuery({
    queryKey: ['move-out-financial-close-refund-source', id, data.reference],
    queryFn: ({ signal }) =>
      api.transport<RefundSource>(`/api/v1/contracts/${encodeURIComponent(id)}/deposit-refunds`, {
        signal,
      }),
    retry: false,
  });
  const chargeReview = useQuery({
    queryKey: ['move-out-financial-close-review', id, data.reference],
    queryFn: ({ signal }) => api.settlementChargeReview(id, signal),
    retry: false,
  });
  const beneficiaries = Array.isArray(source.data?.beneficiaries) ? source.data.beneficiaries : [];
  const validReview =
    chargeReview.data && Array.isArray(chargeReview.data.missingInputs)
      ? (chargeReview.data as SettlementChargeReviewPreview)
      : null;
  const [waived, setWaived] = useState<string[]>([]);
  const [beneficiary, setBeneficiary] = useState('');
  const [beneficiaryVerified, setBeneficiaryVerified] = useState(false);
  const [reason, setReason] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<MoveOutFinancialCloseResult | null>(null);
  const lock = useRef(false);
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));

  const openIssues = issues.filter((item) => !item.charged);
  const undecided = openIssues.filter((item) => !waived.includes(item.key));
  const sourceAvailable = wholeVnd(source.data?.availableAmount);
  const availableForOffsets = wholeVnd(data.availableDeposit);
  const outstandingForDamage = data.receivables
    .filter((item) => item.charge.kind === 'TenantDamage')
    .map((item) => wholeVnd(item.outstanding));
  const damagesOutstanding = outstandingForDamage.every((item) => item !== null)
    ? outstandingForDamage.reduce<bigint>((total, value) => total + (value ?? 0n), 0n)
    : null;
  // A pending damage balance is resolved by this action itself; every other
  // refund-source blocker still requires separate resolution on the server.
  const unresolvedBlockers = (source.data?.blockers ?? []).filter(
    (blocker) => blocker !== 'settlement_receivable_outstanding' || damagesOutstanding === 0n,
  );
  const existingRefundRequest = (source.data?.requests ?? []).some((request) =>
    ['REQUESTED', 'APPROVED', 'COMPLETED'].includes(request.status),
  );
  const hasLegacyDeductionPlan = source.data?.depositDeductions != null;
  const sourceValid =
    Array.isArray(source.data?.beneficiaries) &&
    typeof source.data?.financialReference === 'string' &&
    sourceAvailable !== null &&
    availableForOffsets !== null &&
    damagesOutstanding !== null;
  const projectedRefund =
    sourceValid &&
    sourceAvailable !== null &&
    availableForOffsets !== null &&
    damagesOutstanding !== null
      ? sourceAvailable -
        (availableForOffsets < damagesOutstanding ? availableForOffsets : damagesOutstanding)
      : null;
  // Do not demand a refund beneficiary when the entire remaining deposit will
  // be applied to the confirmed damage and there will be no refund request.
  const refundPotentiallyPositive = projectedRefund !== null && projectedRefund > 0n;
  const chargeReviewReady =
    !!validReview &&
    validReview.missingInputs.length === 0 &&
    ((data.noAdditionalCharges === true && data.receivables.length === 0) ||
      (validReview.isCurrent && !!validReview.review?.id));
  const canClose =
    !busy &&
    !source.isFetching &&
    !chargeReview.isFetching &&
    !source.error &&
    !chargeReview.error &&
    unresolvedBlockers.length === 0 &&
    !existingRefundRequest &&
    !hasLegacyDeductionPlan &&
    sourceValid &&
    chargeReviewReady &&
    !undecided.length &&
    !!reason.trim() &&
    consent &&
    (!refundPotentiallyPositive || (!!beneficiary && beneficiaryVerified));

  async function closeFinancials() {
    if (!canClose || lock.current || !validReview) return;
    const body = {
      expectedReference: data.reference,
      expectedChargeReviewId:
        data.noAdditionalCharges === true ? null : (validReview.review?.id ?? null),
      beneficiaryResidentId: beneficiary || null,
      beneficiaryVerified: !!beneficiary && beneficiaryVerified,
      waivedIssueKeys: openIssues
        .filter((item) => waived.includes(item.key))
        .map((item) => item.key),
      reason: reason.trim(),
      humanConfirmed: true,
    };
    lock.current = true;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const outcome = await api.mutate<MoveOutFinancialCloseResult>(
        id,
        'move-out/receivables/final-close',
        body,
        keys.get('final-close', body),
      );
      if (!outcome || outcome.contractId !== id || !Array.isArray(outcome.offsetIds))
        throw new Error('Máy chủ chưa xác nhận kết quả chốt quyết toán.');
      keys.confirmed('final-close', body);
      setResult(outcome);
      await Promise.all([source.refetch(), chargeReview.refetch()]);
      await saved();
    } catch (cause) {
      setError(contractError(cause));
      if ((cause as { status?: number })?.status === 409) {
        setConsent(false);
        await Promise.all([source.refetch(), chargeReview.refetch()]);
        await saved();
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Chốt quyết toán, tự cấn trừ cọc và lập yêu cầu hoàn
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Chỉ thực hiện sau khi Owner xác nhận mọi khoản thu và lý do miễn thu của từng mục còn vấn
          đề. Máy chủ tự cấn trừ từ cọc đã xác minh; nếu đủ điều kiện và còn dư, tạo đơn hoàn tiền ở
          trạng thái chờ duyệt. Không tự chuyển tiền hoặc phát sinh khoản nợ trùng.
        </Typography>
        {!chargeReviewReady && (
          <Alert severity="warning">
            Cần xác nhận danh sách khoản thu cuối kỳ ở phía trên trước khi chốt tài chính.
          </Alert>
        )}
        {source.error && <Alert severity="error">{contractError(source.error)}</Alert>}
        {chargeReview.error && <Alert severity="error">{contractError(chargeReview.error)}</Alert>}
        {(unresolvedBlockers.length > 0 || hasLegacyDeductionPlan) && (
          <Alert severity="warning">
            Nguồn tiền cọc còn điều kiện chưa xử lý. Hãy hoàn tất đối soát các nghĩa vụ và khấu trừ
            hiện có trước khi chốt quyết toán.
          </Alert>
        )}
        {existingRefundRequest && (
          <Alert severity="warning">
            Đã có yêu cầu hoàn cọc đang chờ xử lý hoặc đã hoàn tất. Không thể tạo thêm từ bước chốt
            quyết toán này.
          </Alert>
        )}
        {sourceValid && source.data && (
          <Typography variant="body2">
            Cọc hiện có thể đối chiếu: {formatContractMoney(source.data.availableAmount ?? '0')}
            {projectedRefund !== null && (
              <>
                {' '}
                · Dự kiến còn dư sau cấn trừ thiệt hại:{' '}
                {formatContractMoney((projectedRefund > 0n ? projectedRefund : 0n).toString())}
              </>
            )}
          </Typography>
        )}
        {openIssues.length > 0 && (
          <>
            <Typography variant="subtitle2">Hạng mục chưa được duyệt mức bồi thường</Typography>
            {openIssues.map((item) => (
              <FormControlLabel
                key={item.key}
                control={
                  <Checkbox
                    checked={waived.includes(item.key)}
                    disabled={busy}
                    onChange={(_, value) => {
                      setWaived((current) =>
                        value ? [...current, item.key] : current.filter((key) => key !== item.key),
                      );
                      setConsent(false);
                    }}
                  />
                }
                label={`Không thu bồi thường: ${item.label}`}
              />
            ))}
            {!!undecided.length && (
              <Alert severity="warning">
                Còn {undecided.length} hạng mục cần nhập giá bồi thường hoặc xác nhận miễn thu.
              </Alert>
            )}
          </>
        )}
        {beneficiaries.length > 0 && (
          <>
            <TextField
              select
              label="Người nhận hoàn cọc theo thỏa thuận"
              value={beneficiary}
              disabled={busy}
              onChange={(event) => {
                setBeneficiary(event.target.value);
                setBeneficiaryVerified(false);
                setConsent(false);
              }}
            >
              <MenuItem value="">Không chọn nếu chỉ cấn trừ, không có khoản dư</MenuItem>
              {beneficiaries.map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.label}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              control={
                <Checkbox
                  checked={beneficiaryVerified}
                  disabled={busy || !beneficiary}
                  onChange={(_, checked) => {
                    setBeneficiaryVerified(checked);
                    setConsent(false);
                  }}
                />
              }
              label="Tôi đã đối chiếu người nhận hoàn cọc với thỏa thuận và thông tin xác minh"
            />
          </>
        )}
        <TextField
          label="Lý do chốt quyết toán / căn cứ miễn thu"
          value={reason}
          disabled={busy}
          multiline
          minRows={2}
          onChange={(event) => {
            setReason(event.target.value.slice(0, 2000));
            setConsent(false);
          }}
          slotProps={{ htmlInput: { maxLength: 2000 } }}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={consent}
              disabled={busy}
              onChange={(_, checked) => setConsent(checked)}
            />
          }
          label="Tôi đã xác nhận đầy đủ mức bồi thường, phần không thu, tiền cọc và đồng ý tự tạo yêu cầu hoàn khi đủ điều kiện"
        />
        {!!error && <Alert severity="error">{error}</Alert>}
        {result && (
          <Alert severity={result.refundRequestId ? 'success' : 'info'}>
            Đã xác nhận {result.offsetIds.length} khoản cấn trừ. Còn phải thu:{' '}
            {formatContractMoney(result.outstandingAmount)} · Cọc còn lại:{' '}
            {formatContractMoney(result.remainingDeposit)}.{' '}
            {result.refundRequestId
              ? 'Đã tạo đơn hoàn cọc, đang chờ Owner duyệt; chưa chuyển tiền.'
              : 'Chưa có đơn hoàn cọc được tạo; đối chiếu nghĩa vụ và điều kiện nguồn hoàn.'}
          </Alert>
        )}
        <ConfirmActionButton
          title="Chốt quyết toán trả phòng"
          description="Máy chủ sẽ đối chiếu lại số liệu, cấn trừ cọc theo các khoản đã duyệt và chỉ tạo yêu cầu hoàn nếu còn dư đủ điều kiện. Đây không phải xác nhận đã chuyển tiền."
          confirmationKey={JSON.stringify([
            data.reference,
            validReview?.review?.id,
            beneficiary,
            beneficiaryVerified,
            waived,
            reason,
            consent,
          ])}
          disabled={!canClose}
          onConfirm={closeFinancials}
        >
          Chốt quyết toán và xử lý tiền cọc
        </ConfirmActionButton>
      </Stack>
    </Paper>
  );
}
