// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { contractClient, type ContractView } from '../../../../packages/client-core/src/contracts';
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Action: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  ui: {},
}));
vi.mock('../features/contracts/ContractEvidence', () => ({ ContractEvidence: () => null }));
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
