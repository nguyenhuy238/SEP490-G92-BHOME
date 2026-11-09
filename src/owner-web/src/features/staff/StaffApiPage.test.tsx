import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../packages/client-core/src/api';
import { StaffApiPage } from './StaffApiPage';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../meters/useMeterApi', () => ({ useMeterApi: () => ({ request: mocks.request }) }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
const staff = {
  userId: 'staff',
  fullName: 'Staff synthetic',
  email: 'staff@example.invalid',
  phone: null,
  isActive: true,
  accountVersion: 'v7',
  employment: {
    id: 'work',
    employmentType: 'FullTime',
    startDate: '2026-01-01',
    endDate: null,
    contractNumber: null,
    salaryType: null,
    baseRate: null,
    status: 'Active',
  },
};
beforeEach(() => {
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (path: string) =>
    path === '/api/v1/staff/staff'
      ? staff
      : { items: path.startsWith('/api/v1/staff?') ? [staff] : [], totalCount: 1 },
  );
});
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <StaffApiPage />
    </QueryClientProvider>,
  );
}
it('loads server staff and forwards search and account status filters', async () => {
  mount();
  expect(await screen.findByText('Staff synthetic')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tìm nhân viên'), { target: { value: 'query' } });
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      expect.stringContaining('search=query'),
      expect.anything(),
    ),
  );
});
it('preserves account version and employment contract, and reports server responsibility conflicts', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Xem chi tiết' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa tài khoản và công việc' }));
  fireEvent.change(screen.getByLabelText(/Lý do cập nhật/), {
    target: { value: 'Synthetic change' },
  });
  fireEvent.click(screen.getByLabelText('Tài khoản hoạt động'));
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PUT')
      throw new ApiError(409, { code: 'staff_responsibilities_unresolved' });
    return path === '/api/v1/staff/staff' ? staff : { items: [], totalCount: 0 };
  });
  fireEvent.submit(document.getElementById('staff-editor')!);
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  expect(await screen.findByText(/Nhân viên còn trách nhiệm/)).toBeInTheDocument();
  const call = mocks.request.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(call[1].body)).toMatchObject({
    accountVersion: 'v7',
    isActive: false,
    reason: 'Synthetic change',
    employment: { employmentType: 'FullTime' },
  });
  expect(JSON.parse(call[1].body).employment).not.toHaveProperty('id');
});
