// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { contractClient, type ContractView } from '../../../../packages/client-core/src/contracts';
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Action: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  ui: {},
}));
vi.mock('../features/contracts/ContractEvidence', () => ({
  ContractEvidence: ({ previewId }: { previewId: string }) => <span>PDF {previewId}</span>,
}));
vi.mock('../features/contracts/HoldingDepositAllocation', () => ({
  HoldingDepositAllocation: () => null,
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (path: string | null) => ({
    data: path?.endsWith('/holding-deposit')
      ? {
          verified: '100000',
          remaining: '0',
          disposition: {
            cause: 'OwnerCannotProvideRoom',
            status: 'RefundReserved',
            forfeitedAmount: '0',
            refundRequired: '100000',
            refunded: '0',
            reserved: '100000',
          },
        }
      : [],
    error: '',
    reload: vi.fn(),
  }),
}));
import { ContractWorkflowPanel } from '../features/contracts/ContractWorkflowPanel';
afterEach(cleanup);
it.each(['Draft', 'PendingSigning'])(
  'Staff sees and generates the %s Main preview without fetching privileged deposit data',
  async (status) => {
    let generated = false;
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/previews') && init?.method === 'POST') {
        generated = true;
        return { id: 'preview' };
      }
      if (path.endsWith('/previews'))
        return generated ? [{ id: 'preview', recordedAt: '2026-11-18T00:00:00Z' }] : [];
      throw new Error(path);
    });
    render(
      <ContractWorkflowPanel
        api={contractClient(request as Parameters<typeof contractClient>[0])}
        contract={{ id: 'main', kind: 'Main', status } as ContractView}
        role="Staff"
        section="documents"
      />,
    );
    const button = await screen.findByRole('button', { name: 'Tạo bản xem trước' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText('PDF preview');
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(request.mock.calls.every(([path]) => !path.includes('/deposit-verifications'))).toBe(
      true,
    );
  },
);
it('Staff cannot open the preview for an Active Main contract', async () => {
  const request = vi.fn();
  render(
    <ContractWorkflowPanel
      api={contractClient(request)}
      contract={{ id: 'main', kind: 'Main', status: 'Active' } as ContractView}
      role="Staff"
      section="documents"
    />,
  );
  expect(screen.queryByRole('button', { name: 'Tạo bản xem trước' })).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
it('shows backend refund status as monitoring without treating a reservation as completed', async () => {
  const api = contractClient(async <T,>() => [] as T);
  render(
    <ContractWorkflowPanel
      api={api}
      contract={
        { id: 'synthetic-contract', kind: 'Holding', requiredDeposit: '100000' } as ContractView
      }
      role="Owner"
      section="history"
    />,
  );
  await screen.findByText('Đang chờ thực chi');
  expect(screen.queryByText('Đã xác minh thực chi hoàn cọc')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Lập yêu cầu hoàn tiền' })).toBeNull();
});
