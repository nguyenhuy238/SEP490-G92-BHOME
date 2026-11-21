import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'web',
  read: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mocks.platform;
    },
  },
}));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'synthetic-device-only',
  getItemAsync: mocks.read,
  setItemAsync: mocks.write,
  deleteItemAsync: mocks.remove,
}));
import { createCredentialStore } from '../../../src/mobile/src/lib/credentialStore';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('session credential storage by platform', () => {
  it('keeps web credentials in memory, clears them on logout, and never calls SecureStore', async () => {
    mocks.platform = 'web';
    for (const operation of [mocks.read, mocks.write, mocks.remove]) {
      operation.mockImplementation(() => {
        throw new Error('Native storage unavailable on web');
      });
    }
    const store = createCredentialStore();
    expect(await store.read()).toBeNull();
    await store.write('synthetic-token');
    expect(await store.read()).toBe('synthetic-token');
    expect(await createCredentialStore().read()).toBeNull();
    await store.remove();
    expect(await store.read()).toBeNull();
    for (const operation of [mocks.read, mocks.write, mocks.remove])
      expect(operation).not.toHaveBeenCalled();
  });

  it.each(['ios', 'android'])(
    'continues to use device-only secure storage on %s',
    async (platform) => {
      mocks.platform = platform;
      mocks.read.mockResolvedValue('synthetic-stored-token');
      const store = createCredentialStore();
      expect(await store.read()).toBe('synthetic-stored-token');
      await store.write('synthetic-new-token');
      await store.remove();
      expect(mocks.read).toHaveBeenCalledExactlyOnceWith('bhome.mobile.session.v1');
      expect(mocks.write).toHaveBeenCalledExactlyOnceWith(
        'bhome.mobile.session.v1',
        'synthetic-new-token',
        {
          keychainAccessible: 'synthetic-device-only',
        },
      );
      expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('bhome.mobile.session.v1');
    },
  );
});
