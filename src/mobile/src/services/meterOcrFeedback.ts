import type { Proposal } from '../lib/api';

// Keep server warning codes out of the capture UI. Unknown codes still request review.
export function meterOcrFeedback(proposal: Proposal): string {
  const messages = [
    proposal.isFallback
      ? 'OCR chưa đọc được. Hãy nhập chỉ số thủ công.'
      : 'Chỉ số OCR đề xuất: hãy đối chiếu ảnh và sửa nếu cần.',
  ];
  const warnings = new Set(proposal.warnings);
  if (
    ['meter_profile_unavailable', 'invalid_meter_precision', 'invalid_previous_reading'].some(
      (code) => warnings.has(code),
    )
  )
    messages.push(
      'Thông tin cấu hình đồng hồ chưa hợp lệ. Hãy báo Owner kiểm tra loại đồng hồ, độ chính xác và chỉ số trước.',
    );
  if (warnings.has('meter_not_detected'))
    messages.push('Chưa tìm thấy đồng hồ trong ảnh. Hãy chụp lại đúng đồng hồ của tác vụ.');
  if (
    ['reading_region_not_detected', 'reading_region_uncertain', 'meter_detection_uncertain'].some(
      (code) => warnings.has(code),
    )
  )
    messages.push(
      'Chưa thấy rõ ô chỉ số. Hãy chụp gần hơn hoặc nhập tay sau khi đối chiếu đồng hồ.',
    );
  if (
    ['ambiguous_reading', 'multiple_meters', 'conflicting_reading', 'text_region_limit'].some(
      (code) => warnings.has(code),
    )
  )
    messages.push('Có nhiều vùng số chưa phân biệt được. Hãy chụp riêng một đồng hồ, rõ ô chỉ số.');
  if (warnings.has('meter_type_mismatch'))
    messages.push(
      'Loại đồng hồ hoặc đơn vị trong ảnh không khớp tác vụ. Hãy kiểm tra lại đồng hồ.',
    );
  if (warnings.has('reading_below_previous'))
    messages.push(
      'Chỉ số đề xuất thấp hơn chỉ số trước. Hãy kiểm tra ảnh; thay hoặc quay vòng đồng hồ cần xử lý riêng.',
    );
  if (warnings.has('blur_or_low_detail') || warnings.has('possible_glare'))
    messages.push('Ảnh có thể mờ hoặc lóa. Hãy đối chiếu từng chữ số hoặc chụp lại.');
  if (
    ['decimal_places_applied', 'decimal_separator_unverified', 'meter_precision_mismatch'].some(
      (code) => warnings.has(code),
    )
  )
    messages.push('Hãy kiểm tra kỹ vị trí dấu thập phân và các chữ số phần lẻ.');
  if (warnings.has('billing_register_unverified'))
    messages.push('Hãy bảo đảm màn hình đang hiển thị tổng chỉ số dùng tính tiền.');
  if (warnings.size > 0 && messages.length === 1)
    messages.push(
      'Hãy kiểm tra đúng phòng, mã đồng hồ, đơn vị và toàn bộ ô chỉ số trước khi xác nhận.',
    );
  return messages.join(' ');
}
