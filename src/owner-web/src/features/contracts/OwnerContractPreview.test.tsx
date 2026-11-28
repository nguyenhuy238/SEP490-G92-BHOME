import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import {
  contractClient,
  type ContractRequest,
  type ContractView,
} from '../../../../../packages/client-core/src/contracts';
import { OwnerContractPreview } from './components/signing/OwnerContractPreview';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it.each([false, true])(
  'Owner can review the exact %s signed PDF without sending an invitation',
  async (signed) => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:owner-contract'),
      revokeObjectURL: vi.fn(),
    });
    const c = {
      id: 'main',
      snapshotHash: 'hash',
      signatures: signed ? [{ status: 'Signed' }] : [],
    } as ContractView;
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/previews') && init?.method === 'POST') return { id: 'reviewed' };
      if (path.endsWith('/previews/reviewed') || path.endsWith('/document'))
        return new Response('%PDF-synthetic');
      throw new Error(path);
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <OwnerContractPreview api={contractClient(request as ContractRequest)} contract={c} />
      </QueryClientProvider>,
    );
    expect(screen.queryByTitle('PDF hợp đồng Owner xem trước')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xem PDF hợp đồng' }));
    expect(await screen.findByTitle('PDF hợp đồng Owner xem trước')).toHaveAttribute(
      'src',
      'blob:owner-contract',
    );
    expect(request.mock.calls.some(([path]) => path.includes('/signing-invitations'))).toBe(false);
    expect(request.mock.calls.some(([path]) => path.endsWith('/document'))).toBe(signed);
  },
);
