import type { Proposal } from './api';
import { diagnosticWarning, ocrProfiles } from './ocrDiagnostics';

export interface AutomaticAnalysis {
  classificationStatus: 'classified' | 'unknown' | 'ambiguous' | 'unavailable' | 'manual';
  detectedCategory: string;
  classificationConfidence: number | null;
  classificationSource: string;
  candidateCategories: string[];
  warnings: string[];
  identityProposal: Proposal | null;
  meterProposal: Proposal | null;
}
export interface AutomaticDiagnosticResult {
  analysis: AutomaticAnalysis;
  elapsedMilliseconds: number;
}
export const automaticDiagnosticEndpoint = '/api/v1/ocr/diagnostics/auto';
export function categoryProfile(category: string) {
  return category === 'cccd_front'
    ? 'identity-front'
    : category === 'cccd_back'
      ? 'identity-back'
      : category.replaceAll('_', '-');
}
export function categoryLabel(category: string) {
  return ocrProfiles.find((p) => p.id === categoryProfile(category))?.label ?? 'Chưa xác định';
}
export function reviewWarning(code: string) {
  const messages: Record<string, string> = {
    classification_requires_review:
      'Chưa đủ dấu hiệu để phân biệt loại ảnh. Hãy chọn loại phù hợp.',
    classification_insufficient_evidence:
      'Chưa xác định được loại ảnh. Hãy chụp rõ toàn bộ giấy tờ hoặc công tơ.',
    classification_conflict: 'Các dấu hiệu về loại ảnh không khớp. Hãy kiểm tra và chọn lại.',
    classification_unavailable: 'Tự nhận diện chưa khả dụng. Bạn có thể chọn loại ảnh để đọc lại.',
    classification_text_evidence:
      'Loại giấy tờ được gợi ý từ thông tin đọc được. Hãy đối chiếu với ảnh.',
    multiple_meters: 'Ảnh có nhiều công tơ. Hãy chụp riêng công tơ cần đọc.',
    multiple_reading_regions: 'Có nhiều vùng chỉ số. Hãy chụp rõ riêng vùng cần đọc.',
    billing_register_unverified: 'Hãy kiểm tra màn hình đang hiển thị tổng chỉ số dùng tính tiền.',
    reading_region_unverified: 'Hãy kiểm tra đúng ô chỉ số, đơn vị và dấu thập phân.',
    meter_localization_unavailable: 'Hãy đối chiếu đúng công tơ và ô chỉ số trong ảnh.',
  };
  const message = messages[code] ?? diagnosticWarning(code);
  return message === code
    ? 'Kết quả chưa chắc chắn. Hãy đối chiếu ảnh hoặc chụp lại.'
    : message.replace(/\s*\([a-z_]+\)$/, '');
}

// Bounded in-memory copy for post-capture clarification, never file storage.
export class TemporaryOcrImage {
  bytes: Uint8Array<ArrayBuffer> | null = null;
  replace(input: Uint8Array<ArrayBuffer>) {
    this.clear();
    this.bytes = input.slice();
  }
  clear() {
    this.bytes?.fill(0);
    this.bytes = null;
  }
}
// No spreading a multi-megabyte array and no Node/native encoding shim.
export function ocrPreview(input: Uint8Array) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunks: string[] = [];
  let chunk = '';
  for (let i = 0; i < input.length; i += 3) {
    const a = input[i]!,
      b = input[i + 1] ?? 0,
      c = input[i + 2] ?? 0;
    chunk +=
      alphabet[a >> 2]! +
      alphabet[((a & 3) << 4) | (b >> 4)]! +
      (i + 1 < input.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < input.length ? alphabet[c & 63] : '=');
    if (chunk.length >= 16384) {
      chunks.push(chunk);
      chunk = '';
    }
  }
  chunks.push(chunk);
  return `data:image/${input[0] === 137 ? 'png' : 'jpeg'};base64,${chunks.join('')}`;
}
