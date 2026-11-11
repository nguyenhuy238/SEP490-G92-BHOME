import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import {
  contractClient,
  type ContractRequest,
  type FinalInspection,
  type SettlementReceivables,
  type SettlementSummary,
} from '../../../../../packages/client-core/src/contracts';
import { SettlementReceivablesPanel } from './SettlementReceivablesPanel';

const view = {
  contractId: 'contract',
  reference: 'approved-source-v1',
  availableDeposit: '400000',
  offsets: [],
  receivables: [
    {
      charge: { id: 'charge', description: 'Synthetic damage', amount: '600000' },
      allocated: '0',
      outstanding: '600000',
      status: 'Unpaid',
    },
  ],
} as unknown as SettlementReceivables;
function mount() {
  const request = vi.fn<ContractRequest>(
    async <T,>(_path: string, init?: RequestInit): Promise<T> => {
      if (init?.method === 'POST') throw { status: 503 };
      return view as T;
    },
  );
  const api = contractClient(
    <T,>(path: string, init?: RequestInit) => request(path, init) as Promise<T>,
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SettlementReceivablesPanel
        api={api}
        id="contract"
        inspection={
          {
            id: 'inspection',
            version: 2,
            observed: { assets: [], evidenceIds: ['proof'] },
          } as unknown as FinalInspection
        }
        summary={
          {
            reference: 'financial-source',
            invoices: [],
            unresolvedItems: ['final_charges_and_damage_policy_pending'],
          } as unknown as SettlementSummary
        }
        saved={vi.fn(async () => {})}
      />
    </QueryClientProvider>,
  );
  return request;
}
it('approves damage above the deposit as a separate receivable and preserves the retry key', async () => {
  const request = mount();
  await screen.findByLabelText('Số tiền phải thu thiệt hại (VND)');
  fireEvent.change(screen.getByLabelText('Số tiền phải thu thiệt hại (VND)'), {
    target: { value: '600000' },
  });
  fireEvent.change(screen.getByLabelText('Mô tả và căn cứ chi phí'), {
    target: { value: 'Synthetic repair cost' },
  });
  fireEvent.click(screen.getByLabelText('Dùng ảnh biên bản 1'));
  const button = screen.getByRole('button', { name: 'Duyệt khoản phải thu thiệt hại' });
  expect(button).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText(
      'Tôi xác nhận thiệt hại, chứng từ và khoản này chưa được tính trên hóa đơn hoặc khoản phải thu khác',
    ),
  );
  fireEvent.click(button);
  await waitFor(() =>
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1),
  );
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() =>
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2),
  );
  const posts = request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts[0][0]).toMatch(/\/receivables\/damage$/);
  expect(JSON.parse(posts[0][1]?.body as string)).toMatchObject({
    amount: '600000',
    inspectionId: 'inspection',
    inspectionVersion: 2,
    expectedReference: view.reference,
    evidenceIds: ['proof'],
    humanConfirmed: true,
  });
  expect(posts[0][1]?.headers).toEqual(posts[1][1]?.headers);
});
it('requires a separate source-specific confirmation for a deposit offset', async () => {
  const request = mount();
  await screen.findByLabelText('Số tiền cấn trừ (VND)');
  fireEvent.mouseDown(screen.getByLabelText('Khoản đích cấn trừ'));
  fireEvent.click(await screen.findByRole('option', { name: /Synthetic damage/ }));
  fireEvent.change(screen.getByLabelText('Số tiền cấn trừ (VND)'), { target: { value: '250000' } });
  fireEvent.change(screen.getByLabelText('Căn cứ duyệt cấn trừ'), {
    target: { value: 'Synthetic deposit source checked' },
  });
  const button = screen.getByRole('button', { name: 'Duyệt cấn trừ' });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Tôi xác nhận nguồn cọc, khoản đích và số tiền cấn trừ'));
  fireEvent.click(button);
  await waitFor(() =>
    expect(
      request.mock.calls.some(
        ([path, init]) => path.endsWith('/receivables/deposit-offsets') && init?.method === 'POST',
      ),
    ).toBe(true),
  );
  const post = request.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(post[1]?.body as string)).toMatchObject({
    amount: '250000',
    receivableId: 'charge',
    invoiceId: null,
    expectedReference: view.reference,
    humanConfirmed: true,
  });
});
