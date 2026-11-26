import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { FinanceTotals } from '../../../../../packages/client-core/src/finance';
import { BusinessFinanceOverview } from './BusinessFinanceOverview';

const totals: FinanceTotals = {
  issued: '100000000',
  approvedAdjustments: '0',
  verifiedCollections: '96000000',
  operatingExpenses: '30000000',
  operatingProfit: '69000000',
  outstandingNow: '4000000',
  initialInvestment: '0',
  netOperatingCashFlow: null,
  totalRooms: 10,
  occupiedRooms: 8,
  management: {
    revenue: '100000000',
    actualBusinessCollections: '96000000',
    currentOutstanding: '4000000',
    overdueInvoiceOutstanding: '0',
    priorPeriodCollections: '0',
    depositReceipts: '10000000',
    operatingPaymentsConfirmed: '28000000',
    operatingUnpaidConfirmed: '2000000',
    operatingUnknownPaymentAmount: '0',
    operatingCashFlow: '68000000',
    operatingMarginPercent: '69',
    depreciation: '15000000',
    profitAfterDepreciation: '54000000',
    investmentPaymentsConfirmed: '5000000',
    netCashAfterInvestment: '63000000',
    collectionRatePercent: '96',
    expenseCategories: [],
  },
};

it('shows only the main figures without recalculating or adding deposits', () => {
  render(<BusinessFinanceOverview totals={totals} />);
  const summary = within(screen.getByRole('region', { name: 'Tóm tắt kinh doanh' }));
  for (const amount of [
    '100.000.000 ₫',
    '30.000.000 ₫',
    '69.000.000 ₫',
    '96.000.000 ₫',
    '28.000.000 ₫',
    '4.000.000 ₫',
  ]) {
    expect(summary.getByText(amount)).toBeVisible();
  }
  expect(summary.queryByText('70.000.000 ₫')).not.toBeInTheDocument();
  expect(summary.getByText(/Tiền cọc theo dõi riêng/)).toBeVisible();
  expect(summary.queryByText('54.000.000 ₫')).not.toBeInTheDocument();
});

it('keeps unknown cash and depreciation distinct from zero and retains the server explanation', () => {
  render(
    <BusinessFinanceOverview
      totals={{
        ...totals,
        management: {
          ...totals.management!,
          actualBusinessCollections: null,
          operatingPaymentsConfirmed: null,
          currentOutstanding: null,
          cashFlowUnavailableReason: 'expense_payment_history_required',
        },
      }}
    />,
  );
  expect(screen.getAllByText('Chưa xác định')).toHaveLength(3);
  expect(screen.getByRole('alert')).toHaveTextContent('thiếu lịch sử xác nhận chi tiền');
  expect(screen.queryByText('0 ₫')).not.toBeInTheDocument();
});

it('preserves losses and exact large decimal strings supplied by the server', () => {
  render(
    <BusinessFinanceOverview
      totals={{
        ...totals,
        operatingProfit: '-999999999999999999',
        management: {
          ...totals.management!,
          actualBusinessCollections: '-1000000',
          depositReceipts: '0',
        },
      }}
    />,
  );
  expect(screen.getByText('-999.999.999.999.999.999 ₫')).toBeVisible();
  expect(screen.getByText('-1.000.000 ₫')).toBeVisible();
});

it('does not fabricate a management summary for an older server response', () => {
  render(<BusinessFinanceOverview totals={{ ...totals, management: null }} />);
  expect(screen.queryByRole('region', { name: 'Tóm tắt kinh doanh' })).not.toBeInTheDocument();
});
