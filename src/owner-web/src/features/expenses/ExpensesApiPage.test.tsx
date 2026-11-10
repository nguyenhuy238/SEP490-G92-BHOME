import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { ExpensesApiPage } from './ExpensesApiPage';
import { MemoryRouter, Route, Routes } from 'react-router';

const mock = vi.hoisted(() => ({
  locations: vi.fn(),
  expenses: vi.fn(),
  expense: vi.fn(),
  createExpense: vi.fn(),
  updateExpense: vi.fn(),
  expenseEvidence: vi.fn(),
  expenseReferences: vi.fn(),
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
  mock.expense.mockResolvedValue(expense);
  mock.expenseEvidence.mockResolvedValue([]);
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
  await screen.findByText('Bảo trì — 500.000 ₫');
  expect(mock.expenses).toHaveBeenCalledWith(
    expect.objectContaining({ locationId: 'location' }),
    expect.any(AbortSignal),
  );
  expect(screen.getByRole('combobox', { name: 'Cơ sở' })).toBeDisabled();
});
it('filters Initial Investment on the server and uses that type for new records', async () => {
  mount();
  await screen.findByText('Bảo trì — 500.000 ₫');
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
it('loads real API rows, submits one mutation while busy and reloads the list', async () => {
  let finish!: (v: typeof expense) => void;
  mock.createExpense.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  await screen.findByText('Bảo trì — 500.000 ₫');
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
  fireEvent.click(await screen.findByRole('button', { name: 'Chi tiết / chỉnh sửa' }));
  await screen.findByDisplayValue('500000');
  fireEvent.change(screen.getByLabelText(/Lý do chỉnh sửa/), {
    target: { value: 'Đối chiếu lại' },
  });
  fireEvent.submit(document.getElementById('expense-editor')!);
  await screen.findByText('Đã lưu khoản chi.');
  expect(mock.expense).toHaveBeenCalledWith('expense');
  expect(mock.updateExpense).toHaveBeenCalledWith('expense', expense, 1, 'Đối chiếu lại');
});

it('selects real Room/Asset/Work Order references and submits the exact source IDs', async () => {
  mock.expenseReferences.mockImplementation(async (_location, roomId) => ({
    rooms: [{ id: 'room', label: 'R-01', roomId: 'room', assetId: null }],
    assets: roomId
      ? [{ id: 'asset', label: 'Bàn tổng hợp', roomId: 'room', assetId: 'asset' }]
      : [],
    workOrders: roomId
      ? [{ id: 'work-order', label: 'Sửa bàn tổng hợp', roomId: 'room', assetId: 'asset' }]
      : [],
    truncated: false,
  }));
  mock.createExpense.mockResolvedValue(expense);
  mount();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ghi khoản chi' })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ghi khoản chi' }));
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Phòng ghi nhận' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    ),
  );
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Phòng ghi nhận' }));
  fireEvent.click(await screen.findByRole('option', { name: 'R-01' }));
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Work Order liên quan' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    ),
  );
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
  expect(screen.queryByText('Bảo trì — 500.000 ₫')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ghi khoản chi' }));
  mock.createExpense.mockRejectedValue({ status: 503 });
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
