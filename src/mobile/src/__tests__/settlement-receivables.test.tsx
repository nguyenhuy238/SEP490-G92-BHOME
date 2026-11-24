// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const reload = vi.hoisted(() => vi.fn());
const navigation = vi.hoisted(() => ({ go: vi.fn() }));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => navigation,
}));
vi.mock('react-native', () => ({ Image: () => null }));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  ui: {},
  Action: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: () => ({
    loading: false,
    error: '',
    reload,
    data: {
      total: 1,
      items: [
        {
          contractId: 'historical',
          roomNumber: 'SYN-01',
          availableDeposit: '100000',
          receivables: [
            {
              charge: {
                id: 'charge',
                kind: 'TenantDamage',
                assetId: 'asset',
                description: 'Giường đơn hỏng khung',
                amount: '600000',
              },
              allocated: '400000',
              outstanding: '200000',
              status: 'PartiallyPaid',
            },
          ],
          offsets: [
            {
              id: 'offset',
              receivableId: 'charge',
              amount: '400000',
              reason: 'Owner approved source',
            },
          ],
        },
      ],
    },
  }),
}));
import { TenantSettlementReceivables } from '../screens/TenantSettlementReceivables';
it('shows historical Room debt and verified offsets without treating physical departure as payment', () => {
  render(<TenantSettlementReceivables />);
  expect(screen.getByText('Phòng SYN-01')).toBeTruthy();
  expect(screen.getByText(/Còn nợ: 200.000/)).toBeTruthy();
  expect(screen.getByText('Đã thanh toán một phần')).toBeTruthy();
  expect(screen.getByText('Thiệt hại đã được Owner duyệt')).toBeTruthy();
  expect(screen.getByText('Thiệt hại tài sản')).toBeTruthy();
  expect(screen.getByText('Giường đơn hỏng khung')).toBeTruthy();
  expect(screen.getByText(/Cấn trừ cọc đã duyệt cho khoản này: 400.000/)).toBeTruthy();
  expect(screen.getByText(/Cọc còn khả dụng để đối chiếu: 100.000/)).toBeTruthy();
  expect(screen.getByText(/chưa phải số tiền hoàn/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại khoản phải thu' }));
  expect(reload).toHaveBeenCalledOnce();
  expect(screen.queryByText(/Nội dung chuyển khoản/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết khoản phải thu' }));
  expect(navigation.go).toHaveBeenCalledWith('invoice', {
    view: 'settlement',
    settlementContractId: 'historical',
    settlementChargeId: 'charge',
  });
});
