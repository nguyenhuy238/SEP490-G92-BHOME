import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { ExpensesApiPage } from './ExpensesApiPage';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ExpenseReferences } from '../../../../../packages/client-core/src/finance';

const mock = vi.hoisted(() => ({
  locations: vi.fn(),
  expenses: vi.fn(),
  report: vi.fn(),
  expense: vi.fn(),
  createExpense: vi.fn(),
  updateExpense: vi.fn(),
  expenseEvidence: vi.fn(),
  expenseReferences: vi.fn(),
  expensePayments: vi.fn(),
  recordExpensePayment: vi.fn(),
}));
vi.mock('./useFinanceApi', () => ({ useFinanceApi: () => mock }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
const expense = {
  id: 'expense',
  locationId: 'location',
  roomId: null,
  expenseType: 'OPERATING',
  category: 'Bảo trì',
  amount: '500000',
  occurredOn: '2026-11-01',
  note: 'Chứng từ tổng hợp',
  version: 1,
  canEdit: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  mock.locations.mockResolvedValue([{ id: 'location', label: 'Cơ sở tổng hợp' }]);
  mock.expenses.mockResolvedValue({ items: [expense], total: 1, page: 1, pageSize: 25 });
  mock.report.mockResolvedValue({
    total: { initialInvestment: '15000000', operatingExpenses: '1200000' },
  });
  mock.expense.mockResolvedValue(expense);
  mock.expenseEvidence.mockResolvedValue([]);
  mock.expensePayments.mockResolvedValue({
    expenseId: expense.id,
    version: 1,
    amount: expense.amount,
    paidAmount: '0',
    remainingAmount: expense.amount,
    status: 'Unpaid',
    events: [],
  });
  mock.expenseReferences.mockResolvedValue({
    rooms: [],
    assets: [],
    workOrders: [],
    truncated: false,
  });
});
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ExpensesApiPage />
    </QueryClientProvider>,
  );
}
it('keeps the Location Workspace scope when loading and creating expenses', async () => {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/locations/location/investment']}>
        <Routes>
          <Route path="/locations/:locationId/investment" element={<ExpensesApiPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findAllByText('Bảo trì');
  expect(screen.getAllByText('500.000 ₫').length).toBeGreaterThan(0);
  expect(mock.report).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Xem tổng hợp vốn và chi phí' }));
  expect(await screen.findByText('15.000.000 ₫')).toBeInTheDocument();
  expect(screen.getByText('1.200.000 ₫')).toBeInTheDocument();
  expect(screen.getByText(/^Toàn cơ sở · đến \d{2}\/\d{2}\/\d{4}$/)).toBeInTheDocument();
  expect(screen.queryByText(/Không phụ thuộc bộ lọc/)).not.toBeInTheDocument();
  expect(mock.report).toHaveBeenCalledWith(
    expect.objectContaining({ locationId: 'location' }),
    expect.any(AbortSignal),
  );
  expect(mock.expenses).toHaveBeenCalledWith(
    expect.objectContaining({ locationId: 'location' }),
    expect.any(AbortSignal),
  );
  expect(screen.queryByRole('combobox', { name: 'Cơ sở' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '2026-11-01' } });
  await waitFor(() =>
    expect(mock.expenses).toHaveBeenLastCalledWith(
      expect.objectContaining({ locationId: 'location', from: '2026-11-01' }),
      expect.any(AbortSignal),
    ),
  );
  expect(mock.report).toHaveBeenCalledTimes(1);
  mock.createExpense.mockResolvedValue(expense);
  fireEvent.click(screen.getByRole('button', { name: 'Ghi khoản chi' }));
  expect(screen.getByRole('combobox', { name: /Cơ sở ghi nhận/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  fireEvent.change(screen.getByLabelText(/Danh mục khoản chi/), { target: { value: 'Vệ sinh' } });
  fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '200000' } });
  fireEvent.change(screen.getByLabelText(/Ngày phát sinh/), { target: { value: '2026-11-02' } });
  fireEvent.change(screen.getByLabelText(/Nội dung/), {
    target: { value: 'Chi phí tại cơ sở hiện tại' },
  });
  fireEvent.submit(document.getElementById('expense-editor')!);
  await screen.findByText('Đã lưu khoản chi.');
  expect(mock.createExpense).toHaveBeenCalledWith(
    expect.objectContaining({ locationId: 'location', amount: '200000', category: 'Vệ sinh' }),
    expect.any(String),
  );
});
it('filters Initial Investment on the server and uses that type for new records', async () => {
  mount();
  await screen.findAllByText('Bảo trì');
  fireEvent.click(screen.getByRole('tab', { name: 'Đầu tư ban đầu' }));
  await waitFor(() =>
    expect(mock.expenses).toHaveBeenLastCalledWith(
      expect.objectContaining({ expenseType: 'INITIAL_INVESTMENT', page: 1 }),
      expect.any(AbortSignal),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ghi khoản chi' }));
  expect(screen.getByRole('combobox', { name: 'Phân loại' })).toHaveTextContent('Đầu tư ban đầu');
});
it('does not request an invalid date range and can clear the filters', async () => {
  mount();
  await screen.findAllByText('Bảo trì');
  expect(screen.getByRole('button', { name: 'Bộ lọc chi tiết' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc chi tiết' }));
  fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '2026-12-01' } });
  fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '2026-11-01' } });
  expect(screen.getByText('Chọn lại khoảng ngày để xem khoản chi.')).toBeInTheDocument();
  expect(
    mock.expenses.mock.calls.some(
      ([filter]) => filter.from && filter.to && filter.from > filter.to,
    ),
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
  await screen.findAllByText('Bảo trì');
  expect(screen.getByLabelText('Từ ngày')).toHaveValue('');
  expect(screen.getByLabelText('Đến ngày')).toHaveValue('');
});
it('keeps source-managed expenses read-only even when the editor form is submitted', async () => {
  const sourceManaged = { ...expense, canEdit: false };
  mock.expenses.mockResolvedValue({ items: [sourceManaged], total: 1, page: 1, pageSize: 25 });
  mock.expense.mockResolvedValue(sourceManaged);
  mount();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Xem chi tiết' }))[0]);
  await screen.findByText(/Khoản chi này do nghiệp vụ nguồn quản lý/);
  expect(screen.getByLabelText(/Số tiền/)).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Lưu khoản chi' })).toBeDisabled();
  fireEvent.submit(document.getElementById('expense-editor')!);
  expect(mock.updateExpense).not.toHaveBeenCalled();
});
it('loads real API rows, submits one mutation while busy and reloads the list', async () => {
  let finish!: (v: typeof expense) => void;
  mock.createExpense.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  await screen.findAllByText('Bảo trì');
  fireEvent.click(screen.getByRole('button', { name: 'Ghi khoản chi' }));
  fireEvent.change(screen.getByLabelText(/Danh mục khoản chi/), { target: { value: 'Vệ sinh' } });
  fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '200000' } });
  fireEvent.change(screen.getByLabelText(/Ngày phát sinh/), { target: { value: '2026-11-02' } });
  fireEvent.change(screen.getByLabelText(/Nội dung/), {
    target: { value: 'Chứng từ tổng hợp mới' },
  });
  fireEvent.submit(document.getElementById('expense-editor')!);
  fireEvent.submit(document.getElementById('expense-editor')!);
  await waitFor(() => expect(mock.createExpense).toHaveBeenCalledTimes(1));
  expect(mock.createExpense).toHaveBeenCalledWith(
    expect.objectContaining({ locationId: 'location', amount: '200000', category: 'Vệ sinh' }),
    expect.any(String),
  );
  await act(async () => {
    finish(expense);
  });
  await screen.findByText('Đã lưu khoản chi.');
  expect(mock.expenses.mock.calls.length).toBeGreaterThan(1);
});
it('loads detail and submits the server revision and correction reason', async () => {
  mock.updateExpense.mockResolvedValue({ ...expense, version: 2 });
  mount();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Chi tiết / chỉnh sửa' }))[0]);
  await screen.findByDisplayValue('500.000');
  fireEvent.change(screen.getByLabelText(/Lý do chỉnh sửa/), {
    target: { value: 'Đối chiếu lại' },
  });
  fireEvent.submit(document.getElementById('expense-editor')!);
  await screen.findByText('Đã lưu khoản chi.');
  expect(mock.expense).toHaveBeenCalledWith('expense');
  expect(mock.updateExpense).toHaveBeenCalledWith('expense', expense, 1, 'Đối chiếu lại');
});

it('keeps the expense dialog open and blocks editing while a payment is being recorded', async () => {
  let finish!: () => void;
  mock.recordExpensePayment.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Chi tiết / chỉnh sửa' }))[0]);
  fireEvent.change(await screen.findByLabelText('Số tiền đã chuyển (đ)'), {
    target: { value: '100000' },
  });
  fireEvent.change(screen.getByLabelText('Ghi chú xác nhận / chứng từ'), {
    target: { value: 'Verified synthetic transfer' },
  });
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'Tôi xác nhận thông tin thanh toán đúng thực tế.',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận thực chi' }));
  await waitFor(() => expect(mock.recordExpensePayment).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Đóng' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Đang lưu…' })).toBeDisabled();
  expect(screen.getByLabelText('Danh mục khoản chi')).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.submit(document.getElementById('expense-editor')!);
  expect(mock.updateExpense).not.toHaveBeenCalled();
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText('Đã cập nhật thông tin tài chính.')).toBeInTheDocument();
});

it('selects real Room/Asset/Work Order references and submits the exact source IDs', async () => {
  let resolveInitialReferences!: (references: ExpenseReferences) => void;
  const initialReferences = new Promise<ExpenseReferences>((resolve) => {
    resolveInitialReferences = resolve;
  });
  mock.expenseReferences.mockImplementation((_location, roomId) =>
    roomId
      ? Promise.resolve({
          rooms: [{ id: 'room', label: 'R-01', roomId: 'room', assetId: null }],
          assets: [{ id: 'asset', label: 'Bàn tổng hợp', roomId: 'room', assetId: 'asset' }],
          workOrders: [
            { id: 'work-order', label: 'Sửa bàn tổng hợp', roomId: 'room', assetId: 'asset' },
          ],
          truncated: false,
        })
      : initialReferences,
  );
  mock.createExpense.mockResolvedValue(expense);
  mount();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ghi khoản chi' })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ghi khoản chi' }));
  fireEvent.click(screen.getByRole('button', { name: /Liên kết bổ sung/ }));
  await waitFor(() =>
    expect(mock.expenseReferences).toHaveBeenCalledWith('location', null, expect.any(AbortSignal)),
  );
  expect(screen.getByRole('combobox', { name: 'Phòng ghi nhận' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await act(async () => {
    resolveInitialReferences({
      rooms: [{ id: 'room', label: 'R-01', roomId: 'room', assetId: null }],
      assets: [],
      workOrders: [],
      truncated: false,
    });
  });
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Phòng ghi nhận' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    ),
  );
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Phòng ghi nhận' }));
  fireEvent.click(await screen.findByRole('option', { name: 'R-01' }));
  await waitFor(() =>
    expect(mock.expenseReferences).toHaveBeenCalledWith(
      'location',
      'room',
      expect.any(AbortSignal),
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Tài sản liên quan' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Work Order liên quan' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    ),
  );
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Tài sản liên quan' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Bàn tổng hợp' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Work Order liên quan' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Sửa bàn tổng hợp' }));
  expect(screen.getByRole('combobox', { name: 'Tài sản liên quan' })).toHaveTextContent(
    'Bàn tổng hợp',
  );
  fireEvent.change(screen.getByLabelText(/Danh mục khoản chi/), { target: { value: 'Bảo trì' } });
  fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '200000' } });
  fireEvent.change(screen.getByLabelText(/Ngày phát sinh/), { target: { value: '2026-11-06' } });
  fireEvent.change(screen.getByLabelText(/Nội dung/), {
    target: { value: 'Chi thực tế theo chứng từ' },
  });
  fireEvent.submit(document.getElementById('expense-editor')!);
  await waitFor(() =>
    expect(mock.createExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId: 'location',
        roomId: 'room',
        assetId: 'asset',
        taskId: 'work-order',
      }),
      expect.any(String),
    ),
  );
});
it('shows API failure without demo rows or false success and preserves the retry key', async () => {
  mock.expenses.mockRejectedValue({ status: 503 });
  mount();
  await screen.findByText('Không thể tải hoặc lưu dữ liệu tài chính. Vui lòng thử lại.');
  expect(screen.queryByText('Bảo trì')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ghi khoản chi' }));
  mock.createExpense.mockRejectedValue({ status: 503 });
  fireEvent.change(screen.getByLabelText(/Số tiền/), { target: { value: '200000' } });
  fireEvent.change(screen.getByLabelText(/Ngày phát sinh/), { target: { value: '2026-11-02' } });
  fireEvent.change(screen.getByLabelText(/Danh mục khoản chi/), {
    target: { value: 'Chi tổng hợp' },
  });
  fireEvent.change(screen.getByLabelText(/Nội dung \/ tham chiếu chứng từ/), {
    target: { value: 'Chứng từ tổng hợp' },
  });
  fireEvent.submit(document.getElementById('expense-editor')!);
  await waitFor(() => expect(mock.createExpense).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Lưu khoản chi' })).not.toBeDisabled(),
  );
  fireEvent.submit(document.getElementById('expense-editor')!);
  await waitFor(() => expect(mock.createExpense).toHaveBeenCalledTimes(2));
  expect(mock.createExpense.mock.calls[0][1]).toBe(mock.createExpense.mock.calls[1][1]);
  expect(screen.queryByText('Đã lưu khoản chi.')).not.toBeInTheDocument();
});
it('offers a clear all-expenses recovery when a filter returns no results', async () => {
  mock.expenses.mockImplementation(async (filters) =>
    filters.category
      ? { items: [], total: 0, page: 1, pageSize: 25 }
      : { items: [expense], total: 1, page: 1, pageSize: 25 },
  );
  mount();
  await screen.findAllByText('Bảo trì');
  fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc chi tiết' }));
  fireEvent.change(screen.getByLabelText('Danh mục'), { target: { value: 'không có' } });
  await screen.findByText(/Không tìm thấy khoản chi theo bộ lọc hiện tại/);
  fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả khoản chi' }));
  await screen.findAllByText('Bảo trì');
  expect(screen.getByLabelText('Danh mục')).toHaveValue('');
  expect(mock.expenses).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 1 }),
    expect.any(AbortSignal),
  );
});
it('distinguishes an immutable source-managed expense from its optional Work Order and asset links', async () => {
  mock.expenses.mockResolvedValue({
    items: [
      {
        ...expense,
        canEdit: false,
        assetName: 'Máy bơm',
        taskTitle: 'Sửa máy bơm',
        taskId: 'work-order',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  });
  mount();
  expect((await screen.findAllByText('Do nghiệp vụ nguồn quản lý')).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Tài sản: Máy bơm · Work Order: Sửa máy bơm/).length).toBeGreaterThan(
    0,
  );
  expect(screen.getAllByRole('button', { name: 'Xem chi tiết' }).length).toBeGreaterThan(0);
});
it('opens the linked Work Order from a read-only expense when a router is available', async () => {
  const linked = { ...expense, canEdit: false, taskId: 'work-order', taskTitle: 'Sửa máy bơm' };
  mock.expenses.mockResolvedValue({ items: [linked], total: 1, page: 1, pageSize: 25 });
  mock.expense.mockResolvedValue(linked);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/locations/location/investment']}>
        <Routes>
          <Route path="/locations/:locationId/investment" element={<ExpensesApiPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click((await screen.findAllByRole('button', { name: 'Xem chi tiết' }))[0]);
  expect(await screen.findByRole('link', { name: 'Mở Work Order liên quan' })).toHaveAttribute(
    'href',
    '/maintenance?workOrderId=work-order',
  );
});
