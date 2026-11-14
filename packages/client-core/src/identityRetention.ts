export interface IdentityRetentionPolicy {
  approvedDecisionReference: string | null;
  retentionDays: number | null;
  startBasis: string | null;
}
export interface IdentityRetentionEvent {
  id: string;
  action: 'Review' | 'PlaceHold' | 'ReleaseHold';
  holdId: string | null;
  reason: string;
  actorId: string;
  at: string;
  sourceReference: string;
  blockingReasons: string[];
}
export interface IdentityRetentionView {
  residentId: string;
  reference: string;
  policy: IdentityRetentionPolicy;
  startDate: string | null;
  reviewAfter: string | null;
  status: string;
  canDelete: boolean;
  blockingReasons: string[];
  activeHolds: IdentityRetentionEvent[];
  history: IdentityRetentionEvent[];
}
const reasons: Record<string, string> = {
  current_residence: 'Hồ sơ còn gắn nơi ở hiện tại.',
  contract_not_closed: 'Còn hợp đồng chưa đóng.',
  residence_not_closed: 'Thời gian cư trú thực tế chưa được đóng.',
  identity_retention_hold_active: 'Đang có lệnh giữ hồ sơ.',
  refund_pending: 'Còn nghĩa vụ hoàn tiền chưa hoàn tất.',
  financial_obligations_require_review: 'Quyết toán hoặc nghĩa vụ tài chính cần đối chiếu.',
  preaccount_contract_records_require_review:
    'Hồ sơ hợp đồng đã đóng trước khi có tài khoản cần được rà soát theo chính sách lưu trữ.',
  holding_financial_records_require_review:
    'Có chứng từ cọc giữ chỗ cần rà soát phạm vi lưu giữ theo chính sách được duyệt.',
  financial_ledger_unavailable: 'Chưa xác minh được sổ tài chính.',
  retention_policy_unapproved: 'Chưa có tham chiếu quyết định chính sách được phê duyệt.',
  retention_duration_unconfigured: 'Thời hạn lưu giữ chưa được cấu hình từ chính sách đã duyệt.',
  retention_start_policy_unconfigured: 'Chưa duyệt căn cứ bắt đầu tính thời hạn.',
  retention_start_unavailable: 'Chưa có ngày bắt đầu theo căn cứ chính sách.',
  retention_period_not_elapsed: 'Chưa qua thời gian lưu giữ theo cấu hình.',
};
export const identityRetentionReason = (code: string) =>
  reasons[code] ?? 'Cần rà soát điều kiện lưu giữ hồ sơ.';
