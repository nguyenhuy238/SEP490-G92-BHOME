import type { FinanceSourceKind } from '../../../../../packages/client-core/src/finance';

export const sourceLabels: Record<FinanceSourceKind, string> = {
  revenue: 'Doanh thu',
  cash: 'Tiền kinh doanh thực thu',
  debt: 'Công nợ hiện tại',
  'period-debt': 'Công nợ thuộc kỳ',
  deposit: 'Tiền cọc nhận',
};
