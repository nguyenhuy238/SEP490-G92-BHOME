import { ApiError } from './api';
import type { Page } from './invoices';

export interface VerifiedPayment {
  id: string;
  amount: string;
  paidAt: string;
  paidBy: string;
  paidByUserId: string | null;
  verificationSource: string;
  verifiedAt: string;
}
export interface InvoicePayment {
  invoiceId: string;
  paymentStatus: 'NotIssued' | 'Paid' | 'Unpaid';
  payableAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  dueDate: string;
  overdueDays: number;
  transferReference: string;
  pendingReview: boolean;
  history: VerifiedPayment[];
  originalIssuedAmount?: string;
  approvedAdjustmentTotal?: string;
  potentialExcessAmount?: string;
  financialVersion?: number;
  reviewStatus?: string;
}
export interface TransferInstructions {
  invoiceId: string;
  availability: string;
  bankIdentifier: string | null;
  accountNumber: string | null;
  accountHolder: string | null;
  outstandingAmount: string;
  transferReference: string;
  transferDescription: string;
  qrPayload: string | null;
  qrImageDataUri: string | null;
  isDevelopmentDemo: boolean;
  receivingAccountVersion: number | null;
}
export interface BankAccount {
  id?: string;
  locationId: string;
  bankIdentifier: string;
  accountNumber: string;
  accountHolder: string;
  enabled: boolean;
  isDevelopmentDemo: boolean;
  version: number;
}
export interface BankTransfer {
  allocatedSettlementContractId?: string | null;
  allocatedSettlementReceivableId?: string | null;
  id: string;
  providerIdentity: string;
  bankReference: string;
  amount: string;
  currency: string;
  occurredAt: string;
  transferDescription: string;
  statementReference: string;
  verificationReason: string;
  verifiedByUserId: string;
  verifiedAt: string;
  proposedInvoiceId: string | null;
  status: string;
  reason: string;
  allocatedInvoiceId: string | null;
  isDevelopmentDemo: boolean;
  allocatedAmount?: string;
  unallocatedAmount?: string;
}
export interface TransferInput {
  providerIdentity: string;
  bankReference: string;
  amount: string;
  currency: 'VND';
  occurredAt: string;
  transferDescription: string;
  statementReference: string;
  verificationReason: string;
  proposedInvoiceId: string | null;
  humanVerified: boolean;
  isDevelopmentDemo: boolean;
}
export interface Reconciliation {
  sequence: number;
  invoiceId: string | null;
  decision: string;
  reason: string;
  actorId: string;
  occurredAt: string;
}
export interface DebtInvoice {
  invoiceId: string;
  locationId: string;
  roomId: string;
  locationName: string;
  roomNumber: string;
  billingPeriod: string;
  dueDate: string;
  payableAmount: string | null;
  paidAmount: string | null;
  outstandingAmount: string;
  paymentStatus: 'Paid' | 'Unpaid';
  overdueDays: number;
  originalIssuedAmount?: string | null;
  approvedAdjustmentTotal?: string | null;
  potentialExcessAmount?: string | null;
}
export interface DebtSummary {
  outstandingAmount: string;
  overdueAmount: string;
  invoiceCount: number;
  overdueInvoiceCount: number;
}
export interface PaymentHistory {
  id: string;
  invoiceId: string;
  locationId: string;
  roomId: string;
  locationName: string;
  roomNumber: string;
  billingPeriod: string;
  amount: string;
  paidAt: string;
  paidBy: string;
  verificationSource: string;
  bankReference: string | null;
  verifiedByUserId: string | null;
}
export interface PayerChoice {
  userId: string;
  displayLabel: string;
}
export interface ReceiptExcessTarget {
  invoiceId?: string | null;
  settlementContractId?: string | null;
  receivableId?: string | null;
  holdingContractId?: string | null;
}
export interface ReceiptExcessDisposition {
  id: string;
  transferId: string;
  target: ReceiptExcessTarget;
  roomId: string;
  amount: string;
  payerResidentId: string;
  payerUserId: string | null;
  payerLabel: string;
  reason: string;
  approvedAt: string;
  isDevelopmentDemo: boolean;
}
export interface ReceiptExcessContext {
  transferId: string;
  target: ReceiptExcessTarget;
  roomId: string;
  amount: string;
  outstanding: string;
  transferReference: string;
  payers: { residentId: string; userId: string | null; label: string }[];
  reference: string;
  problems: string[];
  disposition: ReceiptExcessDisposition | null;
  isDevelopmentDemo: boolean;
}
export interface PaymentFilter {
  settlementContractId?: string;
  page?: number;
  locationId?: string;
  roomId?: string;
  billingPeriod?: string;
  overdueOnly?: boolean;
  paymentStatus?: string;
}
export function paymentQuery(filter: PaymentFilter = {}) {
  const query = new URLSearchParams({ page: String(filter.page ?? 1), pageSize: '20' });
  for (const [key, value] of Object.entries(filter))
    if (value !== undefined && value !== '') query.set(key, String(value));
  return query.toString();
}
export function paymentClient(request: <T>(path: string, init?: RequestInit) => Promise<T>) {
  const mutation = <T>(route: string, body: unknown, key: string) =>
    request<T>(route, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(body),
    });
  const root = '/api/v1/payment-transactions';
  return {
    excessDisposition: async (id: string, signal?: AbortSignal) =>
      (await request<ReceiptExcessDisposition | null>(
        `${root}/${encodeURIComponent(id)}/excess-disposition`,
        { signal },
      )) ?? null,
    excessContext: (id: string, target: ReceiptExcessTarget, signal?: AbortSignal) => {
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(target)) if (value) query.set(name, value);
      return request<ReceiptExcessContext>(
        `${root}/${encodeURIComponent(id)}/excess-disposition/context?${query}`,
        { signal },
      );
    },
    confirmExcess: (
      id: string,
      input: {
        target: ReceiptExcessTarget;
        expectedReference: string;
        payerResidentId: string;
        reason: string;
        humanConfirmed: boolean;
      },
      key: string,
    ) =>
      mutation<ReceiptExcessDisposition>(
        `${root}/${encodeURIComponent(id)}/excess-disposition`,
        input,
        key,
      ),
    payment: (id: string, signal?: AbortSignal) =>
      request<InvoicePayment>(`/api/v1/invoices/${encodeURIComponent(id)}/payment`, { signal }),
    instructions: (id: string, signal?: AbortSignal) =>
      request<TransferInstructions>(
        `/api/v1/invoices/${encodeURIComponent(id)}/transfer-instructions`,
        { signal },
      ),
    payers: (id: string, signal?: AbortSignal) =>
      request<PayerChoice[]>(`/api/v1/invoices/${encodeURIComponent(id)}/payment/eligible-payers`, {
        signal,
      }),
    invoices: (filter: PaymentFilter, signal?: AbortSignal) =>
      request<Page<DebtInvoice>>('/api/v1/payment-invoices?' + paymentQuery(filter), { signal }),
    debts: (filter: PaymentFilter, signal?: AbortSignal) =>
      request<Page<DebtInvoice>>('/api/v1/debts?' + paymentQuery(filter), { signal }),
    debtSummary: (filter: PaymentFilter, signal?: AbortSignal) =>
      request<DebtSummary>('/api/v1/debts/summary?' + paymentQuery(filter), { signal }),
    history: (filter: PaymentFilter, signal?: AbortSignal) =>
      request<Page<PaymentHistory>>('/api/v1/payment-history?' + paymentQuery(filter), { signal }),
    transfers: (filter: PaymentFilter, signal?: AbortSignal) =>
      request<Page<BankTransfer>>(root + '?' + paymentQuery(filter), { signal }),
    transfer: (id: string, signal?: AbortSignal) =>
      request<BankTransfer>(`${root}/${encodeURIComponent(id)}`, { signal }),
    reviews: (id: string, signal?: AbortSignal) =>
      request<Page<Reconciliation>>(`${root}/${encodeURIComponent(id)}/reconciliation-history`, {
        signal,
      }),
    register: (input: TransferInput, key: string) => mutation<BankTransfer>(root, input, key),
    allocate: (id: string, invoiceId: string, paidByUserId: string | null, key: string) =>
      mutation<{ status: string; reason: string }>(
        `${root}/${encodeURIComponent(id)}/allocate`,
        { invoiceId, paidByUserId, humanVerified: true },
        key,
      ),
    reject: (id: string, reason: string, key: string) =>
      mutation(`${root}/${encodeURIComponent(id)}/reject`, { reason }, key),
    allocateHolding: (id: string, contractId: string, paidByUserId: string, key: string) =>
      mutation<{ status: string; reason: string }>(
        `${root}/${encodeURIComponent(id)}/allocate-holding-deposit`,
        { contractId, paidByUserId, humanVerified: true },
        key,
      ),
    account: async (locationId: string, signal?: AbortSignal) =>
      (await request<BankAccount | undefined>(
        `/api/v1/receiving-bank-accounts/${encodeURIComponent(locationId)}`,
        { signal },
      )) ?? null,
    saveAccount: (input: BankAccount) =>
      request<BankAccount>('/api/v1/receiving-bank-accounts', {
        method: 'PUT',
        body: JSON.stringify({ ...input, expectedVersion: input.version, humanVerified: true }),
      }),
  };
}
const labels: Record<string, string> = {
  ExcessRefundPending: 'Phải hoàn tiền dư',
  ExcessRefundCompleted: 'Đã hoàn tiền dư',
  verified_whole_excess_refund_required: 'Toàn bộ giao dịch phải hoàn cho người thực trả.',
  verified_whole_excess_refund_completed: 'Đã hoàn toàn bộ giao dịch cho người thực trả.',
  verified_whole_excess_returned: 'Đã hoàn toàn bộ giao dịch cho người thực trả.',
  verified_partial_excess_returned: 'Đã hoàn một phần tiền dư; tiếp tục xử lý số còn lại.',
  receipt_target_not_settled: 'Nghĩa vụ vẫn còn số tiền phải trả; cần đối soát phân bổ trước.',
  receipt_verified_payer_required: 'Cần xác minh hồ sơ người thực trả trước khi hoàn.',
  verified_bank_receipt_required: 'Giao dịch chưa đủ điều kiện xác minh tiền ngân hàng thực nhận.',
  development_payment_mismatch: 'Giao dịch và nghĩa vụ phải cùng chế độ dữ liệu.',
  refund_source_requires_manual_review: 'Giao dịch đã có yêu cầu hoàn; cần kiểm tra hồ sơ hiện có.',
  bank_transaction_already_allocated: 'Giao dịch đã được phân bổ; xem hồ sơ hoàn phần dư.',
  Paid: 'Đã thanh toán',
  verified_partial_payment: 'Đã ghi nhận thanh toán một phần; tiếp tục theo dõi dư nợ.',
  verified_excess_payment_pending_review:
    'Đã thanh toán đủ hóa đơn; tiền thừa giữ chờ Owner xử lý.',
  Unpaid: 'Chưa thanh toán',
  NotIssued: 'Chưa phát hành',
  PendingReview: 'Chờ đối soát',
  Allocated: 'Đã ghi nhận',
  Rejected: 'Không phân bổ',
  partial_payment_policy_required: 'Tiền thiếu: chờ quyết định phân bổ, chưa ghi có.',
  excess_payment_policy_required: 'Tiền thừa: chờ xử lý, chưa tự phân bổ hoặc hoàn tiền.',
  invoice_already_settled: 'Hóa đơn đã thanh toán; giao dịch mới được giữ để đối soát.',
  invoice_transfer_reference_mismatch: 'Nội dung chuyển khoản chưa khớp hóa đơn.',
  bank_reference_already_credited: 'Tham chiếu đã ghi có cho nghĩa vụ khác.',
  owner_allocation_confirmation_required: 'Owner cần xác nhận phân bổ sau đối chiếu sao kê.',
  unmatched_bank_transfer: 'Chưa xác định hóa đơn nhận tiền.',
  verified_full_payment: 'Đã xác minh đủ số dư phải trả.',
  ReceivingAccountUnavailable: 'Chưa có tài khoản nhận tiền được bật. Vui lòng liên hệ Owner.',
  Settled: 'Hóa đơn đã đủ tiền, không cấp thêm QR chuyển khoản.',
  NotIssuedInstructions: 'Chỉ cung cấp hướng dẫn khi hóa đơn được phát hành.',
};
export function paymentText(value: string) {
  return labels[value] ?? 'Cần kiểm tra thông tin đối soát';
}
export function paymentError(error: unknown) {
  const value = error as { status?: number; code?: string; problem?: { code?: string } };
  const code =
    error instanceof ApiError ? error.problem?.code : (value?.code ?? value?.problem?.code);
  const errors: Record<string, string> = {
    receipt_excess_already_confirmed: 'Giao dịch đã xác nhận phải hoàn. Tải lại hồ sơ hoàn tiền.',
    receipt_excess_review_changed: 'Số liệu đối chiếu đã thay đổi. Tải lại và xác nhận lại.',
    receipt_excess_not_ready:
      'Chưa đủ điều kiện xác nhận toàn bộ tiền dư. Kiểm tra các mục còn vướng.',
    receipt_verified_payer_required: 'Chọn đúng hồ sơ người thực trả đã được xác minh.',
    receipt_excess_confirmation_required:
      'Cần chọn người thực trả, nhập lý do và xác nhận đối chiếu.',
    invalid_verified_bank_transfer:
      'Kiểm tra số tiền VND nguyên, thời gian và bằng chứng sao kê; cần xác nhận của Owner.',
    payment_idempotency_key_reused:
      'Yêu cầu đã dùng với nội dung khác. Hãy tải lại trước khi thao tác.',
    bank_transaction_identity_conflict: 'Tham chiếu ngân hàng đã tồn tại với dữ liệu khác.',
    receiving_account_version_changed: 'Tài khoản nhận đã thay đổi. Hãy tải lại.',
    invalid_receiving_bank_account:
      'Kiểm tra BIN 6 số, tài khoản 6–19 số, tên in hoa không dấu và xác nhận cấu hình.',
    payer_not_invoice_viewer: 'Người trả phải thuộc danh sách khách có quyền trên hóa đơn.',
    allocated_payment_cannot_be_rejected: 'Không thể từ chối giao dịch đã phân bổ.',
    bank_transfer_rejected: 'Giao dịch đã bị từ chối phân bổ.',
    development_payment_unavailable:
      'Giao dịch tổng hợp chỉ được đối soát trong Development/Testing.',
    final_invoice_required: 'Chỉ đối soát vào hóa đơn đã phát hành.',
    payment_concurrent_or_duplicate_effect:
      'Có thay đổi hoặc tham chiếu đã được xử lý. Tải lại để kiểm tra.',
  };
  return (
    (code && errors[code]) ||
    (value?.status === 403
      ? 'Tài khoản không có quyền thực hiện thao tác.'
      : value?.status === 404
        ? 'Không tìm thấy dữ liệu trong phạm vi tài khoản.'
        : 'Chưa hoàn thành yêu cầu. Tải lại trạng thái trước khi thử lại.')
  );
}
