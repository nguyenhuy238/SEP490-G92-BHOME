// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Invoice } from '../../../../packages/client-core/src/invoices';
import type { TenantMeterReading } from '../../../../packages/client-core/src/tenantReadings';

const navigation = vi.hoisted(() => ({ go: vi.fn() }));
vi.mock('../features/workspace/WorkspaceProvider', () => ({ useWorkspace: () => navigation }));
vi.mock('../theme/theme', () => ({
  colors: {
    navy: '#001637',
    white: '#ffffff',
    muted: '#64748b',
    red: '#ba1a1a',
    ink: '#111b2e',
    amber: '#a86108',
  },
  staffColors: { navy: '#193653', blue: '#2563eb' },
}));
vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(value: T) => value },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => ({
  Text: ({
    children,
    accessibilityLabel,
    accessibilityRole,
  }: {
    children?: React.ReactNode;
    accessibilityLabel?: string;
    accessibilityRole?: string;
  }) => (
    <div aria-label={accessibilityLabel} role={accessibilityRole}>
      {children}
    </div>
  ),
  Icon: () => <span />,
  ActivityIndicator: () => <span>Đang tải</span>,
  Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  TouchableRipple: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    accessibilityLabel?: string;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('../components/TenantMeterReadingEvidence', () => ({
  TenantMeterReadingEvidence: ({ id, label }: { id: string; label: string }) => (
    <span data-testid="verified-meter-photo">
      {label}: {id}
    </span>
  ),
}));

import { TenantDashboard, tenantMonthlyUtility } from '../screens/TenantDashboard';

afterEach(() => {
  cleanup();
  navigation.go.mockReset();
});

const roomId = '11111111-1111-4111-8111-111111111111';
const meterId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const waterId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const room = {
  id: 'active-contract',
  roomId,
  locationId: 'location',
  roomNumber: 'B101',
  locationName: 'Cơ sở Test',
  status: 'Active',
  kind: 'Main',
  startDate: '2026-01-01',
  endDate: '2027-01-01',
  monthlyRent: '3000000',
};
const readings = [
  {
    id: meterId,
    roomId,
    roomNumber: 'B101',
    locationName: 'Cơ sở Test',
    meterCode: 'E-101',
    utilityType: 'Electricity' as const,
    purpose: 'Periodic' as const,
    readingDate: '2026-11-22',
    billingPeriod: '2026-11-01',
    previousValue: '120',
    confirmedValue: '150',
    consumption: '30',
    confirmedAt: '2026-11-22T12:00:00Z',
    status: 'Confirmed' as const,
  },
  {
    id: waterId,
    roomId,
    roomNumber: 'B101',
    locationName: 'Cơ sở Test',
    meterCode: 'W-101',
    utilityType: 'Water' as const,
    purpose: 'Periodic' as const,
    readingDate: '2026-11-22',
    billingPeriod: '2026-11-01',
    previousValue: '14',
    confirmedValue: '17',
    consumption: '3',
    confirmedAt: '2026-11-22T13:00:00Z',
    status: 'Confirmed' as const,
  },
] satisfies TenantMeterReading[];
const invoice = {
  id: 'this-month',
  roomId,
  roomNumber: 'B101',
  locationName: 'Cơ sở Test',
  billingPeriod: '2026-11-01',
  status: 'Final',
  total: '3455000',
  dueDate: '2026-11-30',
  lines: [
    { id: 'rent', category: 'Rent', name: 'Tiền thuê phòng', amount: '3000000' },
    {
      id: 'electricity',
      category: 'Electricity',
      name: 'Tiền điện',
      amount: '105000',
      quantity: '30',
      meterReadingId: meterId,
    },
    {
      id: 'water',
      category: 'Water',
      name: 'Tiền nước',
      amount: '300000',
      quantity: '3',
      meterReadingId: waterId,
    },
    { id: 'service', category: 'ServiceFee', name: 'Internet', amount: '50000' },
  ],
} as unknown as Invoice;
const payment = {
  invoiceId: invoice.id,
  paymentStatus: 'Unpaid' as const,
  paidAmount: '0',
  outstandingAmount: '3455000',
  payableAmount: '3455000',
  dueDate: '2026-11-30',
  overdueDays: 0,
  transferReference: '',
  pendingReview: false,
  history: [],
};

it('puts the genuine current-month invoice, kWh, m³, evidence and service fees first', () => {
  render(
    <TenantDashboard
      month="2026-11"
      contracts={[room]}
      invoice={invoice}
      payment={payment}
      meterReadings={readings}
    />,
  );
  expect(screen.getByText('Phòng B101')).toBeTruthy();
  expect(screen.getByText('Hóa đơn tháng 11/2026')).toBeTruthy();
  expect(screen.getAllByText('3.455.000 ₫')).toHaveLength(2);
  expect(screen.getByText('kWh')).toBeTruthy();
  expect(screen.getByText('m³')).toBeTruthy();
  expect(screen.getByText('Chốt: 150 kWh · Trước: 120 kWh')).toBeTruthy();
  expect(screen.getByText('Chốt: 17 m³ · Trước: 14 m³')).toBeTruthy();
  expect(screen.getAllByTestId('verified-meter-photo')).toHaveLength(2);
  expect(screen.getByText('Internet')).toBeTruthy();
  expect(screen.getByText('50.000 ₫')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Thanh toán hóa đơn' }));
  expect(navigation.go).toHaveBeenCalledWith('invoice', { invoiceId: 'this-month' });
});

it('shows verified consumption without inventing a bill or fees before invoice issuance', () => {
  render(<TenantDashboard month="2026-11" contracts={[room]} meterReadings={readings} />);
  expect(screen.getByText('Chưa có hóa đơn')).toBeTruthy();
  expect(screen.getByText(/Chưa có phí dịch vụ của kỳ này/)).toBeTruthy();
  expect(screen.getAllByTestId('verified-meter-photo')).toHaveLength(2);
  expect(screen.queryByText(/Thanh toán hóa đơn/)).toBeNull();
});

it('shows paid state from verified payment data, not inferred from invoice total', () => {
  render(
    <TenantDashboard
      month="2026-11"
      contracts={[room]}
      invoice={invoice}
      payment={{ ...payment, paymentStatus: 'Paid', paidAmount: '3455000', outstandingAmount: '0' }}
    />,
  );
  expect(screen.getByText('3.455.000 ₫')).toBeTruthy();
  expect(screen.getByText('Đã thanh toán')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Thanh toán hóa đơn' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Xem chi tiết hóa đơn' })).toBeTruthy();
});

it('does not display another period’s debt as the amount of the current invoice', () => {
  render(
    <TenantDashboard
      month="2026-11"
      contracts={[room]}
      invoice={invoice}
      payment={payment}
      debt={{ invoiceId: 'october', outstandingAmount: '120000', overdueDays: 3 } as never}
    />,
  );
  expect(screen.getByText('Hóa đơn tháng 11/2026')).toBeTruthy();
  expect(screen.getByText('Còn hóa đơn kỳ khác cần thanh toán')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Còn hóa đơn kỳ khác/ }));
  expect(navigation.go).toHaveBeenCalledWith('invoice', { invoiceId: 'october' });
});

it('uses only this period and room’s confirmed periodic readings, never missing-as-zero', () => {
  const historical = { ...readings[0], id: 'old', billingPeriod: '2026-10-01', consumption: '40' };
  expect(
    tenantMonthlyUtility('Electricity', '2026-11', roomId, undefined, [historical]),
  ).toMatchObject({
    usage: null,
    evidenceId: null,
  });
  expect(
    tenantMonthlyUtility('Water', '2026-11', roomId, undefined, [
      { ...readings[1], consumption: '0' },
    ]),
  ).toMatchObject({ usage: '0', evidenceId: waterId });
  expect(tenantMonthlyUtility('Electricity', '2026-11', roomId, invoice, readings)).toMatchObject({
    usage: '30',
    evidenceId: meterId,
    billed: '105000',
  });
});
