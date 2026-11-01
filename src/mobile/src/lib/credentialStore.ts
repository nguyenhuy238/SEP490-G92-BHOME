import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { CredentialStore } from './sessions';

const KEY = 'bhome.mobile.session.v1';

export function createCredentialStore(): CredentialStore {
  if (Platform.OS === 'web') {
    // Browser sessions last only for this provider's lifetime. Never persist tokens in web storage.
    let credential: string | null = null;
    return {
      read: async () => credential,
      write: async (value) => {
        credential = value;
      },
      remove: async () => {
        credential = null;
      },
    };
  }
  return {
    read: () => SecureStore.getItemAsync(KEY),
    write: (value) =>
      SecureStore.setItemAsync(KEY, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    remove: () => SecureStore.deleteItemAsync(KEY),
  };
}
