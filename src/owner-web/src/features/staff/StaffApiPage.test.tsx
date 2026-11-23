import {
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from '@testing-library/react';
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
    startDate: '2026-01-01',
    endDate: null,
    contractNumber: null,
    salaryType: null,
    baseRate: null,
    status: 'Active',
  },
};
const noResponsibilities = { canDeactivate: true, assignments: [], tasks: [], moveOuts: [] };
beforeEach(() => {
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/staff/staff') return staff;
    if (path.endsWith('/responsibilities')) return noResponsibilities;
    if (path.endsWith('/employments')) return [{ ...staff.employment, history: [] }];
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
  expect(screen.getByText(/Tài khoản nhân viên được kích hoạt ngay khi tạo/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Họ tên/), { target: { value: 'Synthetic new Staff' } });
  fireEvent.change(screen.getByLabelText(/^Email/), {
    target: { value: 'new-staff@example.invalid' },
  });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Hình thức lương' }));
  fireEvent.click(screen.getByRole('option', { name: 'Theo tháng' }));
  expect(screen.getByLabelText(/Mức lương thỏa thuận \(VND\/tháng\)/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Loại công việc/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Trạng thái công việc')).not.toBeInTheDocument();
  expect(
    screen.getByText((_, element) => element?.textContent === 'Trạng thái hợp đồng ban đầu: Đang làm việc'),
  ).toBeInTheDocument();
  const salary = screen.getByLabelText(/Mức lương thỏa thuận/);
  fireEvent.change(salary, { target: { value: '3000000' } });
  expect(salary).toHaveValue('3.000.000');
  fireEvent.change(salary, { target: { value: '9007199254740993' } });
  expect(salary).toHaveValue('9.007.199.254.740.993');
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
  expect(JSON.parse(call[1].body).employment.baseRate).toBe('9007199254740993');
  expect(JSON.parse(call[1].body).employment.status).toBe('Active');
  expect(JSON.parse(call[1].body).employment.salaryType).toBe('Monthly');
});
it('opens newly created active Staff so Owner can send credentials immediately', async () => {
  const created = {
    ...staff,
    userId: 'new-staff',
    fullName: 'New active Staff',
    email: 'new-staff@example.invalid',
  };
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/staff' && init?.method === 'POST') return created;
    if (path === '/api/v1/staff/new-staff') return created;
    if (path.endsWith('/employments')) return [{ ...staff.employment, history: [] }];
    if (path.endsWith('/responsibilities')) return noResponsibilities;
    return { items: [], totalCount: 0 };
  });
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm nhân viên' }));
  fireEvent.change(screen.getByLabelText(/Họ tên/), { target: { value: created.fullName } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: created.email } });
  fireEvent.submit(document.getElementById('staff-editor')!);
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  expect(
    await screen.findByRole('button', { name: 'Gửi tài khoản và mật khẩu mới' }),
  ).toBeInTheDocument();
  expect(mocks.request).not.toHaveBeenCalledWith(
    expect.stringMatching(/\/invitation$/),
    expect.anything(),
  );
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
    employment: { status: 'Active' },
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

it('requests a 12-character password email without a reset link, preserving errors for retry', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Chi tiết' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Gửi tài khoản và mật khẩu mới' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Gửi tài khoản và mật khẩu mới',
  });
  expect(within(dialog).getByText('Email nhận: staff@example.invalid')).toBeInTheDocument();
  expect(within(dialog).getByText(/mật khẩu ngẫu nhiên 12 ký tự/)).toBeInTheDocument();
  expect(within(dialog).getByText(/Hồ sơ → Bảo mật/)).toBeInTheDocument();
  expect(within(dialog).queryByText(/liên kết dùng một lần/)).not.toBeInTheDocument();
  const confirm = within(dialog).getByRole('button', { name: 'Xác nhận' });
  const original = mocks.request.getMockImplementation()!;
  let failPasswordIssue = true;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/issue-password') && init?.method === 'POST' && failPasswordIssue) {
      failPasswordIssue = false;
      throw new ApiError(400, { code: 'email_recipient_invalid' });
    }
    return original(path, init);
  });
  fireEvent.click(confirm);
  expect(await screen.findByRole('alert')).toHaveTextContent('Địa chỉ email nhận không hợp lệ');
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  // Wait for the captured dialog's exit transition without repeatedly scanning
  // the whole MUI page's accessibility tree on a busy CI runner.
  await waitForElementToBeRemoved(dialog, { timeout: 5000 });
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/v1/staff/staff/issue-password',
    expect.objectContaining({ method: 'POST' }),
  );
  const issued = mocks.request.mock.calls.find(
    ([path, init]) => path.endsWith('/issue-password') && init?.method === 'POST',
  )!;
  expect(issued[1]).not.toHaveProperty('body');
  expect(
    mocks.request.mock.calls.filter(
      ([path, init]) => path.endsWith('/issue-password') && init?.method === 'POST',
    ),
  ).toHaveLength(2);
});

it('retains edited values after a stale-version error', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Chi tiết' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa hồ sơ' }));
  fireEvent.change(screen.getByLabelText(/Họ tên/), { target: { value: 'Updated synthetic' } });
  fireEvent.change(screen.getByLabelText(/Lý do cập nhật/), { target: { value: 'Update' } });
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/staff/staff' && init?.method === 'PUT')
      throw new ApiError(409, { code: 'stale_staff_version' });
    return original(path, init);
  });
  fireEvent.submit(document.getElementById('staff-editor')!);
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  const staleDialog = await screen.findByRole('dialog', { name: 'Dữ liệu đã thay đổi' });
  fireEvent.click(within(staleDialog).getByRole('button', { name: 'Hủy' }));
  // MUI keeps the underlying editor aria-hidden during dialog exit animation.
  // Wait for the portal to close before searching the editor's accessible UI.
  await waitForElementToBeRemoved(staleDialog, { timeout: 5000 });
  expect(await screen.findByRole('button', { name: 'Tải hồ sơ mới' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
  expect(screen.getByLabelText(/Họ tên/)).toHaveValue('Updated synthetic');
  fireEvent.click(screen.getByRole('button', { name: 'Tải hồ sơ mới' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Đã kiểm tra, tiếp tục chỉnh sửa' }));
  expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).not.toBeDisabled();
});

it('creates with the existing DTO, retains input on validation errors, and closes after retry', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm nhân viên' }));
  fireEvent.change(screen.getByLabelText(/Họ tên/), { target: { value: 'New synthetic' } });
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'new@example.invalid' } });
  mocks.request.mockImplementation(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      throw new ApiError(400, { errors: { Email: ['Email thử nghiệm không hợp lệ.'] } });
    return { items: [staff], totalCount: 1 };
  });
  fireEvent.submit(document.getElementById('staff-editor')!);
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  expect(await screen.findByText('Email thử nghiệm không hợp lệ.')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Xác nhận lưu hồ sơ' })).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText(/Email/)).toHaveAttribute('aria-invalid', 'true');
  await waitFor(() => expect(screen.getByLabelText(/Email/)).toHaveFocus());
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
    employment: { status: 'Active' },
  });
  expect(JSON.parse(init.body).employment).not.toHaveProperty('employmentType');
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

it('renders multiple structured field errors and focuses the first invalid field without discarding input', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm nhân viên' }));
  fireEvent.change(screen.getByLabelText(/Họ tên/), { target: { value: 'Người dùng tổng hợp' } });
  fireEvent.change(screen.getByLabelText(/^Email/), {
    target: { value: 'synthetic@example.invalid' },
  });
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/staff' && init?.method === 'POST')
      throw new ApiError(400, {
        code: 'validation_error',
        fieldErrors: {
          email: [{ code: 'invalid_email_format', message: 'Email không đúng định dạng.' }],
          fullName: [{ code: 'invalid_length', message: 'Họ tên phải có từ 2 đến 150 ký tự.' }],
        },
      });
    return original(path, init);
  });
  fireEvent.submit(document.getElementById('staff-editor')!);
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  expect(await screen.findByText('Email không đúng định dạng.')).toBeInTheDocument();
  expect(screen.getByText('Họ tên phải có từ 2 đến 150 ký tự.')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText(/Họ tên/)).toHaveFocus());
  expect(screen.getByLabelText(/Họ tên/)).toHaveValue('Người dùng tổng hợp');
  expect(screen.getByLabelText(/^Email/)).toHaveValue('synthetic@example.invalid');
  expect(screen.getByLabelText(/^Email/)).toHaveAttribute('aria-invalid', 'true');
});

it('creates a separate employment period with the latest account version and no account changes', async () => {
  const base = mocks.request.getMockImplementation()!;
  const prior = {
    ...staff,
    employment: { ...staff.employment, endDate: '2027-12-31', contractNumber: 'OLD-01' },
  };
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/staff/staff') return prior;
    if (path.endsWith('/employments') && init?.method !== 'POST')
      return [{ ...prior.employment, history: [] }];
    if (path.endsWith('/employments') && init?.method === 'POST') return prior;
    return base(path, init);
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Chi tiết' }));
  const drawer = await screen.findByRole('dialog', { name: 'Chi tiết nhân viên' });
  const renew = await within(drawer).findByRole('button', { name: 'Tạo kỳ hợp đồng mới' });
  await waitFor(() => expect(renew).toBeEnabled());
  fireEvent.click(renew);
  fireEvent.change(screen.getByLabelText(/Số hợp đồng lao động/), { target: { value: 'NEW-02' } });
  fireEvent.change(screen.getByLabelText(/Lý do cập nhật/), { target: { value: 'Gia hạn' } });
  expect(screen.getByLabelText(/Ngày bắt đầu/)).toHaveValue('2028-01-01');
  fireEvent.submit(document.getElementById('staff-editor')!);
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/staff/staff/employments',
      expect.objectContaining({ method: 'POST' }),
    ),
  );
  const [, init] = mocks.request.mock.calls.find(
    ([path, init]) => path.endsWith('/employments') && init?.method === 'POST',
  )!;
  const payload = JSON.parse(init.body);
  expect(payload).toMatchObject({
    accountVersion: 'v7',
    reason: 'Gia hạn',
    employment: { contractNumber: 'NEW-02', startDate: '2028-01-01' },
  });
  expect(payload).not.toHaveProperty('isActive');
  expect(payload.employment).not.toHaveProperty('id');
});

it('shows exact unresolved responsibilities and blocks known unsafe deactivation', async () => {
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) =>
    path.endsWith('/responsibilities')
      ? {
          canDeactivate: false,
          assignments: [
            {
              id: 'a',
              locationId: 'loc',
              locationName: 'Cơ sở test',
              startDate: '2026-01-01',
              endDate: '9999-12-31',
            },
          ],
          tasks: [],
          moveOuts: [],
        }
      : base(path, init),
  );
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Chi tiết' }));
  fireEvent.click(
    await screen.findByRole('button', { name: /Cơ sở đang\/sắp phụ trách/ }, { timeout: 5000 }),
  );
  expect(screen.getByRole('link', { name: 'Xử lý' })).toHaveAttribute(
    'href',
    '/staff-assignments?staffUserId=staff&locationId=loc',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }));
  fireEvent.click(screen.getByLabelText('Tài khoản hoạt động'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled());
  expect(mocks.request.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
});
