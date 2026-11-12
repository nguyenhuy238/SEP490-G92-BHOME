import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import {
  contractClient,
  type ContractRequest,
} from '../../../../../packages/client-core/src/contracts';
import { FinalChargeReviewPanel } from './FinalChargeReviewPanel';
function mount(missingInputs: string[] = []) {
  const request = vi.fn<ContractRequest>(
    async <T,>(_path: string, init?: RequestInit): Promise<T> => {
      if (init?.method === 'POST') throw { status: 503 };
      return { reference: 'source-1', review: null, isCurrent: false, missingInputs } as T;
    },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FinalChargeReviewPanel
        api={contractClient(
          <T,>(path: string, init?: RequestInit) => request(path, init) as Promise<T>,
        )}
        id="contract"
        reference="ledger"
        saved={async () => {}}
      />
    </QueryClientProvider>,
  );
  return request;
}
it('requires source review and a reason and preserves the operation key for a retry', async () => {
  const request = mount();
  const button = await screen.findByRole('button', { name: 'Xác nhận đủ khoản thu' });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Căn cứ xác nhận đủ khoản thu'), {
    target: { value: 'Checked signed terms, final readings and damage report' },
  });
  fireEvent.click(
    screen.getByLabelText('Tôi đã đối chiếu biên bản và xác nhận danh sách khoản thu đầy đủ'),
  );
  fireEvent.click(button);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() =>
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2),
  );
  const posts = request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts[0][1]?.headers).toEqual(posts[1][1]?.headers);
  expect(JSON.parse(posts[0][1]?.body as string)).toMatchObject({
    expectedReference: 'source-1',
    allChargesConfirmed: true,
  });
});
it('does not accept an incomplete set of mandatory utility charges', async () => {
  mount(['final_utility_charge_review_required:Water']);
  await screen.findByText('Cần ghi nhận khoản chốt điện/nước, kể cả khi đã tính đủ trên hóa đơn.');
  expect(
    screen.getByLabelText('Tôi đã đối chiếu biên bản và xác nhận danh sách khoản thu đầy đủ'),
  ).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Xác nhận đủ khoản thu' })).toBeDisabled();
});
