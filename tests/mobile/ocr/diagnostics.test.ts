import { describe, expect, it } from 'vitest';
import {
  diagnosticStatus,
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
});
