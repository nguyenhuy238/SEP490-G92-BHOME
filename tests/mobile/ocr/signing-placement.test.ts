import { describe, expect, it, vi } from 'vitest';
import {
  boxHeight,
  clampPlacement,
  signingClient,
  signingError,
  signingPayload,
} from '../../../packages/client-core/src/signing';

const a4 = { width: 595.28, height: 841.89 };
const id = '00000000-0000-0000-0000-000000000003';
const picture = { width: 600, height: 200 };

describe('visible signature placement', () => {
  it('measures the box exactly as the server draws it', () => {
    // 0.3 of A4 = 178.6 pt wide; picture 3:1 -> 59.5 pt; caption 2 x 9.8 x 1.35 + 12 = 38.46 pt.
    expect(boxHeight(0.3, a4, picture, true) * a4.height).toBeCloseTo(178.584 / 3 + 38.46, 1);
    // Text only: 2 x 14 x 1.35 + 12 = 49.8 pt whatever the width.
    expect(boxHeight(0.3, a4, null, true) * a4.height).toBeCloseTo(49.8, 5);
    expect(boxHeight(0.3, a4, picture, false)).toBe(boxHeight(0.5, a4, null, false));
  });

  it('keeps the box on an existing page and inside it', () => {
    const p = clampPlacement({ page: 9, x: 0.9, y: 0.99, width: 0.9 }, [a4, a4], picture, true);
    expect(p.page).toBe(2);
    expect(p.width).toBe(0.6);
    expect(p.x + p.width).toBeLessThanOrEqual(1);
    expect(p.y + boxHeight(p.width, a4, picture, true)).toBeLessThan(1);
    expect(clampPlacement({ page: 0, x: -1, y: -1, width: 0.01 }, [a4], null, false)).toEqual({
      page: 1,
      x: 0,
      y: 0,
      width: 0.08,
    });
  });

  it('sends the plain request unless the signer chose a place or turned the picture off', () => {
    expect(signingPayload(id, null, true)).toEqual({ certificateId: id });
    expect(signingPayload(id, { page: 2, x: 0.123456, y: 0.5, width: 0.3 }, true)).toEqual({
      certificateId: id,
      placement: { page: 2, x: 0.1235, y: 0.5, width: 0.3 },
      usePicture: true,
    });
    expect(signingPayload(id, null, false)).toEqual({
      certificateId: id,
      placement: null,
      usePicture: false,
    });
    expect(() => signingPayload('not-a-guid', null, true)).toThrow();
  });

  it('shows the server sentence for digital-signing refusals', () => {
    expect(signingError({ status: 400, problem: { detail: 'Ảnh phải có nền trong suốt.' } })).toBe(
      'Ảnh phải có nền trong suốt.',
    );
    expect(signingError({ status: 400, problem: { code: 'signature_placement_invalid' } })).toMatch(
      /Ô chữ ký nằm ngoài trang/,
    );
  });

  it('calls the signing endpoints with the PNG body and the page size', async () => {
    const request = vi.fn().mockResolvedValue({});
    const signing = signingClient(request);
    const png = new Uint8Array([137, 80, 78, 71]);
    await signing.uploadImage(png);
    expect(request).toHaveBeenLastCalledWith('/api/v1/digital-signing/signature-image', {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: png,
    });
    await signing.pageBytes(id, 2, 800.7);
    expect(request.mock.lastCall?.[0]).toBe(`/api/v1/contracts/${id}/signing/pages/2?width=800`);
    await signing.testViettel(' 079000000001 ');
    expect(JSON.parse(request.mock.lastCall?.[1].body)).toEqual({ userId: '079000000001' });
  });
});
