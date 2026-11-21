import { inputDate } from '../../lib/identity';
export type Draft = Record<string, string>;
export type WorkflowKind =
  | 'contract'
  | 'move-out'
  | 'move-in'
  | 'residence'
  | 'adjustment'
  | 'contract-request'
  | 'task'
  | 'debt'
  | 'incident';
export function validateWorkflow(kind: WorkflowKind, data: Draft, evidence: number): string[] {
  const errors: string[] = [];
  const required: Record<WorkflowKind, string[]> = {
    contract: ['room', 'tenant', 'type', 'start', 'end', 'terms', 'deposit'],
    'move-out': ['room', 'date', 'condition', 'electric', 'water'],
    'move-in': ['room', 'date', 'condition', 'electric', 'water', 'keys'],
    residence: ['start', 'result', 'reference'],
    adjustment: ['invoice', 'charge', 'reason'],
    'contract-request': ['type', 'date', 'reason'],
    task: ['progress', 'note'],
    debt: ['outcome', 'note'],
    incident: ['room', 'severity', 'description'],
  };
  if (required[kind].some((key) => !data[key]?.trim()))
    errors.push('Điền đầy đủ các trường có dấu *.');
  if (kind === 'contract' && data.type === 'main' && !data.rent?.trim())
    errors.push('Hợp đồng thuê chính cần tiền thuê theo chính sách đã cấu hình.');
  if (
    kind === 'contract' &&
    data.type === 'main' &&
    data.source === 'holding' &&
    !data.holdingRef?.trim()
  )
    errors.push('Chọn tham chiếu hợp đồng giữ chỗ để backend kiểm tra hợp lệ.');
  for (const key of ['date', 'start', 'end'])
    if (data[key]) {
      try {
        inputDate(data[key]);
      } catch {
        errors.push('Ngày không hợp lệ; dùng dd/MM/yyyy.');
        break;
      }
    }
  if (data.start && data.end) {
    try {
      if (inputDate(data.start)! >= inputDate(data.end)!)
        errors.push('Ngày kết thúc phải sau ngày bắt đầu.');
    } catch {
      /* reported above */
    }
  }
  for (const key of ['electric', 'water', 'deposit', 'rent', 'amount', 'progress', 'cost'])
    if (data[key]) {
      if (
        !/^\d+(?:[.,]\d{1,4})?$/.test(data[key]) ||
        !Number.isFinite(Number(data[key].replace(',', '.')))
      )
        errors.push('Số tiền/chỉ số phải là số không âm, không dùng dấu phân cách hàng nghìn.');
    }
  if (data.progress && Number(data.progress) > 100) errors.push('Tiến độ không vượt quá 100%.');
  if (kind === 'adjustment' && data.reason?.trim().length < 10)
    errors.push('Mô tả khoản thu tranh chấp và lý do bằng ít nhất 10 ký tự.');
  if (kind === 'incident' && data.description?.trim().length < 10)
    errors.push('Mô tả sự cố bằng ít nhất 10 ký tự.');
  if (kind === 'task' && data.mode === 'blocker' && !data.blocker?.trim())
    errors.push('Ghi rõ vướng mắc và hỗ trợ cần thiết.');
  if (kind === 'task' && data.mode === 'proposal' && (!data.cost?.trim() || !data.duration?.trim()))
    errors.push('Nhập dự toán chi phí và thời gian đề xuất để Owner xem xét.');
  if ((kind === 'move-out' || kind === 'move-in') && !data.keys?.trim())
    errors.push('Ghi nhận chìa khóa và thẻ bàn giao.');
  if ((kind === 'move-out' || kind === 'move-in') && evidence < 1)
    errors.push('Cần ít nhất một ảnh bằng chứng kiểm tra phòng/chỉ số.');
  if (kind === 'residence' && evidence < 1)
    errors.push('Đính kèm ít nhất một bằng chứng kết quả đăng ký.');
  if (kind === 'task' && data.mode === 'submit' && evidence < 1)
    errors.push('Cần ảnh kết quả trước khi gửi Owner kiểm tra.');
  if (evidence < 0 || evidence > 5) errors.push('Tối đa 5 ảnh minh chứng.');
  return [...new Set(errors)];
}
