import type { ContractRequest, DepositDeductionPlan } from './contracts';
export interface RefundEvent {
  action: string;
  actor: string;
  at: string;
  reason: string;
  version: number;
}
export interface Refund {
  id: string;
  sourcePaymentId: string | null;
  sourceDepositContractId?: string | null;
  beneficiaryResidentId: string;
  beneficiaryLabel: string;
  amount: string;
  reason: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
  version: number;
  requestedAt: string;
  decisionReason: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  externalReference: string | null;
  isDevelopmentDemo: boolean;
  history: RefundEvent[];
  executionIntent: {
    key: string;
    contentType: string;
    length: number;
    sha256: string;
    executedAt: string;
    externalReference: string;
    reason: string;
  } | null;
}
export interface RefundSource {
  approvedDepositOffsets?: string;
  sourcePaymentId: string | null;
  sourceDepositContractId?: string | null;
  verifiedDepositAmount?: string | null;
  financialReference?: string | null;
  blockers?: string[] | null;
  depositDeductions?: DepositDeductionPlan | null;
  excessAmount: string;
  refundedAmount: string;
  reservedAmount: string;
  availableAmount: string | null;
  isDevelopmentDemo: boolean;
  beneficiaries: { id: string; label: string }[];
  requests: Refund[];
}
export interface RefundInput {
  beneficiaryResidentId: string;
  amount: string;
  reason: string;
  humanConfirmed: boolean;
}
export interface RefundExecution {
  expectedVersion: number;
  executedAt: string;
  externalReference: string;
  reason: string;
  humanConfirmed: boolean;
}
export function refundClient(request: ContractRequest) {
  return {
    source: (id: string, signal?: AbortSignal) =>
      request<RefundSource>(`/api/v1/payment-transactions/${id}/refunds`, { signal }),
    depositSource: (id: string, signal?: AbortSignal) =>
      request<RefundSource>(`/api/v1/contracts/${id}/deposit-refunds`, { signal }),
    createDeposit: (
      id: string,
      body: {
        refund: RefundInput;
        expectedFinancialReference: string;
        beneficiaryVerified: boolean;
        noDeductionsConfirmed: boolean;
        expectedDeductionPlanId?: string;
        deductionsConfirmed?: boolean;
      },
      key: string,
    ) =>
      request<Refund>(`/api/v1/contracts/${id}/deposit-refunds`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      }),
    create: (id: string, body: RefundInput, key: string) =>
      request<Refund>(`/api/v1/payment-transactions/${id}/refunds`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      }),
    decide: (
      id: string,
      body: { expectedVersion: number; approve: boolean; reason: string; humanConfirmed: boolean },
      key: string,
    ) =>
      request<Refund>(`/api/v1/refund-requests/${id}/decision`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      }),
    execute: (id: string, input: RefundExecution, file: Blob, key: string) => {
      const body = new FormData();
      Object.entries(input).forEach(([name, value]) => body.append(name, String(value)));
      body.append('evidence', file, 'chung-tu-hoan');
      return request<Refund>(`/api/v1/refund-requests/${id}/execution`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body,
      });
    },
    evidence: (id: string) => request<Blob>(`/api/v1/refund-requests/${id}/evidence`, {}, 'blob'),
  };
}
export function refundError(error: unknown): string {
  const e = error as { status?: number; code?: string; problem?: { code?: string } };
  const messages: Record<string, string> = {
    deposit_deduction_review_required:
      'Cần xem đúng quyết định khấu trừ đã duyệt trước khi yêu cầu hoàn phần còn lại.',
    deduction_evidence_integrity_failed:
      'Chứng từ thiệt hại không khớp quyết định. Cần Owner đối chiếu lại.',
    refund_amount_unavailable: 'Nguồn tiền đã được giữ chỗ hoặc hoàn. Hãy tải lại nguồn.',
    deposit_refund_confirmation_required:
      'Cần xác minh người nộp cọc và xác nhận không khấu trừ trước khi lập yêu cầu.',
    deposit_refund_not_ready:
      'Cọc chưa đủ điều kiện hoàn. Hãy đọc các nghĩa vụ đang chờ và tải lại nguồn.',
    refund_verified_payer_required:
      'Cần xác định đúng người thực trả và hồ sơ đã liên kết trước khi hoàn.',
    refund_changed: 'Yêu cầu đã thay đổi hoặc chưa ở bước phù hợp. Hãy tải lại.',
    refund_source_changed: 'Nguồn tiền hoặc người nhận đã thay đổi. Cần Owner kiểm tra lại.',
    refund_reference_used: 'Tham chiếu hoàn tiền đã dùng cho yêu cầu khác.',
    refund_execution_intent_conflict:
      'Đã có lần ghi nhận đang chờ. Dùng đúng ảnh và thông tin đang hiển thị để thử lại.',
    refund_evidence_integrity_failed:
      'Chứng từ không khớp nội dung đã ghi nhận. Cần Owner kiểm tra.',
    refund_idempotency_conflict: 'Mã thao tác đã dùng với nội dung khác. Hãy tải lại để kiểm tra.',
  };
  return (
    messages[e.code ?? e.problem?.code ?? ''] ??
    (e.status === 403
      ? 'Chỉ Owner được xử lý hoàn tiền.'
      : 'Chưa ghi nhận hoàn tất. Tải lại để kiểm tra trước khi thử lại.')
  );
}
