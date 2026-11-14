// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  contractClient,
  type ContractRequest,
} from '../../../../packages/client-core/src/contracts';
vi.mock('react-native', () => ({
  Image: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
    <span>{accessibilityLabel}</span>
  ),
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({
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
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
}));
import { MainInitialPaymentCard } from '../features/contracts/MainInitialPaymentCard';
const request = vi.fn();
const paid = vi.fn();
const api = contractClient(request as ContractRequest);
beforeEach(() => {
  vi.clearAllMocks();
  request.mockImplementation(async (path: string) => ({
    contractId: 'main',
    availability: 'Available',
    signingComplete: true,
    charges: [
      { code: 'RENT', name: 'Tiền thuê tháng đầu', amount: '3000000' },
      { code: 'INTERNET', name: 'Internet', amount: '50000' },
    ],
    requiredDeposit: '3000000',
    holdingCredit: '3000000',
    verifiedDeposit: '3000000',
    verifiedRentAndFees: '0',
    outstandingAmount: '3050000',
    paid: false,
    transferReference: 'BH12345678',
    qrImageDataUri: path.endsWith('/transfer-instructions') ? 'data:image/png;base64,TEST' : null,
  }));
});
afterEach(cleanup);
it('uses backend total and Holding credit, generating only one total QR without claiming payment', async () => {
  render(<MainInitialPaymentCard api={api} contractId="main" onPaid={paid} />);
  const button = await screen.findByRole('button', { name: 'Tạo QR thanh toán tổng' });
  expect(screen.getByText(/Cọc Holding đã áp dụng:/).textContent).toMatch(/3.000.000/);
  expect(screen.getByText(/Còn phải trả:/).textContent).toMatch(/3.050.000/);
  fireEvent.click(button);
  await screen.findByText('QR thanh toán ban đầu');
  expect(
    request.mock.calls.filter(([path]) => path.endsWith('/transfer-instructions')),
  ).toHaveLength(1);
  expect(paid).not.toHaveBeenCalled();
  expect(request.mock.calls.some(([path]) => path.includes('/activate'))).toBe(false);
});
it('only reports paid after the backend returns paid true', async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (path: string) => ({
    ...(await original(path)),
    paid: true,
    outstandingAmount: '0',
    availability: 'Settled',
  }));
  render(<MainInitialPaymentCard api={api} contractId="main" onPaid={paid} />);
  await screen.findByText('Backend đã xác nhận thanh toán đủ.');
  expect(paid).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Tạo QR thanh toán tổng' })).toBeNull();
});
it('keeps QR disabled when the receiving account is unavailable and preserves API errors', async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (path: string) => ({
    ...(await original(path)),
    availability: 'ReceivingAccountUnavailable',
  }));
  render(<MainInitialPaymentCard api={api} contractId="main" onPaid={paid} />);
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Tạo QR thanh toán tổng' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  expect(paid).not.toHaveBeenCalled();
});
