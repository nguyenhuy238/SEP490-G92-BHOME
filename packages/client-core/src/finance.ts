import type { ContractRequest } from './contracts';

export interface ExpenseInput {
  locationId: string;
  roomId: string | null;
  expenseType: 'INITIAL_INVESTMENT' | 'OPERATING';
  category: string;
  amount: string;
  occurredOn: string;
  note: string;
  assetId?: string | null;
  taskId?: string | null;
}
export interface Expense extends ExpenseInput {
  id: string;
  version: number;
  canEdit: boolean;
  assetName?: string | null;
  taskTitle?: string | null;
}
export interface ExpenseReference {
  id: string;
  label: string;
  roomId: string | null;
  assetId: string | null;
}
export interface ExpenseReferences {
  rooms: ExpenseReference[];
  assets: ExpenseReference[];
  workOrders: ExpenseReference[];
  truncated: boolean;
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
export interface ExpenseEvidence {
  id: string;
  operationKey: string;
  contentType: string;
  length: number;
  sha256: string;
  status: 'PendingUpload' | 'Uploaded';
  recordedAt: string;
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
  verifiedDepositReturns?: string | null;
  historicalOccupancy?: {
    status: string;
    from: string | null;
    to: string | null;
    occupiedRoomDays: number | null;
    rentableRoomDays: number | null;
    occupancyRate: number | null;
    limitations: string[];
  } | null;
}
export interface ScenarioInput {
  name: string;
  baseline: ReportFilter;
  forecastMonths: number;
  assumptions: {
    monthlyRent: string;
    occupancyPercent: string;
    collectionPercent: string;
    monthlyUtilityServiceCost: string;
    monthlyStaffCost: string;
    monthlyMaintenanceCost: string;
    monthlyOtherCost: string;
  };
}
export interface ScenarioView {
  id: string | null;
  input: ScenarioInput;
  baseline: FinancialReport;
  calculationVersion: string;
  result: {
    monthlyRevenue: string;
    monthlyCollections: string;
    monthlyOperatingExpenses: string;
    monthlyProfit: string;
    monthlyNetCashFlow: string;
    forecastNetCashFlow: string;
    remainingCapitalAtEnd: string | null;
    estimatedRemainingMonths: string | null;
    monthlyProfitDifference: string;
    unavailableReason: string | null;
  };
}
export interface ScenarioSummary {
  id: string;
  name: string;
  locationId: string | null;
  baselineFrom: string;
  baselineTo: string;
  forecastMonths: number;
  calculatedAt: string;
}
export function financeClient(request: ContractRequest) {
  return {
    analyzeScenario: (input: ScenarioInput) =>
      request<ScenarioView>('/api/v1/financial-scenarios/analyze', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    saveScenario: (input: ScenarioInput, key: string) =>
      request<ScenarioView>('/api/v1/financial-scenarios', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(input),
      }),
    scenarios: (page: number, signal?: AbortSignal) =>
      request<ScenarioSummary[]>(`/api/v1/financial-scenarios?page=${page}&pageSize=25`, {
        signal,
      }),
    scenario: (id: string, signal?: AbortSignal) =>
      request<ScenarioView>(`/api/v1/financial-scenarios/${id}`, { signal }),
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
    expenseReferences: (locationId: string, roomId?: string | null, signal?: AbortSignal) =>
      request<ExpenseReferences>(
        `/api/v1/expenses/reference-choices?${new URLSearchParams({ locationId, ...(roomId ? { roomId } : {}) })}`,
        { signal },
      ),
    expenseEvidence: (id: string, signal?: AbortSignal) =>
      request<ExpenseEvidence[]>(`/api/v1/expenses/${id}/evidence`, { signal }),
    uploadExpenseEvidence: (
      id: string,
      bytes: Uint8Array<ArrayBuffer>,
      type: string,
      key: string,
    ) =>
      request<ExpenseEvidence>(`/api/v1/expenses/${id}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': type, 'Idempotency-Key': key },
        body: bytes,
      }),
    expenseEvidenceFile: (id: string, fileId: string, signal?: AbortSignal) =>
      request<Blob>(`/api/v1/expenses/${id}/evidence/${fileId}`, { signal }, 'blob'),
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
  if (status === 413) return 'Ảnh chứng từ vượt quá 5 MB.';
  return 'Không thể tải hoặc lưu dữ liệu tài chính. Vui lòng thử lại.';
}
