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
  unsupported_or_unreadable_layout:
    'Chưa trích xuất được thông tin từ bố cục giấy tờ này. Hãy chụp trọn mặt thẻ hoặc nhập thủ công.',
  reading_not_recognized:
    'Chưa đọc được chỉ số công tơ. Hãy chụp rõ vùng hiển thị cùng đơn vị kWh hoặc m³, hoặc nhập thủ công.',
  ambiguous_reading:
    'Ảnh có nhiều chỉ số chưa phân biệt được. Hãy chụp gần vùng chỉ số cần ghi hoặc nhập thủ công.',
  conflicting_identity_numbers: 'Các số CCCD đọc được không khớp. Hãy kiểm tra và nhập lại.',
  low_confidence: 'Kết quả OCR có độ tin cậy thấp. Hãy đối chiếu với ảnh trước khi xác nhận.',
  orientation_corrected: 'Ảnh đã được xoay để nhận dạng. Hãy kiểm tra lại kết quả.',
  orientation_uncertain: 'Chiều đọc ảnh chưa chắc chắn. Hãy chụp đúng chiều hoặc nhập thủ công.',
  reading_preprocessed: 'Vùng chỉ số đã được tăng tương phản để đọc. Hãy đối chiếu với công tơ.',
  conflicting_reading: 'Các lần nhận dạng cho chỉ số khác nhau. Hãy chụp lại hoặc nhập thủ công.',
  decimal_separator_unverified:
    'Chưa xác định được vị trí dấu thập phân. Hãy chọn đúng số chữ số thập phân hoặc nhập thủ công.',
  decimal_places_applied:
    'Đã đặt dấu thập phân theo cấu hình công tơ. Hãy kiểm tra; phần lẻ vẫn được giữ đầy đủ.',
  meter_precision_mismatch:
    'Dấu thập phân đọc được không khớp cấu hình công tơ. Hãy kiểm tra cấu hình hoặc nhập thủ công.',
};
export function diagnosticEndpoint(profile: string, decimalPlaces = 'auto') {
  if (!ocrProfiles.some((item) => item.id === profile)) throw new Error('Invalid OCR profile');
  const base = `/api/v1/ocr/diagnostics/${profile}`;
  if (profile.startsWith('identity-') || decimalPlaces === 'auto') return base;
  if (!/^[0-4]$/.test(decimalPlaces)) throw new Error('Invalid meter precision');
  return `${base}?decimalPlaces=${decimalPlaces}`;
}
export function diagnosticWarning(code: string) {
  const fieldWarning = /^(invalid|conflicting)_(.+)$/.exec(code);
  if (fieldWarning && diagnosticFields[fieldWarning[2]!])
    return `${diagnosticFields[fieldWarning[2]!]!}: ${fieldWarning[1] === 'invalid' ? 'chưa đọc được giá trị hợp lệ' : 'có các giá trị không khớp'}. Hãy kiểm tra hoặc nhập thủ công. (${code})`;
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
