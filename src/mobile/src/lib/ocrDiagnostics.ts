import type { Proposal } from './api';

export const ocrProfiles = [
  { id: 'identity-front', label: 'CCCD · Mặt trước' },
  { id: 'identity-back', label: 'CCCD · Mặt sau' },
  { id: 'electricity-mechanical', label: 'Điện · Cơ khí' },
  { id: 'electricity-digital', label: 'Điện · Điện tử' },
  { id: 'water-mechanical', label: 'Nước · Cơ khí' },
  { id: 'water-digital', label: 'Nước · Điện tử' },
];
export interface DiagnosticResult {
  proposal: Proposal;
  elapsedMilliseconds: number;
}
export function diagnosticStatus(proposal: Proposal) {
  if (proposal.isFallback) return 'OCR chưa trả được kết quả';
  if (Object.keys(proposal.proposedFields).length === 0)
    return 'Chưa trích xuất được trường dữ liệu';
  return 'Đã nhận được dữ liệu OCR';
}
const warnings: Record<string, string> = {
  ocr_unavailable: 'Engine/model OCR chưa sẵn sàng trên máy chủ.',
  ocr_timeout: 'Xử lý OCR vượt thời gian cho phép.',
  ocr_busy: 'Engine đang xử lý ảnh khác. Hãy thử lại.',
  no_text: 'Không phát hiện được chữ trong ảnh.',
  possible_glare: 'Ảnh có thể bị lóa hoặc có nhiều vùng quá sáng.',
  blur_or_low_detail: 'Ảnh mờ hoặc thiếu chi tiết. Hãy giữ máy ổn định và chụp gần hơn.',
  text_region_limit: 'Ảnh có quá nhiều vùng chữ; chỉ một phần được xử lý.',
};
export function diagnosticWarning(code: string) {
  return warnings[code] ? `${warnings[code]} (${code})` : code;
}
export const diagnosticFields: Record<string, string> = {
  citizenIdentityNumber: 'Số CCCD',
  fullName: 'Họ và tên',
  dateOfBirth: 'Ngày sinh',
  gender: 'Giới tính',
  nationality: 'Quốc tịch',
  placeOfOrigin: 'Quê quán',
  residentialAddress: 'Nơi cư trú',
  dateOfExpiry: 'Ngày hết hạn',
  dateOfIssue: 'Ngày cấp',
  placeOfIssue: 'Nơi cấp',
  reading: 'Chỉ số đồng hồ',
};
