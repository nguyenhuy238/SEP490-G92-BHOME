import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ContractClient } from '../../../../../packages/client-core/src/contracts';
import { ContractHandoverPanel } from './ContractHandoverPanel';

const reload = vi.hoisted(() => vi.fn());
vi.mock('../../../../../packages/client-core/src/useContractHandover', () => ({
  useContractHandover: () => ({
    loading: false,
    error: '',
    reload,
    data: {
      history: [],
      documents: [],
      record: {
        version: 3,
        status: 'Draft',
        tenantConfirmedAt: null,
        staffConfirmedAt: null,
        snapshot: {
          date: '2026-11-16',
          roomNumber: 'SYN',
          roomCondition: 'Đã kiểm tra',
          keysAndAccess: 'Hai chìa khóa',
          notes: '',
          assets: [
            {
              id: 'chair',
              name: 'Ghế',
              observedCondition: 'Tốt',
              inventoryCondition: 'Tốt',
              observedQuantity: 3,
              handedOverQuantity: 3,
              goodQuantity: 3,
              wornQuantity: 0,
              damagedQuantity: 0,
              missingQuantity: 1,
            },
          ],
          evidenceIds: [],
          electricity: { id: 'e', value: '100' },
          water: { id: 'w', value: '100' },
        },
      },
    },
  }),
}));
vi.mock('../../components/common/PrivateEvidenceViewer', () => ({
  PrivateEvidenceViewer: () => null,
}));

it('binds an explicit Owner exception to the displayed version and blocks duplicate submissions', async () => {
  let resolve!: () => void;
  const mutate = vi.fn(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  render(<ContractHandoverPanel api={{ mutate } as unknown as ContractClient} id="contract" />);
  expect(screen.getByText(/thực tế 3, bàn giao 3/)).toBeVisible();
  const accept = screen.getByRole('button', { name: 'Chấp nhận bàn giao theo thực tế' });
  expect(accept).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Lý do quyết định ngoại lệ bàn giao'), {
    target: { value: 'Chấp nhận thiếu một ghế' },
  });
  fireEvent.change(screen.getByLabelText('Phương án bổ sung / sửa chữa / kiểm tra lại'), {
    target: { value: 'Bổ sung bằng biên bản riêng' },
  });
  fireEvent.click(accept);
  fireEvent.click(accept);
  expect(mutate).toHaveBeenCalledOnce();
  expect(mutate).toHaveBeenCalledWith(
    'contract',
    'handover/owner-review',
    {
      version: 3,
      accepted: true,
      reason: 'Chấp nhận thiếu một ghế',
      handlingPlan: 'Bổ sung bằng biên bản riêng',
    },
    expect.any(String),
  );
  resolve();
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
});
