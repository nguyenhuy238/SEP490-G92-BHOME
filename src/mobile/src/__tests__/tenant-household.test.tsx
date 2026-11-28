// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TenantHouseholdPanel } from '../features/profile/TenantHouseholdPanel';

const s = vi.hoisted(() => ({ request: vi.fn(), id: 'own-contract', select: vi.fn() }));
vi.mock('../lib/SessionProvider', () => ({ useSession: () => ({ api: s }) }));
vi.mock('../features/tenant/room/useTenantTenancy', () => ({
  useTenantTenancy: () => ({
    current: s.id ? { id: s.id } : undefined,
    items: [],
    select: s.select,
  }),
}));
vi.mock('../features/profile/ProfileComponents', () => ({ profileStyles: {} }));
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => ({
  Text: ({
    children,
    accessibilityRole,
  }: {
    children: React.ReactNode;
    accessibilityRole?: string;
  }) => <span role={accessibilityRole}>{children}</span>,
  Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
const data = {
  representativeResidentId: 'representative',
  version: 1,
  representative: {
    fullName: 'ĐẠI DIỆN KIỂM THỬ',
    dateOfBirth: '1990-01-01',
    maskedCitizenNumber: '********0001',
  },
  members: [
    {
      residentId: 'child',
      clientKey: 'child',
      fullName: 'THÀNH VIÊN KIỂM THỬ',
      dateOfBirth: '2015-02-03',
      relationship: 'Con',
      phone: null,
      citizenNumber: null,
    },
  ],
};
beforeEach(() => {
  s.id = 'own-contract';
  s.request.mockReset().mockResolvedValue(data);
});
afterEach(cleanup);
it('loads the own contract household and expands optional member details without requiring an account or CCCD', async () => {
  render(<TenantHouseholdPanel />);
  expect(await screen.findByText('ĐẠI DIỆN KIỂM THỬ · Người đại diện')).toBeTruthy();
  expect(s.request.mock.calls[0][0]).toBe('/api/v1/contracts/own-contract/household');
  expect(screen.getByText('1 thành viên cùng ở · Không tính người đại diện')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'THÀNH VIÊN KIỂM THỬ · Con' }));
  expect(screen.getByText('Ngày sinh: 03/02/2015')).toBeTruthy();
  expect(screen.getByText('CCCD: Chưa cung cấp')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'THÀNH VIÊN KIỂM THỬ · Con' }));
  expect(screen.queryByText('Ngày sinh: 03/02/2015')).toBeNull();
});
it('shows a recoverable error when the backend refuses access and never renders stale household data', async () => {
  s.request.mockRejectedValueOnce(new Error('404'));
  render(<TenantHouseholdPanel />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(/ĐẠI DIỆN KIỂM THỬ/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText(/ĐẠI DIỆN KIỂM THỬ/)).toBeTruthy();
});
it('ignores an old household response after the selected contract changes', async () => {
  let finish!: (value: typeof data) => void;
  s.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<TenantHouseholdPanel />);
  await waitFor(() => expect(s.request).toHaveBeenCalled());
  s.id = 'other-own-contract';
  s.request.mockResolvedValue({ ...data, representative: null, members: [] });
  view.rerender(<TenantHouseholdPanel />);
  expect(await screen.findByText('0 thành viên cùng ở · Không tính người đại diện')).toBeTruthy();
  finish(data);
  await waitFor(() => expect(screen.queryByText(/ĐẠI DIỆN KIỂM THỬ/)).toBeNull());
});
it('does not request a household without an account-scoped active tenancy', () => {
  s.id = '';
  render(<TenantHouseholdPanel />);
  expect(s.request).not.toHaveBeenCalled();
});
