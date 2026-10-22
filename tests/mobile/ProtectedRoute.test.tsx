import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@bhome/client-core/auth.tsx';
import { roles, type Role } from '@bhome/client-core/roles.ts';
import { ProtectedRoute } from '../../src/mobile/src/auth/ProtectedRoute';

function SignInControl({ role }: { role: Role }) {
  const { acceptSession } = useAuth();
  return (
    <button
      onClick={() =>
        acceptSession({ userId: 'synthetic-user', roles: [role], accessToken: 'test-only' })
      }
    >
      Test session
    </button>
  );
}

it.each([roles.owner, roles.staff, roles.tenant])('gates the Owner route for role %s', (role) => {
  render(
    <MemoryRouter>
      <AuthProvider>
        <SignInControl role={role} />
        <Link to="/owner">Open Owner workspace</Link>
        <Routes>
          <Route path="/" element={<p>Home</p>} />
          <Route element={<ProtectedRoute allowedRoles={[roles.owner]} />}>
            <Route path="owner" element={<p>Owner workspace</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Test session' }));
  fireEvent.click(screen.getByRole('link', { name: 'Open Owner workspace' }));
  if (role === roles.owner) expect(screen.getByText('Owner workspace')).toBeInTheDocument();
  else expect(screen.getByRole('alert')).toHaveTextContent('Bạn không có quyền truy cập.');
});
