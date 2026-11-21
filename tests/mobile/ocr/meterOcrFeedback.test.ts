import { describe, expect, it } from 'vitest';
import type { Proposal } from '../../../src/mobile/src/lib/api';
import { meterOcrFeedback } from '../../../src/mobile/src/services/meterOcrFeedback';

const proposal = (warnings: string[], isFallback = false): Proposal => ({
  proposedFields: isFallback ? {} : { reading: '00123.45' },
  warnings,
  missingFields: isFallback ? ['reading'] : [],
  confidence: {},
  isFallback,
  requiresConfirmation: true,
});

describe('meter OCR review guidance', () => {
  it.each(['ambiguous_reading', 'multiple_meters', 'text_region_limit', 'conflicting_reading'])(
    'explains %s with manual entry and retake guidance',
    (warning) => {
      const message = meterOcrFeedback(proposal([warning], true));
      expect(message).toContain('nhập chỉ số thủ công');
      expect(message).toContain('chụp riêng một đồng hồ');
      expect(message).not.toContain(warning);
    },
  );
  it.each([
    ['meter_not_detected', 'Chưa tìm thấy đồng hồ'],
    ['reading_region_not_detected', 'Chưa thấy rõ ô chỉ số'],
    ['meter_detection_uncertain', 'Chưa thấy rõ ô chỉ số'],
    ['meter_type_mismatch', 'không khớp tác vụ'],
    ['reading_below_previous', 'thấp hơn chỉ số trước'],
    ['possible_glare', 'mờ hoặc lóa'],
    ['blur_or_low_detail', 'mờ hoặc lóa'],
    ['meter_precision_mismatch', 'dấu thập phân'],
    ['decimal_places_applied', 'dấu thập phân'],
    ['billing_register_unverified', 'tổng chỉ số dùng tính tiền'],
    ['meter_profile_unavailable', 'báo Owner kiểm tra'],
    ['invalid_meter_precision', 'báo Owner kiểm tra'],
    ['invalid_previous_reading', 'báo Owner kiểm tra'],
    ['future_warning', 'đúng phòng, mã đồng hồ'],
  ])('explains %s without leaking technical codes', (warning, text) => {
    const message = meterOcrFeedback(proposal([warning]));
    expect(message).toContain(text);
    expect(message).not.toContain(warning);
    expect(message).toContain('đối chiếu ảnh');
  });
  it('keeps both image quality and consumption warnings', () => {
    const message = meterOcrFeedback(proposal(['reading_below_previous', 'possible_glare']));
    expect(message).toContain('thấp hơn chỉ số trước');
    expect(message).toContain('mờ hoặc lóa');
  });
});
