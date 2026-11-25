import type { ContractRequest } from './contracts';
import { infrastructureError, catalogError } from './api';
import { formatBillingDecimal } from './invoices';

// Financial results can be negative; preserve the server's exact decimal string.
export function formatFinanceMoney(value: string): string {
  const negative = value.startsWith('-');
  const amount = formatBillingDecimal(negative ? value.slice(1) : value);
  return amount === '—' ? '—' : `${negative && amount !== '0' ? '-' : ''}${amount} ₫`;
}

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
  roomId?: string;
  from?: string;
  to?: string;
  expenseType?: string;
  category?: string;
  page?: number;
  includeTotalAmount?: boolean;
}
export interface ExpensePage {
  items: Expense[];
  total: number;
  page: number;
  pageSize: number;
  totalAmount?: string | null;
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
  includeComparison?: boolean;
}
export type FinanceSourceKind = 'revenue' | 'cash' | 'debt' | 'period-debt' | 'deposit';
export interface BankReceiptSourcePage {
  items: {
    id: string;
    receivedAt: string;
    reference: string;
    amount: string;
    allocated: string;
    grossUnallocated: string;
  }[];
  total: number;
  page: number;
  pageSize: number;
  totalReceived: string;
  totalGrossUnallocated: string;
  snapshotAt: string;
}
export interface BankRefundSourcePage {
  items: {
    id: string;
    paymentId: string;
    executedAt: string;
    amount: string;
    reference: string | null;
  }[];
  total: number;
  page: number;
  pageSize: number;
  totalAmount: string;
  snapshotAt: string;
}
export interface FinanceSourcePage {
  items: {
    id: string;
    kind: string;
    locationId: string;
    roomId: string;
    roomNumber: string;
    contractId: string;
    basisDate: string;
    amount: string;
    paymentId: string | null;
    receivedAt: string | null;
    reference: string | null;
    original: string | null;
    adjustments: string | null;
    allocated: string | null;
  }[];
  total: number;
  totalAmount: string;
  page: number;
  pageSize: number;
  snapshotAt: string;
}
export interface FinanceChange {
  current: string;
  previous: string;
  change: string;
  changePercent: string | null;
}
export interface FinanceComparison {
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
  revenue: FinanceChange;
  operatingExpenses: FinanceChange;
  operatingProfit: FinanceChange;
  expenseCategories: (FinanceChange & { category: string })[];
}
export interface ExpensePaymentInput {
  amount: string;
  paidOn: string | null;
  expectedVersion: number;
  note: string;
}
export interface ExpensePaymentView {
  expenseId: string;
  version: number;
  amount: string;
  paidAmount: string | null;
  remainingAmount: string | null;
  status: 'Unknown' | 'Paid' | 'Unpaid' | 'PartiallyPaid';
  events: (Omit<ExpensePaymentInput, 'expectedVersion'> & { key: string; recordedAt: string })[];
  dueOn?: string | null;
  dueStatus?: 'Unknown' | 'Paid' | 'Overdue' | 'DueToday' | 'NotDue';
  dueHistory?: { key: string; recordedAt: string; input: ExpenseDueDateInput }[];
}
export interface ExpenseDueDateInput {
  dueOn: string | null;
  expectedVersion: number;
  note: string;
}
export interface DepreciationInput {
  kind: 'Building' | 'Equipment' | 'Land' | 'NonDepreciable';
  inServiceOn: string;
  usefulLifeMonths: number | null;
  salvageValue: string;
  effectiveFrom: string | null;
  retiredOn: string | null;
  expectedVersion: number;
  note: string;
}
export interface InvestmentDisposalInput {
  disposedOn: string;
  saleAmount: string;
  expectedVersion: number;
  note: string;
  quantity?: number | null;
  recognizeInOpenPeriod?: boolean;
}
export interface InvestmentReceiptInput {
  amount: string;
  receivedOn: string;
  expectedVersion: number;
  note: string;
  disposalKey?: string | null;
}
export interface AssetReplacementReview {
  repairCount: number;
  repairCost: string;
  latestRepairAt: string | null;
  ageMonths: number;
  carryingValue: string | null;
  replacementCost: string | null;
  repairCostPercent: string | null;
  reasons: string[];
}
export interface DepreciationView {
  expenseId: string;
  locationId: string;
  assetId: string | null;
  name: string;
  cost: string;
  quantity: number | null;
  purchasedOn: string;
  version: number;
  revisions: { key: string; effectiveFrom: string; plan: DepreciationInput }[];
  amounts: { period: string; accumulated: string; carryingValue: string; monthly: string } | null;
  disposal?: {
    key: string;
    recordedAt: string;
    input: InvestmentDisposalInput;
    recognizedOn?: string | null;
  } | null;
  receipts?: { key: string; recordedAt: string; input: InvestmentReceiptInput }[] | null;
  disposalReceived?: string | null;
  disposalOutstanding?: string | null;
  remainingQuantity?: number | null;
  partialDisposals?:
    | {
        sale: {
          key: string;
          recordedAt: string;
          input: InvestmentDisposalInput;
          recognizedOn?: string | null;
        };
        received: string;
        outstanding: string;
      }[]
    | null;
}
export interface StaffCostCandidate {
  employmentId: string;
  staffId: string;
  staffName: string;
  startDate: string;
  endDate: string | null;
  salaryType: string | null;
  baseRate: string | null;
  locations: { locationId: string; locationName: string }[];
  recorded: boolean;
}
export interface DepreciationSourcePage {
  items: (Pick<
    DepreciationView,
    | 'expenseId'
    | 'locationId'
    | 'assetId'
    | 'name'
    | 'cost'
    | 'quantity'
    | 'purchasedOn'
    | 'amounts'
    | 'remainingQuantity'
  > & { roomId: string | null })[];
  total: number;
  page: number;
  pageSize: number;
  totalAmount: string | null;
  knownAmount: string;
  unknownLots: number;
  snapshotAt: string;
}
export interface StaffCostInput {
  employmentId: string;
  period: string;
  category: string;
  total: string;
  shares: { locationId: string; amount: string }[];
  note: string;
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
  management?: FinanceManagementTotals | null;
}
export interface FinanceManagementTotals {
  revenue: string | null;
  actualBusinessCollections: string | null;
  currentOutstanding: string | null;
  overdueInvoiceOutstanding: string | null;
  priorPeriodCollections: string | null;
  depositReceipts: string | null;
  initialRentAndFeeCollections?: string | null;
  advanceCollections?: string | null;
  operatingPaymentsConfirmed: string | null;
  operatingUnpaidConfirmed: string | null;
  operatingUnknownPaymentAmount: string | null;
  operatingCashFlow: string | null;
  operatingMarginPercent: string | null;
  depreciation: string | null;
  profitAfterDepreciation: string | null;
  investmentPaymentsConfirmed: string | null;
  netCashAfterInvestment: string | null;
  collectionRatePercent: string | null;
  expenseCategories: { category: string; amount: string | null }[];
  cashFlowUnavailableReason?: string | null;
  periodOutstanding?: string | null;
  investmentInPeriod?: string | null;
  cumulativeOperatingCashFlow?: string | null;
  cashCapital?: FinancialReport['capital'] | null;
  operatingCostPerRoom?: string | null;
  currentOccupancyPercent?: string | null;
  activeMonthlyRentPerRoom?: string | null;
  assetDisposalReceipts?: string | null;
}
export interface FinancialTrendPoint {
  from: string;
  to: string;
  revenue: string;
  operatingExpenses: string;
  operatingProfit: string;
  actualBusinessCollections: string;
  operatingPaymentsConfirmed: string;
  isComplete: boolean;
}
export interface FinancialReport {
  trend?: FinancialTrendPoint[] | null;
  trendUnavailableReason?: string | null;
  receiptReconciliation?: {
    verifiedBankReceipts: string;
    unallocatedAtReview: string;
    excessRefundedInPeriod: string;
  } | null;
  comparison?: FinanceComparison | null;
  settlementSources?: SettlementFinanceSources | null;
  filter: ReportFilter;
  snapshotAt: string;
  total: FinanceTotals;
  locations: {
    locationId: string;
    locationName: string;
    totals: FinanceTotals;
    settlementSources?: SettlementFinanceSources | null;
  }[];
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
export interface SettlementFinanceSources {
  approvedCharges: string;
  outstandingNow: string;
  verifiedBankCollections: string;
  depositOffsetsApplied: string;
  holdingForfeitures: string;
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
    monthlyServiceRevenue?: string;
    additionalInvestment?: string;
    monthlyDepreciation?: string | null;
    operatingPaymentPercent?: string;
    costIncreasePercent?: string;
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
    monthlyProfitAfterDepreciation?: string | null;
    monthlyMarginPercent?: string | null;
    monthlyOperatingPayments?: string | null;
    forecastCashAfterInvestment?: string | null;
    warnings?: string[] | null;
  };
}
export interface ScenarioDefaults {
  obligations?: {
    from: string;
    to: string;
    recurringDue: string;
    contractualSalary: string | null;
    recurringCount: number;
    staffCount: number;
    unresolvedStaffCount: number;
    historicalGeneratedRecurring?: string;
    historicalAllocatedSalary?: string;
    rentCoverage?: {
      rooms: number;
      contractedRooms: number;
      occupiedRoomDays: number;
      possibleRoomDays: number;
      unresolvedRooms: number;
      monthlyRent: string | null;
      occupancyPercent: string | null;
    } | null;
  } | null;
  baseline: ReportFilter;
  snapshotAt: string;
  monthlyRent: string | null;
  occupancyPercent: string | null;
  collectionPercent: string | null;
  monthlyUtilityServiceCost: string | null;
  monthlyStaffCost: string | null;
  monthlyMaintenanceCost: string | null;
  monthlyOtherCost: string | null;
  monthlyDepreciation: string | null;
  monthlyServiceRevenue?: string | null;
  operatingPaymentPercent?: string | null;
  limitations: string[];
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
    scenarioDefaults: (filter: ReportFilter, signal?: AbortSignal) => {
      const query = new URLSearchParams({ from: filter.from, to: filter.to });
      if (filter.locationId) query.set('locationId', filter.locationId);
      return request<ScenarioDefaults>(`/api/v1/financial-scenarios/defaults?${query}`, { signal });
    },
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
        if (value) query.set(key, String(value));
      });
      return request<FinancialReport>(`/api/v1/financial-reports?${query}`, { signal });
    },
    reportSources: (
      filter: ReportFilter,
      kind: FinanceSourceKind,
      page: number,
      signal?: AbortSignal,
    ) => {
      const query = new URLSearchParams({
        from: filter.from,
        to: filter.to,
        kind,
        page: String(page),
      });
      if (filter.locationId) query.set('locationId', filter.locationId);
      if (filter.roomId) query.set('roomId', filter.roomId);
      return request<FinanceSourcePage>(`/api/v1/financial-reports/sources?${query}`, { signal });
    },
    bankReceiptSources: (filter: ReportFilter, page: number, signal?: AbortSignal) => {
      const query = new URLSearchParams({ from: filter.from, to: filter.to, page: String(page) });
      if (filter.locationId) query.set('locationId', filter.locationId);
      if (filter.roomId) query.set('roomId', filter.roomId);
      return request<BankReceiptSourcePage>(
        `/api/v1/financial-reports/bank-receipt-sources?${query}`,
        { signal },
      );
    },
    bankRefundSources: (filter: ReportFilter, page: number, signal?: AbortSignal) => {
      const query = new URLSearchParams({ from: filter.from, to: filter.to, page: String(page) });
      if (filter.locationId) query.set('locationId', filter.locationId);
      if (filter.roomId) query.set('roomId', filter.roomId);
      return request<BankRefundSourcePage>(
        `/api/v1/financial-reports/bank-refund-sources?${query}`,
        { signal },
      );
    },
    bankReceiptRefund: (id: string, signal?: AbortSignal) =>
      request<import('./refunds').RefundSource>(
        `/api/v1/payment-transactions/${encodeURIComponent(id)}/refunds`,
        { signal },
      ),
    depreciationSources: (filter: ReportFilter, page: number, signal?: AbortSignal) => {
      const query = new URLSearchParams({ from: filter.from, to: filter.to, page: String(page) });
      if (filter.locationId) query.set('locationId', filter.locationId);
      if (filter.roomId) query.set('roomId', filter.roomId);
      return request<DepreciationSourcePage>(
        `/api/v1/financial-reports/depreciation-sources?${query}`,
        { signal },
      );
    },
    locations: (signal?: AbortSignal) =>
      request<{ id: string; label: string }[]>('/api/v1/capture/locations', { signal }),
    rooms: (locationId: string, signal?: AbortSignal) =>
      request<{ id: string; label: string }[]>(
        `/api/v1/capture/locations/${encodeURIComponent(locationId)}/rooms`,
        { signal },
      ),
    expenses: (filter: ExpenseFilter, signal?: AbortSignal) => {
      const query = new URLSearchParams();
      Object.entries(filter).forEach(([key, value]) => {
        if (value) query.set(key, String(value));
      });
      return request<ExpensePage>(`/api/v1/expenses?${query}`, { signal });
    },
    expense: (id: string, signal?: AbortSignal) =>
      request<Expense>(`/api/v1/expenses/${id}`, { signal }),
    expensePayments: (id: string, signal?: AbortSignal) =>
      request<ExpensePaymentView>(`/api/v1/expenses/${id}/payments`, { signal }),
    setExpenseDueDate: (id: string, input: ExpenseDueDateInput, key: string) =>
      request<ExpensePaymentView>(`/api/v1/expenses/${id}/payments/due-date`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(input),
      }),
    recordExpensePayment: (id: string, input: ExpensePaymentInput, key: string) =>
      request<ExpensePaymentView>(`/api/v1/expenses/${id}/payments`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(input),
      }),
    depreciation: (id: string, signal?: AbortSignal) =>
      request<DepreciationView>(`/api/v1/depreciation/${id}`, { signal }),
    replacementReview: (id: string, replacementCost: string, signal?: AbortSignal) =>
      request<AssetReplacementReview>(
        `/api/v1/depreciation/${id}/replacement-review?${new URLSearchParams(replacementCost ? { replacementCost } : {})}`,
        { signal },
      ),
    recordDepreciation: (id: string, input: DepreciationInput, key: string) =>
      request<DepreciationView>(`/api/v1/depreciation/${id}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(input),
      }),
    disposeInvestment: (id: string, input: InvestmentDisposalInput, key: string) =>
      request<DepreciationView>(`/api/v1/depreciation/${id}/disposal`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(input),
      }),
    receiveInvestmentDisposal: (id: string, input: InvestmentReceiptInput, key: string) =>
      request<DepreciationView>(`/api/v1/depreciation/${id}/disposal-receipts`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(input),
      }),
    staffCosts: (period: string, signal?: AbortSignal) =>
      request<StaffCostCandidate[]>(`/api/v1/staff-costs?period=${encodeURIComponent(period)}`, {
        signal,
      }),
    recordStaffCost: (input: StaffCostInput, key: string) =>
      request<string[]>('/api/v1/staff-costs', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(input),
      }),
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
  const shared = catalogError(error);
  if (shared) return shared;
  const infrastructure = infrastructureError(error);
  if (infrastructure) return infrastructure;
  if ((error as { code?: string })?.code === 'settlement_report_sources_require_review')
    return 'Nguồn khoản phải thu hoặc phân bổ tiền chưa khớp. Cần Owner đối chiếu trước khi lập báo cáo.';
  if ((error as { code?: string })?.code === 'completed_baseline_required')
    return 'Chọn kỳ nền đã hoàn tất trước ngày hiện tại.';
  const status = (error as { status?: number })?.status;
  if (status === 403) return 'Chỉ Owner được truy cập chức năng tài chính.';
  if (status === 404) return 'Không tìm thấy dữ liệu trong phạm vi cho phép.';
  if (status === 409) return 'Dữ liệu hoặc yêu cầu đã thay đổi. Tải lại để kiểm tra trước khi lưu.';
  if (status === 400)
    return 'Thông tin chưa hợp lệ. Kiểm tra số tiền, ngày và các trường bắt buộc.';
  if (status === 413) return 'Ảnh chứng từ vượt quá 5 MB.';
  return 'Không thể tải hoặc lưu dữ liệu tài chính. Vui lòng thử lại.';
}
