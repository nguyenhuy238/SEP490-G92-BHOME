import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../../../../../packages/client-core/src/auth';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe() {
  const { session, isRestoring } = useAuth();
  return (
    <span>
      {isRestoring ? 'restoring' : session?.roles.includes('Owner') ? 'owner' : 'anonymous'}
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

it('finishes restoration without a session when the refresh cookie is revoked', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 401)));
  render(
    <AuthProvider apiBaseUrl="https://api.example.invalid" transport="web">
      <Probe />
    </AuthProvider>,
  );
  expect(await screen.findByText('anonymous')).toBeInTheDocument();
});
