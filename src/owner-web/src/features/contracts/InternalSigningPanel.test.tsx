import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import {
  contractClient,
  type ContractRequest,
  type ContractView,
} from '../../../../../packages/client-core/src/contracts';
import { InternalSigningPanel } from './InternalSigningPanel';
afterEach(cleanup);
const contract = {
  id: 'holding',
  kind: 'Holding',
  status: 'PendingSigning',
  approvedAt: '2026-11-13T00:00:00Z',
  snapshotHash: 'snapshot',
  isDevelopmentDemo: true,
} as ContractView;
function show(sandboxAvailable = true, reject = false) {
  let confirmed = false;
  const request = vi.fn(async (path: string) => {
    if (path.endsWith('/owner-confirmation')) {
      if (reject) throw { status: 403 };
      confirmed = true;
      return;
    }
    return {
      invitations: [],
      tenantAcceptedAt: null,
      ownerAcceptedAt: confirmed ? '2026-11-13T01:00:00Z' : null,
      documentHash: 'snapshot',
      sandboxAvailable,
      canContinue: false,
    };
  });
  const changed = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InternalSigningPanel
        api={contractClient(request as ContractRequest)}
        contract={contract}
        onChanged={changed}
      />
    </QueryClientProvider>,
  );
  return { request, changed };
}
it('requires explicit Owner checkbox and persists confirmation before Tenant simulation without declaring QR ready', async () => {
  const { request, changed } = show();
  const button = await screen.findByRole('button', { name: 'Xác nhận chữ ký Owner (Sandbox)' });
  expect(button).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText(
      'Tôi là Owner, đồng ý nội dung và xác nhận chữ ký giả lập cho hợp đồng này',
    ),
  );
  fireEvent.click(button);
  await screen.findByText(/Owner đã xác nhận:/);
  expect(request).toHaveBeenCalledWith(
    '/api/v1/contracts/holding/internal-signing/owner-confirmation',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        documentHash: 'snapshot',
        consent: true,
        consentVersion: 'internal-acceptance-v1',
      }),
    }),
  );
  expect(changed).toHaveBeenCalledOnce();
  expect(
    screen.getByText('Chỉ khi đủ xác nhận của Owner và Tenant, backend mới cho sang bước QR.'),
  ).toBeInTheDocument();
});
it('does not show Sandbox confirmation when backend capability is disabled', async () => {
  const { request } = show(false);
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Xác nhận chữ ký Owner (Sandbox)' })).toBeNull();
});
it('retains unconfirmed state when backend rejects the Owner action', async () => {
  show(true, true);
  const button = await screen.findByRole('button', { name: 'Xác nhận chữ ký Owner (Sandbox)' });
  fireEvent.click(
    screen.getByLabelText(
      'Tôi là Owner, đồng ý nội dung và xác nhận chữ ký giả lập cho hợp đồng này',
    ),
  );
  fireEvent.click(button);
  await screen.findByText('Chưa thể hoàn tất. Vui lòng kiểm tra kết nối và thử lại.');
  await waitFor(() => expect(button).toBeEnabled());
  expect(screen.queryByText(/Owner đã xác nhận:/)).toBeNull();
});
