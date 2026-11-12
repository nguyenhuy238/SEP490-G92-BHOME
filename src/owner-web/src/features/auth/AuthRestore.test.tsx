import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../../../../../packages/client-core/src/auth';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe() {
  const { session, isRestoring, restoreError, retryRestore } = useAuth();
  return (
    <span>
      {isRestoring ? 'restoring' : session?.roles.includes('Owner') ? 'owner' : 'anonymous'}
      {restoreError && <button onClick={() => void retryRestore()}>Retry restoration</button>}
    </span>
  );
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

it('restores an Owner session from the HttpOnly cookie transport on startup', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    json({
      userId: 'synthetic-owner',
      roles: ['Owner'],
      accessToken: 'synthetic-access',
      refreshToken: null,
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    <AuthProvider apiBaseUrl="https://api.example.invalid" transport="web">
      <Probe />
    </AuthProvider>,
  );
  expect(screen.getByText('restoring')).toBeInTheDocument();
  expect(await screen.findByText('owner')).toBeInTheDocument();
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('https://api.example.invalid/api/v1/auth/refresh');
  expect(options.credentials).toBe('include');
  expect(options.headers.get('X-BHome-Client')).toBe('web');
  expect(JSON.parse(options.body)).toEqual({});
});

it('restores a same-origin empty-base session and can retry an unavailable server without claiming invalid credentials', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(
      json({ userId: 'synthetic-owner', roles: ['Owner'], accessToken: 'synthetic-access' }),
    );
  vi.stubGlobal('fetch', fetch);
  render(
    <AuthProvider apiBaseUrl="" transport="web">
      <Probe />
    </AuthProvider>,
  );
  await screen.findByText('Retry restoration');
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/auth/refresh');
  fireEvent.click(screen.getByText('Retry restoration'));
  await screen.findByText('owner');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('finishes restoration without a session when the refresh cookie is revoked', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 401)));
  render(
    <AuthProvider apiBaseUrl="https://api.example.invalid" transport="web">
      <Probe />
    </AuthProvider>,
  );
  expect(await screen.findByText('anonymous')).toBeInTheDocument();
});
