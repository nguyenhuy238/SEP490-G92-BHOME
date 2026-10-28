import { useSyncExternalStore } from 'react';
const KEY = 'bhome-owner-demo-session';
export const DEMO_USER = 'demo@bhome.vn';
export const DEMO_PASSWORD = 'BhomeDemo!2024';
let active = false;
try {
  active = sessionStorage.getItem(KEY) === 'owner-demo';
} catch {
  /* Persistence is optional for demo login. */
}
const listeners = new Set<() => void>();
function publish(value: boolean) {
  active = value;
  try {
    if (value) sessionStorage.setItem(KEY, 'owner-demo');
    else sessionStorage.removeItem(KEY);
  } catch {
    /* Keep the current in-memory demo session. */
  }
  listeners.forEach((listener) => listener());
}
export function useDemoSession() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => active,
  );
}
export const demoAuth = {
  async login(userName: string, password: string) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (userName !== DEMO_USER || password !== DEMO_PASSWORD)
      throw new Error('Tài khoản demo không hợp lệ.');
    publish(true);
  },
  async logout() {
    publish(false);
  },
};
