import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { theme } from '../../theme/theme';
import AutomationPage, { DemoAutomationPage, LiveAutomationPage } from './AutomationPage';
import { invoiceClient } from '../../../../../packages/client-core/src/invoices';
const mocks = vi.hoisted(() => ({ request: vi.fn(), schedule: vi.fn() }));
vi.mock('./useInvoiceApi', () => ({
  useInvoiceApi: () => ({ ...invoiceClient(mocks.request), ...mocks }),
}));
vi.mock('../../services/config', () => ({ isMockMode: false, apiBaseUrl: '' }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function mount(page: React.ReactNode = <LiveAutomationPage />) {
  render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>{page}</MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
it('renders the actual live automation route when API mode is enabled', async () => {
  respond(false);
  mount(<AutomationPage />);
  expect(
    screen.getByText(
      'Chọn cơ sở để cấu hình lịch. Kỳ kiểm thử dùng riêng cho các thao tác thủ công.',
    ),
  ).toBeInTheDocument();
  await choose();
  expect(await screen.findByText('missing_water_meter')).toBeInTheDocument();
  expect(mocks.request).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/billing-automation/preview?'),
    expect.anything(),
  );
});
async function choose() {
  fireEvent.mouseDown(await screen.findByLabelText('Cơ sở'));
  fireEvent.click(await screen.findByRole('option', { name: 'Synthetic' }));
  fireEvent.change(screen.getByLabelText('Kỳ kiểm thử'), { target: { value: '2026-11' } });
}
async function chooseRoom() {
  fireEvent.mouseDown(await screen.findByLabelText('Phòng kiểm thử'));
  fireEvent.click(await screen.findByRole('option', { name: 'A101' }));
}
async function chooseMeter() {
  fireEvent.mouseDown(await screen.findByLabelText('Đồng hồ điện hoặc nước'));
  fireEvent.click(await screen.findByRole('option', { name: 'A101 · D01' }));
}
async function openSchedule() {
  fireEvent.click(await screen.findByRole('button', { name: /Thiết lập lịch|Chỉnh sửa lịch/ }));
  await screen.findByLabelText(/Kỳ bắt đầu áp dụng cấu hình/);
}
function respond(developerActionsEnabled = true) {
  mocks.schedule.mockResolvedValue({
    locationId: 'loc',
    version: 3,
    rateDate: 0,
    rentSource: 0,
    partialMonth: 0,
    rounding: 0,
    draftDay: 7,
    draftMonthOffset: 0,
    finalDay: 20,
    finalMonthOffset: 0,
    dueDay: 25,
    dueMonthOffset: 0,
  });
  mocks.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/capture/locations') return [{ id: 'loc', label: 'Synthetic' }];
    if (path === '/api/v1/capture/locations/loc/rooms') return [{ id: 'room', label: 'A101' }];
    if (path === '/api/v1/capture/locations/loc/meters')
      return [{ id: 'meter-a', label: 'A101 · D01', parentId: 'room' }];
    if (path.startsWith('/api/v1/capture/meter-tasks?')) return [];
    if (path.startsWith('/api/v1/invoices?')) return { items: [], totalCount: 0, pageSize: 20 };
    if (path.includes('/history')) return [];
    if (path.includes('/preview?'))
      return {
        developerActionsEnabled,
        timeZone: 'Asia/Ho_Chi_Minh',
        businessDate: '2026-11-02',
        phases: [
          { phase: 'Meter', scheduledDate: '2026-11-01', eligible: true },
          { phase: 'Final', scheduledDate: '2026-11-20', eligible: false },
        ],
      };
    if (path.includes('/executions?'))
      return [
        {
          id: 'exec',
          phase: 'Draft',
          status: 'PendingInputs',
          attempts: 2,
          createdCount: 1,
          existingCount: 0,
          exceptionsJson: '[{"code":"missing_water_meter"}]',
          lastStartedAt: '2026-11-02T00:00:00Z',
        },
      ];
    if (path.includes('/delivery-status'))
      return {
        configured: false,
        enabled: false,
        maxAttempts: 4,
        deliveries: { items: [], totalCount: 0 },
      };
    return [];
  });
}
it('keeps both manual actions and independent effective month visible; saves automation disabled', async () => {
  respond();
  mount();
  await choose();
  expect(await screen.findByText('missing_water_meter')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Cấu hình lịch' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Chạy thử thủ công' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Giao nhiệm vụ khởi tạo' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Giao nhiệm vụ vận hành' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tạo hóa đơn nháp' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kiểm tra và phát hành' })).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'Chạy ngay: Phát hành hóa đơn' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Lịch chạy & giám sát/ }));
  expect(screen.queryByRole('button', { name: /Chạy ngay:/ })).not.toBeInTheDocument();
  await openSchedule();
  fireEvent.change(await screen.findByLabelText(/Kỳ bắt đầu áp dụng cấu hình/), {
    target: { value: '2027-02' },
  });
  fireEvent.change(screen.getByLabelText(/Ngày giao việc ghi chỉ số/), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText(/Ngày hết hạn ghi chỉ số/), { target: { value: '4' } });
  expect(screen.queryByLabelText('Bật tự động cho cơ sở')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Lưu lịch (không kích hoạt tự động)' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/billing-automation',
      expect.objectContaining({ method: 'PUT' }),
    ),
  );
  const call = mocks.request.mock.calls.find((c) => c[0] === '/api/v1/billing-automation')!;
  expect(JSON.parse(call[1].body)).toMatchObject({
    expectedVersion: 0,
    expectedBillingScheduleVersion: 3,
    enabled: false,
    authorizeAutomaticFinalization: false,
    meterDay: 2,
    meterDueDay: 4,
    meterDueMonthOffset: 0,
    draftDay: 7,
    draftMonthOffset: 0,
    finalDay: 20,
    finalMonthOffset: 0,
    timeZone: 'Asia/Ho_Chi_Minh',
    effectiveFrom: '2027-02-01',
  });
  expect(JSON.parse(call[1].body)).toMatchObject({ dueDay: 25, dueMonthOffset: 0 });
  expect(screen.getByLabelText('Kỳ kiểm thử')).toHaveValue('2026-11');
});
it('creates the first billing schedule and automation together without requiring Pricing', async () => {
  respond();
  mocks.schedule.mockResolvedValue(undefined);
  mount();
  await choose();
  await openSchedule();
  fireEvent.change(screen.getByLabelText(/Ngày giao việc ghi chỉ số/), { target: { value: '12' } });
  fireEvent.change(screen.getByLabelText(/Ngày hết hạn ghi chỉ số/), { target: { value: '13' } });
  fireEvent.change(screen.getByLabelText(/Ngày tạo hóa đơn nháp/), { target: { value: '13' } });
  fireEvent.change(screen.getByLabelText(/Ngày phát hành chính thức/), { target: { value: '13' } });
  fireEvent.change(screen.getByLabelText(/Ngày hạn thanh toán/), { target: { value: '20' } });
  for (const [label, value] of [
    ['Mốc tham chiếu kỳ', '1'],
    ['Phí cố định khi ở không đủ tháng', '1'],
    ['Làm tròn từng khoản VND', '0'],
  ] as const) {
    fireEvent.mouseDown(screen.getByLabelText(new RegExp(label)));
    fireEvent.click(
      screen.getByRole('option', {
        name:
          value === '1'
            ? label === 'Mốc tham chiếu kỳ'
              ? 'Ngày cuối tháng'
              : 'Theo số ngày ở'
            : '0,5 làm tròn lên',
      }),
    );
  }
  fireEvent.click(screen.getByRole('button', { name: 'Tạo lịch (không kích hoạt tự động)' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/billing-automation',
      expect.objectContaining({ method: 'PUT' }),
    ),
  );
  const call = mocks.request.mock.calls.find(([path]) => path === '/api/v1/billing-automation')!;
  expect(JSON.parse(call[1].body)).toMatchObject({
    expectedBillingScheduleVersion: 0,
    enabled: false,
    authorizeAutomaticFinalization: false,
    meterDay: 12,
    meterDueDay: 13,
    draftDay: 13,
    finalDay: 13,
    dueDay: 20,
    initialSchedule: { rateDate: 1, partialMonth: 1, rounding: 0 },
  });
});
it('keeps calculation rules and completion/payment dates editable after a saved schedule exists', async () => {
  respond();
  mount();
  await choose();
  await openSchedule();
  expect(screen.getByRole('combobox', { name: 'Mốc tham chiếu kỳ' })).toHaveTextContent(
    'Ngày đầu tháng',
  );
  expect(
    screen.getByRole('combobox', { name: 'Phí cố định khi ở không đủ tháng' }),
  ).toHaveTextContent('Thu cả tháng');
  expect(screen.getByRole('combobox', { name: 'Làm tròn từng khoản VND' })).toHaveTextContent(
    '0,5 làm tròn lên',
  );
  expect(screen.getByLabelText(/Ngày hạn thanh toán/)).toHaveValue(25);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Mốc tham chiếu kỳ' }));
  fireEvent.click(screen.getByRole('option', { name: 'Ngày cuối tháng' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Phí cố định khi ở không đủ tháng' }));
  fireEvent.click(screen.getByRole('option', { name: 'Theo số ngày ở' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Làm tròn từng khoản VND' }));
  fireEvent.click(screen.getByRole('option', { name: '0,5 làm tròn về số chẵn' }));
  fireEvent.change(screen.getByLabelText(/Ngày hết hạn ghi chỉ số/), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText(/Ngày phát hành chính thức/), { target: { value: '21' } });
  fireEvent.change(screen.getByLabelText(/Ngày hạn thanh toán/), { target: { value: '26' } });
  fireEvent.change(screen.getByLabelText(/Ngày giao việc ghi chỉ số/), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu lịch (không kích hoạt tự động)' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/billing-automation',
      expect.objectContaining({ method: 'PUT' }),
    ),
  );
  const call = mocks.request.mock.calls.find(([path]) => path === '/api/v1/billing-automation')!;
  expect(JSON.parse(call[1].body)).toMatchObject({
    expectedBillingScheduleVersion: 3,
    initialSchedule: { rateDate: 1, partialMonth: 1, rounding: 1 },
    meterDay: 3,
    meterDueDay: 5,
    finalDay: 21,
    dueDay: 26,
    enabled: false,
    authorizeAutomaticFinalization: false,
  });
});
it('shows month-based choices and previews actual dates while keeping numeric offsets in the API', async () => {
  respond();
  mount();
  await choose();
  await openSchedule();
  fireEvent.change(screen.getByLabelText(/Kỳ bắt đầu áp dụng cấu hình/), {
    target: { value: '2026-11' },
  });
  fireEvent.change(screen.getByLabelText(/Ngày giao việc ghi chỉ số/), { target: { value: '28' } });
  fireEvent.change(screen.getByLabelText(/Ngày hết hạn ghi chỉ số/), { target: { value: '30' } });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Tạo nháp vào tháng' }));
  fireEvent.click(screen.getByRole('option', { name: 'Tháng sau' }));
  fireEvent.change(screen.getByLabelText(/Ngày tạo hóa đơn nháp/), { target: { value: '2' } });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Phát hành vào tháng' }));
  fireEvent.click(screen.getByRole('option', { name: 'Tháng sau' }));
  fireEvent.change(screen.getByLabelText(/Ngày phát hành chính thức/), { target: { value: '5' } });
  const preview = screen.getByLabelText('Xem trước lịch thực hiện');
  expect(preview).toHaveTextContent('28/11/2026');
  expect(preview).toHaveTextContent('30/11/2026');
  expect(preview).toHaveTextContent('02/12/2026');
  expect(preview).toHaveTextContent('05/12/2026');
  // Existing payment due date is November 25, so a December Final is rejected.
  expect(screen.getByRole('button', { name: 'Lưu lịch (không kích hoạt tự động)' })).toBeDisabled();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Tạo nháp vào tháng' }));
  fireEvent.click(screen.getByRole('option', { name: 'Tháng này' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Phát hành vào tháng' }));
  fireEvent.click(screen.getByRole('option', { name: 'Tháng này' }));
  fireEvent.change(screen.getByLabelText(/Ngày tạo hóa đơn nháp/), { target: { value: '7' } });
  fireEvent.change(screen.getByLabelText(/Ngày phát hành chính thức/), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu lịch (không kích hoạt tự động)' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/billing-automation',
      expect.objectContaining({ method: 'PUT' }),
    ),
  );
  const call = mocks.request.mock.calls.find(([url]) => url === '/api/v1/billing-automation')!;
  expect(JSON.parse(call[1].body)).toMatchObject({
    draftMonthOffset: 0,
    finalMonthOffset: 0,
    enabled: false,
  });
});
it('warns about a previously enabled plan yet saves a new version with both automatic flags disabled', async () => {
  respond();
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/billing-automation/loc/history')
      return [
        {
          id: 'prior-enabled-plan',
          locationId: 'loc',
          version: 8,
          effectiveFrom: '2026-10-01',
          enabled: true,
          authorizeAutomaticFinalization: true,
          meterDay: 2,
          meterDueDay: 4,
          meterDueMonthOffset: 0,
          billingScheduleVersion: 3,
          timeZone: 'Asia/Ho_Chi_Minh',
          recordedAt: '2026-10-01T00:00:00Z',
          billingSnapshot: JSON.stringify({
            DraftDay: 7,
            DraftMonthOffset: 0,
            FinalDay: 20,
            FinalMonthOffset: 0,
            DueDay: 25,
            DueMonthOffset: 0,
          }),
        },
      ];
    return original(path, init);
  });
  mount();
  await choose();
  expect(await screen.findByText(/Có phiên bản cũ được bật tự động/)).toBeInTheDocument();
  await openSchedule();
  const effective = await screen.findByLabelText(/Kỳ bắt đầu áp dụng cấu hình/);
  fireEvent.change(effective, { target: { value: '2027-02' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu lịch (không kích hoạt tự động)' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/billing-automation',
      expect.objectContaining({ method: 'PUT' }),
    ),
  );
  const put = mocks.request.mock.calls.find(
    ([path, init]) => path === '/api/v1/billing-automation' && init?.method === 'PUT',
  )!;
  expect(JSON.parse(put[1].body)).toMatchObject({
    expectedVersion: 8,
    enabled: false,
    authorizeAutomaticFinalization: false,
    effectiveFrom: '2027-02-01',
  });
});
it('hides developer actions outside the permitted runtime', async () => {
  respond(false);
  mount();
  await choose();
  await screen.findByText('missing_water_meter');
  expect(screen.queryByRole('button', { name: /Chạy ngay:/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Giao nhiệm vụ khởi tạo' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Tạo hóa đơn nháp' })).toBeDisabled();
});
it('does not send any mutation merely by opening configuration or changing test period', async () => {
  respond(true);
  mount(<AutomationPage />);
  await choose();
  await openSchedule();
  await screen.findByLabelText(/Kỳ bắt đầu áp dụng cấu hình/);
  fireEvent.change(screen.getByLabelText('Kỳ kiểm thử'), { target: { value: '2026-12' } });
  await screen.findByRole('heading', { name: 'Chạy thử thủ công' });
  expect(
    mocks.request.mock.calls.filter(
      ([, init]) => init?.method === 'POST' || init?.method === 'PUT',
    ),
  ).toEqual([]);
});
it('creates individual initial and periodic tasks with room meter and period; refuses duplicates', async () => {
  respond(true);
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/billing-automation/manual-meter-tasks' && init?.method === 'POST')
      return { id: 'created-task' };
    return original(path, init);
  });
  mount();
  await choose();
  await chooseRoom();
  await chooseMeter();
  const initial = screen.getByRole('button', { name: 'Giao nhiệm vụ khởi tạo' });
  await waitFor(() => expect(initial).toBeEnabled());
  fireEvent.click(initial);
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/billing-automation/manual-meter-tasks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ meterId: 'meter-a', purpose: 0, billingPeriod: '2026-11-01' }),
      }),
    ),
  );
  const periodic = screen.getByRole('button', { name: 'Giao nhiệm vụ vận hành' });
  await waitFor(() => expect(periodic).toBeEnabled());
  fireEvent.click(periodic);
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/billing-automation/manual-meter-tasks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ meterId: 'meter-a', purpose: 1, billingPeriod: '2026-11-01' }),
      }),
    ),
  );
  expect(screen.queryByLabelText(/Ngày ghi chỉ số thử/)).not.toBeInTheDocument();
  expect(
    mocks.request.mock.calls.filter(
      ([path]) => path === '/api/v1/capture/meter-tasks' && path !== undefined,
    ),
  ).toEqual([]);
});
it('creates a draft for only selected room and billing period and delegates contract resolution to backend', async () => {
  respond();
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/invoices/drafts' && init?.method === 'POST') {
      return { id: 'created-draft', status: 'Draft' };
    }
    return original(path, init);
  });
  mount();
  await choose();
  await chooseRoom();
  expect(screen.queryByLabelText('Hợp đồng đại diện khi lập nháp')).not.toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'Tạo hóa đơn nháp' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/invoices/drafts', {
      method: 'POST',
      body: '{"roomId":"room","billingPeriod":"2026-11-01"}',
    }),
  );
  expect(
    mocks.request.mock.calls.some(
      ([path]) =>
        path.startsWith('/api/v1/rooms/room/occupancy-history') ||
        path.startsWith('/api/v1/billing-automation/representative?'),
    ),
  ).toBe(false);
});
it('explains the backend ambiguous representative conflict without selecting any contract in UI', async () => {
  respond();
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/invoices/drafts' && init?.method === 'POST') {
      throw { status: 409, problem: { code: 'representative_selection_required' } };
    }
    return original(path, init);
  });
  mount();
  await choose();
  await chooseRoom();
  const button = screen.getByRole('button', { name: 'Tạo hóa đơn nháp' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect((await screen.findAllByText(/Có nhiều hợp đồng trong kỳ/)).length).toBeGreaterThan(0);
  expect(screen.queryByLabelText(/Hợp đồng đại diện khi lập nháp/)).not.toBeInTheDocument();
  const writes = mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes.map(([path]) => path)).toEqual(['/api/v1/invoices/drafts']);
});
it('disables new Draft before configured draft date and shows the exact reason', async () => {
  respond();
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.includes('/preview?')) {
      const preview = await original(path, init);
      return {
        ...preview,
        businessDate: '2026-11-02',
        phases: [
          { phase: 'Meter', scheduledDate: '2026-11-01', eligible: false },
          { phase: 'Draft', scheduledDate: '2026-11-07', eligible: false },
        ],
      };
    }
    return original(path, init);
  });
  mount();
  await choose();
  await chooseRoom();
  expect(await screen.findByText(/Chưa đến ngày lập nháp 2026-11-07/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tạo hóa đơn nháp' })).toBeDisabled();
  expect(
    mocks.request.mock.calls.some(
      ([path, init]) => path === '/api/v1/invoices/drafts' && init?.method === 'POST',
    ),
  ).toBe(false);
});
it('explains backend draft_date_not_reached even when no Draft date is returned in preview', async () => {
  respond();
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/invoices/drafts' && init?.method === 'POST') {
      throw { status: 409, problem: { code: 'draft_date_not_reached' } };
    }
    return original(path, init);
  });
  mount();
  await choose();
  await chooseRoom();
  const button = screen.getByRole('button', { name: 'Tạo hóa đơn nháp' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(await screen.findByText(/Chưa đến ngày tạo hóa đơn nháp/)).toBeInTheDocument();
  expect(screen.getByText(/Chưa đến ngày tạo hóa đơn nháp/)).toHaveTextContent('Cấu hình lịch');
});
it('gates both manual meter actions until the configured assignment date is reached', async () => {
  respond(true);
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.includes('/preview?')) {
      const preview = await original(path, init);
      return {
        ...preview,
        businessDate: '2026-11-02',
        phases: [{ phase: 'Meter', scheduledDate: '2026-11-04', eligible: false }],
      };
    }
    return original(path, init);
  });
  mount();
  await choose();
  await chooseRoom();
  await chooseMeter();
  expect((await screen.findAllByText(/Chưa đến ngày giao việc/)).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Giao nhiệm vụ khởi tạo' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Giao nhiệm vụ vận hành' })).toBeDisabled();
  expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([]);
});
it('delegates reading dates to backend schedule for a historical test period', async () => {
  respond(true);
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.includes('/preview?')) {
      const preview = await original(path, init);
      return {
        ...preview,
        businessDate: '2026-11-14',
        phases: [{ phase: 'Meter', scheduledDate: '2026-10-03', eligible: false }],
      };
    }
    if (path === '/api/v1/billing-automation/manual-meter-tasks' && init?.method === 'POST')
      return { id: 'old-period-task' };
    return original(path, init);
  });
  mount();
  await choose();
  fireEvent.change(screen.getByLabelText('Kỳ kiểm thử'), { target: { value: '2026-10' } });
  await chooseRoom();
  await chooseMeter();
  const periodic = screen.getByRole('button', { name: 'Giao nhiệm vụ vận hành' });
  await waitFor(() => expect(periodic).toBeEnabled());
  fireEvent.click(periodic);
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/billing-automation/manual-meter-tasks', {
      method: 'POST',
      body: '{"meterId":"meter-a","purpose":1,"billingPeriod":"2026-10-01"}',
    }),
  );
});
it('does not create a second initial task when the same meter already has one', async () => {
  respond(true);
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith('/api/v1/capture/meter-tasks?'))
      return [{ id: 'existing', meterId: 'meter-a', purpose: 0 }];
    return original(path, init);
  });
  mount();
  await choose();
  await chooseRoom();
  await chooseMeter();
  await screen.findByText(/Đã có nhiệm vụ khởi tạo cho đồng hồ này/);
  expect(screen.getByRole('button', { name: 'Giao nhiệm vụ khởi tạo' })).toBeDisabled();
  expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([]);
});
it('checks older capture pages before allowing an initial task for the selected meter', async () => {
  respond(true);
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('roomId=room&page=1')) {
      return Array.from({ length: 100 }, (_, i) => ({
        id: `old-${i}`,
        meterId: 'different-meter',
        purpose: 0,
      }));
    }
    if (path.endsWith('roomId=room&page=2')) {
      return [{ id: 'older-match', meterId: 'meter-a', purpose: 0 }];
    }
    return original(path, init);
  });
  mount();
  await choose();
  await chooseRoom();
  await chooseMeter();
  expect(await screen.findByText(/Đã có nhiệm vụ khởi tạo cho đồng hồ này/)).toBeInTheDocument();
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/v1/capture/meter-tasks?roomId=room&page=2',
    expect.anything(),
  );
  expect(screen.getByRole('button', { name: 'Giao nhiệm vụ khởi tạo' })).toBeDisabled();
  expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([]);
});
it('prevents scheduling Final later than the inherited payment due date', async () => {
  respond();
  mount();
  await choose();
  await openSchedule();
  await screen.findByLabelText(/Kỳ bắt đầu áp dụng cấu hình/);
  fireEvent.change(screen.getByLabelText(/Ngày giao việc ghi chỉ số/), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText(/Ngày hết hạn ghi chỉ số/), { target: { value: '4' } });
  fireEvent.change(screen.getByLabelText(/Ngày phát hành chính thức/), { target: { value: '26' } });
  expect(screen.getByRole('button', { name: 'Lưu lịch (không kích hoạt tự động)' })).toBeDisabled();
  expect(
    screen.getByText(/thứ tự giao việc\/hạn ghi số\/nháp\/phát hành\/hạn thanh toán/),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Ngày phát hành chính thức/), { target: { value: '25' } });
  expect(screen.getByRole('button', { name: 'Lưu lịch (không kích hoạt tự động)' })).toBeEnabled();
  expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'PUT')).toEqual([]);
});
it('only finalizes the exact selected draft after explicit review and a fresh server read', async () => {
  respond(true);
  const original = mocks.request.getMockImplementation()!;
  const draft = {
    id: 'invoice-1',
    roomId: 'room',
    billingPeriod: '2026-11-01',
    roomNumber: 'A101',
    status: 'Draft',
    version: 5,
    total: '150000',
    missingInputs: [],
    dueDate: '2026-11-25',
  };
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith('/api/v1/invoices?') && path.includes('roomId=room')) {
      return { items: [draft], totalCount: 1, pageSize: 20 };
    }
    if (path === '/api/v1/invoices/invoice-1' && !init?.method) return draft;
    if (path === '/api/v1/invoices/invoice-1/finalize')
      return { ...draft, status: 'Final', version: 6 };
    return original(path, init);
  });
  mount();
  await choose();
  await chooseRoom();
  const finalize = screen.getByRole('button', { name: 'Kiểm tra và phát hành' });
  await waitFor(() => expect(finalize).toBeEnabled());
  expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([]);
  fireEvent.click(finalize);
  expect(screen.getByText(/Hóa đơn: invoice-1/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Xác nhận phát hành' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /Tôi đã kiểm tra đúng phòng/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận phát hành' }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/invoices/invoice-1/finalize', {
      method: 'POST',
      body: '{"expectedVersion":5}',
    }),
  );
  expect(mocks.request).toHaveBeenCalledWith('/api/v1/invoices/invoice-1', expect.anything());
});
it('demo offers four local sample actions without contacting backend', async () => {
  mount(<DemoAutomationPage />);
  expect(screen.getByRole('heading', { name: 'Cấu hình lịch' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Chạy thử thủ công' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Giao nhiệm vụ khởi tạo' }));
  expect(screen.getByText(/Demo: đã giao nhiệm vụ khởi tạo/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tạo hóa đơn nháp' }));
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra và phát hành' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Tôi đã kiểm tra phòng và kỳ/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận phát hành' }));
  expect(screen.getByText(/Demo: đã mô phỏng phát hành/)).toBeInTheDocument();
  expect(mocks.request).not.toHaveBeenCalled();
});
it('keeps the draft list usable when the automation monitor fails', async () => {
  respond(false);
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: unknown) => {
    if (path.includes('/preview?')) throw new Error('Automation monitor unavailable');
    if (path.startsWith('/api/v1/invoices?')) {
      return {
        items: [
          { id: 'draft', roomNumber: 'P201', version: 2, total: '120000', missingInputs: [] },
        ],
        totalCount: 1,
        pageSize: 20,
      };
    }
    return original(path, init);
  });
  mount();
  await choose();
  expect(await screen.findByText('Phòng P201')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tính lại bản nháp' })).toBeEnabled();
  expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
});
it('keeps advanced monitoring collapsed until Owner opens it', async () => {
  respond(false);
  mount();
  await choose();
  await screen.findByText('missing_water_meter');
  expect(screen.queryByText('Gửi thông báo bên ngoài')).not.toBeInTheDocument();
  expect(screen.queryByText('Lịch sử xử lý (tối đa 100 lần gần nhất)')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Lịch chạy & giám sát/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /Lịch chạy & giám sát/ }));
  expect(await screen.findByText('Gửi thông báo bên ngoài')).toBeInTheDocument();
  expect(screen.getByText('Lịch sử xử lý (tối đa 100 lần gần nhất)')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Lịch chạy & giám sát/ })).toHaveLength(1);
});
it('shows API failure and permits refresh', async () => {
  mocks.request.mockRejectedValue(new Error('offline'));
  mount();
  expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeEnabled();
});

it('recalculates the existing draft with its version and shows the returned inputs', async () => {
  respond(false);
  const read = mocks.request.getMockImplementation()!;
  const draft = {
    id: 'draft',
    version: 4,
    roomNumber: 'A101',
    total: '1000',
    missingInputs: ['confirmed_reading_Electricity'],
  };
  mocks.request.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/invoices?'))
      return { items: [draft], totalCount: 1, pageSize: 20 };
    if (path === '/api/v1/invoices/draft/refresh')
      return { ...draft, version: 5, total: '4000', missingInputs: ['confirmed_reading_Water'] };
    return read(path);
  });
  mount();
  await choose();
  expect(await screen.findByText(/Thiếu:.*điện/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.filter(([path]) => path.startsWith('/api/v1/invoices?')),
    ).toHaveLength(2),
  );
  expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Tính lại bản nháp' }));
  expect(await screen.findByText(/Thiếu:.*nước/i)).toBeInTheDocument();
  expect(screen.queryByText(/Thiếu:.*điện/i)).not.toBeInTheDocument();
  expect(screen.getByText(/4\.000 ₫/)).toBeInTheDocument();
  expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([
    ['/api/v1/invoices/draft/refresh', { method: 'POST', body: '{"expectedVersion":4}' }],
  ]);
  expect(mocks.request).toHaveBeenCalledWith(
    '/api/v1/invoices?page=1&pageSize=20&locationId=loc&billingPeriod=2026-11-01&status=Draft',
    expect.anything(),
  );
});
