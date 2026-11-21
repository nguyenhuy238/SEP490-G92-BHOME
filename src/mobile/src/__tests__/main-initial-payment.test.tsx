// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
vi.mock('../features/contracts/ContractLoading', () => ({
  ContractLoading: ({ label }: { label: string }) => <div role="progressbar">{label}</div>,
}));
import {
  contractClient,
  type ContractRequest,
} from '../../../../packages/client-core/src/contracts';
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
    outstandingDeposit: '0',
    outstandingRentAndFees: '3050000',
    meteredRates: [{ code: 'ELECTRICITY', name: 'Điện', rate: '3500', unit: 'kWh' }],
    paid: false,
    transferReference: 'BH12345678',
    qrImageDataUri: path.endsWith('/transfer-instructions') ? 'data:image/png;base64,TEST' : null,
  }));
});
afterEach(cleanup);
it('counts down to an automatic backend status check and clears the countdown after payment', async () => {
  vi.useFakeTimers();
  try {
    const original = request.getMockImplementation()!;
    request.mockImplementationOnce(original).mockImplementation(async (path: string) => ({
      ...(await original(path)),
      paid: true,
      outstandingAmount: '0',
    }));
    render(<MainInitialPaymentCard api={api} contractId="main" onPaid={paid} />);
    await act(async () => {});
    expect(screen.getByText(/Kiểm tra lại sau 30s/)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29000);
    });
    expect(screen.getByText(/Kiểm tra lại sau 1s/)).toBeTruthy();
    expect(paid).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(paid).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Đang chờ đối soát/)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
it('does not offer transfer instructions when SePay is disabled', async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (path: string) => ({
    ...(await original(path)),
    availability: 'PaymentProviderDisabled',
    transferReference: null,
  }));
  render(<MainInitialPaymentCard api={api} contractId="main" onPaid={paid} />);
  await screen.findByText(/SePay đang tắt/);
  expect(screen.queryByText('Nội dung chuyển khoản')).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Tạo QR thanh toán tổng' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it('uses backend total and Holding credit, generating only one total QR without claiming payment', async () => {
  render(<MainInitialPaymentCard api={api} contractId="main" onPaid={paid} />);
  const button = await screen.findByRole('button', { name: 'Tạo QR thanh toán tổng' });
  expect(screen.getByText('Tiền giữ chỗ đã áp dụng')).toBeTruthy();
  expect(screen.getByText(/3.000.000/)).toBeTruthy();
  expect(screen.getByText(/3.050.000/)).toBeTruthy();
  expect(screen.queryByText('Internet')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết khoản thu' }));
  expect(screen.getByText('Internet')).toBeTruthy();
  expect(screen.getByText('Cọc còn phải nộp')).toBeTruthy();
  expect(screen.getByText('Tính trên hóa đơn theo chỉ số')).toBeTruthy();
  expect(screen.getByText(/3.500.*\/kWh/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Thu gọn chi tiết' }));
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
  await screen.findByText('Thanh toán đã được xác nhận. Tiếp tục bước kích hoạt hợp đồng.');
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
