// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  contractClient,
  type ContractRequest,
  type ContractView,
} from '../../../../packages/client-core/src/contracts';
import type { HoldingSandboxState } from '../../../../packages/client-core/src/holdingSandbox';
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
vi.mock('../features/contracts/HoldingProgress', () => ({
  HoldingProgress: () => <span>Tiến trình test</span>,
}));
import { HoldingSandboxFlow, useHoldingSandbox } from '../features/contracts/HoldingSandboxFlow';
const request = vi.fn();
const api = contractClient(request as ContractRequest);
const c = {
  id: 'contract',
  roomNumber: 'TEST',
  isDevelopmentDemo: true,
  status: 'Draft',
  approvedAt: '2026-11-13T00:00:00Z',
  startDate: '2026-11-13',
  endDate: '2026-12-13',
} as ContractView;
const changed = vi.fn();
let state: HoldingSandboxState;
function Harness({ contract = c }: { contract?: ContractView }) {
  const sandbox = useHoldingSandbox(api, contract);
  return sandbox.data ? (
    <HoldingSandboxFlow
      contract={contract}
      sandbox={sandbox}
      onChanged={changed}
      onList={vi.fn()}
    />
  ) : (
    <span>Luồng thật</span>
  );
}
beforeEach(() => {
  vi.stubGlobal('__DEV__', true);
  vi.clearAllMocks();
  state = {
    mode: 'Test',
    contractId: 'contract',
    ownerSimulated: false,
    tenantSimulated: false,
    canShowQr: false,
    depositVerified: false,
    required: '3000000',
    verified: '0',
    onHold: false,
    contractStatus: 'Draft',
  };
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/simulation/signatures')) {
      const { participant } = JSON.parse(init!.body as string);
      if (participant === 'Owner') state.ownerSimulated = true;
      else state.tenantSimulated = true;
      state.canShowQr = state.ownerSimulated && state.tenantSimulated;
    } else if (path.endsWith('/transfer-instructions'))
      return {
        mode: 'Test',
        contractId: 'contract',
        availability: 'Available',
        accountHolder: 'SYNTHETIC TEST',
        accountNumber: '0000000001',
        bankIdentifier: '970422',
        outstandingAmount: '3000000',
        transferReference: 'BH12345678',
        qrImageDataUri: 'data:image/png;base64,TEST',
      };
    else if (path.endsWith('/simulation/activate')) {
      if (!state.depositVerified) throw { status: 409 };
      state.onHold = true;
      state.contractStatus = 'Active';
    }
    return structuredClone(state);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('requires both server simulation results before QR and verified deposit before OnHold', async () => {
  render(<Harness />);
  await screen.findByText('Mô phỏng Owner đã ký');
  expect((screen.getByText('Tiếp tục: tạo QR') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Mô phỏng Owner đã ký'));
  await screen.findByText('✓ Owner đã ký (mô phỏng)');
  expect((screen.getByText('Tiếp tục: tạo QR') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Mô phỏng người giữ chỗ đã ký'));
  await screen.findByText('✓ Người giữ chỗ đã ký (mô phỏng)');
  expect(request.mock.calls.some(([path]) => path.endsWith('/transfer-instructions'))).toBe(false);
  fireEvent.click(screen.getByText('Tiếp tục: tạo QR'));
  await screen.findByText('QR tiền giữ chỗ Test Mode');
  expect((screen.getByText('Hoàn tất giữ chỗ (Test Mode)') as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(request.mock.calls.some(([path]) => path.endsWith('/simulation/activate'))).toBe(false);
  state.depositVerified = true;
  state.verified = '3000000';
  fireEvent.click(screen.getByText('Kiểm tra thanh toán'));
  await screen.findByText('Backend đã xác minh đủ tiền cọc.');
  fireEvent.click(screen.getByText('Hoàn tất giữ chỗ (Test Mode)'));
  await screen.findByText('Giữ chỗ thành công · Test Mode');
  expect(changed).toHaveBeenCalledOnce();
  expect(
    request.mock.calls.some(
      ([path]) => path.includes('/owner-confirmation') || path.includes('/signing-invitations'),
    ),
  ).toBe(false);
});
it('does not expose simulation for real contracts or production builds', () => {
  const view = render(<Harness contract={{ ...c, isDevelopmentDemo: false }} />);
  expect(request).not.toHaveBeenCalled();
  vi.stubGlobal('__DEV__', false);
  view.rerender(<Harness />);
  expect(request).not.toHaveBeenCalled();
  expect(screen.queryByText('Mô phỏng Owner đã ký')).toBeNull();
});
it('falls back to real flow when sandbox capability is unavailable', async () => {
  request.mockRejectedValue({ status: 404 });
  render(<Harness />);
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(screen.getByText('Luồng thật')).toBeTruthy();
  expect(screen.queryByText('Mô phỏng Owner đã ký')).toBeNull();
});
it('does not advance when the backend rejects a simulation', async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation((path: string, init?: RequestInit) =>
    path.endsWith('/simulation/signatures')
      ? Promise.reject({ status: 409 })
      : original(path, init),
  );
  render(<Harness />);
  fireEvent.click(await screen.findByText('Mô phỏng Owner đã ký'));
  await waitFor(() =>
    expect((screen.getByText('Mô phỏng Owner đã ký') as HTMLButtonElement).disabled).toBe(false),
  );
  expect((screen.getByText('Tiếp tục: tạo QR') as HTMLButtonElement).disabled).toBe(true);
  expect(state.ownerSimulated).toBe(false);
});
