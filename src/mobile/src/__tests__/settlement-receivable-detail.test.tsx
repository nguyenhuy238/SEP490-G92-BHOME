// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ status: 'Unpaid', reload: vi.fn(), options: null as unknown }));
const contractId = '8c1420e0-fea6-44eb-bbaa-d8fd8e9416df';
const chargeId = '911c8fb5-8ee5-4c52-91c2-2381aa8412d3';

vi.mock('expo-router', () => ({ router: { canGoBack: () => false, back: vi.fn() } }));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ session: { roles: ['Tenant'] } }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ go: vi.fn() }),
}));
vi.mock('../components/WorkspaceHeaderContext', () => ({
  useWorkspaceHeaderRefresh: () => true,
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Action: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  ui: {},
}));
vi.mock('../screens/TenantSettlementTransfer', () => ({
  TenantSettlementTransfer: () => <div data-testid="payment-qr">QR</div>,
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (_path: string, options: unknown) => {
    mock.options = options;
    return {
      loading: false,
      error: '',
      reload: mock.reload,
      data: {
        contractId,
        roomNumber: 'TEST-9A0205575A',
        offsets: [],
        receivables: [
          {
            charge: { id: chargeId, kind: 'TenantDamage', amount: '20000', description: 'Test' },
            allocated: mock.status === 'Paid' ? '20000' : '0',
            outstanding: mock.status === 'Paid' ? '0' : '20000',
            status: mock.status,
          },
        ],
      },
    };
  },
}));

import { TenantSettlementReceivableDetail } from '../screens/TenantSettlementReceivableDetail';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mock.reload.mockReset();
  mock.status = 'Unpaid';
});

it('polls only verified receivable balance, retains cached detail and stops on Paid', () => {
  vi.useFakeTimers();
  const view = render(<TenantSettlementReceivableDetail contractId={contractId} chargeId={chargeId} />);
  expect(mock.options).toMatchObject({ cache: { tags: ['payments', 'contracts'] } });
  expect(screen.getByTestId('payment-qr')).toBeTruthy();
  act(() => vi.advanceTimersByTime(5000));
  expect(mock.reload).toHaveBeenCalledTimes(1);
  mock.status = 'Paid';
  view.rerender(<TenantSettlementReceivableDetail contractId={contractId} chargeId={chargeId} />);
  expect(screen.queryByTestId('payment-qr')).toBeNull();
  expect(screen.getByText(/Máy chủ đã xác nhận thanh toán đủ/)).toBeTruthy();
  act(() => vi.advanceTimersByTime(10000));
  expect(mock.reload).toHaveBeenCalledTimes(1);
});
