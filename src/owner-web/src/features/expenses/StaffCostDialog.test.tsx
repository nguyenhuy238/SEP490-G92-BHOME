import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { StaffCostDialog } from './StaffCostDialog';

const api = vi.hoisted(() => ({ staffCosts: vi.fn(), recordStaffCost: vi.fn() }));
vi.mock('./useFinanceApi', () => ({ useFinanceApi: () => api }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
const candidate = {
  employmentId: 'employment',
  staffId: 'staff',
  staffName: 'Nhân viên tổng hợp',
  startDate: '2026-01-01',
  endDate: null,
  salaryType: 'Monthly',
  baseRate: '10000000',
  locations: [
    { locationId: 'a', locationName: 'Cơ sở A' },
    { locationId: 'b', locationName: 'Cơ sở B' },
  ],
  recorded: false,
};
beforeEach(() => {
  vi.resetAllMocks();
  api.staffCosts.mockResolvedValue([candidate]);
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <StaffCostDialog close={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}
async function choose() {
  const field = await screen.findByRole('combobox', { name: 'Nhân viên / hợp đồng' });
  await waitFor(() => expect(field).not.toHaveAttribute('aria-disabled', 'true'));
  fireEvent.mouseDown(field);
  fireEvent.click(await screen.findByRole('option', { name: /Nhân viên tổng hợp/ }));
}
it('requires exact 60/40 allocation and confirmation, retries with the same key, and links actual expenses', async () => {
  const client = mount();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await choose();
  const save = screen.getByRole('button', { name: 'Ghi nhận chi phí' });
  fireEvent.change(screen.getByLabelText('Cơ sở A (đ)'), { target: { value: '6000000' } });
  fireEvent.change(screen.getByLabelText('Cơ sở B (đ)'), { target: { value: '3000000' } });
  fireEvent.change(screen.getByLabelText('Căn cứ ghi nhận'), {
    target: { value: 'Bảng lương tổng hợp' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Cơ sở B (đ)'), { target: { value: '4000000' } });
  expect(save).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  api.recordStaffCost
    .mockRejectedValueOnce(new Error('Network'))
    .mockResolvedValueOnce(['expense-a', 'expense-b']);
  fireEvent.click(save);
  await screen.findByText(/Không thể tải hoặc lưu/);
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await screen.findByText(/Đã ghi nhận 2 khoản chi/);
  expect(api.recordStaffCost.mock.calls[0]).toEqual(api.recordStaffCost.mock.calls[1]);
  expect(api.recordStaffCost.mock.calls[0][0]).toMatchObject({
    employmentId: 'employment',
    category: 'Lương',
    total: '10000000',
    shares: [
      { locationId: 'a', amount: '6000000' },
      { locationId: 'b', amount: '4000000' },
    ],
  });
  expect(screen.getByRole('link', { name: 'Mở khoản chi 1' })).toHaveAttribute(
    'href',
    '/expenses?expenseId=expense-a',
  );
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['staff-costs', 'owner'] });
});
it('does not reuse salary as a bonus or submit a recorded salary', async () => {
  api.staffCosts.mockResolvedValue([{ ...candidate, recorded: true }]);
  mount();
  await choose();
  expect(screen.getByText(/Đã ghi nhận lương/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ghi nhận chi phí' })).toBeDisabled();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Loại chi phí' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Thưởng' }));
  expect(screen.getByLabelText('Tổng chi phí (đ)')).toHaveValue('');
  expect(api.recordStaffCost).not.toHaveBeenCalled();
});
it('leaves a legacy nonmonthly rate out of the monthly total until Owner supplies actual cost', async () => {
  api.staffCosts.mockResolvedValue([{ ...candidate, salaryType: 'Hourly', baseRate: '50000' }]);
  mount();
  await choose();
  expect(screen.getByText(/Mức lương hợp đồng:.*50\.000.*Hourly/)).toBeInTheDocument();
  expect(screen.getByLabelText('Tổng chi phí (đ)')).toHaveValue('');
  expect(screen.getByLabelText('Cơ sở A (đ)')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Ghi nhận chi phí' })).toBeDisabled();
  expect(api.recordStaffCost).not.toHaveBeenCalled();
});
