// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saved: null as string | null,
  state: 'active',
  listener: undefined as ((state: string) => void) | undefined,
  removeListener: vi.fn(),
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: { hostUri: '192.168.1.2:8081' } } }));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
  getItemAsync: async () => mocks.saved,
  setItemAsync: async (_key: string, value: string) => {
    mocks.saved = value;
  },
  deleteItemAsync: async () => {
    mocks.saved = null;
  },
}));
vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return mocks.state;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocks.listener = listener;
      return { remove: mocks.removeListener };
    },
  },
}));
vi.mock('../../../src/mobile/src/lib/captureFiles', () => ({ clearAbandonedCaptures: vi.fn() }));
import { SessionProvider, useSession } from '../../../src/mobile/src/lib/SessionProvider';

function Consumer() {
  const { session, baseUrl } = useSession();
  return (
    <span>
      {baseUrl} {session?.userId ?? 'waiting'}
    </span>
  );
}
const session = {
  userId: 'synthetic-user',
  roles: ['Owner'],
  accessToken: 'synthetic-access',
  refreshToken: 'synthetic-next',
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('__DEV__', true);
  vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', '');
  vi.stubEnv('EXPO_PUBLIC_DEV_API_BASE_URL', 'https://synthetic-pc.local:7240');
  vi.stubEnv('EXPO_PUBLIC_DEV_SERVER_ID', 'synthetic-ca');
  mocks.saved = JSON.stringify({
    base: 'https://synthetic-pc.local:7240',
    refreshToken: 'synthetic-old',
    serverId: 'synthetic-ca',
  });
  mocks.state = 'active';
  mocks.removeListener.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('restores an offline session automatically when foreground polling detects connectivity', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(new Response('Healthy'))
    .mockResolvedValueOnce(new Response(JSON.stringify(session)));
  vi.stubGlobal('fetch', fetcher);
  await act(async () => {
    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    );
  });
  expect(screen.getByText(/waiting/)).toBeTruthy();
  expect(mocks.saved).toContain('synthetic-old');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(screen.getByText(/synthetic-user/)).toBeTruthy();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    'https://synthetic-pc.local:7240/health/ready',
    'https://synthetic-pc.local:7240/health/ready',
    'https://synthetic-pc.local:7240/api/v1/auth/refresh',
  ]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('does not poll in the background, reconnects on foreground, and removes timers/listeners on unmount', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(new Response('Healthy'))
    .mockResolvedValueOnce(new Response(JSON.stringify(session)));
  vi.stubGlobal('fetch', fetcher);
  const view = render(
    <SessionProvider>
      <Consumer />
    </SessionProvider>,
  );
  await act(async () => {});
  mocks.state = 'background';
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  mocks.state = 'active';
  await act(async () => {
    mocks.listener?.('active');
  });
  expect(screen.getByText(/synthetic-user/)).toBeTruthy();
  view.unmount();
  expect(mocks.removeListener).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
