// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileApi, MobileApiError } from '../../../src/mobile/src/lib/api';
import type { OperationalTask } from '../../../src/mobile/src/services/operationalTasks';

const mocks = vi.hoisted(() => ({
  role: 'Staff',
  actor: 'staff',
  api: null as MobileApi | null,
  go: vi.fn(),
  logout: vi.fn(),
  replace: vi.fn(),
  onStateChange: null as ((state: string) => void) | null,
  taskId: '00000000-0000-0000-0000-000000000001',
}));
type Children = { children?: React.ReactNode };
type Button = Children & { onPress: () => void; disabled?: boolean };
vi.mock('expo-router', () => ({
  router: { push: vi.fn(), replace: mocks.replace },
  useLocalSearchParams: () => ({ taskId: mocks.taskId }),
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock('react-native', () => ({
  View: ({ children }: Children) => <div>{children}</div>,
  Image: () => <img alt="Ảnh kết quả" />,
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocks.onStateChange = listener;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: Children) => <span>{children}</span>,
  ActivityIndicator: () => <span>Đang tải dữ liệu</span>,
  TextInput: ({
    label,
    value,
    onChangeText,
    disabled,
    secureTextEntry,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    disabled?: boolean;
    secureTextEntry?: boolean;
  }) => (
    <label>
      {label}
      <input
        type={secureTextEntry ? 'password' : 'text'}
        value={value}
        disabled={disabled}
        onChange={(event) => onChangeText(event.target.value)}
      />
    </label>
  ),
  Checkbox: {
    Item: ({
      label,
      status,
      onPress,
      disabled,
    }: {
      label: string;
      status: string;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <label>
        <input
          type="checkbox"
          checked={status === 'checked'}
          onChange={onPress}
          disabled={disabled}
        />
        {label}
      </label>
    ),
  },
}));
vi.mock('../../../src/mobile/src/components/WorkspaceKit', () => ({
  Action: ({ children, onPress, disabled }: Button) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  Box: ({ children }: Children) => <div>{children}</div>,
  Row: ({ children }: Children) => <div>{children}</div>,
  Heading: ({
    title,
    action,
    onPress,
  }: {
    title: string;
    action?: string;
    onPress?: () => void;
  }) => (
    <div>
      <h1>{title}</h1>
      {action && <button onClick={onPress}>{action}</button>}
    </div>
  ),
  Pill: ({ children }: Children) => <span>{children}</span>,
  Metric: ({ label, value }: { label: string; value: string }) => (
    <span>
      {label}: {value}
    </span>
  ),
  QuickActions: ({ items }: { items: { label: string; onPress: () => void }[] }) => (
    <div>
      {items.map((item) => (
        <button key={item.label} onClick={item.onPress}>
          {item.label}
        </button>
      ))}
    </div>
  ),
  InfoRow: ({ title, onPress }: { title: string; onPress: () => void }) => (
    <button onClick={onPress}>{title}</button>
  ),
  ui: {},
}));
vi.mock('../../../src/mobile/src/components/WorkflowControls', () => ({
  ChoiceField: ({
    label,
    value,
    options,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    options: { id: string; label: string }[];
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        <option value="">Chọn</option>
        {options
          .filter((option) => option.id)
          .map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
      </select>
    </label>
  ),
  Input: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
    </label>
  ),
}));
vi.mock('../../../src/mobile/src/components/CameraCapture', () => ({
  CameraCapture: () => <span>Camera</span>,
}));
vi.mock('../../../src/mobile/src/lib/SessionProvider', () => ({
  useSession: () => ({
    api: mocks.api,
    logout: mocks.logout,
    session: { roles: [mocks.role], userId: mocks.actor },
  }),
}));
vi.mock('../../../src/mobile/src/features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ role: mocks.role, go: mocks.go }),
}));
import {
  OperationalTaskDetail,
  OperationalTasksScreen,
  TaskWorkForm,
} from '../../../src/mobile/src/screens/OperationalTaskScreens';
import {
  TaskNotificationsScreen,
  TenantHomeScreen,
} from '../../../src/mobile/src/screens/LiveWorkspaceScreens';
import { AccountSecurityScreen } from '../../../src/mobile/src/screens/AccountSecurityScreen';
import { TenantInvoicesScreen } from '../../../src/mobile/src/screens/TenantInvoicesScreen';

const id = '00000000-0000-0000-0000-000000000001';
const fileId = '00000000-0000-0000-0000-000000000002';
const page = <T,>(items: T[], totalCount = items.length) => ({
  items,
  page: 1,
  pageSize: 20,
  totalCount,
});
const task: OperationalTask = {
  id,
  locationId: id,
  kind: 'AdHoc',
  title: 'Kiểm tra hành lang',
  requirements: 'Đối chiếu checklist',
  priority: 'Normal',
  dueAt: '2026-11-02T02:00:00Z',
  evidenceRequired: true,
  status: 'InProgress',
  isOverdue: false,
  currentResponsibleStaffUserId: 'staff',
  responsibilityAvailable: true,
  result: null,
  version: 7,
  verifiedAt: null,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  mocks.role = 'Staff';
  mocks.actor = 'staff';
  mocks.taskId = id;
  mocks.go.mockClear();
  mocks.logout.mockReset().mockResolvedValue(undefined);
  mocks.replace.mockClear();
});
afterEach(cleanup);

it('Tenant reads persisted invoice consumption and amount without a fake payment state', async () => {
  mocks.role = 'Tenant';
  mocks.actor = 'tenant';
  const invoice = {
    id: 'bill',
    roomNumber: 'P101',
    locationName: 'Synthetic',
    billingPeriod: '2026-10-01',
    status: 'Final',
    total: '3119250',
    missingInputs: [],
    dueDate: '2026-11-10',
    lines: [
      {
        id: 'line',
        name: 'Điện tổng hợp',
        category: 'Electricity',
        rateDate: '2026-10-01',
        rate: '3500',
        quantity: '25.5',
        amount: '89250',
        meterReadingId: 'reading',
        previousReading: '100',
        confirmedReading: '125.5',
      },
    ],
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      json(String(url).includes('/invoices/bill') ? invoice : page([invoice])),
    );
  setApi(fetcher);
  render(<TenantInvoicesScreen />);
  await screen.findByText('Phòng P101 · 2026-10');
  fireEvent.click(screen.getByText('Xem hóa đơn'));
  await screen.findByText('Điện tổng hợp');
  expect(screen.getByText('Tiêu thụ: 25.5 kWh')).toBeTruthy();
  expect(screen.getByText(/Chỉ số trước: 100/)).toBeTruthy();
  expect(screen.queryByText(/Đã thanh toán|Paid|Thanh toán thành công/)).toBeNull();
  expect(fetcher.mock.calls[1]![0]).toContain('/api/v1/invoices/bill');
});
it('Tenant invoice detail failure removes prior data and offers reload', async () => {
  mocks.role = 'Tenant';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      json(
        page([
          {
            id: 'bill',
            roomNumber: 'P101',
            locationName: 'Synthetic',
            billingPeriod: '2026-10-01',
            status: 'Draft',
            total: '3000000',
            missingInputs: [],
          },
        ]),
      ),
    )
    .mockResolvedValue(json({}, 404));
  setApi(fetcher);
  render(<TenantInvoicesScreen />);
  fireEvent.click(await screen.findByText('Xem hóa đơn'));
  await screen.findByText(/HTTP 404/);
  expect(screen.queryByText('Tổng tiền hóa đơn')).toBeNull();
  expect(screen.getByText('Về danh sách hóa đơn')).toBeTruthy();
});
function setApi(fetcher: typeof fetch) {
  mocks.api = new MobileApi(
    'https://api.example.invalid',
    () => 'synthetic-access',
    async () => undefined,
    vi.fn(),
    fetcher,
  );
}

it('uses server list, pagination and role navigation instead of preview work orders', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      json(
        page([{ ...task, title: String(url).includes('page=2') ? 'Trang hai' : task.title }], 21),
      ),
    );
  setApi(fetcher);
  render(<OperationalTasksScreen />);
  await screen.findByText(task.title);
  expect(screen.queryByText(/CV-1042/)).toBeNull();
  fireEvent.click(screen.getByText('Xem chi tiết & cập nhật'));
  expect(mocks.go).toHaveBeenCalledWith('task-detail', { taskId: id });
  fireEvent.click(screen.getByText('Sau'));
  await screen.findByText('Trang hai');
  expect(fetcher.mock.calls[1]![0]).toContain('page=2');
});
it('does not show stale records after a forbidden reload or failed filter', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(page([task])))
    .mockResolvedValueOnce(json({}, 403));
  setApi(fetcher);
  render(<OperationalTasksScreen />);
  await screen.findByText(task.title);
  fireEvent.click(screen.getByText('Tải lại dữ liệu'));
  expect(screen.queryByText(task.title)).toBeNull();
  await screen.findByText(/HTTP 403/);
  expect(screen.queryByText('Xem chi tiết & cập nhật')).toBeNull();
});
it('requires result and evidence before Staff submits, blocks duplicates, and uses the current version', async () => {
  let resolveMutation!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (init?.method === 'POST')
      return new Promise((resolve) => {
        resolveMutation = resolve;
      });
    if (String(url).includes('/history')) return json(page([]));
    if (String(url).endsWith('/evidence'))
      return json([{ id: fileId, createdAt: '2026-11-01T00:00:00Z' }]);
    return json(task);
  });
  setApi(fetcher);
  render(<OperationalTaskDetail />);
  await screen.findByText(task.title);
  fireEvent.change(screen.getByLabelText('Thao tác'), { target: { value: 'submit' } });
  fireEvent.click(screen.getByText('Xác nhận thao tác'));
  expect(screen.getByText(/Nhập kết quả/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Kết quả / Nội dung / Lý do'), {
    target: { value: 'Đã kiểm tra' },
  });
  fireEvent.click(screen.getByText('Xác nhận thao tác'));
  expect(screen.getByText(/Chọn ít nhất một ảnh/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Dùng ảnh 1 cho lần gửi này'));
  fireEvent.click(screen.getByText('Xác nhận thao tác'));
  fireEvent.click(screen.getByText('Xác nhận thao tác'));
  const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0]![1]!.body as string)).toEqual({
    version: 7,
    note: 'Đã kiểm tra',
    evidenceIds: [fileId],
  });
  expect(new Headers(posts[0]![1]?.headers).get('Idempotency-Key')).toMatch(/^[a-f0-9-]{36}$/);
  expect(screen.queryByText('Máy chủ đã ghi nhận thao tác.')).toBeNull();
  await act(async () =>
    resolveMutation(json({ ...task, status: 'PendingVerification', version: 8 })),
  );
  await screen.findByText('Máy chủ đã ghi nhận thao tác.');
});
it('retains the idempotency key after an uncertain mutation response and never claims success', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (init?.method === 'POST') throw new MobileApiError(0, 'request_timeout');
    if (String(url).includes('/history')) return json(page([]));
    if (String(url).endsWith('/evidence')) return json([]);
    return json({ ...task, status: 'Assigned' });
  });
  setApi(fetcher);
  render(<OperationalTaskDetail />);
  await screen.findByText(task.title);
  fireEvent.change(screen.getByLabelText('Thao tác'), { target: { value: 'start' } });
  fireEvent.click(screen.getByText('Xác nhận thao tác'));
  await screen.findByText(/15 giây/);
  await waitFor(() =>
    expect((screen.getByText('Xác nhận thao tác') as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByText('Xác nhận thao tác'));
  await waitFor(() =>
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2),
  );
  const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(new Headers(posts[0]![1]?.headers).get('Idempotency-Key')).toBe(
    new Headers(posts[1]![1]?.headers).get('Idempotency-Key'),
  );
  expect(screen.queryByText('Máy chủ đã ghi nhận thao tác.')).toBeNull();
});
it('shows Owner verification only after server data loads and sends the matching version', async () => {
  mocks.role = 'Owner';
  mocks.actor = 'owner';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).includes('/history')) return json(page([]));
    if (String(url).endsWith('/evidence')) return json([]);
    return json({ ...task, status: init?.method === 'POST' ? 'Completed' : 'PendingVerification' });
  });
  setApi(fetcher);
  render(<OperationalTaskDetail />);
  await screen.findByText(task.title);
  fireEvent.change(screen.getByLabelText('Thao tác'), { target: { value: 'verify' } });
  fireEvent.click(screen.getByText('Xác nhận thao tác'));
  await screen.findByText('Máy chủ đã ghi nhận thao tác.');
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(post[0]).toContain('/verify');
  expect(JSON.parse(post[1]!.body as string).version).toBe(7);
});
it('rejects invalid task deep links before loading private data', () => {
  const fetcher = vi.fn<typeof fetch>();
  setApi(fetcher);
  mocks.taskId = '../other';
  render(<OperationalTaskDetail />);
  expect(screen.getByText(/Mã công việc không hợp lệ/)).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});
it('renders Tenant contracts from the scoped endpoint without fetching Owner or Staff records', async () => {
  mocks.role = 'Tenant';
  mocks.actor = 'tenant';
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    json(
      page([
        {
          id,
          roomNumber: 'T.101',
          locationName: 'Cơ sở kiểm thử',
          status: 'Active',
          kind: 'MainTenancy',
          startDate: '2026-11-01',
          endDate: '2027-10-31',
          monthlyRent: '3000000',
        },
      ]),
    ),
  );
  setApi(fetcher);
  render(<TenantHomeScreen />);
  await screen.findByText('Phòng T.101');
  fireEvent.click(screen.getByText('Xem hợp đồng & trạng thái ký'));
  expect(mocks.go).toHaveBeenCalledWith('contract', { contractId: id });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    'https://api.example.invalid/api/v1/contracts?page=1&pageSize=5',
  ]);
});
it('keeps notifications unread and shows rejection when the server refuses marking read', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_url, init) =>
      init?.method === 'POST'
        ? json({}, 403)
        : json(
            page([
              { id, taskId: id, event: 'rework', readAt: null, createdAt: '2026-11-01T00:00:00Z' },
            ]),
          ),
    );
  setApi(fetcher);
  render(<TaskNotificationsScreen />);
  await screen.findByText('Yêu cầu làm lại');
  fireEvent.click(screen.getByText('Đánh dấu đã đọc'));
  await screen.findByText(/HTTP 403/);
  expect(screen.getByText('Chưa đọc')).toBeTruthy();
  expect(mocks.go).not.toHaveBeenCalled();
});
it('creates a real task with Vietnam offset and rejects impossible calendar dates before mutation', async () => {
  mocks.role = 'Owner';
  const saved = vi.fn();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_url, init) =>
      json(init?.method === 'POST' ? task : [{ id, label: 'Cơ sở mẫu kiểm thử' }]),
    );
  setApi(fetcher);
  render(<TaskWorkForm onCancel={vi.fn()} onSaved={saved} />);
  await screen.findByText('Cơ sở mẫu kiểm thử');
  fireEvent.change(screen.getByLabelText('Cơ sở'), { target: { value: id } });
  fireEvent.change(screen.getByLabelText('Tên công việc'), { target: { value: 'Kiểm tra' } });
  fireEvent.change(screen.getByLabelText('Yêu cầu & kết quả cần đạt'), {
    target: { value: 'Theo checklist' },
  });
  const date = screen.getByLabelText('Thời hạn (dd/MM/yyyy HH:mm, giờ Việt Nam)');
  fireEvent.change(date, { target: { value: '30/02/2027 09:00' } });
  fireEvent.click(screen.getByText('Lưu công việc'));
  expect(screen.getByText(/Nhập thời hạn/)).toBeTruthy();
  expect(saved).not.toHaveBeenCalled();
  fireEvent.change(date, { target: { value: '28/02/2027 09:00' } });
  fireEvent.click(screen.getByText('Lưu công việc'));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(post[1]!.body as string).work.dueAt).toBe('2027-02-28T09:00:00+07:00');
});

it('validates password confirmation and keeps the session when the server rejects the change', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}, 400));
  setApi(fetcher);
  render(<AccountSecurityScreen />);
  fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), {
    target: { value: 'Synthetic-Old!2026' },
  });
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), {
    target: { value: 'Synthetic-New!2026' },
  });
  fireEvent.click(screen.getByText('Đổi mật khẩu & Đăng xuất'));
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu mới'), {
    target: { value: 'Synthetic-New!2026' },
  });
  fireEvent.click(screen.getByText('Đổi mật khẩu & Đăng xuất'));
  await screen.findByText(/HTTP 400/);
  expect(mocks.logout).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
});
it('clears password fields in the background and logs out only after a successful server change', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  setApi(fetcher);
  render(<AccountSecurityScreen />);
  fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), {
    target: { value: 'Synthetic-Old!2026' },
  });
  await act(async () => mocks.onStateChange?.('background'));
  expect((screen.getByLabelText('Mật khẩu hiện tại') as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), {
    target: { value: 'Synthetic-Old!2026' },
  });
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), {
    target: { value: 'Synthetic-New!2026' },
  });
  fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu mới'), {
    target: { value: 'Synthetic-New!2026' },
  });
  fireEvent.click(screen.getByText('Đổi mật khẩu & Đăng xuất'));
  fireEvent.click(screen.getByText('Đổi mật khẩu & Đăng xuất'));
  await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
    currentPassword: 'Synthetic-Old!2026',
    newPassword: 'Synthetic-New!2026',
  });
  expect(mocks.replace).toHaveBeenCalledWith('/');
  expect((screen.getByLabelText('Mật khẩu mới') as HTMLInputElement).value).toBe('');
});
