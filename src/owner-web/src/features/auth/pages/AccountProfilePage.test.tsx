import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import AccountProfilePage from './AccountProfilePage';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  logout: vi.fn(),
  login: vi.fn(),
  changePassword: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('../hooks/useAccountProfileApi', () => ({
  useAccountProfileApi: () => ({ get: mocks.get, update: mocks.update }),
}));
vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({
    session: { userId: 'owner-id', roles: ['Owner'] },
    client: {
      logout: mocks.logout,
      login: mocks.login,
      changePassword: mocks.changePassword,
      clear: mocks.clear,
      session: { roles: ['Owner'] },
    },
  }),
}));

const profile = {
  userId: 'owner-id',
  fullName: 'Owner tổng hợp',
  phone: '0900000000',
  email: 'owner@example.invalid',
  roles: ['Owner'],
  isActive: true,
  version: 'profile-v1',
};

function renderPage() {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={query}>
      <MemoryRouter>
        <AccountProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(profile);
  mocks.update.mockReset().mockResolvedValue({ ...profile, fullName: 'Owner đã cập nhật', version: 'profile-v2' });
  mocks.logout.mockReset();
  mocks.login.mockReset().mockResolvedValue(undefined);
  mocks.changePassword.mockReset();
  mocks.clear.mockReset();
});

it('verifies the current password and restores the session when contact details change', async () => {
  mocks.update.mockResolvedValue({
    ...profile,
    email: 'owner.updated@example.invalid',
    version: 'profile-v2',
  });
  renderPage();
  await screen.findByRole('heading', { name: 'Hồ sơ tài khoản' });
  fireEvent.change(screen.getByLabelText(/^Email/), {
    target: { value: 'owner.updated@example.invalid' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  expect(screen.getByLabelText(/^Mật khẩu hiện tại để xác nhận/)).toBeRequired();
  expect(mocks.update).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText(/^Mật khẩu hiện tại để xác nhận/), {
    target: { value: 'Current!Password-493' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

  await waitFor(() =>
    expect(mocks.login).toHaveBeenNthCalledWith(
      1,
      'owner@example.invalid',
      'Current!Password-493',
    ),
  );
  await waitFor(() =>
    expect(mocks.update).toHaveBeenCalledWith({
      fullName: 'Owner tổng hợp',
      phone: '0900000000',
      email: 'owner.updated@example.invalid',
      version: 'profile-v1',
    }),
  );
  await waitFor(() =>
    expect(mocks.login).toHaveBeenNthCalledWith(
      2,
      'owner.updated@example.invalid',
      'Current!Password-493',
    ),
  );
});

it('loads the real profile contract and updates only editable fields with its version', async () => {
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Hồ sơ tài khoản' })).toBeInTheDocument();
  expect(mocks.get).toHaveBeenCalledOnce();
  expect(screen.getByLabelText(/^Email/)).toHaveValue('owner@example.invalid');
  expect(screen.getByText('Owner')).toBeInTheDocument();
  expect(screen.getByText('Đang hoạt động')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/^Họ và tên/), { target: { value: 'Owner đã cập nhật' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

  await waitFor(() =>
    expect(mocks.update).toHaveBeenCalledWith({
      fullName: 'Owner đã cập nhật',
      phone: '0900000000',
      email: 'owner@example.invalid',
      version: 'profile-v1',
    }),
  );
  expect(await screen.findByText('Đã cập nhật hồ sơ tài khoản.')).toBeInTheDocument();
});

it('opens the existing password dialog from the profile page', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Hồ sơ tài khoản' });
  fireEvent.click(screen.getAllByRole('button', { name: 'Đổi mật khẩu' })[0]);
  expect(screen.getByRole('heading', { name: 'Đổi mật khẩu' })).toBeInTheDocument();
  expect(screen.getByLabelText(/^Mật khẩu hiện tại/)).toBeInTheDocument();
});
