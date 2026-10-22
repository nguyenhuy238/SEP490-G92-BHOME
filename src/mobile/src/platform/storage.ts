// Preference storage only. Never use localStorage or Capacitor Preferences for credentials.
export interface PreferenceStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export const browserPreferenceStorage: PreferenceStorage = {
  get: async (key) => localStorage.getItem(key),
  set: async (key, value) => localStorage.setItem(key, value),
  remove: async (key) => localStorage.removeItem(key),
};
// Select a reviewed Keychain/Keystore implementation before adding persistent mobile sessions.
export interface SecureTokenStorage {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}
