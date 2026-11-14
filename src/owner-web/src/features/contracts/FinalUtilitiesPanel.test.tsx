import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import {
  contractClient,
  type ContractRequest,
  type FinalUtilityPreview,
} from '../../../../../packages/client-core/src/contracts';
import { FinalUtilitiesPanel } from './FinalUtilitiesPanel';
const row: FinalUtilityPreview = {
  contractId: 'contract',
  utilityType: 'Electricity',
  billingPeriod: '2026-10-01',
  reference: 'usage-source-1',
  baseline: {
    value: '125.5',
    date: '2026-10-29',
    sourceKind: 'FinalInvoice',
    readingId: 'baseline',
    evidenceId: 'baseline-photo',
    sourceId: 'invoice-line',
  },
  final: {
    value: '140',
    date: '2026-10-31',
    sourceKind: 'ConfirmedFinal',
    readingId: 'final',
    evidenceId: 'final-photo',
    sourceId: 'inspection',
  },
  alreadyBilledQuantity: '25.5',
  quantity: '14.5',
  amount: '29000',
  missingInputs: [],
  existingReceivableId: null,
  calculationSnapshot: '{}',
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
      <FinalUtilitiesPanel
        api={api}
        id="contract"
        reference="financial-source"
        saved={vi.fn(async () => {})}
      />
    </QueryClientProvider>,
  );
  return request;
}
it('shows billed and final readings, requires review and retries the exact source without double submission', async () => {
  const request = mount();
  await screen.findByText(/Mốc: 125,5/);
  expect(screen.getByText(/Phải thu thêm: 29.000/)).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Duyệt khoản chốt Điện' });
  expect(button).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText(
      'Tôi xác nhận mốc đã tính tiền, chỉ số chốt và chính sách giá áp dụng cho Điện',
    ),
  );
  fireEvent.click(button);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() =>
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2),
  );
  const posts = request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts[0][0]).toMatch(/receivables\/final-utilities$/);
  expect(JSON.parse(posts[0][1]?.body as string)).toEqual({
    utilityType: 0,
    expectedReference: row.reference,
    humanConfirmed: true,
  });
  expect(posts[0][1]?.headers).toEqual(posts[1][1]?.headers);
});
it('does not present a missing quota as a zero payable charge', async () => {
  const request = mount({
    ...row,
    amount: null,
    missingInputs: ['utility_quota_verification_required'],
  });
  await screen.findByText('Thiếu định mức miễn phí đã xác nhận');
  expect(screen.getByText('Phải thu thêm: Chưa đủ dữ liệu')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Duyệt khoản chốt Điện' })).toBeDisabled();
  expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
