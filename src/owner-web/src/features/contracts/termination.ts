import type { MoveOut, SettlementSummary } from '../../../../../packages/client-core/src/contracts';

export function moveOutProgress(
  move: MoveOut,
  inspectionConfirmed: boolean,
  resolved: boolean | null,
) {
  const approved = ['Approved', 'Inspected', 'PendingSettlement', 'Settled', 'Completed'].includes(
    move.status,
  );
  const inspected = ['Inspected', 'PendingSettlement', 'Settled', 'Completed'].includes(
    move.status,
  );
  return [
    { label: 'Yêu cầu', done: true },
    { label: 'Phê duyệt', done: approved },
    { label: 'Lịch kiểm tra', done: !!move.inspectionScheduledAt },
    { label: 'Biên bản', done: inspected },
    { label: 'Duyệt biên bản', done: inspectionConfirmed },
    {
      label: 'Quyết toán',
      done: resolved === true && move.financialReviewStatus === 'OwnerReviewed',
    },
    { label: 'Trả phòng', done: move.status === 'Completed' },
  ];
}

export function financialState(summary: SettlementSummary | null, move: MoveOut) {
  if (!summary) return 'Chưa đối chiếu được';
  if (!summary.resolved) return 'Chưa hoàn tất';
  return move.financialReviewStatus === 'OwnerReviewed' ? 'Đã hoàn tất' : 'Chờ Owner xác nhận';
}

export function offsetAmountError(
  amount: string,
  deposit: string,
  outstanding: string | null,
): string | null {
  if (!amount) return null;
  if (!/^[1-9]\d{0,17}$/.test(amount)) return 'Nhập số tiền VND nguyên dương, tối đa 18 chữ số.';
  if (outstanding === null) return 'Chọn nghĩa vụ còn phải thanh toán trước khi xác nhận.';
  if (!/^\d+(?:\.0+)?$/.test(deposit) || !/^\d+(?:\.0+)?$/.test(outstanding))
    return 'Chưa đủ dữ liệu để xác nhận giới hạn cấn trừ.';
  const value = BigInt(amount);
  if (value > BigInt(deposit.split('.')[0])) return 'Số tiền vượt cọc khả dụng.';
  if (value > BigInt(outstanding.split('.')[0]))
    return 'Số tiền vượt nghĩa vụ còn phải thanh toán.';
  return null;
}

/** Read only approved display fields, never raw financial fingerprints or storage keys. */
export function historyNote(snapshot: unknown): string | null {
  if (typeof snapshot !== 'string') return null;
  try {
    const value: unknown = JSON.parse(snapshot);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const note = record.reason ?? record.Reason ?? record.inspectionNotes ?? record.InspectionNotes;
    return typeof note === 'string' ? note.slice(0, 4000) : null;
  } catch {
    return null;
  }
}
