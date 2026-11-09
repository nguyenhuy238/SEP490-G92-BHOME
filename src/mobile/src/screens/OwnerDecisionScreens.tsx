import React, { useMemo, useRef, useState } from 'react';
import { Checkbox, Text, TextInput } from 'react-native-paper';
import { useLocalSearchParams } from 'expo-router';
import { randomUUID } from '../lib/randomUUID';
import { mutationKeys } from '../../../../packages/client-core/src/contracts';
import {
  adjustmentClient,
  adjustmentError,
  adjustmentStatus,
  type Adjustment,
} from '../../../../packages/client-core/src/adjustments';
import {
  businessToday,
  formatContractMoney,
  type ContractPage,
} from '../../../../packages/client-core/src/contracts';
import type { FinancialReport } from '../../../../packages/client-core/src/finance';
import {
  paymentClient,
  paymentError,
  paymentText,
  type BankTransfer,
  type DebtInvoice,
  type PayerChoice,
} from '../../../../packages/client-core/src/payments';
import type { Page } from '../../../../packages/client-core/src/invoices';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import type { IncidentPage, WorkOrder } from '../services/incidents';
import type { OperationalTask, TaskPage } from '../services/operationalTasks';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useSession } from '../lib/SessionProvider';
import { useFeedbackState } from '../lib/useFeedbackState';
import { showSuccess } from '../lib/toast';
import type { Named } from '../lib/api';
import { Action, Box, Heading, Metric, Pill, Row, ui } from '../components/WorkspaceKit';
import { ChoiceField } from '../components/WorkflowControls';
import { Pagination, QueryState } from '../components/WorkspaceQueryState';
import { AdjustmentEvidenceImage } from './TenantAdjustmentPanel';

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function CountCard({ label, count, icon, open }: { label: string; count: number | null; icon: string; open: () => void }) {
  return (
    <Box style={ui.half}>
      <Metric label={label} value={count === null ? '…' : String(count)} detail="Cần Owner xem xét" icon={icon} />
      <Action secondary onPress={open}>Mở danh sách</Action>
    </Box>
  );
}

export function OwnerApprovalCenterScreen() {
  const { go } = useWorkspace();
  const tasks = useWorkspaceQuery<TaskPage<OperationalTask>>(
    '/api/v1/operational-tasks?page=1&pageSize=3&status=PendingVerification',
  );
  const plans = useWorkspaceQuery<IncidentPage<WorkOrder>>(
    '/api/v1/work-orders?page=1&pageSize=3&workOrderStatus=PendingApproval',
  );
  const verification = useWorkspaceQuery<IncidentPage<WorkOrder>>(
    '/api/v1/work-orders?page=1&pageSize=3&workOrderStatus=PendingVerification',
  );
  const adjustments = useWorkspaceQuery<Page<Adjustment>>(
    '/api/v1/invoice-adjustments?page=1&pageSize=3&status=Pending',
  );
  const signing = useWorkspaceQuery<ContractPage>(
    '/api/v1/contracts?page=1&pageSize=3&status=PendingSigning',
  );
  const activation = useWorkspaceQuery<ContractPage>(
    '/api/v1/contracts?page=1&pageSize=3&status=PendingActivation',
  );
  const payments = useWorkspaceQuery<Page<BankTransfer>>(
    '/api/v1/payment-transactions?page=1&pageSize=3&paymentStatus=PendingReview',
  );
  const queries = [tasks, plans, verification, adjustments, signing, activation, payments];
  return (
    <>
      <Heading title="Trung tâm phê duyệt" detail="Các quyết định nhanh thuộc thẩm quyền Owner" />
      {queries.map((query, index) => <QueryState key={index} {...query} />)}
      <Row>
        <CountCard label="Công việc chờ nghiệm thu" count={tasks.data?.totalCount ?? null} icon="clipboard-check-outline" open={() => go('operations')} />
        <CountCard label="Phương án sửa chữa" count={plans.data?.totalCount ?? null} icon="wrench-clock-outline" open={() => go('owner-maintenance')} />
      </Row>
      <Row>
        <CountCard label="Bảo trì chờ nghiệm thu" count={verification.data?.totalCount ?? null} icon="shield-check-outline" open={() => go('owner-maintenance')} />
        <CountCard label="Điều chỉnh hóa đơn" count={adjustments.data?.totalCount ?? null} icon="receipt-text-edit-outline" open={() => go('owner-adjustments')} />
      </Row>
      <Row>
        <CountCard label="Hợp đồng chờ ký" count={signing.data?.totalCount ?? null} icon="file-sign" open={() => go('signing')} />
        <CountCard label="Hợp đồng chờ kích hoạt" count={activation.data?.totalCount ?? null} icon="file-check-outline" open={() => go('signing')} />
      </Row>
      <CountCard label="Giao dịch chờ đối soát" count={payments.data?.totalCount ?? null} icon="bank-transfer" open={() => go('owner-payments')} />
      <Box>
        <Heading title="Lối tắt" />
        <Action secondary onPress={() => go('owner-announcements')}>Gửi thông báo đến Tenant</Action>
      </Box>
    </>
  );
}

export function OwnerAdjustmentListScreen() {
  const { go } = useWorkspace();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('Pending');
  const query = useWorkspaceQuery<Page<Adjustment>>(
    `/api/v1/invoice-adjustments?page=${page}&pageSize=20${status ? `&status=${status}` : ''}`,
  );
  return (
    <>
      <Heading title="Điều chỉnh hóa đơn" detail="Owner xem bằng chứng và quyết định từng yêu cầu" />
      <ChoiceField label="Trạng thái" value={status} options={[
        { id: 'Pending', label: 'Chờ xử lý' }, { id: 'Approved', label: 'Đã duyệt' },
        { id: 'Rejected', label: 'Đã từ chối' }, { id: '', label: 'Tất cả' },
      ]} onChange={(value) => { setStatus(value); setPage(1); }} />
      <QueryState {...query} />
      {query.data?.items.map((item) => (
        <Box key={item.id}>
          <Row spread><Pill>{adjustmentStatus(item.status)}</Pill><Text style={ui.muted}>{formatInstant(item.submittedAt)}</Text></Row>
          <Heading title={`${item.locationName} · Phòng ${item.roomNumber}`} detail={`Kỳ ${item.billingPeriod}`} />
          <Text>{item.reason}</Text>
          <Text style={ui.money}>{formatContractMoney(item.currentAmount)} → {item.proposedAmount === null ? 'Chưa đề xuất' : formatContractMoney(item.proposedAmount)}</Text>
          <Action onPress={() => go('owner-adjustment-detail', { adjustmentId: item.id })}>Xem và quyết định</Action>
        </Box>
      ))}
      {query.data?.items.length === 0 && <Box><Text>Không có yêu cầu phù hợp.</Text></Box>}
      {query.data && <Pagination page={page} total={query.data.totalCount} loading={query.loading} onChange={setPage} />}
    </>
  );
}

export function OwnerAdjustmentReviewScreen() {
  const { adjustmentId } = useLocalSearchParams<{ adjustmentId?: string }>();
  const { api } = useSession();
  const { go } = useWorkspace();
  const id = adjustmentId && idPattern.test(adjustmentId) ? adjustmentId : '';
  const query = useWorkspaceQuery<Adjustment>(id ? `/api/v1/invoice-adjustments/${id}` : null);
  const client = useMemo(() => api ? adjustmentClient(api.request.bind(api)) : null, [api]);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFeedbackState();
  const lock = useRef(false);
  const [keys] = useState(() => mutationKeys(randomUUID));
  const item = query.data;
  async function decide(approve: boolean) {
    if (!client || !item || lock.current || item.status !== 'Pending') return;
    if (!confirmed || !reason.trim() || (approve && !amount.trim())) {
      setError('Nhập lý do, giá trị quyết định và xác nhận đã kiểm tra hồ sơ.'); return;
    }
    const body = {
      expectedVersion: item.version,
      expectedInvoiceVersion: item.invoiceVersion,
      expectedFinancialVersion: item.currentFinancialVersion || item.financialVersion,
      correctedAmount: approve ? amount.replace(/[.,\s₫đ]/g, '') : null,
      chargeCode: item.chargeCode,
      reason: reason.trim(), humanConfirmed: true,
    };
    lock.current = true; setBusy(true); setError('');
    try {
      await client.decide(item.id, approve, body, keys.get(`${item.id}:${approve}`, body));
      keys.confirmed(`${item.id}:${approve}`, body); showSuccess('Máy chủ đã ghi nhận quyết định.'); query.reload();
    } catch (e) { setError(adjustmentError(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  if (!id) return <Box><Text>Mã yêu cầu điều chỉnh không hợp lệ.</Text></Box>;
  return (
    <>
      <Action secondary onPress={() => go('owner-adjustments')}>Về danh sách điều chỉnh</Action>
      <QueryState {...query} />
      {item && <>
        <Box>
          <Row spread><Pill>{adjustmentStatus(item.status)}</Pill><Text style={ui.muted}>{formatInstant(item.submittedAt)}</Text></Row>
          <Heading title={`${item.locationName} · Phòng ${item.roomNumber}`} detail={`Hóa đơn kỳ ${item.billingPeriod}`} />
          <Text>Lý do Tenant: {item.reason}</Text>
          <Text>Số tiền hiện tại: {formatContractMoney(item.currentChargeAmount ?? item.currentAmount)}</Text>
          <Text>Tenant đề xuất: {item.proposedAmount === null ? 'Không nhập' : formatContractMoney(item.proposedAmount)}</Text>
          <Text>Trạng thái hóa đơn: {item.invoiceStatus}</Text>
          <Text>Bằng chứng: {item.evidence.length} ảnh/tệp</Text>
          {client && item.evidence.map((file, index) => (
            <AdjustmentEvidenceImage
              key={file.id}
              client={client}
              id={item.id}
              fileId={file.id}
              mime={file.contentType}
              number={index + 1}
            />
          ))}
        </Box>
        {item.status === 'Pending' && <Box>
          <Heading title="Quyết định của Owner" />
          <TextInput mode="outlined" label="Số tiền đúng sau điều chỉnh (VND)" value={amount} onChangeText={setAmount} keyboardType="numeric" disabled={busy} />
          <TextInput mode="outlined" label="Lý do quyết định" value={reason} onChangeText={setReason} multiline disabled={busy} />
          <Checkbox.Item label="Tôi đã kiểm tra hóa đơn và bằng chứng" status={confirmed ? 'checked' : 'unchecked'} onPress={() => setConfirmed(!confirmed)} disabled={busy} />
          {!!error && <Text style={ui.red}>{error}</Text>}
          <Row><Action disabled={busy} onPress={() => void decide(true)}>Phê duyệt</Action><Action secondary disabled={busy} onPress={() => void decide(false)}>Từ chối</Action></Row>
        </Box>}
        {item.decision && <Box><Heading title="Kết quả" /><Text>{item.decision.reason}</Text><Text>{formatInstant(item.decision.decidedAt)}</Text></Box>}
      </>}
    </>
  );
}

export function OwnerPaymentListScreen() {
  const { go } = useWorkspace(); const [page, setPage] = useState(1); const [status, setStatus] = useState('PendingReview');
  const query = useWorkspaceQuery<Page<BankTransfer>>(`/api/v1/payment-transactions?page=${page}&pageSize=20${status ? `&paymentStatus=${status}` : ''}`);
  return <>
    <Heading title="Đối soát giao dịch" detail="Chỉ xác nhận sau khi đã đối chiếu sao kê ngân hàng" />
    <ChoiceField label="Trạng thái" value={status} options={[{ id: 'PendingReview', label: 'Chờ đối soát' }, { id: 'Allocated', label: 'Đã phân bổ' }, { id: 'Rejected', label: 'Đã từ chối' }, { id: '', label: 'Tất cả' }]} onChange={(v) => { setStatus(v); setPage(1); }} />
    <QueryState {...query} />
    {query.data?.items.map((item) => <Box key={item.id}>
      <Row spread><Pill>{paymentText(item.status)}</Pill><Text>{formatInstant(item.occurredAt)}</Text></Row>
      <Heading title={formatContractMoney(item.amount)} detail={item.bankReference} />
      <Text>{item.transferDescription || 'Không có nội dung chuyển khoản'}</Text>
      <Action onPress={() => go('owner-payment-detail', { paymentId: item.id })}>Kiểm tra giao dịch</Action>
    </Box>)}
    {query.data?.items.length === 0 && <Box><Text>Không có giao dịch phù hợp.</Text></Box>}
    {query.data && <Pagination page={page} total={query.data.totalCount} loading={query.loading} onChange={setPage} />}
  </>;
}

export function OwnerPaymentReviewScreen() {
  const { paymentId } = useLocalSearchParams<{ paymentId?: string }>(); const id = paymentId && idPattern.test(paymentId) ? paymentId : '';
  const { api } = useSession(); const { go } = useWorkspace();
  const transfer = useWorkspaceQuery<BankTransfer>(id ? `/api/v1/payment-transactions/${id}` : null);
  const invoices = useWorkspaceQuery<Page<DebtInvoice>>(id ? '/api/v1/payment-invoices?page=1&pageSize=100&paymentStatus=Unpaid' : null);
  const [invoiceId, setInvoiceId] = useState(''); const selectedInvoice = invoiceId || transfer.data?.proposedInvoiceId || '';
  const payers = useWorkspaceQuery<PayerChoice[]>(selectedInvoice ? `/api/v1/invoices/${selectedInvoice}/payment/eligible-payers` : null);
  const [payer, setPayer] = useState(''); const [reason, setReason] = useState(''); const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useFeedbackState(); const lock = useRef(false); const [keys] = useState(() => mutationKeys(randomUUID));
  const client = useMemo(() => api ? paymentClient(api.request.bind(api)) : null, [api]);
  async function act(allocate: boolean) {
    if (!client || !transfer.data || lock.current || !confirmed || (allocate ? !selectedInvoice : !reason.trim())) { setError('Chọn hóa đơn hoặc nhập lý do từ chối và xác nhận đã đối chiếu sao kê.'); return; }
    const body = allocate ? { invoiceId: selectedInvoice, payer } : { reason: reason.trim() }; const scope = `${id}:${allocate}`;
    lock.current = true; setBusy(true); setError('');
    try { if (allocate) await client.allocate(id, selectedInvoice, payer || null, keys.get(scope, body)); else await client.reject(id, reason.trim(), keys.get(scope, body)); keys.confirmed(scope, body); showSuccess('Máy chủ đã ghi nhận kết quả đối soát.'); transfer.reload(); }
    catch (e) { setError(paymentError(e)); } finally { lock.current = false; setBusy(false); }
  }
  if (!id) return <Box><Text>Mã giao dịch không hợp lệ.</Text></Box>;
  const item = transfer.data;
  return <>
    <Action secondary onPress={() => go('owner-payments')}>Về danh sách giao dịch</Action><QueryState {...transfer} />
    {item && <><Box><Row spread><Pill>{paymentText(item.status)}</Pill><Text>{formatInstant(item.occurredAt)}</Text></Row><Heading title={formatContractMoney(item.amount)} detail={`${item.providerIdentity} · ${item.bankReference}`} /><Text>Nội dung: {item.transferDescription}</Text><Text>Tham chiếu sao kê: {item.statementReference}</Text><Text>Căn cứ xác minh: {item.verificationReason}</Text></Box>
    {item.status === 'PendingReview' && <Box><Heading title="Quyết định đối soát" /><ChoiceField label="Hóa đơn nhận tiền" value={selectedInvoice} options={(invoices.data?.items ?? []).map(x => ({ id: x.invoiceId, label: `${x.locationName} · P.${x.roomNumber} · ${formatContractMoney(x.outstandingAmount)}` }))} onChange={setInvoiceId} disabled={busy} />{selectedInvoice && <ChoiceField label="Người thanh toán (không bắt buộc)" value={payer} options={[{ id: '', label: 'Không xác định' }, ...(payers.data ?? []).map(x => ({ id: x.userId, label: x.displayLabel }))]} onChange={setPayer} disabled={busy} />}<TextInput mode="outlined" label="Lý do từ chối" value={reason} onChangeText={setReason} multiline disabled={busy} /><Checkbox.Item label="Tôi đã đối chiếu sao kê ngân hàng" status={confirmed ? 'checked' : 'unchecked'} onPress={() => setConfirmed(!confirmed)} disabled={busy} />{!!error && <Text style={ui.red}>{error}</Text>}<Row><Action disabled={busy || !selectedInvoice} onPress={() => void act(true)}>Phân bổ vào hóa đơn</Action><Action secondary disabled={busy || !reason.trim()} onPress={() => void act(false)}>Từ chối</Action></Row></Box>}</>}
  </>;
}

interface RecipientPreview { recipientCount: number; missingEmailCount: number }
interface Announcement { id: string; title: string; body: string; status: string; recipientCount: number; sentAt: string | null }
export function OwnerAnnouncementScreen() {
  const { api } = useSession(); const [scope, setScope] = useState('ALL_TENANTS'); const [locationId, setLocationId] = useState('');
  const locations = useWorkspaceQuery<Named[]>('/api/v1/capture/locations'); const sent = useWorkspaceQuery<Announcement[]>('/api/v1/announcements/sent?page=1&pageSize=20');
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [email, setEmail] = useState(false); const [preview, setPreview] = useState<RecipientPreview | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useFeedbackState(); const lock = useRef(false);
  const audience = { type: scope, locationIds: scope === 'LOCATION' && locationId ? [locationId] : [], roomIds: [], userIds: [] };
  async function previewRecipients() { if (!api || lock.current || (scope === 'LOCATION' && !locationId)) return; lock.current = true; setBusy(true); setError(''); try { setPreview(await api.request('/api/v1/announcements/preview-recipients', { method: 'POST', body: JSON.stringify(audience) })); } catch { setError('Chưa thể xác định người nhận. Kiểm tra phạm vi rồi thử lại.'); } finally { lock.current = false; setBusy(false); } }
  async function send() { if (!api || lock.current || !title.trim() || !body.trim() || !preview) { setError('Nhập nội dung và xem trước người nhận trước khi gửi.'); return; } lock.current = true; setBusy(true); setError(''); try { const draft = await api.request<Announcement>('/api/v1/announcements', { method: 'POST', body: JSON.stringify({ title: title.trim(), body: body.trim(), audience, channels: email ? ['IN_APP', 'EMAIL'] : ['IN_APP'], priority: 'P2' }) }); await api.request(`/api/v1/announcements/${draft.id}/send`, { method: 'POST' }); setTitle(''); setBody(''); setPreview(null); sent.reload(); showSuccess('Đã gửi thông báo đến người nhận hợp lệ.'); } catch { setError('Chưa gửi được thông báo. Tải lại và kiểm tra phạm vi người nhận.'); } finally { lock.current = false; setBusy(false); } }
  return <><Heading title="Gửi thông báo" detail="UC-35 · Owner gửi thông báo trong phạm vi chuỗi" /><ChoiceField label="Phạm vi" value={scope} options={[{ id: 'ALL_TENANTS', label: 'Tất cả Tenant đang cư trú' }, { id: 'LOCATION', label: 'Theo cơ sở' }]} onChange={(v) => { setScope(v); setPreview(null); }} />{scope === 'LOCATION' && <ChoiceField label="Cơ sở" value={locationId} options={(locations.data ?? []).map(x => ({ id: x.id, label: x.label }))} onChange={(v) => { setLocationId(v); setPreview(null); }} />}<TextInput mode="outlined" label="Tiêu đề" value={title} onChangeText={(v) => { setTitle(v); setPreview(null); }} maxLength={150} /><TextInput mode="outlined" label="Nội dung" value={body} onChangeText={(v) => { setBody(v); setPreview(null); }} multiline maxLength={1000} /><Checkbox.Item label="Gửi thêm qua email nếu Tenant có email xác nhận" status={email ? 'checked' : 'unchecked'} onPress={() => { setEmail(!email); setPreview(null); }} />{!!error && <Text style={ui.red}>{error}</Text>}{preview && <Box><Text>Người nhận: {preview.recipientCount}</Text>{email && <Text>Thiếu email xác nhận: {preview.missingEmailCount}</Text>}</Box>}<Row><Action secondary disabled={busy} onPress={() => void previewRecipients()}>Xem trước người nhận</Action><Action disabled={busy || !preview || preview.recipientCount === 0} onPress={() => void send()}>Gửi thông báo</Action></Row><Heading title="Đã gửi gần đây" /><QueryState {...sent} />{sent.data?.map(x => <Box key={x.id}><Heading title={x.title} detail={x.sentAt ? formatInstant(x.sentAt) : x.status} /><Text>{x.body}</Text><Text>{x.recipientCount} người nhận</Text></Box>)}</>;
}

export function OwnerFinanceScreen() {
  const today = businessToday(); const [locationId, setLocationId] = useState(''); const from = `${today.slice(0, 8)}01`;
  const locations = useWorkspaceQuery<Named[]>('/api/v1/capture/locations');
  const query = useWorkspaceQuery<FinancialReport>(`/api/v1/financial-reports?from=${from}&to=${today}${locationId ? `&locationId=${locationId}` : ''}`);
  const t = query.data?.total;
  return <><Heading title="Tài chính tháng này" detail="Số liệu quản trị từ giao dịch đã xác minh; không phải báo cáo thuế" /><ChoiceField label="Cơ sở" value={locationId} options={[{ id: '', label: 'Toàn chuỗi' }, ...(locations.data ?? []).map(x => ({ id: x.id, label: x.label }))]} onChange={setLocationId} /><QueryState {...query} />{t && <><Row><Metric label="Thực thu" value={formatContractMoney(t.verifiedCollections)} detail="Đã xác minh" icon="cash-check" /><Metric label="Công nợ" value={formatContractMoney(t.outstandingNow)} detail="Dư nợ hiện tại" icon="receipt-text-clock-outline" /></Row><Row><Metric label="Chi phí vận hành" value={formatContractMoney(t.operatingExpenses)} detail="Trong kỳ" icon="cash-minus" /><Metric label="Lợi nhuận vận hành" value={formatContractMoney(t.operatingProfit)} detail="Thu trừ chi phí" icon="chart-line" /></Row><Box><Text>Phòng đang ở: {t.occupiedRooms}/{t.totalRooms}</Text><Text>Vốn đầu tư: {formatContractMoney(t.initialInvestment)}</Text>{query.data?.capital.recoveryPercent && <Text>Thu hồi vốn: {query.data.capital.recoveryPercent}%</Text>}{query.data?.capital.unavailableReason && <Text style={ui.muted}>Chưa tính được payback: {query.data.capital.unavailableReason}</Text>}</Box></>}</>;
}
