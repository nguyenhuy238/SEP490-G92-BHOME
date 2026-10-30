import { describe, expect, it } from 'vitest';
import {
  diagnosticStatus,
  diagnosticEndpoint,
  diagnosticWarning,
  ocrProfiles,
} from '../../../src/mobile/src/lib/ocrDiagnostics';
import type { Proposal } from '../../../src/mobile/src/lib/api';

const blank: Proposal = {
  proposedFields: {},
  warnings: [],
  missingFields: [],
  confidence: {},
  isFallback: false,
  requiresConfirmation: true,
};
describe('OCR diagnostic results', () => {
  it('only applies explicit display precision to meter diagnostics', () => {
    expect(diagnosticEndpoint('electricity-digital', '1')).toBe(
      '/api/v1/ocr/diagnostics/electricity-digital?decimalPlaces=1',
    );
    expect(diagnosticEndpoint('water-mechanical')).not.toContain('?');
    expect(diagnosticEndpoint('identity-back', '1')).not.toContain('?');
    expect(() => diagnosticEndpoint('electricity-digital', '9')).toThrow();
    expect(() => diagnosticEndpoint('../identity-front')).toThrow();
  });
  it('does not present HTTP success or fallback as successful recognition', () => {
    expect(diagnosticStatus(blank)).toBe('Chưa trích xuất được trường dữ liệu');
    expect(diagnosticStatus({ ...blank, isFallback: true })).toBe('OCR chưa trả được kết quả');
    expect(diagnosticStatus({ ...blank, proposedFields: { reading: '123.45' } })).toBe(
      'Đã nhận được dữ liệu OCR',
    );
  });
  it('keeps diagnostic codes visible and all six profiles distinct', () => {
    expect(diagnosticWarning('ocr_unavailable')).toContain('ocr_unavailable');
    expect(diagnosticWarning('unrecognized_warning')).toBe('unrecognized_warning');
    expect(new Set(ocrProfiles.map((p) => p.id)).size).toBe(6);
  });
  it('explains document and meter failures in Vietnamese while preserving support codes', () => {
    for (const code of [
      'unsupported_or_unreadable_layout',
      'reading_not_recognized',
      'ambiguous_reading',
      'invalid_dateOfIssue',
      'conflicting_dateOfIssue',
    ]) {
      expect(diagnosticWarning(code)).toContain('nhập thủ công');
      expect(diagnosticWarning(code)).toContain(`(${code})`);
      expect(diagnosticWarning(code)).not.toBe(code);
    }
  });
});
