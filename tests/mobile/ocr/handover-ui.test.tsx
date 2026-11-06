// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  contractClient,
  type ContractView,
  type HandoverView,
} from '../../../packages/client-core/src/contracts';
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Checkbox: {
    Item: ({
      label,
      status,
      onPress,
      disabled,
    }: {
      label: string;
      status: string;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <label>
        <input
          type="checkbox"
          checked={status === 'checked'}
          onChange={onPress}
          disabled={disabled}
        />
        {label}
      </label>
    ),
  },
}));
vi.mock('../../../src/mobile/src/components/WorkspaceKit', () => ({
  Action: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title }: { title: string }) => <h1>{title}</h1>,
  ui: {},
}));
vi.mock('../../../src/mobile/src/components/WorkflowControls', () => ({
  Input: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    </label>
  ),
  ChoiceField: () => null,
}));
vi.mock('../../../src/mobile/src/components/CameraCapture', () => ({ CameraCapture: () => null }));
vi.mock('../../../src/mobile/src/features/contracts/ContractEvidence', () => ({
  ContractEvidence: () => null,
}));
import { ContractHandoverPanel } from '../../../src/mobile/src/features/contracts/ContractHandoverPanel';
afterEach(cleanup);
const id = '00000000-0000-0000-0000-000000000001';
const contract = { id, status: 'Active', kind: 'Main' } as ContractView;
const record = (version: number): HandoverView =>
  ({
    version,
    status: 'Draft',
    tenantConfirmedVersion: null,
    tenantConfirmedAt: null,
    staffConfirmedAt: null,
    snapshot: {
      date: '2026-11-06',
      roomNumber: 'SYNTHETIC',
      roomCondition: 'Hiện trạng phiên bản ' + version,
      keysAndAccess: 'Hai chìa khóa',
      notes: '',
      assets: [],
      evidenceIds: [],
      electricity: { id: 'electric', value: '100' },
      water: { id: 'water', value: '200' },
    },
  }) as HandoverView;
function setup() {
  const api = contractClient(vi.fn());
  api.handover = vi.fn().mockResolvedValue(record(1));
  api.handoverHistory = vi.fn().mockResolvedValue([]);
  api.handoverChoices = vi.fn().mockResolvedValue({ assets: [], readings: [], evidence: [] });
  api.mutate = vi.fn().mockRejectedValue({ status: 503 });
  return api;
}
it('requires new consent when the server returns a newer handover version', async () => {
  const api = setup();
  render(<ContractHandoverPanel api={api} contract={contract} role="Tenant" />);
  await screen.findByLabelText('Tôi đã kiểm tra nội dung phiên bản 1');
  fireEvent.click(screen.getByRole('checkbox'));
  expect(
    (screen.getByRole('button', { name: 'Xác nhận nhận phòng' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  vi.mocked(api.handover).mockResolvedValue(record(2));
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại bàn giao' }));
  await screen.findByLabelText('Tôi đã kiểm tra nội dung phiên bản 2');
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect(
    (screen.getByRole('button', { name: 'Xác nhận nhận phòng' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(api.mutate).not.toHaveBeenCalled();
});
it('hides old evidence and consent immediately when changing Contract and the next read fails', async () => {
  const api = setup();
  const view = render(<ContractHandoverPanel api={api} contract={contract} role="Tenant" />);
  await screen.findByText('Phòng SYNTHETIC: Hiện trạng phiên bản 1');
  fireEvent.click(screen.getByRole('checkbox'));
  let reject!: (error: unknown) => void;
  vi.mocked(api.handover).mockImplementationOnce(
    () =>
      new Promise((_, failure) => {
        reject = failure;
      }),
  );
  view.rerender(
    <ContractHandoverPanel
      api={api}
      contract={{ ...contract, id: 'another-contract' }}
      role="Tenant"
    />,
  );
  expect(screen.queryByText('Phòng SYNTHETIC: Hiện trạng phiên bản 1')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Xác nhận nhận phòng' })).toBeNull();
  reject({ status: 403 });
  await screen.findByText(/không có quyền/i);
  expect(api.mutate).not.toHaveBeenCalled();
});
it('does not allow Staff completion until Tenant has confirmed the displayed version', async () => {
  const api = setup();
  render(<ContractHandoverPanel api={api} contract={contract} role="Staff" />);
  await screen.findByRole('button', { name: 'Staff xác nhận hoàn tất bàn giao' });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(
    (screen.getByRole('button', { name: 'Staff xác nhận hoàn tất bàn giao' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  vi.mocked(api.handover).mockResolvedValue({
    ...record(1),
    tenantConfirmedVersion: 1,
    tenantConfirmedAt: '2026-11-06T02:00:00Z',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại bàn giao' }));
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Staff xác nhận hoàn tất bàn giao',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Staff xác nhận hoàn tất bàn giao' }));
  await waitFor(() => expect(api.mutate).toHaveBeenCalledTimes(1));
  expect(api.mutate).toHaveBeenCalledWith(
    id,
    'handover/staff-confirmation',
    { version: 1, note: '' },
    expect.any(String),
  );
  await screen.findByText(/chưa sẵn sàng/);
  expect(screen.queryByText('Đã lưu xác nhận / phản hồi tại máy chủ.')).toBeNull();
});
