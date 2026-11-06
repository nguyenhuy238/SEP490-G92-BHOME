import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  contractError,
  displayContractDate,
  formatContractMoney,
  localSchedule,
  mutationKeys,
  type ContractClient,
  type ContractView,
  type MoveOut,
} from '../../../../../packages/client-core/src/contracts';
import {
  settlementBlocker,
  useContractLifecycle,
} from '../../../../../packages/client-core/src/useContractLifecycle';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { signedVnd } from '../../../../../packages/client-core/src/adjustments';
import { ChartCard } from '../../components/common/PortalUI';
import { RefundPanel } from '../payments/RefundPanel';

export function ContractLifecyclePanel({
  api,
  contract,
  moveOut,
  onChanged,
}: {
  api: ContractClient;
  contract: ContractView;
  moveOut: MoveOut;
  onChanged: () => void;
}) {
  const q = useContractLifecycle(api, contract.id, 'Owner');
  const staff = useQuery({
    queryKey: ['inspection-staff', contract.locationId],
    queryFn: ({ signal }) => api.inspectionStaff(contract.locationId, signal),
    enabled: moveOut.status === 'Approved',
  });
  const [reason, setReason] = useState(''),
    [schedule, setSchedule] = useState(''),
    [assignee, setAssignee] = useState('');
  const [reviewedReference, setReviewedReference] = useState<string | null>(null),
    [noChargesInspection, setNoChargesInspection] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const lock = useRef(false);
  async function save(operation: string, body: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.mutate(contract.id, operation, body, keys.get(operation, body));
      keys.confirmed(operation, body);
      setReviewedReference(null);
      setNoChargesInspection(null);
      setReason('');
      setNotice('Đã lưu tại máy chủ.');
      q.reload();
      onChanged();
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const inspection = q.inspections[0],
    summary = q.summary;
  const inspectionKey = inspection ? `${contract.id}:${inspection.id}:${inspection.version}` : null;
  const noCharges = !!inspectionKey && noChargesInspection === inspectionKey;
  const checked = !!summary && reviewedReference === summary.reference;
  const money = (v: string | null) => (v === null ? 'Chờ xác minh' : formatContractMoney(v));
  return (
    <ChartCard title="Kiểm tra & quyết toán trả phòng">
      <Stack spacing={2}>
        <Button disabled={busy || q.loading} onClick={q.reload}>
          Tải lại dữ liệu quyết toán
        </Button>
        {q.loading && <Typography>Đang đối chiếu dữ liệu…</Typography>}
        {!!(error || q.error) && <Alert severity="error">{error || q.error}</Alert>}
        {!!notice && <Alert severity="success">{notice}</Alert>}
        {moveOut.status === 'Approved' && (
          <>
            <TextField
              label="Lịch kiểm tra (giờ Việt Nam)"
              type="datetime-local"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              select
              label="Staff kiểm tra"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <MenuItem value="">Chưa phân công</MenuItem>
              {(staff.data ?? []).map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.label}
                </MenuItem>
              ))}
            </TextField>
            {staff.error && (
              <Alert severity="error">
                {contractError(staff.error)}
                <Button onClick={() => void staff.refetch()}>Tải lại Staff</Button>
              </Alert>
            )}
            <Button
              disabled={busy || !schedule || !!staff.error || staff.isFetching}
              onClick={() => {
                try {
                  void save('move-out/schedule', {
                    scheduledAt: localSchedule(schedule),
                    staffUserId: assignee || null,
                    expectedVersion: moveOut.version,
                  });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Lưu lịch & phân công
            </Button>
            {!assignee && (
              <Alert severity="info">
                Lịch chưa có người phụ trách. Chọn Staff được phân công Location để giao việc.
              </Alert>
            )}
          </>
        )}
        {q.inspections.map((i) => (
          <Stack key={i.id} spacing={1}>
            <Typography variant="h6">
              Biên bản phiên bản {i.version} · {formatInstant(i.inspectedAt)}
            </Typography>
            <Typography>Đối chiếu bàn giao nhận phòng phiên bản {i.baselineVersion}</Typography>
            <Table size="small" aria-label={`Đối chiếu trả phòng phiên bản ${i.version}`}>
              <TableHead>
                <TableRow>
                  <TableCell>Hạng mục</TableCell>
                  <TableCell>Khi nhận</TableCell>
                  <TableCell>Khi trả</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell>Phòng</TableCell>
                  <TableCell>{i.baseline.roomCondition}</TableCell>
                  <TableCell>{i.observed.roomCondition}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Chìa khóa / quyền truy cập</TableCell>
                  <TableCell>{i.baseline.keysAndAccess}</TableCell>
                  <TableCell>{i.observed.keysAndAccess}</TableCell>
                </TableRow>
                {i.observed.assets.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.name}</TableCell>
                    <TableCell>
                      {i.baseline.assets.find((b) => b.id === a.id)?.observedCondition}
                    </TableCell>
                    <TableCell>{a.observedCondition}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell>Điện</TableCell>
                  <TableCell>{i.baseline.electricity.value}</TableCell>
                  <TableCell>
                    {i.observed.electricity.value} ·{' '}
                    {displayContractDate(i.observed.electricity.date)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Nước</TableCell>
                  <TableCell>{i.baseline.water.value}</TableCell>
                  <TableCell>
                    {i.observed.water.value} · {displayContractDate(i.observed.water.date)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <Typography>{i.observed.notes}</Typography>
            <Typography>
              {i.ownerDecision === 'Confirmed'
                ? 'Owner đã xác nhận'
                : i.ownerDecision === 'Reinspection'
                  ? 'Yêu cầu kiểm tra lại'
                  : 'Chờ Owner xác nhận'}{' '}
              · {i.ownerReason}
            </Typography>
          </Stack>
        ))}
        {summary && (
          <>
            <Typography variant="h6">Nguồn quyết toán</Typography>
            <Typography>
              Cọc bảo đảm đã xác minh: {money(summary.verifiedSecurityDeposit)} · Cọc giữ chỗ đã áp
              dụng: {money(summary.appliedHoldingDeposit)}
            </Typography>
            <Typography>
              Nợ riêng hợp đồng: {money(summary.contractSpecificOutstanding)} · Phí cuối kỳ:{' '}
              {money(summary.approvedFinalCharges)}
            </Typography>
            <Typography>
              Khấu trừ đã duyệt: {money(summary.approvedDeductions)} · Hoàn tiền:{' '}
              {money(summary.refundAmount)}
            </Typography>
            {summary.calculation && (
              <>
                <Typography>
                  Đã phát hành: {money(summary.calculation.issuedTotal)} · Phải thu hiệu lực:{' '}
                  {money(summary.calculation.payableTotal)} · Đã phân bổ hóa đơn:{' '}
                  {money(summary.calculation.verifiedInvoicePayments)}
                </Typography>
                <Typography>
                  Cọc đã dùng: {money(summary.calculation.depositAllocated)} · Đã hoàn cọc:{' '}
                  {money(summary.calculation.depositRefunded)} · Cọc giữ chỗ hoàn:{' '}
                  {money(summary.calculation.depositReserved)} · Cọc khả dụng:{' '}
                  {money(summary.calculation.availableSecurityDeposit)}
                </Typography>
              </>
            )}
            <Typography>
              {summary.otherActiveContracts
                ? 'Phòng còn hợp đồng đang thuê khác; hoàn tất người này vẫn giữ phòng Đang thuê.'
                : 'Máy chủ sẽ kiểm tra điều kiện giải phóng phòng khi hoàn tất.'}
            </Typography>
            {summary.invoices.map((i) => (
              <Alert
                key={i.invoiceId}
                severity={i.financials.outstandingAmount === '0' ? 'info' : 'warning'}
              >
                Kỳ {displayContractDate(i.billingPeriod)} ·{' '}
                {i.shared ? 'Hóa đơn chung phòng' : 'Hóa đơn'} · Gốc{' '}
                {money(i.financials.originalIssuedAmount)} · Điều chỉnh{' '}
                {signedVnd(i.financials.approvedAdjustmentTotal)} · Phải thu{' '}
                {money(i.financials.effectivePayableAmount)} · Đã trả{' '}
                {money(i.financials.allocatedPayments)} · Còn nợ{' '}
                {money(i.financials.outstandingAmount)} · Dư{' '}
                {money(i.financials.potentialExcessAmount)}
              </Alert>
            ))}
            {summary.unresolvedItems.map((b) => (
              <Alert key={b} severity="warning">
                {settlementBlocker(b)}
              </Alert>
            ))}
            {!/^0(?:\.0+)?$/.test(summary.verifiedSecurityDeposit) && (
              <RefundPanel
                sourceId={contract.id}
                sourceKind="SecurityDeposit"
                onChanged={() => {
                  q.reload();
                  onChanged();
                }}
              />
            )}
            {summary.resolved && (
              <Alert severity="success">Các nguồn hiện tại đủ điều kiện xem xét hoàn tất.</Alert>
            )}
            <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
              Bản đối chiếu: {summary.reference}
            </Typography>
          </>
        )}
        {!q.loading && !q.error && moveOut.status !== 'Completed' && (
          <>
            <TextField
              label="Lý do / căn cứ của Owner"
              multiline
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
            {inspection && !inspection.ownerDecision && moveOut.status === 'Inspected' && (
              <>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={noCharges}
                      onChange={(e) =>
                        setNoChargesInspection(e.target.checked ? inspectionKey : null)
                      }
                    />
                  }
                  label="Đã đối chiếu: không phát sinh phí bổ sung hoặc thiệt hại cần thu"
                />
                <Button
                  disabled={busy || !reason.trim()}
                  onClick={() =>
                    void save('move-out/inspection-review', {
                      version: inspection.version,
                      confirmed: true,
                      reason,
                      noAdditionalCharges: noCharges,
                    })
                  }
                >
                  Xác nhận biên bản kiểm tra
                </Button>
                <Button
                  disabled={busy || !reason.trim()}
                  onClick={() =>
                    void save('move-out/inspection-review', {
                      version: inspection.version,
                      confirmed: false,
                      reason,
                    })
                  }
                >
                  Yêu cầu kiểm tra lại
                </Button>
              </>
            )}
            {summary && ['Inspected', 'PendingSettlement', 'Settled'].includes(moveOut.status) && (
              <>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={checked}
                      onChange={(e) =>
                        setReviewedReference(e.target.checked ? summary.reference : null)
                      }
                    />
                  }
                  label="Tôi đã đọc số liệu và các nghĩa vụ còn chờ xử lý"
                />
                <Button
                  disabled={busy || !checked || !reason.trim()}
                  onClick={() =>
                    void save('move-out/settlement', {
                      decision: reason,
                      expectedReference: summary.reference,
                    })
                  }
                >
                  Lưu xem xét quyết toán
                </Button>
              </>
            )}
          </>
        )}
        {q.history.map((h) => (
          <Typography key={h.version} variant="caption">
            {formatInstant(h.occurredAt)} · Phiên bản {h.version} ·{' '}
            {(
              {
                Requested: 'Gửi yêu cầu',
                Approved: 'Đã duyệt',
                Scheduled: 'Đặt lịch',
                Inspected: 'Đã kiểm tra',
                InspectionConfirmed: 'Xác nhận kiểm tra',
                ReinspectionRequired: 'Kiểm tra lại',
                Settled: 'Đã quyết toán',
                PendingSettlement: 'Chờ quyết toán',
                Completed: 'Hoàn tất',
              } as Record<string, string>
            )[h.action] ?? h.action}
          </Typography>
        ))}
      </Stack>
    </ChartCard>
  );
}
