import { beforeEach, expect, it, vi } from 'vitest';
import { mutationKeys } from '../../../packages/client-core/src/contracts';

const native = vi.hoisted(() => ({ v4: vi.fn() }));
vi.mock('expo', () => ({ uuid: { v4: native.v4 } }));
// The app must work even when this optional native module is unavailable.
vi.mock('expo-crypto', () => {
  throw new Error("Cannot find native module 'ExpoCrypto'");
});
import { randomUUID } from '../../../src/mobile/src/lib/randomUUID';

beforeEach(() => {
  native.v4.mockReset();
});

it('generates UUIDs through Expo Core when ExpoCrypto is unavailable', () => {
  native.v4.mockReturnValue('747d9dd4-a474-49cd-820d-a44de8ef9d13');
  expect(randomUUID()).toBe('747d9dd4-a474-49cd-820d-a44de8ef9d13');
  expect(native.v4).toHaveBeenCalledOnce();
});

it('keeps idempotency keys stable for retries and rotates after success', () => {
  native.v4
    .mockReturnValueOnce('747d9dd4-a474-49cd-820d-a44de8ef9d13')
    .mockReturnValueOnce('997ec6c4-295f-4c67-867b-e59967c12cf6');
  const keys = mutationKeys(randomUUID);
  const payload = { roomId: 'synthetic-room' };
  const first = keys.get('create', payload);
  expect(keys.get('create', payload)).toBe(first);
  expect(native.v4).toHaveBeenCalledOnce();
  keys.confirmed('create', payload);
  expect(keys.get('create', payload)).not.toBe(first);
  expect(native.v4).toHaveBeenCalledTimes(2);
});

it('propagates a native generator failure without using insecure randomness', () => {
  native.v4.mockImplementation(() => {
    throw new Error('Native UUID unavailable');
  });
  const weakRandom = vi.spyOn(Math, 'random');
  try {
    expect(randomUUID).toThrow('Native UUID unavailable');
    expect(weakRandom).not.toHaveBeenCalled();
  } finally {
    weakRandom.mockRestore();
  }
});
