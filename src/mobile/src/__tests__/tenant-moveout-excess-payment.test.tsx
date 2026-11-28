// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const navigation = vi.hoisted(() => ({ go: vi.fn() }));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => navigation,
}));
vi.mock('../components/WorkspaceKit', () => ({
  Action: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock('../theme/theme', () => ({
  colors: { navy: '#000', white: '#fff', border: '#eee', red: '#b00' },
}));

import { TenantMoveOutExcessPayment } from '../features/contracts/moveOut/TenantMoveOutExcessPayment';

afterEach(() => {
  cleanup();
  navigation.go.mockReset();
});

it('shows one clear receivable detail link instead of embedding QR on Tenant checklist', () => {
  const chargeId = 'bbbb0000-0000-4000-8000-000000000002';
  const contractId = 'aaaa0000-0000-4000-8000-000000000001';
  render(
    <TenantMoveOutExcessPayment
      contractId={contractId}
      chargeId={chargeId}
      payableAmount="500000"
    />,
  );
  expect(screen.getByText(/500.000/)).toBeTruthy();
  expect(screen.queryByAltText(/Mã chuyển khoản/)).toBeNull();
  const button = screen.getByRole('button', { name: 'Xem khoản phải thu trả phòng' });
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(button);
  expect(navigation.go).toHaveBeenCalledExactlyOnceWith('invoice', {
    view: 'settlement',
    settlementContractId: contractId,
    settlementChargeId: chargeId,
  });
});
