// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../theme/theme', () => ({
  colors: { navy: '#000', white: '#fff', border: '#eee', red: '#b00' },
}));
vi.mock('../screens/TenantSettlementTransfer', () => ({
  TenantSettlementTransfer: ({ chargeId, autoOpen }: { chargeId: string; autoOpen: boolean }) => (
    <div data-testid="payment-instructions">{`${chargeId}:${autoOpen}`}</div>
  ),
}));

import { TenantMoveOutExcessPayment } from '../features/contracts/TenantMoveOutExcessPayment';

afterEach(cleanup);

it('automatically loads QR instructions for only the backend-issued settlement receivable', () => {
  const chargeId = 'bbbb0000-0000-4000-8000-000000000002';
  render(
    <TenantMoveOutExcessPayment
      contractId="aaaa0000-0000-4000-8000-000000000001"
      chargeId={chargeId}
      payableAmount="500000"
      onChanged={vi.fn()}
    />,
  );
  expect(screen.getByTestId('payment-instructions').textContent).toBe(`${chargeId}:true`);
  expect(screen.getByText(/500.000/)).toBeTruthy();
});
