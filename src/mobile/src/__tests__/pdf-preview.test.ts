import { expect, it } from 'vitest';
import { previewPngUri, validPreviewInfo } from '../features/contracts/pdfPreview';

it('encodes binary pages exactly without native or browser-only base64 APIs', () => {
  for (const tail of [0, 1, 2, 3, 12345]) {
    const bytes = new Uint8Array(8 + tail);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    for (let i = 8; i < bytes.length; i++) bytes[i] = i % 256;
    expect(previewPngUri(bytes)).toBe(
      'data:image/png;base64,' + Buffer.from(bytes).toString('base64'),
    );
  }
  expect(() => previewPngUri(new Uint8Array())).toThrow('draft_preview_render_failed');
});
it('validates file identity, page ordering, count and dimensions', () => {
  expect(
    validPreviewInfo({ fileId: 'file', pages: [{ number: 1, width: 595, height: 842 }] }, 'file'),
  ).toBe(true);
  expect(validPreviewInfo({ fileId: 'file', pages: [] }, 'file')).toBe(false);
  expect(
    validPreviewInfo({ fileId: 'file', pages: [{ number: 1, width: NaN, height: 842 }] }, 'file'),
  ).toBe(false);
  expect(
    validPreviewInfo({ fileId: 'file', pages: [{ number: 2, width: 595, height: 842 }] }, 'file'),
  ).toBe(false);
});
