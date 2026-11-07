import { conciseMessage } from '../../lib/toast';
import { contractError } from '../../../../../packages/client-core/src/contracts';
import {
  mainDraftMessages,
  type DraftPreviewInfo,
} from '../../../../../packages/client-core/src/mainDrafts';

export function previewError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? (error instanceof Error ? error.message : '');
  if (mainDraftMessages[code]) return mainDraftMessages[code];
  const status = (error as { status?: number })?.status;
  if (status === 503) return 'Kho tài liệu hoặc bộ hiển thị chưa sẵn sàng. Hãy thử lại sau.';
  if (status === 404)
    return 'Không tìm thấy tài liệu hoặc bạn không có quyền xem. Hãy tải lại hợp đồng.';
  if (status === 409) return 'Tài liệu đã thay đổi. Hãy tạo lại bản xem trước.';
  return conciseMessage(contractError(error));
}
export function validPreviewInfo(value: DraftPreviewInfo, fileId: string): boolean {
  return (
    value?.fileId === fileId &&
    Array.isArray(value.pages) &&
    value.pages.length > 0 &&
    value.pages.length <= 20 &&
    value.pages.every(
      (page, index) =>
        page.number === index + 1 &&
        Number.isFinite(page.width) &&
        Number.isFinite(page.height) &&
        page.width > 0 &&
        page.height > 0,
    )
  );
}
// No Buffer/browser polyfill or native dependency. Decode only a PNG returned by our authenticated API.
export function previewPngUri(bytes: Uint8Array): string {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 8 ||
    bytes.length > 10_485_760 ||
    signature.some((value, index) => bytes[index] !== value)
  )
    throw new Error('draft_preview_render_failed');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunks: string[] = [];
  let chunk = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!,
      b = bytes[index + 1] ?? 0,
      c = bytes[index + 2] ?? 0;
    chunk +=
      alphabet[a >> 2]! +
      alphabet[((a & 3) << 4) | (b >> 4)]! +
      (index + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') +
      (index + 2 < bytes.length ? alphabet[c & 63] : '=');
    if (chunk.length >= 8192) {
      chunks.push(chunk);
      chunk = '';
    }
  }
  chunks.push(chunk);
  return 'data:image/png;base64,' + chunks.join('');
}
