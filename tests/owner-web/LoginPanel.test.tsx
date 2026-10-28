import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { AuthProvider } from '@bhome/client-core/auth.tsx';
import { LoginPanel } from '@bhome/client-core/LoginPanel.tsx';

afterEach(() => vi.unstubAllGlobals());
const session = {
  userId: 'synthetic',
  roles: ['Owner'],
  accessToken: 'test-access',
  refreshToken: 'test-refresh',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

it('logs in and clears credentials after server logout through the Vietnamese UI', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json(session))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <AuthProvider apiBaseUrl="https://api.example.invalid">
      <LoginPanel />
    </AuthProvider>,
  );
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'synthetic@example.invalid' },
  });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), {
    target: { value: 'Synthetic!Password-493' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  await screen.findByText('Đã đăng nhập.');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
    email: 'synthetic@example.invalid',
    password: 'Synthetic!Password-493',
  });
  expect(screen.queryByText('Synthetic!Password-493')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
  await screen.findByLabelText('Email');
  expect((screen.getByLabelText('Mật khẩu') as HTMLInputElement).value).toBe('');
  expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.invalid/api/v1/auth/logout');
});

it('shows a generic login failure and removes the password from the form', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 401)));
  render(
    <AuthProvider apiBaseUrl="https://api.example.invalid">
      <LoginPanel />
    </AuthProvider>,
  );
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'synthetic@example.invalid' },
  });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'wrong-secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Không thể đăng nhập.'));
  expect((screen.getByLabelText('Mật khẩu') as HTMLInputElement).value).toBe('');
});
