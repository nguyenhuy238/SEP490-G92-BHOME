// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  contractClient,
  type ContractClient,
} from '../../../../packages/client-core/src/contracts';
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
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
}));
vi.mock('../components/WorkflowControls', () => ({
  Input: ({
    label,
    value,
    disabled,
    onChange,
  }: {
    label: string;
    value: string;
    disabled?: boolean;
    onChange: (value: string) => void;
  }) => (
    <input
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock('../features/onboarding/IdentityWizard', () => ({
  IdentityWizard: ({
    residentId,
    mode,
    onConfirmed,
    onDismiss,
    onVerifiedSummary,
  }: {
    residentId: string;
    mode: string;
    onConfirmed: () => void;
    onDismiss: () => void;
    onVerifiedSummary?: (summary: { fullName: string; dateOfBirth: string | null }) => void;
  }) => (
    <div
      role="dialog"
      aria-label={mode === 'verify' ? 'Nhập thủ công CCCD' : 'Quét CCCD'}
      data-resident={residentId}
    >
      <button
        onClick={() => {
          onVerifiedSummary?.({ fullName: 'Tên đã xác minh', dateOfBirth: '1995-05-20' });
          onConfirmed();
        }}
      >
        Xác nhận từ quy trình CCCD
      </button>
      <button onClick={onDismiss}>Đóng nhập thông tin</button>
    </div>
  ),
}));
import { HoldingNewTenant } from '../features/contracts/HoldingNewTenant';
afterEach(cleanup);
function setup(role = 'Staff', create = vi.fn().mockResolvedValue({ id: 'new-resident' })) {
  const api = { createHoldingResident: create } as unknown as ContractClient;
  const created = vi.fn(),
    confirmed = vi.fn(),
    busy = vi.fn();
  render(
    <HoldingNewTenant
      api={api}
      roomId="room"
      role={role}
      onCreated={created}
      onConfirmed={confirmed}
      onBusyChange={busy}
    />,
  );
  return { create, created, confirmed, busy };
}
function fill() {
  fireEvent.change(screen.getByLabelText('Tên người thuê'), {
    target: { value: 'Người thuê mới' },
  });
  fireEvent.change(screen.getByLabelText('Email người thuê'), {
    target: { value: 'new@example.test' },
  });
}
it('creates one real resident before opening manual identity entry and reuses that profile on reopen', async () => {
  const { create, created, confirmed, busy } = setup();
  fill();
  fireEvent.click(screen.getByText('Nhập thông tin CCCD'));
  fireEvent.click(screen.getByText('Nhập thông tin CCCD'));
  const dialog = await screen.findByRole('dialog', { name: 'Nhập thủ công CCCD' });
  expect(dialog.getAttribute('data-resident')).toBe('new-resident');
  expect(create).toHaveBeenCalledExactlyOnceWith('room', 'Người thuê mới', 'new@example.test');
  expect(created).toHaveBeenCalledWith('new-resident', 'Người thuê mới', 'new@example.test');
  expect(confirmed).not.toHaveBeenCalled();
  expect(busy).toHaveBeenCalledWith(true);
  expect(busy).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByText('Đóng nhập thông tin'));
  fireEvent.click(screen.getByText('Mở thông tin CCCD'));
  await screen.findByRole('dialog', { name: 'Nhập thủ công CCCD' });
  expect(create).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText('Xác nhận từ quy trình CCCD'));
  expect(confirmed).toHaveBeenCalledOnce();
});
it('uses the existing OCR entry when Staff selects scan', async () => {
  setup();
  fill();
  fireEvent.click(screen.getByText('Quét CCCD'));
  await screen.findByRole('dialog', { name: 'Quét CCCD' });
});

it('restores a previously created profile when returning from the terms screen without creating it again', async () => {
  const create = vi.fn();
  render(
    <HoldingNewTenant
      api={{ createHoldingResident: create } as unknown as ContractClient}
      role="Staff"
      roomId="room"
      initialResidentId="existing-new-resident"
      initialName="Người thuê đã nhập"
      initialEmail="saved@example.test"
      initialConfirmed
      onCreated={vi.fn()}
      onConfirmed={vi.fn()}
    />,
  );
  expect((screen.getByLabelText('Tên người thuê') as HTMLInputElement).value).toBe(
    'Người thuê đã nhập',
  );
  fireEvent.click(screen.getByText('Mở thông tin CCCD'));
  expect((await screen.findByRole('dialog')).getAttribute('data-resident')).toBe(
    'existing-new-resident',
  );
  expect(create).not.toHaveBeenCalled();
});
it('creates basic information for Owner while keeping Staff-only identity confirmation unavailable', async () => {
  const { created, confirmed } = setup('Owner');
  fill();
  expect(screen.queryByText('Quét CCCD')).toBeNull();
  fireEvent.click(screen.getByText('Lưu thông tin người thuê'));
  await screen.findByText(
    'Hồ sơ đã tạo. Cần Staff xác minh thông tin CCCD trước khi lập hợp đồng.',
  );
  expect(created).toHaveBeenCalledOnce();
  expect(confirmed).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('validates name and email before creating a record', () => {
  const { create } = setup();
  fireEvent.click(screen.getByText('Nhập thông tin CCCD'));
  expect(screen.getByText('Nhập tên người thuê, tối đa 150 ký tự.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Tên người thuê'), { target: { value: 'Tên mới' } });
  fireEvent.click(screen.getByText('Nhập thông tin CCCD'));
  expect(screen.getByText('Nhập email hợp lệ của người thuê.')).toBeTruthy();
  expect(create).not.toHaveBeenCalled();
});
it('blocks creating again after an ambiguous network result', async () => {
  const create = vi.fn().mockRejectedValue({ status: 0 });
  setup('Staff', create);
  fill();
  fireEvent.click(screen.getByText('Nhập thông tin CCCD'));
  await screen.findByText(
    'Chưa xác định hồ sơ đã được lưu hay chưa. Kiểm tra danh sách người ở trước khi tạo lại.',
  );
  expect((screen.getByText('Nhập thông tin CCCD') as HTMLButtonElement).disabled).toBe(true);
  expect(create).toHaveBeenCalledOnce();
});
it('keeps editable input after a confirmed validation rejection', async () => {
  const { create } = setup('Staff', vi.fn().mockRejectedValue({ status: 400 }));
  fill();
  fireEvent.click(screen.getByText('Nhập thông tin CCCD'));
  await waitFor(() =>
    expect((screen.getByText('Nhập thông tin CCCD') as HTMLButtonElement).disabled).toBe(false),
  );
  expect((screen.getByLabelText('Tên người thuê') as HTMLInputElement).value).toBe(
    'Người thuê mới',
  );
  expect(create).toHaveBeenCalledOnce();
});
it('does not expose creation to Tenant', () => {
  const { create } = setup('Tenant');
  expect(screen.queryByLabelText('Tên người thuê')).toBeNull();
  expect(create).not.toHaveBeenCalled();
});
it('maps new tenant fields to the existing ResidentInput without changing the backend DTO', async () => {
  const request = vi.fn().mockResolvedValue({ id: 'resident' });
  await contractClient(request).createHoldingResident('room', ' Tên mới ', ' new@example.test ');
  expect(request).toHaveBeenCalledWith('/api/v1/capture/residents', {
    method: 'POST',
    body: JSON.stringify({
      roomId: 'room',
      displayLabel: 'Tên mới',
      residentType: 0,
      email: 'new@example.test',
    }),
  });
});

it('uses Holding applicant labels and returns only verified name/date for confirmation without account selection', async () => {
  const api = {
    createHoldingResident: vi.fn().mockResolvedValue({ id: 'applicant' }),
  } as unknown as ContractClient;
  const verified = vi.fn();
  render(
    <HoldingNewTenant
      api={api}
      role="Staff"
      roomId="room"
      context="holding"
      onCreated={vi.fn()}
      onConfirmed={vi.fn()}
      onVerifiedSummary={verified}
    />,
  );
  expect(screen.queryByLabelText('Tên người thuê')).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
  fireEvent.change(screen.getByLabelText('Họ và tên *'), { target: { value: 'Tên đăng ký' } });
  fireEvent.change(screen.getByLabelText('Email *'), {
    target: { value: 'applicant@example.test' },
  });
  fireEvent.click(screen.getByText('Nhập thông tin CCCD'));
  await screen.findByRole('dialog', { name: 'Nhập thủ công CCCD' });
  fireEvent.click(screen.getByText('Xác nhận từ quy trình CCCD'));
  expect(verified).toHaveBeenCalledWith({ fullName: 'Tên đã xác minh', dateOfBirth: '1995-05-20' });
  expect((screen.getByLabelText('Họ và tên *') as HTMLInputElement).value).toBe('Tên đã xác minh');
  expect(screen.getByText('Đã xác nhận thông tin người giữ chỗ.')).toBeTruthy();
});
