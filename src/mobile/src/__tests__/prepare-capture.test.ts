import { beforeEach, expect, it, vi } from 'vitest';
import type { PictureRef } from 'expo-camera';

const native = vi.hoisted(() => ({
  reset: vi.fn(),
  resize: vi.fn(),
  render: vi.fn(),
  save: vi.fn(),
  releaseImage: vi.fn(),
  releaseContext: vi.fn(),
  own: vi.fn((uri: string) => uri),
  sizes: [] as number[],
  files: new Map<string, number>(),
}));
vi.mock('../lib/captureFiles', () => ({ ownCapture: native.own }));
vi.mock('expo-file-system', () => ({
  File: class {
    constructor(public uri: string) {}
    get size() {
      return native.files.get(this.uri) ?? 0;
    }
    get exists() {
      return native.files.has(this.uri);
    }
    delete() {
      native.files.delete(this.uri);
    }
  },
}));
vi.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      reset: native.reset,
      resize: native.resize,
      renderAsync: native.render,
      release: native.releaseContext,
    }),
  },
}));
import {
  captureMaxBytes,
  captureMaxPixels,
  identityCaptureMaxDimension,
  prepareCapture,
} from '../lib/prepareCapture';

const picture = (width = 4000, height = 3000) => ({ width, height }) as PictureRef;
beforeEach(() => {
  vi.clearAllMocks();
  native.files.clear();
  native.sizes = [1_000_000];
  native.own.mockImplementation((uri) => uri);
  native.render.mockResolvedValue({ saveAsync: native.save, release: native.releaseImage });
  native.save.mockImplementation(async () => {
    const uri = `cache://synthetic-${native.save.mock.calls.length}.jpg`;
    native.files.set(uri, native.sizes.shift() ?? 1_000_000);
    return { uri };
  });
});
it('preserves a 12 MP source without cropping, resizing or base64 conversion', async () => {
  const uri = await prepareCapture(picture(), () => true);
  expect(native.resize).not.toHaveBeenCalled();
  expect(native.save).toHaveBeenCalledExactlyOnceWith({ format: 'jpeg', compress: 0.95 });
  expect(native.files.has(uri)).toBe(true);
  expect(native.releaseImage).toHaveBeenCalledOnce();
  expect(native.releaseContext).toHaveBeenCalledOnce();
});
it.each([
  [8000, 6000],
  [6000, 8000],
  [10000, 2000],
])('bounds %s x %s pixels while preserving the source aspect ratio', async (width, height) => {
  await prepareCapture(picture(width, height), () => true);
  const resized = native.resize.mock.calls[0][0];
  expect(resized.width * resized.height).toBeLessThanOrEqual(captureMaxPixels);
  expect(Math.abs(resized.width / resized.height - width / height)).toBeLessThan(0.001);
});
it('only reduces resolution for an oversized encoding and deletes each rejected file', async () => {
  native.sizes = [captureMaxBytes + 100, 2_000_000];
  const uri = await prepareCapture(picture(), () => true);
  expect(native.save).toHaveBeenCalledTimes(2);
  expect(native.resize).toHaveBeenCalledOnce();
  expect([...native.files.keys()]).toEqual([uri]);
  expect(native.reset).toHaveBeenCalledTimes(2);
  expect(native.releaseImage).toHaveBeenCalledTimes(2);
});
it('fails after bounded attempts and cleans all oversize encodings', async () => {
  native.sizes = [captureMaxBytes + 1, captureMaxBytes + 1, captureMaxBytes + 1];
  await expect(prepareCapture(picture(), () => true)).rejects.toThrow('upload limits');
  expect(native.save).toHaveBeenCalledTimes(3);
  expect(native.files.size).toBe(0);
  expect(native.releaseContext).toHaveBeenCalledOnce();
});
it('removes a late save after the session closes and releases native references', async () => {
  let active = true;
  native.save.mockImplementationOnce(async () => {
    active = false;
    native.files.set('cache://late.jpg', 100);
    return { uri: 'cache://late.jpg' };
  });
  await expect(prepareCapture(picture(), () => active)).rejects.toThrow('session ended');
  expect(native.files.size).toBe(0);
  expect(native.own).not.toHaveBeenCalled();
  expect(native.releaseImage).toHaveBeenCalledOnce();
});
it('cleans the output if moving it into the owned cache fails', async () => {
  native.own.mockImplementationOnce(() => {
    throw new Error('move failed');
  });
  await expect(prepareCapture(picture(), () => true)).rejects.toThrow('move failed');
  expect(native.files.size).toBe(0);
  expect(native.releaseImage).toHaveBeenCalledOnce();
  expect(native.releaseContext).toHaveBeenCalledOnce();
});
it('releases native references when rendering or encoding fails', async () => {
  native.save.mockRejectedValueOnce(new Error('encode failed'));
  await expect(prepareCapture(picture(), () => true)).rejects.toThrow('encode failed');
  expect(native.releaseImage).toHaveBeenCalledOnce();
  expect(native.releaseContext).toHaveBeenCalledOnce();
});
it('preserves the existing task-evidence encoding policy', async () => {
  await prepareCapture(picture(2000, 1200), () => true, 'evidence');
  expect(native.resize).toHaveBeenCalledWith({ width: 1600, height: 960 });
  expect(native.save).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.85 });
});
it.each([
  [4000, 3000],
  [3000, 4000],
  [8000, 6000],
])(
  'bounds identity uploads while preserving detail for localization for %s x %s',
  async (width, height) => {
    await prepareCapture(picture(width, height), () => true, 'identity');
    const resized = native.resize.mock.calls[0][0];
    expect(Math.max(resized.width, resized.height)).toBe(identityCaptureMaxDimension);
    expect(Math.abs(resized.width / resized.height - width / height)).toBeLessThan(0.001);
    expect(native.save).toHaveBeenCalledExactlyOnceWith({ format: 'jpeg', compress: 0.95 });
    expect(native.releaseImage).toHaveBeenCalledOnce();
    expect(native.releaseContext).toHaveBeenCalledOnce();
  },
);
it('does not upscale a smaller identity photo', async () => {
  await prepareCapture(picture(1000, 600), () => true, 'identity');
  expect(native.resize).not.toHaveBeenCalled();
});
