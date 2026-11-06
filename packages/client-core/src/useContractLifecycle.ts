import { useCallback, useEffect, useState } from 'react';
import {
  contractError,
  type ContractClient,
  type FinalInspection,
  type InspectionPreparation,
  type SettlementSummary,
} from './contracts';

interface LifecycleState {
  loading: boolean;
  error: string;
  inspections: FinalInspection[];
  preparation: InspectionPreparation | null;
  summary: SettlementSummary | null;
  history: { version: number; action: string; occurredAt: string }[];
}
const emptyLifecycle: LifecycleState = {
  loading: true,
  error: '',
  inspections: [],
  preparation: null,
  summary: null,
  history: [],
};

export function useContractLifecycle(api: ContractClient, id: string, role: string) {
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  const [snapshot, setSnapshot] = useState<{
    api: ContractClient;
    id: string;
    role: string;
    revision: number;
    data: LifecycleState;
  } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    const request = { api, id, role, revision };
    void Promise.all([
      api.inspections(id, c.signal),
      role !== 'Tenant' ? api.inspectionPreparation(id, c.signal) : Promise.resolve(null),
      role !== 'Staff' ? api.settlementSummary(id, c.signal) : Promise.resolve(null),
      api.moveOutHistory(id, c.signal),
    ])
      .then(([inspections, preparation, summary, history]) => {
        if (!c.signal.aborted)
          setSnapshot({
            ...request,
            data: { loading: false, error: '', inspections, preparation, summary, history },
          });
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setSnapshot({
            ...request,
            data: { ...emptyLifecycle, loading: false, error: contractError(e) },
          });
      });
    return () => c.abort();
  }, [api, id, role, revision]);
  const current =
    snapshot?.api === api &&
    snapshot.id === id &&
    snapshot.role === role &&
    snapshot.revision === revision;
  return { ...(current ? snapshot.data : emptyLifecycle), reload };
}

const blockers: Record<string, string> = {
  owner_termination_approval_required: 'Chờ Owner duyệt yêu cầu trả phòng.',
  owner_confirmed_inspection_required: 'Chờ Owner xác nhận biên bản kiểm tra.',
  final_charges_and_damage_policy_pending:
    'Chờ xác minh phí cuối kỳ / thiệt hại và chính sách tính phí.',
  confirmed_handover_baseline_required: 'Thiếu biên bản nhận phòng đã xác nhận để đối chiếu.',
  deposit_deduction_refund_policy_required:
    'Chờ xử lý khấu trừ hoặc hoàn cọc đã được xác minh; chưa thể hoàn tất trả phòng.',
  deposit_ledger_reconciliation_required:
    'Nguồn cọc và sổ phân bổ không khớp; cần Owner đối chiếu.',
  deposit_refund_manual_review_required:
    'Khoản hoàn cọc chưa đủ bằng chứng phân loại hoặc nghĩa vụ đã thay đổi.',
  deposit_source_requires_review: 'Nguồn cọc có phân bổ hoặc số dư chưa được xác minh.',
  deposit_deductions_require_review: 'Còn phí hoặc khấu trừ cần xử lý trước khi hoàn cọc.',
  deposit_deduction_reapproval_required:
    'Nghĩa vụ hoặc biên bản đã đổi; Owner cần xem xét lại quyết định khấu trừ.',
  deposit_contract_not_active: 'Hợp đồng đã kết thúc hoặc chưa Active; không lập khoản hoàn mới.',
  refund_source_requires_manual_review:
    'Có khoản hoàn cũ chưa được phân loại; cần đối chiếu nguồn.',
  holding_allocation_settlement_required: 'Cọc giữ chỗ còn cần đối chiếu.',
  draft_invoice_pending: 'Còn hóa đơn nháp chưa phát hành.',
  shared_liability_allocation_pending:
    'Hóa đơn chung còn nợ; chưa có chính sách phân bổ nghĩa vụ khi một người rời phòng.',
  invoice_outstanding: 'Còn dư nợ hóa đơn.',
  invoice_excess_pending_review: 'Có tiền dư cần đối chiếu.',
  invoice_adjustment_pending: 'Còn yêu cầu điều chỉnh hóa đơn chờ duyệt.',
  bank_transfer_pending_review: 'Giao dịch ngân hàng đang chờ đối chiếu.',
  final_usage_not_covered_by_invoice: 'Chỉ số chốt chưa được bao phủ bởi hóa đơn đã phát hành.',
};
export function settlementBlocker(value: string) {
  if (value.startsWith('unbilled_final_usage_pending:'))
    return 'Chỉ số chốt chưa được bao phủ bởi hóa đơn đã phát hành.';
  if (value.startsWith('final_invoice_coverage_required:'))
    return 'Thiếu hóa đơn đã phát hành cho kỳ ' + value.split(':')[1];
  return blockers[value] ?? 'Cần đối chiếu: ' + value;
}
export function moveOutActionLabel(action: string) {
  return (
    (
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
    )[action] ?? action
  );
}
