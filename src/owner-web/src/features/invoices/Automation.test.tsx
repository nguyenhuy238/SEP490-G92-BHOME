import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { theme } from '../../theme/theme';
import AutomationPage, { DemoAutomationPage, LiveAutomationPage } from './pages/AutomationPage';
import { invoiceClient } from '../../../../../packages/client-core/src/invoices';
const mocks = vi.hoisted(() => ({ request: vi.fn(), schedule: vi.fn() }));
vi.mock('./hooks/useInvoiceApi', () => ({
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
  expect(screen.getByText('Chọn cơ sở để xem lịch.')).toBeInTheDocument();
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
it('keeps manual test actions separate and links schedule edits to Location Settings', async () => {
  respond();
  mount();
  await choose();
  expect(await screen.findByText('missing_water_meter')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Cấu hình lịch' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Thiết lập lịch tại cơ sở' })).toHaveAttribute(
    'href',
    '/locations/loc/settings',
  );
  expect(screen.getByRole('heading', { name: 'Chạy thử thủ công' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Giao nhiệm vụ khởi tạo' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Giao nhiệm vụ vận hành' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tạo hóa đơn nháp' })).toBeInTheDocument();
  expect(screen.queryByLabelText(/Kỳ bắt đầu áp dụng cấu hình/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Mốc tham chiếu kỳ/)).not.toBeInTheDocument();
  expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'PUT')).toEqual([]);
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
  await screen.findByRole('link', { name: 'Thiết lập lịch tại cơ sở' });
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
it('explains a skipped room without an eligible reference contract', async () => {
  respond();
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/invoices/drafts' && init?.method === 'POST') {
      throw { status: 409, problem: { code: 'no_reference_contract_for_period' } };
    }
    return original(path, init);
  });
  mount();
  await choose();
  await chooseRoom();
  const button = screen.getByRole('button', { name: 'Tạo hóa đơn nháp' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(
    (await screen.findAllByText(/Phòng không có hợp đồng đối chiếu đủ điều kiện/)).length,
  ).toBeGreaterThan(0);
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
it('blocks a scheduled reading before the meter installation date and explains the exact dates', async () => {
  respond();
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/capture/locations/loc/meters')
      return [
        {
          id: 'meter-a',
          label: 'A101 · D01',
          parentId: 'room',
          installedOn: '2026-11-20',
          isActive: true,
        },
      ];
    if (path.includes('/preview?'))
      return { ...(await original(path, init)), businessDate: '2026-11-24' };
    return original(path, init);
  });
  mount();
  await choose();
  await chooseRoom();
  await chooseMeter();
  await waitFor(() =>
    expect(
      screen.getAllByText(
        /Ngày ghi số theo lịch \(2026-11-01\) trước ngày lắp đồng hồ \(2026-11-20\)/,
      ),
    ).toHaveLength(2),
  );
  expect(screen.getByRole('button', { name: 'Giao nhiệm vụ khởi tạo' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Giao nhiệm vụ vận hành' })).toBeDisabled();
  expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([]);
});

it('explains the already confirmed move-out readings even with the older meter list response', async () => {
  respond();
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/capture/locations/loc/rooms')
      return [{ id: 'room', label: 'A101', status: 'Available' }];
    if (path.startsWith('/api/v1/capture/meter-tasks?'))
      return [
        {
          id: 'initial',
          meterId: 'meter-a',
          purpose: 0,
          status: 2,
          readingDate: '2026-11-20',
          confirmedReadingId: 'initial-reading',
        },
        {
          id: 'final',
          meterId: 'meter-a',
          purpose: 2,
          status: 2,
          readingDate: '2026-11-22',
          confirmedReadingId: 'final-reading',
        },
      ];
    if (path.includes('/preview?'))
      return { ...(await original(path, init)), businessDate: '2026-11-24' };
    return original(path, init);
  });
  mount();
  await choose();
  await chooseRoom();
  await chooseMeter();
  expect(
    await screen.findByText(/trước chỉ số ban đầu đã xác nhận \(2026-11-20\)/),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Giao nhiệm vụ vận hành' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Xem trả phòng' })).toHaveAttribute('href', '/handovers');
  expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([]);
});

it('displays the real capture validation error instead of a pricing error', async () => {
  respond();
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/billing-automation/manual-meter-tasks' && init?.method === 'POST')
      throw { status: 400, problem: { code: 'reading_before_installation' } };
    return original(path, init);
  });
  mount();
  await choose();
  await chooseRoom();
  await chooseMeter();
  const button = screen.getByRole('button', { name: 'Giao nhiệm vụ vận hành' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(
    await screen.findByText(/Ngày ghi chỉ số theo lịch trước ngày lắp đồng hồ/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Kiểm tra phạm vi, đơn giá và ngày hiệu lực/)).not.toBeInTheDocument();
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
it('recalculates the selected periodic draft with its version instead of creating a duplicate or publishing', async () => {
  respond();
  const original = mocks.request.getMockImplementation()!;
  let draft = {
    id: 'periodic-draft',
    type: 'PERIODIC',
    roomId: 'room',
    billingPeriod: '2026-11-01',
    roomNumber: 'A101',
    status: 'Draft',
    version: 1,
    total: '3000000',
    missingInputs: ['confirmed_reading_Electricity'],
    dueDate: '2026-11-25',
  };
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith('/api/v1/invoices?') && path.includes('roomId=room'))
      return {
        items: [{ ...draft, id: 'unrelated-final', type: 'FINAL', status: 'Final' }, draft],
        totalCount: 2,
        pageSize: 20,
      };
    if (path === '/api/v1/invoices/periodic-draft/refresh') {
      draft = { ...draft, version: 2, total: '3100000', missingInputs: [] };
      return draft;
    }
    return original(path, init);
  });
  mount();
  await choose();
  await chooseRoom();
  const button = await screen.findByRole('button', { name: 'Tính lại hóa đơn nháp' });
  expect(screen.getByRole('button', { name: 'Kiểm tra và phát hành' })).toBeDisabled();
  fireEvent.click(button);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Kiểm tra và phát hành' })).toBeEnabled(),
  );
  expect(screen.getByText(/Đã tính lại bản nháp\. Kiểm tra số tiền/)).toBeInTheDocument();
  expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([
    ['/api/v1/invoices/periodic-draft/refresh', { method: 'POST', body: '{"expectedVersion":1}' }],
  ]);
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
