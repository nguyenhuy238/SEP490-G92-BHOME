import { expect, it, vi } from 'vitest';
import { uploadPhotosBounded } from '../lib/uploadPhotosBounded';

it('overlaps two uploads while preserving photo order and bounding concurrent requests', async () => {
  const pending = new Map<number, (value: string) => void>();
  let active = 0;
  let peak = 0;
  const upload = vi.fn((id: number) => {
    active++;
    peak = Math.max(peak, active);
    return new Promise<string>((resolve) => {
      pending.set(id, (value) => {
        active--;
        resolve(value);
      });
    });
  });
  const result = uploadPhotosBounded([1, 2, 3, 4, 5], upload);
  expect([...pending.keys()]).toEqual([1, 2]);
  pending.get(2)!('photo-2');
  await vi.waitFor(() => expect([...pending.keys()]).toEqual([1, 2, 3]));
  pending.get(1)!('photo-1');
  await vi.waitFor(() => expect([...pending.keys()]).toEqual([1, 2, 3, 4]));
  pending.get(4)!('photo-4');
  await vi.waitFor(() => expect([...pending.keys()]).toEqual([1, 2, 3, 4, 5]));
  pending.get(3)!('photo-3');
  pending.get(5)!('photo-5');
  expect(await result).toEqual(['photo-1', 'photo-2', 'photo-3', 'photo-4', 'photo-5']);
  expect(upload).toHaveBeenCalledTimes(5);
  expect(peak).toBe(2);
});

it('waits for both inflight private uploads before returning a failure, allowing safe idempotent retry', async () => {
  let resolveSecond!: (id: string) => void;
  const second = new Promise<string>((resolve) => {
    resolveSecond = resolve;
  });
  const upload = vi.fn((id: number) => (id === 1 ? Promise.reject(new Error('offline')) : second));
  const result = uploadPhotosBounded([1, 2, 3], upload);
  let completed = false;
  void result.catch(() => {
    completed = true;
  });
  await Promise.resolve();
  expect(upload).toHaveBeenCalledTimes(2);
  expect(completed).toBe(false);
  resolveSecond('saved-id');
  await expect(result).rejects.toThrow('offline');
  expect(completed).toBe(true);
  expect(upload).toHaveBeenCalledTimes(2);
});
