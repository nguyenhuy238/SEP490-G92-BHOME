// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ContractClient, ContractView } from '../../../../packages/client-core/src/contracts';
import { HoldingMainStart } from '../features/contracts/holding/HoldingMainStart';
vi.mock('../lib/randomUUID', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    disabled,
    onPress,
  }: {
    children: React.ReactNode;
    disabled: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ui: { red: {} },
}));
vi.mock('../components/WorkflowControls', () => ({
  Input: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
  }) => (
    <input
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
  ChoiceField: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: { id: string; label: string }[];
    onChange: (id: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" />
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));
afterEach(cleanup);
function setup(
  overrides: Partial<ContractView> = {},
  securityDeposit: string | null = '3000000',
  preparationFails = false,
) {
  const holding = {
    id: 'holding',
    kind: 'Holding',
    roomId: 'room',
    roomNumber: '101',
    startDate: '2026-11-18',
    requiredDeposit: '2300000',
    residentIds: ['existing-resident'],
    representativeResidentId: 'existing-resident',
    holdingExpiresAt: '2099-01-01T00:00:00Z',
    convertedMainContractId: null,
    ...overrides,
  };
  const list = vi
    .fn()
    .mockResolvedValue({ items: [holding], page: 1, pageSize: 20, totalCount: 1 });
  const get = vi.fn().mockResolvedValue(holding);
  const mutate = vi.fn().mockResolvedValue({ id: 'main' });
  const transport = vi.fn().mockResolvedValue({
    securityDeposit,
    residents: [
      {
        id: 'existing-resident',
        fullName: 'Synthetic Tenant',
        maskedCitizenNumber: '********0001',
      },
    ],
  });
  const converted = vi.fn();
  if (preparationFails) transport.mockRejectedValueOnce(new Error('Không tải được hồ sơ'));
  render(
    <HoldingMainStart
      api={{ list, get, mutate, transport } as unknown as ContractClient}
      roomId="room"
      locationId="location"
      onConverted={converted}
    />,
  );
  return { list, get, mutate, transport, converted };
}
it('uses the selected Holding resident and confirmed CCCD without creating another resident, and converts once', async () => {
  const r = setup();
  await screen.findByText(/Synthetic Tenant · CCCD \*+0001 · Đã xác minh/);
  expect(screen.getByRole('option', { name: 'Synthetic Tenant · 101' })).toBeTruthy();
  expect(r.transport.mock.calls[0][0]).toContain('representativeResidentId=existing-resident');
  expect(r.transport.mock.calls.every(([path]) => !path.includes('/capture/residents'))).toBe(true);
  const button = screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng chính thức' });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(r.converted).toHaveBeenCalledWith('main'));
  expect(r.mutate).toHaveBeenCalledOnce();
  expect(r.mutate).toHaveBeenCalledWith(
    'holding',
    'holding-conversion',
    { requireInitialPayment: true },
    expect.any(String),
  );
});
it('explains a profile loading failure and allows retry before conversion', async () => {
  const r = setup({}, '3000000', true);
  const retry = await screen.findByRole('button', { name: 'Tải lại hợp đồng' });
  expect(
    (screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng chính thức' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(r.mutate).not.toHaveBeenCalled();
  fireEvent.click(retry);
  await screen.findByRole('option', { name: 'Synthetic Tenant · 101' });
  expect(
    (screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng chính thức' }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});
it.each([null, '0', '99000000'])(
  'inherits the persisted Holding deposit independently of Owner default %s',
  async (defaultDeposit) => {
    const r = setup({}, defaultDeposit);
    await screen.findByText(/Synthetic Tenant · CCCD/);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(/Tiền cọc đảm bảo: 2.300.000/)).toBeTruthy();
    expect(screen.queryByText(/Chưa có tiền cọc mặc định/)).toBeNull();
    const button = screen.getByRole('button', { name: 'Tiếp tục tạo hợp đồng chính thức' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(r.converted).toHaveBeenCalledWith('main'));
    expect(r.mutate).toHaveBeenCalledWith(
      'holding',
      'holding-conversion',
      { requireInitialPayment: true },
      expect.any(String),
    );
  },
);
it.each([{ kind: 'Main' }, { roomId: 'other-room' }, { holdingExpiresAt: '2000-01-01' }])(
  'does not convert an ineligible source %j',
  async (overrides) => {
    const r = setup(overrides);
    await screen.findByText(/Không có hợp đồng giữ chỗ còn hiệu lực/);
    expect(
      (
        screen.getByRole('button', {
          name: 'Tiếp tục tạo hợp đồng chính thức',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(r.transport).not.toHaveBeenCalled();
    expect(r.mutate).not.toHaveBeenCalled();
  },
);
