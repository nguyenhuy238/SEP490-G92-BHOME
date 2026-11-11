import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import {
  contractClient,
  type ContractRequest,
  type FinalFixedChargePreview,
} from '../../../../../packages/client-core/src/contracts';
import { FinalFixedChargesPanel } from './FinalFixedChargesPanel';

const row: FinalFixedChargePreview = {
  chargeCode: 'RENT',
  name: 'Tiền thuê',
  billingPeriod: '2026-11-01',
  reference: 'source-rent-1',
  amount: '1500000',
  existingReceivableId: null,
  missingInputs: [],
  calculation: {
    billingPeriod: '2026-11-01',
    chargeCode: 'RENT',
    category: 'Rent',
    rate: '3000000',
    partialMonth: 1,
    rounding: 0,
    occupiedDays: 15,
    periodDays: 30,
    cumulativePricedAmount: '1500000',
    alreadyPricedAmount: '0',
  },
};
function mount(value = row) {
  const request = vi.fn<ContractRequest>(
    async <T,>(_path: string, init?: RequestInit): Promise<T> => {
      if (init?.method === 'POST') throw { status: 503 };
      return [value] as T;
    },
  );
  const api = contractClient(
    <T,>(path: string, init?: RequestInit) => request(path, init) as Promise<T>,
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FinalFixedChargesPanel api={api} id="contract" reference="ledger" saved={async () => {}} />
    </QueryClientProvider>,
  );
  return request;
}
it('requires the Owner to verify signed terms and retries the same approval after delivery failure', async () => {
  const request = mount();
  await screen.findByText(/Theo 15\/30 ngày/);
  const button = screen.getByRole('button', { name: 'Duyệt Tiền thuê' });
  expect(button).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText(
      'Tôi xác nhận chính sách Tiền thuê áp dụng đúng điều khoản đã ký và chưa thu trùng',
    ),
  );
  fireEvent.click(button);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() =>
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2),
  );
  const posts = request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts[0][0]).toMatch(/receivables\/final-fixed-charges$/);
  expect(JSON.parse(posts[0][1]?.body as string)).toEqual({
    chargeCode: 'RENT',
    expectedReference: row.reference,
    policyAppliesToSignedTermsConfirmed: true,
  });
  expect(posts[0][1]?.headers).toEqual(posts[1][1]?.headers);
});
it('keeps missing policies pending instead of displaying a zero charge', async () => {
  mount({ ...row, amount: null, calculation: null, missingInputs: ['billing_schedule_required'] });
  await screen.findByText('Phải thu thêm: Chưa đủ dữ liệu');
  expect(screen.getByRole('button', { name: 'Duyệt Tiền thuê' })).toBeDisabled();
});
it('shows the approved adjustment without collecting the original rent again', async () => {
  mount({
    ...row,
    amount: '0',
    calculation: {
      ...row.calculation!,
      cumulativePricedAmount: '3000000',
      alreadyPricedAmount: '3000000',
      policyCalculatedAmount: '1500000',
      approvedReduction: '1500000',
      approvedAdjustmentIds: ['owner-decision'],
    },
  });
  await screen.findByText(/Đã đối chiếu phần giảm Owner duyệt: 1.500.000/);
  expect(screen.getByText('Phải thu thêm: 0 ₫')).toBeTruthy();
});
