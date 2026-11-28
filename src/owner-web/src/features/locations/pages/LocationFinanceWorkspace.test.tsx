import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocationFinanceWorkspace } from './LocationFinanceWorkspace';

const state = vi.hoisted(() => ({
  roles: ['Owner'],
  report: vi.fn(),
  expenses: vi.fn(),
  createExpense: vi.fn(),
  request: vi.fn(),
}));
vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner-id', roles: state.roles } }),
}));
vi.mock('../../expenses/useFinanceApi', () => ({
  useFinanceApi: () => ({
    report: state.report,
    expenses: state.expenses,
    createExpense: state.createExpense,
  }),
}));
vi.mock('../../property/usePropertySetupApi', () => ({
  usePropertySetupApi: () => ({ request: state.request }),
}));

beforeEach(() => {
  state.roles = ['Owner'];
  state.report.mockReset();
  state.expenses.mockReset();
  state.createExpense.mockReset();
  state.request.mockReset();
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method) return {};
    if (path.includes('/recurring-expenses')) return [];
    if (path.includes('/location-investments?'))
      return { items: [], total: 0, page: 1, pageSize: 25 };
    return {
      knownTotal: '3000000',
      roomsTotal: '0',
      commonTotal: '3000000',
      unpricedCount: 1,
      unreviewedRoomCount: 2,
      unreviewedCommonCount: 1,
      groups: [
        {
          id: 'common-hallway',
          name: 'Hành lang',
          scope: 'common',
          verified: true,
          knownTotal: '3000000',
          assets: [
            {
              id: 'camera',
              name: 'Camera',
              quantity: 2,
              unitCost: '1500000',
              totalCost: '3000000',
            },
          ],
        },
      ],
    };
  });
  state.report.mockResolvedValue({
    total: {
      initialInvestment: '150000000',
      operatingExpenses: '5000000',
      verifiedCollections: '11000000',
      outstandingNow: '1000000',
      management: {
        actualBusinessCollections: '10000000',
        currentOutstanding: '1000000',
        depreciation: null,
        cashCapital: {
          unavailableReason: 'full_month_baseline_required',
          remainingCapital: null,
          recoveryPercent: null,
          estimatedRemainingMonths: null,
        },
      },
    },
    capital: {
      unavailableReason: 'full_month_baseline_required',
      remainingCapital: null,
      recoveryPercent: null,
      estimatedRemainingMonths: null,
    },
  });
  state.expenses.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
  state.createExpense.mockResolvedValue({ id: 'created' });
});
afterEach(cleanup);

function mount(search = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/locations/location-123/investment' + search]}>
        <Routes>
          <Route path="/locations/:locationId/investment" element={<LocationFinanceWorkspace />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('opens recurring cost setup for the linked location without creating expenses', async () => {
  mount('?tab=recurring');
  expect(screen.getByRole('tab', { name: 'Chi phí định kỳ' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/recurring-expenses?locationId=location-123',
      expect.objectContaining({ signal: expect.anything() }),
    ),
  );
  expect(state.createExpense).not.toHaveBeenCalled();
  expect(state.request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});

it('falls back to the overview for an unknown finance tab', () => {
  mount('?tab=unknown');
  expect(screen.getByRole('tab', { name: 'Tổng quan' })).toHaveAttribute('aria-selected', 'true');
});

it('shows real API finance totals and warns when recovery is unavailable', async () => {
  mount();
  expect(await screen.findByText('150.000.000 ₫')).toBeInTheDocument();
  expect(
    screen.getByText(
      'Chưa đủ dữ liệu tin cậy để xác định thời gian hoàn vốn. Kiểm tra vốn ban đầu, công nợ, hoàn tiền và các kỳ báo cáo đã kết thúc.',
    ),
  ).toBeInTheDocument();
  expect(state.report).toHaveBeenCalledWith(
    expect.objectContaining({ locationId: 'location-123' }),
    expect.anything(),
  );
  const calls = state.report.mock.calls.map(([filter]) => filter);
  expect(
    calls.some(
      (filter) =>
        filter.from.endsWith('-01') &&
        filter.from.slice(0, 7) !== filter.to.slice(0, 7) &&
        /-(28|29|30|31)$/.test(filter.to),
    ),
  ).toBe(true);
});

it('keeps asset capital read-only and separates manual investment from operating costs', async () => {
  mount();
  fireEvent.click(screen.getByRole('tab', { name: 'Vốn tài sản' }));
  expect(screen.getByText('Tự động từ kiểm kê')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Thêm vốn tài sản' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Đầu tư khác' }));
  await screen.findByText('Chưa có khoản đầu tư khác được ghi nhận cho cơ sở.');
  expect(state.request).toHaveBeenCalledWith(
    '/api/v1/location-investments?locationId=location-123&page=1',
    expect.objectContaining({ signal: expect.anything() }),
  );
  expect(state.expenses).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: 'Chi phí phát sinh' }));
  await waitFor(() =>
    expect(state.expenses).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId: 'location-123',
        expenseType: 'OPERATING',
      }),
      expect.anything(),
    ),
  );
});

it('persists a single lump-sum initial cost using existing idempotent Owner expense API', async () => {
  mount();
  fireEvent.click(screen.getByRole('tab', { name: 'Đầu tư khác' }));
  fireEvent.click(screen.getByRole('button', { name: 'Thêm đầu tư khác' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Tên hạng mục' }), {
    target: { value: 'Cải tạo ban đầu' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Số tiền (VNĐ)' }), {
    target: { value: '150000000' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Nội dung / chứng từ' }), {
    target: { value: 'Cải tạo toàn cơ sở, không gồm tài sản đã kiểm kê' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận' }));
  await waitFor(() => expect(state.createExpense).toHaveBeenCalledTimes(1));
  expect(state.createExpense).toHaveBeenCalledWith(
    expect.objectContaining({
      locationId: 'location-123',
      roomId: null,
      expenseType: 'INITIAL_INVESTMENT',
      category: 'Cải tạo ban đầu',
      amount: '150000000',
    }),
    expect.any(String),
  );
});

it('protects location finance when the session is not Owner', () => {
  state.roles = ['Staff'];
  mount();
  expect(
    screen.getByText('Chỉ Owner được truy cập thông tin vốn và chi phí của cơ sở.'),
  ).toBeInTheDocument();
  expect(state.report).not.toHaveBeenCalled();
});

it('shows common area asset capital and missing-price review alerts from real API', async () => {
  mount();
  fireEvent.click(screen.getByRole('tab', { name: 'Vốn tài sản' }));
  expect((await screen.findAllByText('3.000.000 ₫')).length).toBeGreaterThan(0);
  expect(screen.getByText(/1 tài sản thiếu đơn giá đầu tư/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Tài sản chung cơ sở' }));
  fireEvent.click(await screen.findByText('Hành lang'));
  expect(await screen.findByText('Camera')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
});

it('submits all detailed investments atomically as one backend batch', async () => {
  mount();
  fireEvent.click(screen.getByRole('tab', { name: 'Đầu tư khác' }));
  fireEvent.click(screen.getByRole('button', { name: 'Thêm đầu tư khác' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Nhập chi tiết' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Hạng mục' }), {
    target: { value: 'Cải tạo nhà' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Số tiền' }), {
    target: { value: '12000000' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Nội dung / chứng từ' }), {
    target: { value: 'Đầu tư khác không gồm tài sản' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/location-investments',
      expect.objectContaining({ method: 'POST' }),
    ),
  );
  const call = state.request.mock.calls.find(
    ([path, init]) => path === '/api/v1/location-investments' && init?.method === 'POST',
  );
  expect(JSON.parse(call![1].body)).toMatchObject({
    locationId: 'location-123',
    items: [{ category: 'Cải tạo nhà', amount: '12000000' }],
  });
  expect(state.createExpense).not.toHaveBeenCalled();
});

it('loads recurring rules and creates an effective-dated rule via backend', async () => {
  mount();
  fireEvent.click(screen.getByRole('tab', { name: 'Chi phí định kỳ' }));
  expect(await screen.findByText('Chưa có quy tắc chi phí định kỳ cho cơ sở.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm định kỳ' }));
  expect(
    screen.queryByRole('combobox', { name: 'Ngày phát sinh trong kỳ' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Ngày kết thúc/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Áp dụng thay đổi từ ngày/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Tên khoản chi' }), {
    target: { value: 'Thuê mặt bằng' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Số tiền mỗi kỳ (VNĐ)' }), {
    target: { value: '15000000' },
  });
  fireEvent.change(screen.getByLabelText(/Ngày bắt đầu/), { target: { value: '2026-11-29' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu quy tắc' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/recurring-expenses',
      expect.objectContaining({ method: 'POST' }),
    ),
  );
  const call = state.request.mock.calls.find(
    ([path, init]) => path === '/api/v1/recurring-expenses' && init?.method === 'POST',
  );
  expect(JSON.parse(call![1].body)).toMatchObject({
    locationId: 'location-123',
    name: 'Thuê mặt bằng',
    amount: '15000000',
    frequency: 'MONTHLY',
    dayOfMonth: 29,
    startsOn: '2026-11-29',
  });
});

it('rejects incomplete detailed investments before a backend mutation', async () => {
  mount();
  fireEvent.click(screen.getByRole('tab', { name: 'Đầu tư khác' }));
  fireEvent.click(screen.getByRole('button', { name: 'Thêm đầu tư khác' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Nhập chi tiết' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Hạng mục' }), {
    target: { value: 'Chi phí pháp lý' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Số tiền' }), {
    target: { value: '2500000' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận' }));
  expect(screen.getByText('Mỗi hạng mục cần có tên và số tiền hợp lệ.')).toBeInTheDocument();
  expect(
    state.request.mock.calls.some(
      ([path, init]) => path === '/api/v1/location-investments' && init?.method === 'POST',
    ),
  ).toBe(false);
});

it('updates recurring rules using the loaded version and a future effective date', async () => {
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method) return {};
    if (path.includes('/recurring-expenses'))
      return [
        {
          id: 'rule-1',
          locationId: 'location-123',
          name: 'Điện khu vực chung',
          amount: '2000000',
          frequency: 'MONTHLY',
          dayOfMonth: 15,
          startsOn: '2026-01-01',
          endsOn: null,
          active: true,
          version: 3,
          effectiveFrom: '2026-06-01',
        },
      ];
    return { items: [], total: 0, page: 1, pageSize: 25 };
  });
  mount();
  fireEvent.click(screen.getByRole('tab', { name: 'Chi phí định kỳ' }));
  await screen.findByText('Điện khu vực chung');
  expect(screen.getByText('Quy tắc cũ: ngày 15 mỗi kỳ')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Điều chỉnh' }));
  expect(screen.queryByLabelText(/Ngày phát sinh trong kỳ/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Áp dụng thay đổi từ ngày/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Số tiền mỗi kỳ (VNĐ)' }), {
    target: { value: '2400000' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu quy tắc' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      '/api/v1/recurring-expenses/rule-1',
      expect.objectContaining({ method: 'PUT' }),
    ),
  );
  const request = state.request.mock.calls.find(
    ([path, init]) => path === '/api/v1/recurring-expenses/rule-1' && init?.method === 'PUT',
  );
  expect(request).toBeDefined();
  expect(JSON.parse(request![1].body)).toMatchObject({
    locationId: 'location-123',
    name: 'Điện khu vực chung',
    amount: '2400000',
    expectedVersion: 3,
    startsOn: '2026-01-01',
    dayOfMonth: 15,
  });
  expect(JSON.parse(request![1].body).effectiveFrom >= '2026-11-17').toBe(true);
});
