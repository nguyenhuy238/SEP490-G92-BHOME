// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saved: null as string | null,
  platform: 'ios',
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
  Platform: {
    get OS() {
      return mocks.platform;
    },
  },
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
function WebConsumer() {
  const { session, ready, login, logout } = useSession();
  const [error, setError] = React.useState('');
  return (
    <>
      <span>{ready ? (session?.userId ?? 'signed-out') : 'loading'}</span>
      <button
        onClick={() =>
          void login(
            'https://synthetic-pc.local:7240',
            'synthetic@example.test',
            'synthetic-password',
          ).catch(() => setError('login-failed'))
        }
      >
        Login
      </button>
      <button onClick={() => void logout()}>Logout</button>
      <span>{error}</span>
    </>
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
  mocks.platform = 'ios';
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

it('supports web login/logout without native storage and starts signed out after remount', async () => {
  mocks.platform = 'web';
  const savedOnDevice = mocks.saved;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(session)))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(
    <SessionProvider>
      <WebConsumer />
    </SessionProvider>,
  );
  await act(async () => {});
  expect(screen.getByText('signed-out')).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    screen.getByText('Login').click();
  });
  expect(screen.getByText('synthetic-user')).toBeTruthy();
  expect(mocks.saved).toBe(savedOnDevice);
  view.unmount();
  const remounted = render(
    <SessionProvider>
      <WebConsumer />
    </SessionProvider>,
  );
  await act(async () => {});
  expect(screen.getByText('signed-out')).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
  remounted.unmount();

  fetcher
    .mockReset()
    .mockResolvedValueOnce(new Response(JSON.stringify(session)))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  render(
    <SessionProvider>
      <WebConsumer />
    </SessionProvider>,
  );
  await act(async () => {
    screen.getByText('Login').click();
  });
  await act(async () => {
    screen.getByText('Logout').click();
  });
  expect(screen.getByText('signed-out')).toBeTruthy();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    'https://synthetic-pc.local:7240/api/v1/auth/login',
    'https://synthetic-pc.local:7240/api/v1/auth/logout',
  ]);
  expect(mocks.saved).toBe(savedOnDevice);
});

it('selects loopback HTTPS for localhost web without using the native LAN endpoint', async () => {
  mocks.platform = 'web';
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  render(
    <SessionProvider>
      <Consumer />
    </SessionProvider>,
  );
  await act(async () => {});
  expect(screen.getByText(/https:\/\/localhost:7240/)).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});

it('keeps an invalid web login signed out without changing native credentials', async () => {
  mocks.platform = 'web';
  const savedOnDevice = mocks.saved;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
  render(
    <SessionProvider>
      <WebConsumer />
    </SessionProvider>,
  );
  await act(async () => {
    screen.getByText('Login').click();
  });
  expect(screen.getByText('signed-out')).toBeTruthy();
  expect(screen.getByText('login-failed')).toBeTruthy();
  expect(mocks.saved).toBe(savedOnDevice);
});
