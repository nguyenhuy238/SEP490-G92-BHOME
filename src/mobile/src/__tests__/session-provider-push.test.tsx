// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({
  events: [] as string[],
  unregister: vi.fn(),
  logout: vi.fn(),
  warning: vi.fn(),
  setForeground: vi.fn(),
}));

vi.mock('expo-constants', () => ({ default: { expoConfig: {} } }));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: {
    currentState: 'active',
    addEventListener: () => ({ remove: vi.fn() }),
  },
}));
vi.mock('../lib/apiEndpoint', () => ({ resolveApiEndpoint: () => 'https://api.test' }));
vi.mock('../lib/captureFiles', () => ({ clearAbandonedCaptures: vi.fn() }));
vi.mock('../lib/credentialStore', () => ({ createCredentialStore: () => ({}) }));
vi.mock('../lib/toast', () => ({ showWarning: s.warning }));
vi.mock('../services/pushRegistration', () => ({ unregisterPushDevice: s.unregister }));
vi.mock('../lib/sessions', () => ({
  MobileSessions: class {
    snapshot = {
      session: { userId: 'tenant-a', roles: ['Tenant'] },
      api: { queryCache: { setForeground: s.setForeground } },
      baseUrl: 'https://api.test',
      ready: true,
    };
    subscribe() {
      return () => {};
    }
    async restore() {}
    async reconnect() {}
    async login() {}
    async logout() {
      await s.logout();
    }
  },
}));

import { SessionProvider, useSession } from '../lib/SessionProvider';

function SignOut() {
  const { logout } = useSession();
  return <button onClick={() => void logout()}>Đăng xuất</button>;
}

beforeEach(() => {
  vi.stubGlobal('__DEV__', false);
  vi.clearAllMocks();
  s.events.length = 0;
  s.unregister.mockImplementation(async () => {
    s.events.push('unregister');
    return { removed: true, message: 'Đã hủy đăng ký' };
  });
  s.logout.mockImplementation(async () => {
    s.events.push('logout');
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('unregisters the same authenticated device before ending the Mobile session', async () => {
  render(
    <SessionProvider>
      <SignOut />
    </SessionProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
  await waitFor(() => expect(s.logout).toHaveBeenCalledOnce());
  expect(s.unregister).toHaveBeenCalledWith(expect.any(Object), {
    userId: 'tenant-a',
    baseUrl: 'https://api.test',
  });
  expect(s.events).toEqual(['unregister', 'logout']);
  expect(s.warning).not.toHaveBeenCalled();
});

it('still logs out and warns that push may continue when unregistration fails offline', async () => {
  s.unregister.mockImplementation(async () => {
    s.events.push('unregister');
    throw new Error('offline');
  });
  render(
    <SessionProvider>
      <SignOut />
    </SessionProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
  await waitFor(() => expect(s.logout).toHaveBeenCalledOnce());
  expect(s.events).toEqual(['unregister', 'logout']);
  expect(s.warning).toHaveBeenCalledWith(expect.stringContaining('vẫn nhận tin'));
});
