import type { ContractRequest } from './contracts';

export interface ExpenseInput {
  locationId: string;
  roomId: string | null;
  expenseType: 'INITIAL_INVESTMENT' | 'OPERATING';
  category: string;
  amount: string;
  occurredOn: string;
  note: string;
}
export interface Expense extends ExpenseInput {
  id: string;
  version: number;
  canEdit: boolean;
}
export interface ExpenseFilter {
  locationId?: string;
  from?: string;
  to?: string;
  expenseType?: string;
  category?: string;
  page?: number;
}
export interface ExpensePage {
  items: Expense[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ReportFilter {
  from: string;
  to: string;
  locationId?: string;
  roomId?: string;
}
export interface FinanceTotals {
  issued: string;
  approvedAdjustments: string;
  verifiedCollections: string;
  operatingExpenses: string;
  operatingProfit: string;
  outstandingNow: string;
  initialInvestment: string;
  netOperatingCashFlow: string | null;
  totalRooms: number;
  occupiedRooms: number;
}
export interface FinancialReport {
  filter: ReportFilter;
  snapshotAt: string;
  total: FinanceTotals;
  locations: { locationId: string; locationName: string; totals: FinanceTotals }[];
  capital: {
    initialInvestment: string;
    netRecovery: string | null;
    remainingCapital: string | null;
    recoveryPercent: string | null;
    estimatedRemainingMonths: string | null;
    unavailableReason: string | null;
  };
  hasUnclassifiedRefunds: boolean;
}
export function financeClient(request: ContractRequest) {
  return {
    report: (filter: ReportFilter, signal?: AbortSignal) => {
      const query = new URLSearchParams();
      Object.entries(filter).forEach(([key, value]) => {
        if (value) query.set(key, value);
      });
      return request<FinancialReport>(`/api/v1/financial-reports?${query}`, { signal });
    },
    locations: (signal?: AbortSignal) =>
      request<{ id: string; label: string }[]>('/api/v1/capture/locations', { signal }),
    expenses: (filter: ExpenseFilter, signal?: AbortSignal) => {
      const query = new URLSearchParams();
      Object.entries(filter).forEach(([key, value]) => {
        if (value) query.set(key, String(value));
      });
      return request<ExpensePage>(`/api/v1/expenses?${query}`, { signal });
    },
    expense: (id: string, signal?: AbortSignal) =>
      request<Expense>(`/api/v1/expenses/${id}`, { signal }),
    createExpense: (input: ExpenseInput, key: string) =>
      request<Expense>('/api/v1/expenses', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(input),
      }),
    updateExpense: (id: string, expense: ExpenseInput, expectedVersion: number, reason: string) =>
      request<Expense>(`/api/v1/expenses/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ expense, expectedVersion, reason }),
      }),
  };
}
export function financeError(error: unknown) {
  const status = (error as { status?: number })?.status;
  if (status === 403) return 'Chỉ Owner được truy cập chức năng tài chính.';
  if (status === 404) return 'Không tìm thấy dữ liệu trong phạm vi cho phép.';
  if (status === 409) return 'Dữ liệu hoặc yêu cầu đã thay đổi. Tải lại để kiểm tra trước khi lưu.';
  if (status === 400)
    return 'Thông tin chưa hợp lệ. Kiểm tra số tiền, ngày và các trường bắt buộc.';
  return 'Không thể tải hoặc lưu dữ liệu tài chính. Vui lòng thử lại.';
}
