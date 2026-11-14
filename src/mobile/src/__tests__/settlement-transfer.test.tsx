// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ availability: 'InstructionsOnly', reload: vi.fn() }));
vi.mock('react-native', () => ({ Image: () => null }));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  ui: {},
  Action: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (path: string | null) => ({
    loading: false,
    error: '',
    reload: state.reload,
    data: path
      ? {
          availability: state.availability,
          outstandingAmount: '150000',
          bankIdentifier: 'SYN',
          accountNumber: '0000000000',
          accountHolder: 'SYNTHETIC',
          transferReference: 'SERVER-REFERENCE',
          isDevelopmentDemo: false,
        }
      : null,
  }),
}));
import { TenantSettlementTransfer } from '../screens/TenantSettlementTransfer';
afterEach(cleanup);
it('displays server transfer details without marking payment successful', () => {
  state.availability = 'InstructionsOnly';
  const changed = vi.fn();
  render(<TenantSettlementTransfer contractId="contract" chargeId="charge" changed={changed} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Xem thông tin chuyển khoản cho khoản phải thu' }),
  );
  expect(screen.getByText(/Số còn phải trả: 150.000/)).toBeTruthy();
  expect(screen.getByText('Nội dung chuyển khoản: SERVER-REFERENCE')).toBeTruthy();
  expect(screen.queryByText(/đã được thanh toán đủ/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra lại trạng thái khoản phải thu' }));
  expect(changed).toHaveBeenCalledOnce();
});
it('withholds receiving details until the Owner configures a valid account', () => {
  state.availability = 'ReceivingAccountUnavailable';
  render(<TenantSettlementTransfer contractId="contract" chargeId="charge" changed={vi.fn()} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Xem thông tin chuyển khoản cho khoản phải thu' }),
  );
  expect(screen.getByText(/Owner chưa cấu hình/)).toBeTruthy();
  expect(screen.queryByText(/Nội dung chuyển khoản:/)).toBeNull();
});
