import { cleanup, renderHook } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { PortalProvider } from './PortalProvider';
const auth = vi.hoisted(() => ({
  session: { userId: 'owner', sessionId: 'session-one', roles: ['Owner'] },
}));
vi.mock('../../../../packages/client-core/src/auth', () => ({ useAuth: () => auth }));
vi.mock('../services/config', () => ({ isMockMode: false, apiBaseUrl: '' }));
afterEach(cleanup);
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
