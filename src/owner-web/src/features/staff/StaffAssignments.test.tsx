import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { StaffAssignments } from './StaffAssignments';

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
  accountVersion: 'v1',
  employment: null,
};
const location = { id: 'location', name: 'Cơ sở mẫu', version: 4, isActive: true };
const assignment = {
  id: 'assignment',
  staffUserId: staff.userId,
  locationId: location.id,
  locationName: location.name,
  startDate: '2026-01-01',
  endDate: '2027-12-31',
};

beforeEach(() => {
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/locations?page=1&pageSize=100')
      return { items: [location], totalCount: 1 };
    if (path === `/api/v1/locations/${location.id}`) return location;
    if (path.startsWith('/api/v1/staff-location-assignments/by-staff')) return [assignment];
    if (path.startsWith('/api/v1/staff-location-assignments?')) return [assignment];
    if (path.endsWith('/staff-change-preview'))
      return { locationId: location.id, canRemove: true, openResponsibilities: [] };
    if (path === '/api/v1/staff?page=1&pageSize=100') return { items: [staff], totalCount: 1 };
    return {};
  });
});

function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <StaffAssignments staff={staff} />
    </QueryClientProvider>,
  );
}

it('updates the selected assignment in place and keeps create as an explicit separate action', async () => {
  mount();
  expect(await screen.findByRole('button', { name: 'Tạo phân công mới' })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa' }));
  expect(await screen.findByText(/không tạo thêm phân công mới/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Hiệu lực đến/), { target: { value: '2027-11-30' } });
  fireEvent.change(screen.getByLabelText(/Lý do cập nhật ngày hiệu lực/), {
    target: { value: 'Điều chỉnh thời hạn' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu ngày hiệu lực' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));

  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/staff-location-assignments/assignment/assignment',
      expect.objectContaining({ method: 'PUT' }),
    ),
  );
  expect(mocks.request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
