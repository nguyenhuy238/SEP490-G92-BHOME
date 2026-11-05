import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { ExpensesApiPage } from './ExpensesApiPage';

const mock = vi.hoisted(() => ({
  locations: vi.fn(),
  expenses: vi.fn(),
  expense: vi.fn(),
  createExpense: vi.fn(),
  updateExpense: vi.fn(),
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
