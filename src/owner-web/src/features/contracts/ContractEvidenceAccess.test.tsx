import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ContractClient } from '../../../../../packages/client-core/src/contracts';
import { ContractHandoverPanel } from './ContractHandoverPanel';

vi.mock('../../../../../packages/client-core/src/useContractHandover', () => ({
  useContractHandover: () => ({
    loading: false,
    error: '',
    reload: vi.fn(),
    data: {
      record: {
        version: 1,
        status: 'Completed',
        tenantConfirmedAt: null,
        staffConfirmedAt: null,
        snapshot: {
          date: '2026-11-14',
          roomNumber: '101',
          roomCondition: 'Tốt',
          keysAndAccess: 'Một chìa khóa',
          notes: '',
          assets: [],
          evidenceIds: ['photo'],
          electricity: { id: 'electric', value: '100' },
          water: { id: 'water', value: '10' },
        },
      },
      history: [],
      documents: [],
    },
  }),
}));

it('allows Owner to view or download each handover and meter photo through its private API', async () => {
  const handoverEvidence = vi.fn().mockRejectedValue({ status: 403 });
  const handoverMeterEvidence = vi.fn().mockRejectedValue({ status: 403 });
  const api = { handoverEvidence, handoverMeterEvidence } as unknown as ContractClient;
  render(<ContractHandoverPanel api={api} id="contract" />);

  expect(screen.getByRole('button', { name: 'Xem Ảnh bàn giao 1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tải xuống Ảnh bàn giao 1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Xem Ảnh chỉ số điện' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tải xuống Ảnh chỉ số nước' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Xem Ảnh bàn giao 1' }));
  await waitFor(() =>
    expect(handoverEvidence).toHaveBeenCalledWith('contract', 'photo', expect.any(AbortSignal)),
  );
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Tải xuống Ảnh chỉ số nước' }));
  await waitFor(() =>
    expect(handoverMeterEvidence).toHaveBeenCalledWith(
      'contract',
      'water',
      expect.any(AbortSignal),
    ),
  );
});
