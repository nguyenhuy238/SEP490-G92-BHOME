import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type {
  Expense,
  ExpensePaymentView,
  DepreciationView,
} from '../../../../../packages/client-core/src/finance';
import { ApiError } from '../../../../../packages/client-core/src/api';
import { todayVietnam } from '../staff/staffContracts';
import { ExpenseFinanceActions } from './ExpenseFinanceActions';

const api = vi.hoisted(() => ({
  expensePayments: vi.fn(),
  setExpenseDueDate: vi.fn(),
  recordExpensePayment: vi.fn(),
  depreciation: vi.fn(),
  disposeInvestment: vi.fn(),
  receiveInvestmentDisposal: vi.fn(),
}));
vi.mock('./useFinanceApi', () => ({ useFinanceApi: () => api }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
const expense: Expense = {
  id: 'expense',
  locationId: 'location',
  roomId: null,
  category: 'Điện nước',
  expenseType: 'OPERATING',
  amount: '1000',
  occurredOn: '2026-01-01',
  note: 'Synthetic',
  version: 1,
  canEdit: true,
};
const partial: ExpensePaymentView = {
  expenseId: expense.id,
  version: 2,
  amount: '1000',
  paidAmount: '400',
  remainingAmount: '600',
  status: 'PartiallyPaid',
  events: [
    {
      key: 'payment',
      recordedAt: '2026-01-02T00:00:00Z',
      paidOn: '2026-01-02',
      amount: '400',
      note: 'Paid first part',
    },
  ],
  dueOn: null,
  dueStatus: 'Unknown',
  dueHistory: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  api.expensePayments.mockResolvedValue(partial);
});
function mount(item: Expense = expense) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const changed = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ExpenseFinanceActions expense={item} onChanged={changed} />
    </QueryClientProvider>,
  );
  return { changed, client };
}
async function edit(date: string, note: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Cập nhật hạn thanh toán' }));
  fireEvent.change(screen.getByLabelText('Hạn thanh toán'), { target: { value: date } });
  fireEvent.change(screen.getByLabelText('Lý do cập nhật hạn'), { target: { value: note } });
  const save = screen.getByRole('button', { name: 'Lưu hạn thanh toán' });
  expect(save).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /Xác nhận thay đổi hạn thanh toán/ }));
  return save;
}
it('validates, confirms, retries the same operation key, and retains actual payment history', async () => {
  const { changed } = mount();
  const save = await edit('2025-12-31', 'Agreed');
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Hạn thanh toán'), { target: { value: '2026-01-03' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /Xác nhận thay đổi hạn thanh toán/ }));
  api.setExpenseDueDate
    .mockRejectedValueOnce(new Error('Network'))
    .mockImplementationOnce(async () => {
      api.expensePayments.mockResolvedValue({
        ...partial,
        version: 3,
        dueOn: '2026-01-03',
        dueStatus: 'Overdue',
        dueHistory: [
          {
            key: 'due',
            recordedAt: '2026-01-02T00:00:00Z',
            input: { dueOn: '2026-01-03', expectedVersion: 2, note: 'Agreed' },
          },
        ],
      });
    });
  fireEvent.click(save);
  await screen.findByRole('alert');
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(save);
  await screen.findByText(/Hạn thanh toán: 2026-01-03 · Quá hạn/);
  expect(api.setExpenseDueDate).toHaveBeenCalledTimes(2);
  expect(api.setExpenseDueDate).toHaveBeenCalledWith(
    'expense',
    { dueOn: '2026-01-03', expectedVersion: 2, note: 'Agreed' },
    expect.any(String),
  );
  expect(api.setExpenseDueDate.mock.calls[0]).toEqual(api.setExpenseDueDate.mock.calls[1]);
  expect(screen.getByText(/Paid first part/)).toBeInTheDocument();
  expect(screen.getByText(/Thanh toán một phần/)).toHaveTextContent('600');
  expect(api.recordExpensePayment).not.toHaveBeenCalled();
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
});
it('clears an explicitly set due date without marking an unknown expense paid', async () => {
  const unknown = {
    ...partial,
    status: 'Unknown' as const,
    paidAmount: null,
    remainingAmount: null,
    events: [],
    dueOn: '2026-01-03',
    dueStatus: 'Unknown' as const,
  };
  api.expensePayments.mockResolvedValue(unknown);
  api.setExpenseDueDate.mockImplementation(async () => {
    api.expensePayments.mockResolvedValue({ ...unknown, version: 3, dueOn: null });
  });
  mount();
  fireEvent.click(await edit('', 'Unknown due date'));
  await screen.findByText(/Hạn thanh toán: Chưa xác định/);
  expect(api.setExpenseDueDate).toHaveBeenCalledWith(
    'expense',
    { dueOn: null, expectedVersion: 2, note: 'Unknown due date' },
    expect.any(String),
  );
  expect(screen.getByText(/Chưa rõ tình trạng/)).toHaveTextContent('Chưa xác định');
  expect(api.recordExpensePayment).not.toHaveBeenCalled();
});

it('requires fresh confirmation when payment details or the server version change', async () => {
  const { client } = mount();
  const amount = await screen.findByLabelText('Số tiền đã chuyển (đ)');
  const note = screen.getByLabelText('Ghi chú xác nhận / chứng từ');
  const confirmation = screen.getByRole('checkbox', {
    name: 'Tôi xác nhận thông tin thanh toán đúng thực tế.',
  });
  const save = screen.getByRole('button', { name: 'Ghi nhận thực chi' });
  fireEvent.change(amount, { target: { value: '100' } });
  fireEvent.change(note, { target: { value: 'Verified transfer' } });
  fireEvent.click(confirmation);
  expect(save).toBeEnabled();
  fireEvent.change(amount, { target: { value: '200' } });
  expect(confirmation).not.toBeChecked();
  expect(save).toBeDisabled();
  fireEvent.click(confirmation);
  fireEvent.change(screen.getByLabelText('Ngày thực chi'), {
    target: { value: '2026-01-02' },
  });
  expect(confirmation).not.toBeChecked();
  fireEvent.click(confirmation);
  fireEvent.change(note, { target: { value: 'Changed evidence' } });
  expect(confirmation).not.toBeChecked();
  fireEvent.click(confirmation);
  api.expensePayments.mockResolvedValue({ ...partial, version: 3 });
  await client.invalidateQueries({ queryKey: ['expense-payments', 'owner', expense.id] });
  await waitFor(() => expect(confirmation).not.toBeChecked());
  expect(save).toBeDisabled();
  expect(api.recordExpensePayment).not.toHaveBeenCalled();
});

it('blocks payment resubmission after a version conflict until fresh data is loaded', async () => {
  mount();
  fireEvent.change(await screen.findByLabelText('Số tiền đã chuyển (đ)'), {
    target: { value: '100' },
  });
  fireEvent.change(screen.getByLabelText('Ghi chú xác nhận / chứng từ'), {
    target: { value: 'Verified transfer' },
  });
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'Tôi xác nhận thông tin thanh toán đúng thực tế.',
    }),
  );
  api.recordExpensePayment.mockRejectedValueOnce(new ApiError(409));
  const save = screen.getByRole('button', { name: 'Ghi nhận thực chi' });
  fireEvent.click(save);
  const reload = await screen.findByRole('button', { name: 'Tải lại dữ liệu' });
  expect(save).toBeDisabled();
  fireEvent.click(save);
  expect(api.recordExpensePayment).toHaveBeenCalledTimes(1);
  api.expensePayments.mockResolvedValue({ ...partial, version: 3 });
  fireEvent.click(reload);
  await waitFor(() => expect(reload).not.toBeInTheDocument());
  expect(save).toBeDisabled();
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'Tôi xác nhận thông tin thanh toán đúng thực tế.',
    }),
  );
  expect(save).toBeEnabled();
});

const investment: Expense = { ...expense, expenseType: 'INITIAL_INVESTMENT' };
const lot: DepreciationView = {
  expenseId: expense.id,
  locationId: expense.locationId,
  assetId: null,
  name: 'Four units',
  cost: '1000',
  quantity: 4,
  remainingQuantity: 4,
  purchasedOn: expense.occurredOn,
  version: 3,
  revisions: [
    {
      key: 'plan',
      effectiveFrom: expense.occurredOn,
      plan: {
        kind: 'Equipment',
        inServiceOn: expense.occurredOn,
        usefulLifeMonths: 12,
        salvageValue: '0',
        effectiveFrom: null,
        retiredOn: null,
        expectedVersion: 1,
        note: 'Plan',
      },
    },
  ],
  amounts: { period: '0', accumulated: '100', carryingValue: '900', monthly: '83' },
};
async function beginSale() {
  fireEvent.click(await screen.findByRole('button', { name: 'Ghi nhận thanh lý' }));
  fireEvent.change(screen.getByLabelText('Số lượng thanh lý'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Giá bán (đ)'), { target: { value: '200' } });
  fireEvent.change(screen.getByLabelText('Lý do / chứng từ thanh lý'), {
    target: { value: 'Sold one' },
  });
  return screen.getByRole('button', { name: /^Xác nhận$/ });
}
function confirmSale() {
  fireEvent.click(screen.getByRole('checkbox', { name: 'Tôi xác nhận thông tin đúng thực tế.' }));
}
it('records a quantity sale, preserves retry identity, blocks duplicates and collects only the selected sale', async () => {
  api.depreciation.mockResolvedValue(lot);
  const { client } = mount(investment);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const save = await beginSale();
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Số lượng thanh lý'), { target: { value: '5' } });
  confirmSale();
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Số lượng thanh lý'), { target: { value: '1' } });
  confirmSale();
  api.disposeInvestment.mockRejectedValueOnce(new Error('Network'));
  fireEvent.click(save);
  await screen.findByText('Không thể tải hoặc lưu dữ liệu tài chính. Vui lòng thử lại.');
  const sale = {
    sale: {
      key: 'sale-one',
      recordedAt: '',
      input: {
        disposedOn: todayVietnam(),
        saleAmount: '200',
        expectedVersion: 3,
        note: 'Sold one',
        quantity: 1,
      },
    },
    received: '0',
    outstanding: '200',
  };
  let complete!: () => void;
  api.disposeInvestment.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  fireEvent.click(save);
  fireEvent.click(save);
  expect(api.disposeInvestment).toHaveBeenCalledTimes(2);
  expect(api.disposeInvestment.mock.calls[0]).toEqual(api.disposeInvestment.mock.calls[1]);
  expect(api.disposeInvestment).toHaveBeenCalledWith(
    expense.id,
    sale.sale.input,
    expect.any(String),
  );
  expect(api.receiveInvestmentDisposal).not.toHaveBeenCalled();
  api.depreciation.mockResolvedValue({
    ...lot,
    remainingQuantity: 3,
    version: 4,
    partialDisposals: [sale],
  });
  complete();
  await screen.findByText(/Còn lại trong sổ vốn: 3/);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['finance-depreciation-sources', 'owner'] });
  fireEvent.click(await screen.findByRole('button', { name: /Xác nhận thực thu lần thanh lý/ }));
  fireEvent.change(screen.getByLabelText('Tiền thực thu (đ)'), { target: { value: '80' } });
  fireEvent.change(screen.getByLabelText('Lý do / chứng từ thanh lý'), {
    target: { value: 'Receipt' },
  });
  confirmSale();
  api.receiveInvestmentDisposal.mockImplementation(async () => {
    api.depreciation.mockResolvedValue({
      ...lot,
      remainingQuantity: 3,
      version: 5,
      partialDisposals: [{ ...sale, received: '80', outstanding: '120' }],
    });
  });
  fireEvent.click(screen.getByRole('button', { name: /^Xác nhận$/ }));
  await waitFor(() =>
    expect(api.receiveInvestmentDisposal).toHaveBeenCalledWith(
      expense.id,
      {
        amount: '80',
        receivedOn: todayVietnam(),
        expectedVersion: 4,
        note: 'Receipt',
        disposalKey: 'sale-one',
      },
      expect.any(String),
    ),
  );
  await screen.findByText(/Còn phải thu: 120/);
  expect(screen.getByText(/Còn lại trong sổ vốn: 3/)).toBeInTheDocument();
});
it('requires a reload and fresh confirmation on a version conflict', async () => {
  api.depreciation.mockResolvedValue(lot);
  mount(investment);
  const save = await beginSale();
  confirmSale();
  api.disposeInvestment.mockRejectedValueOnce(new ApiError(409));
  fireEvent.click(save);
  const reload = await screen.findByRole('button', { name: 'Tải lại dữ liệu' });
  expect(save).toBeDisabled();
  api.depreciation.mockResolvedValue({ ...lot, version: 5, remainingQuantity: 2 });
  fireEvent.click(reload);
  await screen.findByText(/Còn lại trong sổ vốn: 2/);
  expect(await screen.findByRole('button', { name: 'Ghi nhận thanh lý' })).toBeEnabled();
  expect(api.disposeInvestment).toHaveBeenCalledTimes(1);
});
it('requires fresh disposal confirmation after a background refresh changes the lot version', async () => {
  api.depreciation.mockResolvedValue(lot);
  const { client } = mount(investment);
  const save = await beginSale();
  confirmSale();
  expect(save).toBeEnabled();
  api.depreciation.mockResolvedValue({ ...lot, version: 4 });
  await client.invalidateQueries({ queryKey: ['expense-depreciation', 'owner', expense.id] });
  await waitFor(() => expect(save).toBeDisabled());
  expect(
    screen.getByRole('checkbox', { name: 'Tôi xác nhận thông tin đúng thực tế.' }),
  ).not.toBeChecked();
  expect(api.disposeInvestment).not.toHaveBeenCalled();
});
