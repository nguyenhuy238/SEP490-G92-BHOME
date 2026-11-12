import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  mocks.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/staff/staff') return staff;
    if (path.startsWith('/api/v1/staff-location-assignments/by-staff')) return [];
    return { items: path.startsWith('/api/v1/staff?') ? [staff] : [], totalCount: 1 };
  });
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
it('creates Staff without asking for or transmitting an initial password', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm nhân viên' }));
  expect(screen.queryByLabelText(/Mật khẩu khởi tạo/)).toBeNull();
  expect(screen.getByText(/Nhân viên tự đặt mật khẩu qua lời mời email/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Họ tên/), { target: { value: 'Synthetic new Staff' } });
  fireEvent.change(screen.getByLabelText(/^Email/), {
    target: { value: 'new-staff@example.invalid' },
  });
  fireEvent.change(screen.getByLabelText(/Loại công việc/), { target: { value: 'PartTime' } });
  fireEvent.submit(document.getElementById('staff-editor')!);
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.some(
        ([path, init]) => path === '/api/v1/staff' && init?.method === 'POST',
      ),
    ).toBe(true),
  );
  const call = mocks.request.mock.calls.find(
    ([path, init]) => path === '/api/v1/staff' && init?.method === 'POST',
  )!;
  expect(JSON.parse(call[1].body)).not.toHaveProperty('initialPassword');
});
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
  fireEvent.click(await screen.findByRole('button', { name: 'Chi tiết' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa hồ sơ' }));
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
  expect(await screen.findByRole('alert')).toHaveTextContent(/Nhân viên còn trách nhiệm/);
  const call = mocks.request.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(call[1].body)).toMatchObject({
    accountVersion: 'v7',
    isActive: false,
    reason: 'Synthetic change',
    employment: { employmentType: 'FullTime' },
  });
  expect(JSON.parse(call[1].body).employment).not.toHaveProperty('id');
  expect(staff.employment.id).toBe('work');
});

it('opens a drawer, separates account and employment statuses, and preserves search on close', async () => {
  const ended = {
    ...staff,
    fullName: '',
    employment: { ...staff.employment, status: 'Ended', endDate: '2026-12-31' },
  };
  mocks.request.mockImplementation(async (path: string) =>
    path === '/api/v1/staff/staff' ? ended : { items: [ended], totalCount: 1 },
  );
  mount();
  expect(await screen.findByText('Chưa cập nhật tên')).toBeInTheDocument();
  expect(screen.getByText('Chưa cập nhật')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tìm nhân viên'), { target: { value: 'test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Chi tiết' }));
  const drawer = await screen.findByRole('dialog', { name: 'Chi tiết nhân viên' });
  expect(await within(drawer).findByText('Đã kết thúc')).toBeInTheDocument();
  expect(within(drawer).getByText('Đang hoạt động')).toBeInTheDocument();
  expect(within(drawer).getByText('31/12/2026')).toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole('button', { name: 'Đóng chi tiết' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByLabelText('Tìm nhân viên')).toHaveValue('test');
  expect(screen.queryByText('Trang trước')).not.toBeInTheDocument();
});

it('shows missing employment and no invented salary', async () => {
  const missing = { ...staff, employment: null };
  mocks.request.mockImplementation(async (path: string) =>
    path === '/api/v1/staff/staff' ? missing : { items: [missing], totalCount: 1 },
  );
  mount();
  expect(await screen.findByText('Chưa có hợp đồng')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Chi tiết' }));
  const drawer = await screen.findByRole('dialog', { name: 'Chi tiết nhân viên' });
  expect(await within(drawer).findByText('Chưa có hợp đồng')).toBeInTheDocument();
  expect(within(drawer).getAllByText('Chưa thiết lập')).toHaveLength(2);
});

it('uses server totals and server pagination, resetting the page for search', async () => {
  mocks.request.mockImplementation(async () => ({ items: [staff], totalCount: 125 }));
  mount();
  expect(await screen.findByText('Trang 1 · 125 bản ghi')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      expect.stringContaining('page=2'),
      expect.anything(),
    ),
  );
  fireEvent.change(screen.getByLabelText('Tìm nhân viên'), { target: { value: 'next' } });
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/staff?search=next&page=1&pageSize=20',
      expect.anything(),
    ),
  );
  expect(screen.queryByText(/100 hồ sơ đầu/)).not.toBeInTheDocument();
});

it('keeps invitation errors visible and allows a successful retry', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Chi tiết' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Gửi thông tin tài khoản' }));
  mocks.request.mockRejectedValueOnce(new ApiError(503, { detail: 'Synthetic unavailable' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Xác nhận' })).not.toBeInTheDocument(),
  );
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/v1/staff/staff/invitation',
    expect.objectContaining({ method: 'POST' }),
  );
});

it('retains edited values after a stale-version error', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Chi tiết' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa hồ sơ' }));
  fireEvent.change(screen.getByLabelText(/Họ tên/), { target: { value: 'Updated synthetic' } });
  fireEvent.change(screen.getByLabelText(/Lý do cập nhật/), { target: { value: 'Update' } });
  mocks.request.mockRejectedValueOnce(new ApiError(409, { code: 'stale_staff_version' }));
  fireEvent.submit(document.getElementById('staff-editor')!);
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Hồ sơ đã thay đổi');
  fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
  expect(screen.getByLabelText(/Họ tên/)).toHaveValue('Updated synthetic');
});

it('creates with the existing DTO, retains input on validation errors, and closes after retry', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm nhân viên' }));
  fireEvent.change(screen.getByLabelText(/Họ tên/), { target: { value: 'New synthetic' } });
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'new@example.invalid' } });
  fireEvent.change(screen.getByLabelText(/Loại công việc/), { target: { value: 'Task' } });
  mocks.request.mockImplementation(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      throw new ApiError(400, { errors: { Email: ['Email thử nghiệm không hợp lệ.'] } });
    return { items: [staff], totalCount: 1 };
  });
  fireEvent.submit(document.getElementById('staff-editor')!);
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Email thử nghiệm');
  fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
  expect(screen.getByLabelText(/Họ tên/)).toHaveValue('New synthetic');
  mocks.request.mockImplementation(async (_path: string, init?: RequestInit) =>
    init?.method === 'POST' ? staff : { items: [staff], totalCount: 1 },
  );
  fireEvent.submit(document.getElementById('staff-editor')!);
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  await waitFor(() => expect(document.getElementById('staff-editor')).not.toBeInTheDocument());
  const [, init] = mocks.request.mock.calls.find(
    ([path, init]) => path === '/api/v1/staff' && init?.method === 'POST',
  )!;
  expect(JSON.parse(init.body)).toMatchObject({
    fullName: 'New synthetic',
    employment: { employmentType: 'Task' },
  });
  expect(JSON.parse(init.body)).not.toHaveProperty('initialPassword');
  expect(JSON.parse(init.body)).not.toHaveProperty('accountVersion');
});

it('rejects reversed dates before a write request', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm nhân viên' }));
  fireEvent.change(screen.getByLabelText(/Ngày bắt đầu/), { target: { value: '2026-06-01' } });
  fireEvent.change(screen.getByLabelText(/Ngày kết thúc/), { target: { value: '2026-05-01' } });
  fireEvent.submit(document.getElementById('staff-editor')!);
  expect(screen.getByText('Ngày kết thúc không được trước ngày bắt đầu.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Xác nhận' })).not.toBeInTheDocument();
  expect(mocks.request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
