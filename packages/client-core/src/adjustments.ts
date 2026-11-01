import { ApiError } from './api';
import type { ContractRequest } from './contracts';
import { formatContractMoney } from './contracts';
import type { Invoice, Page } from './invoices';

export interface AdjustmentFinancials {
  originalIssuedAmount: string;
  approvedAdjustmentTotal: string;
  effectivePayableAmount: string;
  allocatedPayments: string;
  outstandingAmount: string;
  potentialExcessAmount: string;
  financialVersion: number;
  reviewStatus: string;
}
export interface AdjustmentEvidence {
  id: string;
  contentType: string;
  length: number;
}
export interface AdjustmentDecision {
  outcome: string;
  invoiceStatus: string;
  chargeCode: string | null;
  beforeAmount: string;
  correctedAmount: string | null;
  delta: string;
  effectiveBefore: string;
  effectiveAfter: string;
  paidAtDecision: string;
  reason: string;
  ownerId: string;
  decidedAt: string;
}
export interface Adjustment {
  id: string;
  invoiceId: string;
  locationName: string;
  roomNumber: string;
  billingPeriod: string;
  requesterId: string;
  invoiceLineId: string | null;
  chargeCode: string | null;
  currentAmount: string;
  proposedAmount: string | null;
  reason: string;
  invoiceSnapshot: string;
  invoiceStatus: string;
  invoiceVersion: number;
  financialVersion: number;
  status: string;
  version: number;
  submittedAt: string;
  evidence: AdjustmentEvidence[];
  currentInvoice: Invoice;
  decision: AdjustmentDecision | null;
  currentFinancialVersion: number;
  financials: AdjustmentFinancials | null;
  currentChargeAmount: string | null;
}
export interface AdjustmentEffect {
  id: string;
  invoiceStatus: string;
  chargeCode: string | null;
  delta: string;
  beforeAmount: string;
  correctedAmount: string | null;
  decidedAt: string;
}
export interface AdjustmentSubmit {
  invoiceLineId: string | null;
  proposedAmount: string | null;
  reason: string;
  evidenceIds: string[];
  expectedInvoiceVersion: number;
}
export interface AdjustmentDecisionInput {
  expectedVersion: number;
  expectedInvoiceVersion: number;
  expectedFinancialVersion: number;
  correctedAmount: string | null;
  chargeCode: string | null;
  reason: string;
  humanConfirmed: boolean;
}
export interface AdjustmentFilter {
  page?: number;
  locationId?: string;
  roomId?: string;
  invoiceId?: string;
  status?: string;
}
export function adjustmentClient(request: ContractRequest) {
  const root = '/api/v1/invoice-adjustments';
  return {
    list: (filter: AdjustmentFilter = {}, signal?: AbortSignal) => {
      const q = new URLSearchParams({ page: '1', pageSize: '20' });
      for (const [key, value] of Object.entries(filter))
        if (value !== '' && value !== undefined) q.set(key, String(value));
      return request<Page<Adjustment>>(root + '?' + q, { signal });
    },
    get: (id: string, signal?: AbortSignal) =>
      request<Adjustment>(`${root}/${encodeURIComponent(id)}`, { signal }),
    submit: (invoiceId: string, input: AdjustmentSubmit, key: string) =>
      request<Adjustment>(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/adjustment-requests`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(input),
      }),
    decide: (id: string, approve: boolean, input: AdjustmentDecisionInput, key: string) =>
      request<Adjustment>(`${root}/${encodeURIComponent(id)}/${approve ? 'approve' : 'reject'}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(input),
      }),
    upload: (invoiceId: string, content: BodyInit, contentType: string) =>
      request<AdjustmentEvidence>(
        `/api/v1/invoices/${encodeURIComponent(invoiceId)}/adjustment-evidence`,
        { method: 'PUT', headers: { 'Content-Type': contentType }, body: content },
      ),
    evidence: (id: string, fileId: string, signal?: AbortSignal) =>
      request<Blob>(
        `${root}/${encodeURIComponent(id)}/evidence/${encodeURIComponent(fileId)}`,
        { signal },
        'blob',
      ),
    evidenceBytes: (id: string, fileId: string, signal?: AbortSignal) =>
      request<Uint8Array>(
        `${root}/${encodeURIComponent(id)}/evidence/${encodeURIComponent(fileId)}`,
        { signal },
        'bytes',
      ),
    effects: (invoiceId: string, page = 1, signal?: AbortSignal) =>
      request<Page<AdjustmentEffect>>(
        `/api/v1/invoices/${encodeURIComponent(invoiceId)}/adjustments?page=${page}&pageSize=20`,
        { signal },
      ),
  };
}
export const adjustmentStatus = (status: string) =>
  ({ Pending: 'Chờ Owner xem xét', Approved: 'Đã phê duyệt', Rejected: 'Đã từ chối' })[status] ??
  status;
export function signedVnd(amount: string) {
  return amount.startsWith('-')
    ? '−' + formatContractMoney(amount.slice(1))
    : (amount !== '0' ? '+' : '') + formatContractMoney(amount);
}
export function adjustmentError(error: unknown) {
  const x =
    error instanceof ApiError
      ? { status: error.status, code: error.problem?.code }
      : (error as { status?: number; code?: string });
  const labels: Record<string, string> = {
    adjustment_invoice_changed:
      'Hóa đơn hoặc số dư đã thay đổi. Tải lại, kiểm tra và xác nhận lại.',
    adjustment_already_decided: 'Yêu cầu đã được xử lý. Tải lại để xem kết quả.',
    adjustment_concurrent_change: 'Có thao tác đồng thời. Tải lại trước khi quyết định.',
    adjustment_evidence_invalid:
      'Ảnh không hợp lệ, hết hạn hoặc đã gắn yêu cầu khác. Hãy tải ảnh mới.',
    adjustment_draft_charge_required: 'Chọn khoản phí hiện có để sửa hóa đơn nháp.',
    adjustment_amount_out_of_range: 'Giá trị điều chỉnh làm số tiền hóa đơn không hợp lệ.',
    invalid_adjustment_request: 'Kiểm tra lý do, giá trị đề xuất và ảnh bằng chứng.',
    invalid_adjustment_decision: 'Nhập lý do, số tiền VND hợp lệ và xác nhận đã kiểm tra.',
    adjustment_idempotency_key_reused: 'Thao tác đã có dữ liệu khác. Tải lại để kiểm tra.',
  };
  return (
    labels[x?.code ?? ''] ??
    {
      400: 'Dữ liệu điều chỉnh không hợp lệ.',
      401: 'Phiên đăng nhập hết hạn.',
      403: 'Tài khoản không có quyền thao tác này.',
      404: 'Không tìm thấy yêu cầu hoặc bạn không có quyền xem.',
      409: 'Dữ liệu đã thay đổi. Tải lại để kiểm tra.',
      413: 'Ảnh vượt quá 5 MB.',
    }[x?.status ?? 0] ??
    'Chưa xác nhận thành công. Hãy tải lại và thử lại.'
  );
}
