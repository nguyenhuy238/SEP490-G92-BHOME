import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { PortalProvider } from './PortalProvider';
const auth = vi.hoisted(() => ({
  session: { userId: 'owner', sessionId: 'session-one', roles: ['Owner'] },
}));
vi.mock('../../../../packages/client-core/src/auth', () => ({ useAuth: () => auth }));
vi.mock('../services/config', () => ({ isMockMode: false, apiBaseUrl: '' }));
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});
it('drops cached business data when the session or effective roles change', () => {
  const { result, rerender } = renderHook(() => useQueryClient(), {
    wrapper: ({ children }) => <PortalProvider>{children}</PortalProvider>,
  });
  const first = result.current;
  first.setQueryData(['private'], 'private Owner data');
  auth.session = { ...auth.session, roles: ['Staff'] };
  rerender();
  expect(result.current.getQueryData(['private'])).toBeUndefined();
  expect(result.current).not.toBe(first);
  expect(first.getQueryData(['private'])).toBeUndefined();
});

it('does not pause local API reads when Windows reports the browser offline', async () => {
  onlineManager.setOnline(false);
  const request = vi.fn().mockResolvedValue({ items: [{ id: 'location-1' }], totalCount: 1 });
  const { result } = renderHook(
    () =>
      useQuery({
        queryKey: ['local-location-list-offline-regression'],
        queryFn: request,
      }),
    { wrapper: ({ children }) => <PortalProvider>{children}</PortalProvider> },
  );
  await waitFor(() => expect(result.current.data?.totalCount).toBe(1));
  expect(result.current.fetchStatus).toBe('idle');
  expect(request).toHaveBeenCalledTimes(1);
});
