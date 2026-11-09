import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { afterEach, expect, it, vi } from 'vitest';
import { contractClient } from '../../../../../packages/client-core/src/contracts';
import { ApiError } from '../../../../../packages/client-core/src/api';
import { ContractPolicyPanel } from './ContractPolicyPanel';
import { theme } from '../../theme/theme';

afterEach(cleanup);
it('retains an amendment idempotency key after uncertainty and opens the real draft for existing signing controls', async () => {
  const writes: RequestInit[] = [];
  const changed = vi.fn();
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      writes.push(init);
      if (writes.length === 1) throw new ApiError(0);
      return { contractId: 'amendment' };
    }
    if (path.endsWith('/agreed-operating-policy'))
      return {
        contractId: 'parent',
        status: 'Accepted',
        policy: { title: 'Original rules', content: 'Original signed content' },
      };
    return [
      {
        id: 'policy',
        status: 'Published',
        data: { title: 'Proposed rules', effectiveFrom: '2026-12-01' },
      },
    ];
  });
  const api = contractClient(
    <T,>(path: string, init?: RequestInit) => request(path, init) as Promise<T>,
  );
  render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ContractPolicyPanel
          api={api}
          actorId="owner"
          contract={{ id: 'parent', locationId: 'location', kind: 'Main', status: 'Active' }}
          onChanged={changed}
        />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  await screen.findByText(/Original signed content/);
  fireEvent.mouseDown(screen.getByLabelText(/Nội quy đề xuất cho phụ lục/));
  fireEvent.click(await screen.findByRole('option', { name: /Proposed rules/ }));
  fireEvent.change(screen.getByLabelText(/Ngày hiệu lực phụ lục/), {
    target: { value: '2026-12-01' },
  });
  fireEvent.change(screen.getByLabelText(/Lý do thay đổi nội quy/), {
    target: { value: 'Synthetic reason' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo phụ lục nội quy' }));
  await screen.findByText(/Chưa hoàn thành yêu cầu/);
  expect(screen.queryByRole('button', { name: 'Mở phụ lục để ký và áp dụng' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tạo phụ lục nội quy' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Mở phụ lục để ký và áp dụng' }));
  expect(changed).toHaveBeenCalledWith('amendment');
  expect(writes).toHaveLength(2);
  expect(writes[0].headers).toEqual(writes[1].headers);
  expect(JSON.parse(writes[1].body as string)).toEqual({
    policyId: 'policy',
    effectiveFrom: '2026-12-01',
    reason: 'Synthetic reason',
  });
  expect(
    request.mock.calls.some(([path]) => path.endsWith('/activate') || path.endsWith('/signing')),
  ).toBe(false);
});

it('never offers direct amendment preparation for an already applied Addendum', async () => {
  const request = vi.fn(async () => ({
    contractId: 'amendment',
    status: 'Accepted',
    policy: null,
  }));
  const api = contractClient(<T,>() => request() as Promise<T>);
  render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={new QueryClient()}>
        <ContractPolicyPanel
          api={api}
          actorId="owner"
          contract={{
            id: 'amendment',
            locationId: 'location',
            kind: 'Addendum',
            status: 'Applied',
          }}
          onChanged={vi.fn()}
        />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Tạo phụ lục nội quy' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hủy đề xuất phụ lục' })).toBeNull();
});
