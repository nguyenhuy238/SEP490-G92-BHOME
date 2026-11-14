import React, { useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Dialog, Portal, Text } from 'react-native-paper';
import {
  adjustmentClient,
  adjustmentError,
  type Adjustment,
} from '../../../../../packages/client-core/src/adjustments';
import {
  formatContractMoney,
  mutationKeys,
  vnd,
} from '../../../../../packages/client-core/src/contracts';
import {
  paymentClient,
  paymentError,
  type BankTransfer,
  type DebtInvoice,
  type PayerChoice,
  type InvoicePayment,
} from '../../../../../packages/client-core/src/payments';
import type { Page } from '../../../../../packages/client-core/src/invoices';
import { useSession } from '../../lib/SessionProvider';
import { randomUUID } from '../../lib/randomUUID';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { ChoiceField, Input } from '../../components/WorkflowControls';
import { QueryState, Pagination } from '../../components/WorkspaceQueryState';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';

function useFinancialMutation(message: (error: unknown) => string, onChanged: () => void) {
  const { session } = useSession();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [review, setReview] = useState(false);
  const lock = useRef(false);
  const [keys] = useState(() => mutationKeys(randomUUID));
  async function run(scope: string, body: unknown, work: (key: string) => Promise<unknown>) {
    if (lock.current || review || !session?.roles.includes('Owner')) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await work(keys.get(scope, body));
      keys.confirmed(scope, body);
      onChanged();
    } catch (e) {
      setError(message(e));
      setReview(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { busy, error, review, run };
}

function Confirmation({
  title,
  detail,
  open,
  busy,
  close,
  confirm,
}: {
  title: string;
  detail: string;
  open: boolean;
  busy: boolean;
  close: () => void;
  confirm: () => void;
}) {
  return (
    <Portal>
      <Dialog
        visible={open}
        onDismiss={() => {
          if (!busy) close();
        }}
      >
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Content>
          <Text>{detail}</Text>
        </Dialog.Content>
        <Dialog.Actions>
          <Button disabled={busy} onPress={close}>
            Quay lại
          </Button>
          <Button disabled={busy} onPress={confirm}>
            Xác nhận quyết định
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

export function OwnerAdjustmentDecision({
  item,
  onChanged,
}: {
  item: Adjustment;
  onChanged: () => void;
}) {
  const { api, session } = useSession();
  const service = useMemo(() => (api ? adjustmentClient(api.request.bind(api)) : null), [api]);
  const mutation = useFinancialMutation(adjustmentError, onChanged);
  const [amount, setAmount] = useState(item.proposedAmount ?? ''),
    [reason, setReason] = useState(''),
    [code, setCode] = useState(item.chargeCode ?? '');
  const [checked, setChecked] = useState(false),
    [decision, setDecision] = useState<boolean | null>(null),
    [validation, setValidation] = useState('');
  if (
    !service ||
    !session?.roles.includes('Owner') ||
    item.status !== 'Pending' ||
    !item.currentInvoice
  )
    return null;
  const blocked = mutation.busy || mutation.review;
  function decide() {
    if (!service || decision === null || !checked || blocked) return;
    const approve = decision;
    try {
      if (!reason.trim() || reason.trim().length > 2000) throw new Error();
      const input = {
        expectedVersion: item.version,
        expectedInvoiceVersion: item.currentInvoice.version,
        expectedFinancialVersion: item.currentFinancialVersion,
        correctedAmount: decision ? vnd(amount) : null,
        chargeCode: code || null,
        reason: reason.trim(),
        humanConfirmed: true,
      };
      setValidation('');
      void mutation.run(`adjustment/${item.id}/${decision}`, input, (key) =>
        service.decide(item.id, approve, input, key),
      );
      setDecision(null);
    } catch {
      setValidation('Nhập số nguyên VND hợp lệ, lý do tối đa 2.000 ký tự và kiểm tra khoản phí.');
    }
  }
  return (
    <Box>
      <Heading title="Quyết định điều chỉnh" />
      <Text>
        {item.currentInvoice.status === 'Draft'
          ? 'Sửa khoản phí trong bản nháp; không thay chỉ số hoặc biểu giá nguồn.'
          : 'Điều chỉnh được lưu riêng; giữ nguyên hóa đơn đã phát hành.'}
      </Text>
      <ChoiceField
        label="Khoản phí xem xét"
        value={code}
        disabled={blocked || !!item.chargeCode}
        options={[
          {
            id: '',
            label: item.currentInvoice.status === 'Draft' ? 'Chọn khoản phí' : 'Toàn hóa đơn',
          },
          ...item.currentInvoice.lines.map((line) => ({ id: line.chargeCode, label: line.name })),
        ]}
        onChange={(value) => {
          setCode(value);
          setChecked(false);
        }}
      />
      <Input
        label="Giá trị sau điều chỉnh (VND)"
        value={amount}
        disabled={blocked}
        onChange={(value) => {
          setAmount(value);
          setChecked(false);
        }}
      />
      <Input
        label="Lý do quyết định"
        value={reason}
        disabled={blocked}
        onChange={(value) => {
          setReason(value);
          setChecked(false);
        }}
      />
      <Checkbox.Item
        label="Tôi đã kiểm tra hóa đơn, số dư và bằng chứng"
        status={checked ? 'checked' : 'unchecked'}
        disabled={blocked}
        onPress={() => setChecked((value) => !value)}
      />
      {!!(validation || mutation.error) && (
        <Text accessibilityRole="alert" style={ui.red}>
          {validation || mutation.error}
        </Text>
      )}
      {mutation.review && (
        <Text>Tải lại yêu cầu và kiểm tra trạng thái trước khi quyết định tiếp.</Text>
      )}
      <Action
        disabled={
          blocked ||
          !checked ||
          !reason.trim() ||
          !amount ||
          (item.currentInvoice.status === 'Draft' && !code)
        }
        onPress={() => setDecision(true)}
      >
        Phê duyệt
      </Action>
      <Action
        secondary
        disabled={blocked || !checked || !reason.trim()}
        onPress={() => setDecision(false)}
      >
        Từ chối
      </Action>
      <Confirmation
        title={decision ? 'Phê duyệt điều chỉnh?' : 'Từ chối điều chỉnh?'}
        detail={`${item.locationName} · Phòng ${item.roomNumber} · ${decision ? `Giá trị mới: ${amount} VND` : 'Giữ nguyên nghĩa vụ hiện tại'} · ${reason}`}
        open={decision !== null}
        busy={mutation.busy}
        close={() => setDecision(null)}
        confirm={decide}
      />
    </Box>
  );
}

export function OwnerPaymentDecision({
  item,
  onChanged,
}: {
  item: BankTransfer;
  onChanged: () => void;
}) {
  const { api, session } = useSession();
  if (!api || !session?.roles.includes('Owner') || item.status !== 'PendingReview') return null;
  return <PaymentDecisionForm key={item.id} item={item} onChanged={onChanged} />;
}

function PaymentDecisionForm({ item, onChanged }: { item: BankTransfer; onChanged: () => void }) {
  const { api } = useSession();
  const service = useMemo(() => paymentClient(api!.request.bind(api!)), [api]);
  const mutation = useFinancialMutation(paymentError, onChanged);
  const [invoiceId, setInvoiceId] = useState(item.proposedInvoiceId ?? ''),
    [payer, setPayer] = useState(''),
    [reason, setReason] = useState('');
  const [page, setPage] = useState(1),
    [checked, setChecked] = useState(false),
    [decision, setDecision] = useState<'allocate' | 'reject' | null>(null);
  const invoices = useWorkspaceQuery<Page<DebtInvoice>>(
    `/api/v1/payment-invoices?page=${page}&pageSize=20`,
  );
  const payers = useWorkspaceQuery<PayerChoice[]>(
    invoiceId ? `/api/v1/invoices/${encodeURIComponent(invoiceId)}/payment/eligible-payers` : null,
  );
  const invoice = useWorkspaceQuery<InvoicePayment>(
    invoiceId ? `/api/v1/invoices/${encodeURIComponent(invoiceId)}/payment` : null,
  );
  const ready =
    !!invoice.data &&
    invoice.data.paymentStatus === 'Unpaid' &&
    !!payers.data &&
    !payers.error &&
    !invoice.error &&
    !payers.loading &&
    !invoice.loading;
  const blocked = mutation.busy || mutation.review;
  function perform() {
    if (blocked || !checked || !decision) return;
    if (
      decision === 'allocate' &&
      ready &&
      invoiceId &&
      payer &&
      payers.data?.some((person) => person.userId === payer)
    ) {
      const body = { invoiceId, payer };
      void mutation.run(`payment/${item.id}/allocate`, body, (key) =>
        service.allocate(item.id, invoiceId, payer, key),
      );
    } else if (decision === 'reject' && reason.trim() && reason.trim().length <= 2000) {
      void mutation.run(`payment/${item.id}/reject`, { reason: reason.trim() }, (key) =>
        service.reject(item.id, reason.trim(), key),
      );
    }
    setDecision(null);
  }
  return (
    <Box>
      <Heading title="Đối chiếu và quyết định" />
      <QueryState {...invoices} />
      <ChoiceField
        label="Hóa đơn nhận tiền"
        value={invoiceId}
        disabled={blocked}
        options={[
          { id: '', label: 'Chọn hóa đơn' },
          ...(item.proposedInvoiceId &&
          !invoices.data?.items.some((value) => value.invoiceId === item.proposedInvoiceId)
            ? [{ id: item.proposedInvoiceId, label: 'Hóa đơn do máy chủ gợi ý' }]
            : []),
          ...(invoices.data?.items ?? []).map((value) => ({
            id: value.invoiceId,
            label: `${value.locationName} · Phòng ${value.roomNumber} · ${value.billingPeriod.slice(0, 7)} · ${formatContractMoney(value.outstandingAmount)}`,
          })),
        ]}
        onChange={(value) => {
          setInvoiceId(value);
          setPayer('');
          setChecked(false);
        }}
      />
      {invoices.data && (
        <Pagination
          page={page}
          total={invoices.data.totalCount}
          loading={invoices.loading || blocked}
          onChange={setPage}
        />
      )}
      {!!invoiceId && (
        <>
          {(invoice.loading || payers.loading) && <Text>Đang đối chiếu hóa đơn…</Text>}
          {!!(invoice.error || payers.error) && (
            <Text style={ui.red}>{invoice.error || payers.error}</Text>
          )}
          {invoice.data && (
            <Text>
              Phải thu: {formatContractMoney(invoice.data.payableAmount)} · Đã trả:{' '}
              {formatContractMoney(invoice.data.paidAmount)} · Còn nợ:{' '}
              {formatContractMoney(invoice.data.outstandingAmount)}
            </Text>
          )}
          <ChoiceField
            label="Người thực trả"
            value={payer}
            disabled={blocked || !ready}
            options={[
              { id: '', label: 'Chọn người trả đã đối chiếu' },
              ...(payers.data ?? []).map((value) => ({
                id: value.userId,
                label: value.displayLabel,
              })),
            ]}
            onChange={(value) => {
              setPayer(value);
              setChecked(false);
            }}
          />
        </>
      )}
      <Input
        label="Lý do không phân bổ"
        value={reason}
        disabled={blocked}
        onChange={(value) => {
          setReason(value);
          setChecked(false);
        }}
      />
      <Checkbox.Item
        label="Tôi đã đối chiếu sao kê, nghĩa vụ và người thực trả"
        status={checked ? 'checked' : 'unchecked'}
        disabled={blocked}
        onPress={() => setChecked((value) => !value)}
      />
      {!!mutation.error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {mutation.error}
        </Text>
      )}
      {mutation.review && <Text>Tải lại giao dịch để kiểm tra kết quả trước khi gửi tiếp.</Text>}
      <Action
        disabled={blocked || !checked || !ready || !payer}
        onPress={() => setDecision('allocate')}
      >
        Phân bổ vào hóa đơn
      </Action>
      <Action
        secondary
        disabled={blocked || !checked || !reason.trim() || reason.trim().length > 2000}
        onPress={() => setDecision('reject')}
      >
        Không phân bổ giao dịch
      </Action>
      <Confirmation
        title={decision === 'allocate' ? 'Xác nhận phân bổ?' : 'Không phân bổ giao dịch?'}
        detail={`${formatContractMoney(item.amount)} · ${item.bankReference} · ${decision === 'allocate' ? 'Máy chủ sẽ kiểm tra số tiền, tham chiếu và người trả.' : reason}`}
        open={decision !== null}
        busy={mutation.busy}
        close={() => setDecision(null)}
        confirm={perform}
      />
    </Box>
  );
}
