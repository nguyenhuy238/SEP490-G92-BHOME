import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { LoginRoute, ProtectedRoute } from './routeGuards';
const state = vi.hoisted(() => ({ owner: false }));
vi.mock('../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: state.owner ? { roles: ['Owner'] } : null }),
}));
vi.mock('../services/config', () => ({ isMockMode: false }));
vi.mock('../features/auth/pages/LoginPage', () => ({
  LoginPage: () => <span>Login required</span>,
}));
afterEach(cleanup);
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
