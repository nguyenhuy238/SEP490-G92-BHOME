import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import type {
  ContractClient,
  ContractView,
  MoveOut,
} from '../../../../../packages/client-core/src/contracts';
import { ContractLifecyclePanel } from './ContractLifecyclePanel';

const state = vi.hoisted(() => ({ version: 1, reload: vi.fn() }));
vi.mock('../../../../../packages/client-core/src/useContractLifecycle', async (original) => {
  const actual =
    await original<typeof import('../../../../../packages/client-core/src/useContractLifecycle')>();
  const snapshot = {
    date: '2026-11-16',
    roomCondition: 'Synthetic',
    keysAndAccess: 'Private key',
    notes: '',
    assets: [],
    evidenceIds: [],
    electricity: { value: '100', date: '2026-11-16' },
    water: { value: '100', date: '2026-11-16' },
  };
  return {
    ...actual,
    useContractLifecycle: () => ({
      loading: false,
      error: '',
      sectionErrors: {},
      reload: state.reload,
      summary: null,
      preparation: null,
      history: [],
      inspections: [
        {
          id: 'synthetic-inspection',
          version: state.version,
          inspectedAt: '2026-11-16T00:00:00Z',
          baseline: snapshot,
          observed: snapshot,
          ownerDecision: null,
        },
      ],
    }),
  };
});

it('allows Owner to verify the current inspection without Tenant sign-off or a PDF', async () => {
  state.version = 1;
  const api = {
    mutate: vi.fn().mockResolvedValue({}),
    inspectionStaff: vi.fn().mockResolvedValue([]),
  } as unknown as ContractClient;
  const contract = {
    id: '00000000-0000-0000-0000-000000000001',
    locationId: 'synthetic',
    startDate: '2026-10-01',
    endDate: '2026-11-30',
  } as ContractView;
  const moveOut = { status: 'Inspected', proposedDate: '2026-11-16' } as MoveOut;
  const cache = new QueryClient();
  const changed = vi.fn();
  const view = () => (
    <QueryClientProvider client={cache}>
      <ContractLifecyclePanel api={api} contract={contract} moveOut={moveOut} onChanged={changed} />
    </QueryClientProvider>
  );
  const { rerender } = render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại dữ liệu quyết toán' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText('Lý do / căn cứ của Owner'), {
    target: { value: 'Chỉ xác nhận hiện trạng' },
  });
  expect(screen.queryByLabelText('Căn cứ xử lý ngoại lệ phản hồi Tenant')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Xác nhận kết quả kiểm tra' })).toBeEnabled();
  state.version = 2;
  rerender(view());
  expect(api.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận kết quả kiểm tra' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận thực hiện' }));
  await waitFor(() =>
    expect(api.mutate).toHaveBeenCalledWith(
      contract.id,
      'move-out/inspection-review',
      {
        version: 2,
        confirmed: true,
        reason: 'Chỉ xác nhận hiện trạng',
        noAdditionalCharges: false,
      },
      expect.any(String),
    ),
  );
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
});
