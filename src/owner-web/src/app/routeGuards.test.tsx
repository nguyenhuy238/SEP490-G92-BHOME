import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { LoginRoute, ProtectedRoute } from './routeGuards';
const state = vi.hoisted(() => ({
  owner: false,
  restoring: false,
  restoredRoles: null as string[] | null,
  logout: vi.fn(async () => {}),
  restoreError: '',
  retryRestore: vi.fn(async () => {}),
}));
vi.mock('../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({
    session: state.restoredRoles
      ? { roles: state.restoredRoles }
      : state.owner
        ? { roles: ['Owner'] }
        : null,
    isRestoring: state.restoring,
    restoreError: state.restoreError,
    retryRestore: state.retryRestore,
    client: { logout: state.logout },
  }),
}));
vi.mock('../services/config', () => ({ isMockMode: false }));
vi.mock('../features/auth/pages/LoginPage', () => ({
  LoginPage: () => <span>Login required</span>,
}));
afterEach(() => {
  cleanup();
  state.owner = false;
  state.restoring = false;
  state.restoredRoles = null;
  state.logout.mockClear();
  state.restoreError = '';
  state.retryRestore.mockClear();
});

it('keeps an unavailable restoration on the protected path without rendering private content or redirecting to login', () => {
  state.restoreError = 'Temporary server outage';
  render(<App />);
  expect(screen.getByText('Temporary server outage')).toBeInTheDocument();
  expect(screen.queryByText('Login required')).not.toBeInTheDocument();
  expect(screen.queryByText('/invoices?invoiceId=synthetic#detail')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Thử khôi phục phiên'));
  expect(state.retryRestore).toHaveBeenCalledOnce();
  expect(state.logout).not.toHaveBeenCalled();
});
function Target() {
  const location = useLocation();
  return <span>{location.pathname + location.search + location.hash}</span>;
}
function App() {
  return (
    <MemoryRouter initialEntries={['/invoices?invoiceId=synthetic#detail']}>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/invoices" element={<Target />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}
it('retains the full authorized deep link while authentication is restored', async () => {
  state.owner = false;
  const view = render(<App />);
  await screen.findByText('Login required');
  state.owner = true;
  view.rerender(<App />);
  expect(await screen.findByText('/invoices?invoiceId=synthetic#detail')).toBeInTheDocument();
});

it('shows a protected-route loading state until cookie session restoration finishes', async () => {
  state.owner = false;
  state.restoring = true;
  const view = render(<App />);
  expect(screen.queryByText('Login required')).not.toBeInTheDocument();
  state.restoring = false;
  view.rerender(<App />);
  expect(await screen.findByText('Login required')).toBeInTheDocument();
});

it('revokes a restored non-Owner session on the login route', async () => {
  state.restoring = true;
  state.restoredRoles = ['Staff'];
  const view = render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
      </Routes>
    </MemoryRouter>,
  );
  state.restoring = false;
  view.rerender(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText('Login required')).toBeInTheDocument();
  expect(state.logout).toHaveBeenCalledOnce();
});
