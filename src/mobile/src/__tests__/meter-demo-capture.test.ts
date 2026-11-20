// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  canUseLocalMeterDemo,
  createMeterDemoJpeg,
  meterDemoJpegBytes,
} from '../lib/meterDemoCapture';

afterEach(() => vi.restoreAllMocks());

it('offers synthetic meter evidence only on development Web localhost:8081', () => {
  expect(canUseLocalMeterDemo(true, 'web', 'localhost', '8081')).toBe(true);
  expect(canUseLocalMeterDemo(true, 'web', '127.0.0.1', '8081')).toBe(true);
  for (const input of [
    [false, 'web', 'localhost', '8081'],
    [true, 'ios', 'localhost', '8081'],
    [true, 'android', 'localhost', '8081'],
    [true, 'web', 'example.com', '8081'],
    [true, 'web', 'localhost', '5173'],
    [true, 'web', '192.168.1.10', '8081'],
  ] as const) {
    expect(canUseLocalMeterDemo(input[0], input[1], input[2], input[3])).toBe(false);
  }
});

it('creates a labeled JPEG Data URL for upload and rejects fake content types', () => {
  const fillRect = vi.fn();
  const fillText = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect,
    fillText,
  } as unknown as CanvasRenderingContext2D);
  const syntheticBytes = [0xff, 0xd8, 0xff, ...Array(150).fill(0)];
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    `data:image/jpeg;base64,${btoa(String.fromCharCode(...syntheticBytes))}`,
  );
  const uri = createMeterDemoJpeg();
  expect(uri).toMatch(/^data:image\/jpeg;base64,/);
  expect(fillText).toHaveBeenCalledWith('BHOME - DEV TEST', 36, 118);
  expect(meterDemoJpegBytes(uri).slice(0, 3)).toEqual(new Uint8Array([255, 216, 255]));
  expect(() => meterDemoJpegBytes('data:image/png;base64,/9j/')).toThrow();
  expect(() => meterDemoJpegBytes('data:image/jpeg;base64,AAAA')).toThrow();
});
