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
  history: {
    version: number;
    action: string;
    occurredAt: string;
    actorId?: string;
    snapshot?: string;
  }[];
  sectionErrors: Partial<Record<'inspections' | 'preparation' | 'summary' | 'history', string>>;
}
const emptyLifecycle: LifecycleState = {
  loading: true,
  error: '',
  inspections: [],
  preparation: null,
  summary: null,
  history: [],
  sectionErrors: {},
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
    void Promise.allSettled([
      api.inspections(id, c.signal),
      role !== 'Tenant' ? api.inspectionPreparation(id, c.signal) : Promise.resolve(null),
      role !== 'Staff' ? api.settlementSummary(id, c.signal) : Promise.resolve(null),
      api.moveOutHistory(id, c.signal),
    ])
      .then(([inspections, preparation, summary, history]) => {
        if (!c.signal.aborted) {
          // Access loss must clear the entire snapshot. Other source failures must
          // not hide a saved inspection or prevent scheduling a room inspection.
          const results = { inspections, preparation, summary, history };
          const accessLost = Object.values(results).find(
            (r) =>
              r.status === 'rejected' &&
              [401, 403, 404].includes((r.reason as { status?: number })?.status ?? 0),
          );
          const sectionErrors = Object.fromEntries(
            Object.entries(results)
              .filter(([, r]) => r.status === 'rejected')
              .map(([name, r]) => [name, contractError((r as PromiseRejectedResult).reason)]),
          );
          if (accessLost?.status === 'rejected') {
            setSnapshot({
              ...request,
              data: {
                ...emptyLifecycle,
                loading: false,
                error: contractError(accessLost.reason),
                sectionErrors,
              },
            });
            return;
          }
          setSnapshot({
            ...request,
            data: {
              loading: false,
              error: Object.values(sectionErrors).join(' '),
              sectionErrors,
              inspections: inspections.status === 'fulfilled' ? inspections.value : [],
              preparation: preparation.status === 'fulfilled' ? preparation.value : null,
              summary: summary.status === 'fulfilled' ? summary.value : null,
              history: history.status === 'fulfilled' ? history.value : [],
            },
          });
        }
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
  financial_ledger_and_deposit_policy:
    'Chờ đối chiếu nghĩa vụ, cọc và giao dịch thực tế; trạng thái bàn giao được theo dõi riêng.',
  final_charge_review_required: 'Owner cần xác nhận đủ danh sách khoản thu trả phòng hiện tại.',
  settlement_charge_sources_incomplete:
    'Còn nguồn khoản thu chưa xác nhận hoặc khoản phải thu chưa thanh toán.',
  deposit_offset_reconciliation_required:
    'Cần đối chiếu phân bổ cọc với từng quyết định cấn trừ đã duyệt.',
  settlement_receivable_outstanding: 'Còn khoản phải thu chuyển ra chưa thanh toán hết.',
  owner_termination_approval_required: 'Chờ Owner duyệt yêu cầu trả phòng.',
  owner_confirmed_inspection_required: 'Chờ Owner xác nhận biên bản kiểm tra.',
  final_charges_and_damage_policy_pending:
    'Chờ xác minh phí cuối kỳ / thiệt hại và chính sách tính phí.',
  confirmed_handover_baseline_required: 'Thiếu biên bản nhận phòng đã xác nhận để đối chiếu.',
  deposit_deduction_refund_policy_required:
    'Chờ xử lý cấn trừ hoặc hoàn cọc; bàn giao vật lý và tình trạng phòng được xử lý riêng.',
  deposit_ledger_reconciliation_required:
    'Nguồn cọc và sổ phân bổ không khớp; cần Owner đối chiếu.',
  deposit_refund_manual_review_required:
    'Khoản hoàn cọc chưa đủ bằng chứng phân loại hoặc nghĩa vụ đã thay đổi.',
  deposit_source_requires_review: 'Nguồn cọc có phân bổ hoặc số dư chưa được xác minh.',
  deposit_deductions_require_review: 'Còn phí hoặc khấu trừ cần xử lý trước khi hoàn cọc.',
  deposit_deduction_reapproval_required:
    'Nghĩa vụ hoặc biên bản đã đổi; Owner cần xem xét lại quyết định khấu trừ.',
  deposit_contract_not_active: 'Hợp đồng chưa đủ trạng thái để đối chiếu hoàn cọc.',
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
  final_meter_readings_required: 'Cần chỉ số điện và nước chốt đã được Staff xác nhận.',
  maintenance_compensation_pending: 'Còn khoản bồi thường bảo trì cần Owner xử lý.',
  receipt_excess_refund_pending: 'Còn tiền dư giao dịch cần đối soát hoặc hoàn lại.',
  legacy_deduction_requires_migration_review:
    'Có quyết định khấu trừ cũ cần đối chiếu trước khi dùng luồng mới.',
};
export function settlementBlocker(value: string) {
  if (value.startsWith('unbilled_final_usage_pending:'))
    return 'Chỉ số chốt chưa được bao phủ bởi hóa đơn đã phát hành.';
  if (value.startsWith('final_invoice_coverage_required:'))
    return 'Thiếu hóa đơn đã phát hành cho kỳ ' + value.split(':')[1];
  return (
    blockers[value] ??
    'Còn điều kiện cần đối chiếu. Tải lại dữ liệu hoặc liên hệ người quản lý để kiểm tra.'
  );
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
    )[action] ?? 'Cập nhật trả phòng'
  );
}
