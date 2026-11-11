// D011/D012 REST contract. Amounts remain decimal strings throughout the clients.
import { ApiError, requestDiagnostic } from './api';
import { groupVietnameseIntegerDigits } from './localization';
export const contractStates = [
  'Draft',
  'PendingSigning',
  'PendingActivation',
  'Active',
  'Terminated',
  'Superseded',
  'Cancelled',
  'Expired',
  'Converted',
  'Applied',
] as const;
export interface ContractSummary {
  onboardingDraft?: boolean;
  id: string;
  roomId: string;
  locationId: string;
  locationName: string;
  roomNumber: string;
  kind: string;
  status: string;
  startDate: string;
  endDate: string;
  monthlyRent: string;
}
export interface ContractPage {
  items: ContractSummary[];
  page: number;
  pageSize: number;
  totalCount: number;
}
export interface Signature {
  id: string;
  signerUserId: string;
  status: string;
  signedAt: string | null;
}
export interface ContractView {
  onboardingDraft?: boolean;
  id: string;
  roomId: string;
  kind: string;
  status: string;
  startDate: string;
  endDate: string;
  monthlyRent: string;
  requiredDeposit: string;
  terms: string;
  previousContractId: string | null;
  residentIds: string[];
  signatures: Signature[];
  activatedAt: string | null;
  actualEndDate?: string | null;
  ownerSignerId: string;
  tenantUserId: string | null;
  representativeResidentId: string;
  holdingContractId: string | null;
  appliedHoldingDeposit: string;
  isDevelopmentDemo?: boolean;
  roomNumber?: string;
  locationName?: string;
  occupants?: { id: string; label: string; representative: boolean }[] | null;
  holdingExpiresAt?: string | null;
  approvedAt?: string | null;
  priceLockedAt?: string | null;
  convertedMainContractId?: string | null;
  reservedCapacity?: number | null;
  locationId: string;
  signingMode?: string;
  snapshotHash?: string;
}
export interface ContractTemplate {
  id: string;
  version: number;
  title: string;
  notice: string;
  available: boolean;
  developmentOnly: boolean;
  blocker: string | null;
  fields: string[];
}
export interface ContractConfiguration {
  template: ContractTemplate;
  signingMode: string;
  holdingBlocker: string;
  settlementBlocker: string;
}
export interface Preparation {
  locations: NamedOption[];
  rooms: (NamedOption & { locationId: string; status: string })[];
  residents: (NamedOption & {
    roomId: string;
    tenantUserId: string | null;
    verified: boolean;
    residentType?: string;
  })[];
  ownerSigners: NamedOption[];
}
export interface PreviewDocument {
  id: string;
  contractId: string;
  kind: string;
  snapshotHash: string;
  templateId: string | null;
  templateVersion: number | null;
  developmentOnly: boolean;
  recordedAt: string;
}
export interface ContractAudit {
  action: string;
  actorId: string | null;
  occurredAt: string;
}
export interface DepositVerification {
  id: string;
  bankTransactionReference: string;
  amount: string;
  verificationReason: string;
  verifiedByUserId: string;
  verifiedAt: string;
}
export interface Readiness {
  ready: boolean;
  verifiedDeposit: string;
  remainingDeposit: string;
  blockers: string[];
}
export interface HandoverAsset {
  id: string;
  name: string;
  inventoryCondition: string;
  observedCondition: string;
}
export interface HandoverReading {
  id: string;
  meterCode: string;
  utilityType: number;
  date: string;
  value: string;
  evidenceId: string;
  evidenceHash: string;
}
export interface HandoverSnapshot {
  date: string;
  roomNumber: string;
  roomCondition: string;
  keysAndAccess: string;
  notes: string;
  assets: HandoverAsset[];
  electricity: HandoverReading;
  water: HandoverReading;
  evidenceIds: string[];
}
export interface HandoverView {
  version: number;
  status: string;
  snapshot: HandoverSnapshot;
  tenantConfirmedVersion: number | null;
  tenantConfirmedAt: string | null;
  staffConfirmedAt: string | null;
}
export interface HandoverHistory {
  version: number;
  action: string;
  actorId: string;
  occurredAt: string;
  note: string;
  snapshot: HandoverSnapshot;
}
export interface HandoverChoices {
  assets: HandoverAsset[];
  readings: HandoverReading[];
  evidence: PreviewDocument[];
}
export interface MoveOut {
  id: string;
  status: string;
  proposedDate: string;
  reason: string;
  inspectionScheduledAt: string | null;
  pendingReason: string;
  inspectionNotes: string | null;
  inspectedAt: string | null;
  electricityReadingId: string | null;
  waterReadingId: string | null;
  evidenceIds: string[];
  inspectionStaffId?: string | null;
  version?: number;
  ownerConfirmedInspection?: boolean;
  financialReviewStatus?: 'PendingReview' | 'OwnerReviewed';
}
export interface ContractExpiryNotice {
  id: string;
  contractId: string;
  roomNumber: string;
  locationName: string;
  endDate: string;
  stage: string;
  createdAt: string;
}
export interface FinalInspection {
  id: string;
  version: number;
  baselineContractId: string;
  baselineVersion: number;
  baseline: HandoverSnapshot;
  observed: HandoverSnapshot;
  staffId: string;
  inspectedAt: string;
  ownerDecision: string | null;
  ownerReason: string | null;
  reviewedAt: string | null;
}
export interface InspectionPreparation {
  baseline: HandoverView | null;
  baselineContractId: string | null;
  finalReadings: HandoverReading[];
  otherTenantsRemain: boolean;
}
export interface SettlementSummary {
  approvedDepositOffsets?: string;
  chargeReview?: SettlementChargeReview | null;
  receivables?: SettlementReceivableBalance[] | null;
  obligationReference?: string;
  depositDeductions?: DepositDeductionPlan | null;
  financialReference?: string;
  calculation?: {
    issuedTotal: string;
    approvedAdjustmentTotal: string;
    payableTotal: string;
    verifiedInvoicePayments: string;
    roomOutstanding: string;
    contractSpecificOutstanding: string | null;
    potentialInvoiceExcess: string;
    depositAllocated: string | null;
    depositRefunded: string | null;
    depositReserved: string | null;
    availableSecurityDeposit: string | null;
    depositPositionConsistent: boolean;
  } | null;
  contractId: string;
  depositContractId: string;
  roomNumber: string;
  verifiedSecurityDeposit: string;
  appliedHoldingDeposit: string;
  contractSpecificOutstanding: string | null;
  approvedFinalCharges: string | null;
  approvedDeductions: string | null;
  refundAmount: string | null;
  invoices: {
    invoiceId: string;
    billingPeriod: string;
    shared: boolean;
    financials: {
      originalIssuedAmount: string;
      approvedAdjustmentTotal: string;
      effectivePayableAmount: string;
      allocatedPayments: string;
      outstandingAmount: string;
      potentialExcessAmount: string;
    };
  }[];
  unresolvedItems: string[];
  otherActiveContracts: boolean;
  resolved: boolean;
  reference: string;
  transferVerificationStatus: string;
}
export interface HoldingDepositStatus {
  contractId: string;
  status: string;
  required: string;
  verified: string;
  remaining: string;
  requiresManualReview: boolean;
  priceLockedAt: string | null;
  priceLockTrigger: string | null;
  disposition?: {
    cause: string;
    status: string;
    forfeitedAmount: string;
    refundRequired: string;
    refunded: string;
    reserved: string;
    financialReference: string;
  } | null;
}
export interface SettlementChargeReview {
  id: string;
  contractId: string;
  sourceReference: string;
  chargeIds: string[];
  reason: string;
  approvedAt: string;
}
export interface SettlementChargeReviewPreview {
  reference: string;
  review: SettlementChargeReview | null;
  isCurrent: boolean;
  missingInputs: string[];
}
export interface DepositDeductionItem {
  assetId: string | null;
  reasonCode: 'TenantDamage';
  amount: string;
  description: string;
  evidenceIds: string[];
}
export interface SettlementReceivable {
  fixedCharge?: FixedChargeSource | null;
  utility?: {
    meterId: string;
    utilityType: string;
    billingPeriod: string;
    baseline: BillableMeterPoint;
    final: BillableMeterPoint;
    alreadyBilledQuantity: string;
    quantity: string;
    cumulativePricingSnapshot: string;
    pricePolicyId?: string | null;
    pricePolicyVersion?: number | null;
  } | null;
  id: string;
  contractId: string;
  roomId: string;
  kind: string;
  sourceKey: string;
  inspectionId: string;
  inspectionVersion: number;
  assetId: string | null;
  amount: string;
  description: string;
  calculationPolicy: string;
  evidence: { id: string; length: number; sha256: string }[];
  approvedAt: string;
}
export interface FixedChargeSource {
  policyCalculatedAmount?: string | null;
  approvedReduction?: string;
  approvedAdjustmentIds?: string[] | null;
  billingPeriod: string;
  chargeCode: string;
  category: string;
  rate: string;
  partialMonth: number;
  rounding: number;
  occupiedDays: number;
  periodDays: number;
  cumulativePricedAmount: string;
  alreadyPricedAmount: string;
}
export interface FinalFixedChargePreview {
  chargeCode: string;
  name: string;
  billingPeriod: string;
  reference: string;
  amount: string | null;
  calculation: FixedChargeSource | null;
  existingReceivableId: string | null;
  missingInputs: string[];
}
export interface SettlementReceivableBalance {
  charge: SettlementReceivable;
  allocated: string;
  outstanding: string;
  status: 'Unpaid' | 'PartiallyPaid' | 'Paid';
}
export interface DepositOffsetApproval {
  id: string;
  receivableId: string | null;
  invoiceId: string | null;
  sourceDepositContractId: string;
  amount: string;
  reason: string;
  approvedAt: string;
  allocationId: string;
}
export interface SettlementReceivables {
  payers?: { userId: string; displayLabel: string }[] | null;
  invoices?:
    | {
        id: string;
        billingPeriod: string;
        payable: string;
        allocated: string;
        outstanding: string;
      }[]
    | null;
  contractId: string;
  roomId: string;
  roomNumber: string;
  reference: string;
  availableDeposit: string;
  receivables: SettlementReceivableBalance[];
  offsets: DepositOffsetApproval[];
}
export interface DamageChargeInput {
  expectedReference: string;
  inspectionId: string;
  inspectionVersion: number;
  assetId: string | null;
  amount: string;
  description: string;
  evidenceIds: string[];
  humanConfirmed: boolean;
}
export interface DepositOffsetInput {
  expectedReference: string;
  receivableId: string | null;
  invoiceId: string | null;
  amount: string;
  reason: string;
  humanConfirmed: boolean;
}
export interface SettlementTransferInstructions {
  availability: string;
  bankIdentifier: string | null;
  accountNumber: string | null;
  accountHolder: string | null;
  outstandingAmount: string;
  transferReference: string;
  qrImageDataUri: string | null;
  isDevelopmentDemo: boolean;
}
export interface BillableMeterPoint {
  readingId: string;
  evidenceId: string;
  date: string;
  value: string;
  sourceKind: string;
  sourceId: string;
}
export interface FinalUtilityPreview {
  pricePolicyId?: string | null;
  pricePolicyVersion?: number | null;
  contractId: string;
  utilityType: 'Electricity' | 'Water';
  billingPeriod: string;
  reference: string;
  baseline: BillableMeterPoint | null;
  final: BillableMeterPoint | null;
  alreadyBilledQuantity: string;
  quantity: string | null;
  amount: string | null;
  calculationSnapshot: string;
  existingReceivableId: string | null;
  missingInputs: string[];
}
export interface SettlementBankResult {
  transferId: string;
  status: string;
  reason: string;
  allocatedAmount: string;
  unallocatedAmount: string;
}
export interface DepositDeductionPlan {
  id: string;
  contractId: string;
  depositContractId: string;
  inspectionId: string;
  inspectionVersion: number;
  version: number;
  approvedByUserId: string;
  approvedAt: string;
  reason: string;
  obligationReference: string;
  total: string;
  items: DepositDeductionItem[];
  evidence: { id: string; length: number; sha256: string }[];
  isDevelopmentDemo: boolean;
}
export interface SettlementReview {
  id: string;
  decision: string;
  settled: boolean;
  reviewedAt: string;
  reviewedByUserId: string;
}
export interface Certificate {
  id: string;
  provider: string;
  providerUserIdHint: string;
  serialNumber: string;
  subject: string;
  validFrom: string;
  validTo: string;
  locked: boolean;
  usable: boolean;
}
export interface NamedOption {
  id: string;
  label: string;
  parentId?: string;
}
export interface FinalMeterTask {
  id: string;
  contractId: string | null;
  confirmedReadingId: string | null;
  purpose: number;
  utilityType: number;
  status: number;
  readingDate: string;
  meterCode: string;
}
export interface ResidentOption {
  id: string;
  roomId: string;
  displayLabel: string;
  verificationStatus: number;
}
export type ContractRequest = <T>(
  path: string,
  init?: RequestInit,
  responseType?: 'json' | 'blob' | 'bytes',
) => Promise<T>;
const root = '/api/v1/contracts';
const certificates = '/api/v1/digital-signing/certificates';
export function contractClient(request: ContractRequest) {
  return {
    /** The authenticated transport, so related clients (digital signing) share auth and refresh. */
    transport: request,
    expiryReminders: (signal?: AbortSignal) =>
      request<ContractExpiryNotice[]>(`${root}/expiry-reminders`, { signal }),
    inspections: (id: string, signal?: AbortSignal) =>
      request<FinalInspection[]>(`${root}/${id}/move-out/inspections`, { signal }),
    inspectionPreparation: (id: string, signal?: AbortSignal) =>
      request<InspectionPreparation>(`${root}/${id}/move-out/inspection-preparation`, { signal }),
    settlementSummary: (id: string, signal?: AbortSignal) =>
      request<SettlementSummary>(`${root}/${id}/move-out/settlement-summary`, { signal }),
    settlementReceivables: (id: string, signal?: AbortSignal) =>
      request<SettlementReceivables>(`${root}/${id}/move-out/receivables`, { signal }),
    settlementChargeReview: (id: string, signal?: AbortSignal) =>
      request<SettlementChargeReviewPreview>(`${root}/${id}/move-out/receivables/charge-review`, {
        signal,
      }),
    approveSettlementChargeReview: (
      id: string,
      body: { expectedReference: string; reason: string; allChargesConfirmed: boolean },
      key: string,
    ) =>
      request<SettlementChargeReview>(`${root}/${id}/move-out/receivables/charge-review`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      }),
    finalUtilities: (id: string, signal?: AbortSignal) =>
      request<FinalUtilityPreview[]>(`${root}/${id}/move-out/receivables/final-utilities`, {
        signal,
      }),
    finalFixedCharges: (id: string, signal?: AbortSignal) =>
      request<FinalFixedChargePreview[]>(`${root}/${id}/move-out/receivables/final-fixed-charges`, {
        signal,
      }),
    approveFinalFixedCharge: (
      id: string,
      body: {
        chargeCode: string;
        expectedReference: string;
        policyAppliesToSignedTermsConfirmed: boolean;
      },
      key: string,
    ) =>
      request<SettlementReceivable>(`${root}/${id}/move-out/receivables/final-fixed-charges`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      }),
    approveFinalUtility: (
      id: string,
      body: { utilityType: number; expectedReference: string; humanConfirmed: boolean },
      key: string,
    ) =>
      request<SettlementReceivable>(`${root}/${id}/move-out/receivables/final-utilities`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      }),
    settlementTransferInstructions: (id: string, chargeId: string, signal?: AbortSignal) =>
      request<SettlementTransferInstructions>(
        `${root}/${id}/move-out/receivables/${chargeId}/transfer-instructions`,
        { signal },
      ),
    allocateSettlementBank: (
      id: string,
      chargeId: string,
      body: {
        expectedReference: string;
        transferId: string;
        paidByUserId: string | null;
        humanConfirmed: boolean;
      },
      key: string,
    ) =>
      request<SettlementBankResult>(
        `${root}/${id}/move-out/receivables/${chargeId}/bank-allocations`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': key },
          body: JSON.stringify(body),
        },
      ),
    approveDamageCharge: (id: string, body: DamageChargeInput, key: string) =>
      request<SettlementReceivable>(`${root}/${id}/move-out/receivables/damage`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      }),
    approveDepositOffset: (id: string, body: DepositOffsetInput, key: string) =>
      request<DepositOffsetApproval>(`${root}/${id}/move-out/receivables/deposit-offsets`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      }),
    approveDepositDeductions: (
      id: string,
      body: {
        expectedVersion: number;
        expectedReference: string;
        reason: string;
        humanConfirmed: boolean;
        items: DepositDeductionItem[];
      },
      key: string,
    ) =>
      request<DepositDeductionPlan>(`${root}/${id}/deposit-deductions`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      }),
    moveOutHistory: (id: string, signal?: AbortSignal) =>
      request<{ version: number; action: string; occurredAt: string }[]>(
        `${root}/${id}/move-out/history`,
        { signal },
      ),
    moveOutAssignments: (signal?: AbortSignal) =>
      request<
        {
          contractId: string;
          roomNumber: string;
          locationName: string;
          scheduledAt: string;
          status: string;
        }[]
      >(`${root}/move-out-assignments`, { signal }),
    inspectionStaff: async (locationId: string, signal?: AbortSignal) => {
      const [staff, assignments] = await Promise.all([
        request<NamedOption[]>('/api/v1/capture/staff', { signal }),
        request<{ staffUserId: string; startDate: string; endDate: string }[]>(
          `/api/v1/staff-location-assignments?locationId=${guid(locationId)}`,
          { signal },
        ),
      ]);
      const today = businessToday();
      return staff.filter((s) =>
        assignments.some(
          (a) => a.staffUserId === s.id && a.startDate <= today && a.endDate >= today,
        ),
      );
    },
    versions: (id: string, signal?: AbortSignal) =>
      request<
        {
          id: string;
          previousContractId: string | null;
          kind: string;
          status: string;
          startDate: string;
          endDate: string;
          monthlyRent: string | null;
          terms: string;
        }[]
      >(`${root}/${id}/versions`, { signal }),
    list: async (page = 1, status = '', locationId = '', signal?: AbortSignal) => {
      const result = await request<ContractPage>(
        `${root}?${new URLSearchParams({ page: String(page), pageSize: '20', ...(status ? { status } : {}), ...(locationId ? { locationId } : {}) })}`,
        { signal },
      );
      if (
        !result ||
        !Array.isArray(result.items) ||
        !Number.isSafeInteger(result.totalCount) ||
        result.totalCount < result.items.length ||
        result.page !== page ||
        result.pageSize !== 20 ||
        result.items.some(
          (item) =>
            !item ||
            typeof item.id !== 'string' ||
            typeof item.roomNumber !== 'string' ||
            typeof item.locationName !== 'string' ||
            typeof item.status !== 'string' ||
            typeof item.startDate !== 'string' ||
            typeof item.endDate !== 'string' ||
            typeof item.monthlyRent !== 'string',
        )
      )
        throw new ApiError(502, { code: 'invalid_response' });
      return result;
    },
    configuration: (signal?: AbortSignal) =>
      request<ContractConfiguration>(root + '/configuration', { signal }),
    handover: (id: string, signal?: AbortSignal) =>
      request<HandoverView>(root + '/' + id + '/handover', { signal }),
    handoverHistory: (id: string, signal?: AbortSignal) =>
      request<HandoverHistory[]>(root + '/' + id + '/handover/history', { signal }),
    handoverChoices: (id: string, signal?: AbortSignal) =>
      request<HandoverChoices>(root + '/' + id + '/handover/choices', { signal }),
    handoverEvidence: (id: string, fileId: string, signal?: AbortSignal) =>
      request<Blob>(root + '/' + id + '/handover/evidence/' + fileId, { signal }, 'blob'),
    handoverEvidenceBytes: (id: string, fileId: string, signal?: AbortSignal) =>
      request<Uint8Array>(root + '/' + id + '/handover/evidence/' + fileId, { signal }, 'bytes'),
    handoverMeterEvidence: (id: string, readingId: string, signal?: AbortSignal) =>
      request<Blob>(root + '/' + id + '/handover/meter-evidence/' + readingId, { signal }, 'blob'),
    handoverMeterEvidenceBytes: (id: string, readingId: string, signal?: AbortSignal) =>
      request<Uint8Array>(
        root + '/' + id + '/handover/meter-evidence/' + readingId,
        { signal },
        'bytes',
      ),
    uploadHandover: (id: string, bytes: BodyInit, contentType: string) =>
      request<{ id: string }>(root + '/' + id + '/handover/evidence', {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: bytes,
      }),
    preparation: (locationId = '', signal?: AbortSignal) =>
      request<Preparation>(
        root + '/preparation' + (locationId ? '?locationId=' + locationId : ''),
        { signal },
      ),
    tenantAccounts: (signal?: AbortSignal) =>
      request<NamedOption[]>(root + '/preparation/accounts', { signal }),
    linkTenant: (residentId: string, tenantUserId: string) =>
      request<void>(root + '/preparation/residents/' + residentId + '/account', {
        method: 'POST',
        body: JSON.stringify({ tenantUserId }),
      }),
    previews: (id: string, signal?: AbortSignal) =>
      request<PreviewDocument[]>(root + '/' + id + '/previews', { signal }),
    preview: (id: string, fileId: string, signal?: AbortSignal) =>
      request<Blob>(
        root + '/' + id + '/previews/' + fileId,
        { signal, headers: { Accept: 'application/pdf' } },
        'blob',
      ),
    previewBytes: (id: string, fileId: string, signal?: AbortSignal) =>
      request<Uint8Array>(
        root + '/' + id + '/previews/' + fileId,
        { signal, headers: { Accept: 'application/pdf' } },
        'bytes',
      ),
    audit: (id: string, signal?: AbortSignal) =>
      request<ContractAudit[]>(root + '/' + id + '/history', { signal }),
    deposits: (id: string, signal?: AbortSignal) =>
      request<DepositVerification[]>(root + '/' + id + '/deposit-verifications', { signal }),
    get: (id: string, signal?: AbortSignal) => request<ContractView>(`${root}/${id}`, { signal }),
    readiness: (id: string, signal?: AbortSignal) =>
      request<Readiness>(`${root}/${id}/activation-readiness`, { signal }),
    moveOut: (id: string, signal?: AbortSignal) =>
      request<MoveOut>(`${root}/${id}/move-out`, { signal }),
    history: (id: string, signal?: AbortSignal) =>
      request<SettlementReview[]>(`${root}/${id}/move-out/settlement-history`, { signal }),
    certificates: (signal?: AbortSignal) => request<Certificate[]>(certificates, { signal }),
    declareCertificate: (providerUserId: string, serialNumber: string) =>
      request<Certificate>(certificates, {
        method: 'POST',
        body: JSON.stringify({ providerUserId, serialNumber: serialNumber || null }),
      }),
    lockCertificate: (id: string, locked: boolean) =>
      request<void>(`${certificates}/${guid(id)}/lock`, {
        method: 'POST',
        body: JSON.stringify({ locked }),
      }),
    locations: (signal?: AbortSignal) =>
      request<NamedOption[]>('/api/v1/capture/locations', { signal }),
    rooms: (locationId: string, signal?: AbortSignal) =>
      request<NamedOption[]>(`/api/v1/capture/locations/${locationId}/rooms`, { signal }),
    residents: (locationId: string, signal?: AbortSignal) =>
      request<ResidentOption[]>(`/api/v1/capture/locations/${locationId}/residents`, { signal }),
    meters: (locationId: string, signal?: AbortSignal) =>
      request<NamedOption[]>(`/api/v1/capture/locations/${locationId}/meters`, { signal }),
    finalTask: (contractId: string, meterId: string, readingDate: string) =>
      request<{ id: string }>('/api/v1/capture/meter-tasks', {
        method: 'POST',
        body: JSON.stringify({ contractId, meterId, readingDate, purpose: 2, billingPeriod: null }),
      }),
    meterTasks: (signal?: AbortSignal) =>
      request<FinalMeterTask[]>('/api/v1/capture/meter-tasks', { signal }),
    mutate: <T>(id: string | null, operation: string, body: unknown, key: string) =>
      request<T>(root + (id ? `/${id}/${operation}` : ''), {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    document: (id: string, signal?: AbortSignal) =>
      request<Blob>(
        `${root}/${id}/document`,
        { signal, headers: { Accept: 'application/pdf' } },
        'blob',
      ),
    evidence: (id: string, evidenceId: string, signal?: AbortSignal) =>
      request<Blob>(
        `${root}/${id}/move-out/evidence/${evidenceId}`,
        { signal, headers: { Accept: 'application/octet-stream' } },
        'blob',
      ),
    documentBytes: (id: string, signal?: AbortSignal) =>
      request<Uint8Array>(
        `${root}/${id}/document`,
        { signal, headers: { Accept: 'application/pdf' } },
        'bytes',
      ),
    evidenceBytes: (id: string, evidenceId: string, signal?: AbortSignal) =>
      request<Uint8Array>(
        `${root}/${id}/move-out/evidence/${evidenceId}`,
        { signal, headers: { Accept: 'application/octet-stream' } },
        'bytes',
      ),
    upload: (id: string, bytes: BodyInit, contentType: string) =>
      request<{ id: string }>(`${root}/${id}/move-out/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: bytes,
      }),
  };
}
export type ContractClient = ReturnType<typeof contractClient>;
export function certificateStatus(certificate: Certificate, now = Date.now()) {
  if (certificate.locked) return 'Đã khóa';
  const from = Date.parse(certificate.validFrom),
    to = Date.parse(certificate.validTo);
  if (Number.isFinite(to) && to <= now) return 'Đã hết hạn';
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > now || !certificate.usable)
    return 'Chưa dùng được';
  return 'Có thể dùng';
}
export const canUseCertificate = (certificate: Certificate) =>
  certificateStatus(certificate) === 'Có thể dùng';
export const labels: Record<string, string> = {
  Main: 'Hợp đồng thuê',
  Renewal: 'Gia hạn',
  Draft: 'Bản nháp',
  PendingSigning: 'Chờ ký',
  PendingActivation: 'Chờ kích hoạt',
  Expired: 'Đã hết hạn',
  Converted: 'Đã chuyển sang hợp đồng thuê',
  Applied: 'Đã áp dụng',
  holding_owner_approval_required: 'Cần Owner phê duyệt hợp đồng giữ chỗ.',
  holding_deposit_insufficient: 'Cọc giữ chỗ đã xác minh chưa đủ.',
  holding_expired: 'Hợp đồng giữ chỗ đã hết hạn.',
  HoldingDraftCreated: 'Lập bản nháp giữ chỗ',
  HoldingApproved: 'Owner phê duyệt giữ chỗ',
  HoldingActivated: 'Kích hoạt giữ chỗ',
  HoldingCancelled: 'Hủy giữ chỗ',
  HoldingConverted: 'Chuyển sang hợp đồng thuê chính',
  Active: 'Đang hiệu lực',
  Terminated: 'Đã kết thúc',
  Superseded: 'Đã thay thế',
  Cancelled: 'Đã hủy',
  Prepared: 'Đã chuẩn bị ký',
  Dispatching: 'Đang gửi yêu cầu ký',
  Pending: 'Chờ nhà cung cấp xác nhận',
  Signed: 'Đã xác minh chữ ký',
  Simulated: 'SIMULATED SIGNING — không có giá trị pháp lý',
  Confirmed: 'Đã xác nhận bàn giao',
  Disputed: 'Cần sửa nội dung bàn giao',
  Recorded: 'Ghi nhận phiên bản bàn giao',
  TenantConfirmed: 'Tenant xác nhận nhận phòng',
  ContractDraftCreated: 'Lập bản nháp hợp đồng',
  ContractPreviewGenerated: 'Tạo tài liệu xem trước',
  ContractSigningInitiated: 'Bắt đầu quy trình ký',
  ContractSigningPrepared: 'Chuẩn bị tài liệu ký',
  ContractSigningDispatching: 'Gửi yêu cầu ký',
  ContractSigningRequested: 'Đã gửi yêu cầu ký',
  ContractSignatureSimulated: 'Mô phỏng thao tác ký (Development)',
  ContractSignatureVerified: 'Xác minh chữ ký điện tử',
  ContractDepositVerified: 'Owner xác minh cọc',
  ContractActivated: 'Owner kích hoạt hợp đồng',
  ContractRenewalPrepared: 'Lập bản gia hạn chờ ký',
  ContractRenewalCancelled: 'Hủy bản gia hạn đang chờ',
  ContractSigningNeedsReview: 'Cần kiểm tra yêu cầu ký tại nhà cung cấp',
  ContractSigningFailed: 'Nhà cung cấp báo ký thất bại',
  ContractSigningReferenceRecovered: 'Khôi phục tham chiếu yêu cầu ký',
  ContractMoveOutRequested: 'Gửi yêu cầu trả phòng',
  ContractMoveOutApproved: 'Owner duyệt yêu cầu trả phòng',
  ContractInspectionScheduled: 'Đặt lịch kiểm tra trả phòng',
  ContractMoveOutInspected: 'Lưu biên bản kiểm tra trả phòng',
  ContractSettlementReviewed: 'Owner ghi nhận xem xét quyết toán',
  ContractTerminationCompleted: 'Hoàn tất chấm dứt hợp đồng',
  ContractInspectionEvidenceAdded: 'Tải ảnh kiểm tra trả phòng',
  ContractHandoverRecorded: 'Ghi nhận phiên bản bàn giao',
  ContractHandoverDisputed: 'Tenant yêu cầu sửa bàn giao',
  ContractHandoverTenantConfirmed: 'Tenant xác nhận bàn giao',
  ContractHandoverCompleted: 'Staff hoàn tất bàn giao',
  ContractHandoverEvidenceAdded: 'Tải ảnh nhận phòng',
  handover_version_changed:
    'Biên bản đã thay đổi. Tải lại và kiểm tra phiên bản mới trước khi xác nhận.',
  handover_correction_required: 'Staff cần lưu nội dung đã sửa trước khi Tenant xác nhận lại.',
  tenant_handover_confirmation_required:
    'Cần Tenant xác nhận đúng phiên bản hiện tại trước khi Staff hoàn tất.',
  confirmed_handover_readings_required:
    'Cần đủ chỉ số điện và nước đã xác nhận, kèm ảnh, đúng phòng và ngày bàn giao.',
  handover_already_confirmed: 'Biên bản đã hoàn tất; nội dung và bằng chứng được giữ nguyên.',
  invalid_handover_input:
    'Kiểm tra ngày bàn giao, hiện trạng, chìa khóa, tài sản và từ 1 đến 5 ảnh.',
  handover_evidence_integrity_failed:
    'Bằng chứng bàn giao không còn khớp bản đã lưu. Cần kiểm tra tại máy chủ.',
  resident_account_already_linked:
    'Hồ sơ đã liên kết tài khoản khác hoặc có lịch sử hợp đồng khác. Không thể liên kết lại.',
  development_demo_disabled:
    'Hợp đồng demo chỉ có thể xử lý trong Development/Testing đã bật mô phỏng.',
  signing_mode_mismatch: 'Chế độ ký của hợp đồng không khớp cấu hình máy chủ.',
  tenant_account_link_required:
    'Owner cần liên kết tài khoản Tenant với hồ sơ đại diện đã xác minh.',
  tenant_account_mismatch: 'Tài khoản Tenant không khớp người đại diện.',
  holding_policy_and_verified_allocation_required:
    'Giữ phòng / chuyển cọc: chờ chính sách OQ-03 và sổ phân bổ cọc đã xác minh.',
  Failed: 'Ký thất bại',
  ManualReview: 'Cần kiểm tra tại nhà cung cấp',
  Requested: 'Chờ Owner duyệt',
  Approved: 'Đã duyệt trả phòng',
  Inspected: 'Đã kiểm tra',
  PendingSettlement: 'Chờ quyết toán',
  Settled: 'Đã xác minh quyết toán',
  Completed: 'Đã hoàn tất',
  contract_not_pending_activation: 'Hợp đồng chưa ở bước chờ kích hoạt.',
  location_not_active: 'Location chưa hoạt động.',
  room_not_available: 'Phòng chưa sẵn sàng.',
  signed_terms_changed: 'Nội dung hợp đồng không khớp bản đã đưa đi ký.',
  contract_template_not_configured:
    'Chưa có mẫu PDF hợp đồng được phê duyệt. Liên hệ Owner để hoàn tất cấu hình trước khi ký.',
  signing_certificate_not_valid:
    'Chứng thư đã bị khóa hoặc không còn hiệu lực. Tải lại chứng thư trước khi ký.',
  signing_certificate_no_longer_available:
    'Nhà cung cấp không còn trả về chứng thư đã chọn. Hãy kiểm tra và khai báo lại chứng thư của bạn.',
  contract_not_in_effective_period: 'Chưa đến hoặc đã qua kỳ hiệu lực.',
  verified_signature_evidence_required: 'Cần đủ bằng chứng ký đã xác minh của Owner và Tenant.',
  internal_acceptance_evidence_required:
    'Cần chấp thuận đúng PDF bằng OTP của người đại diện và xác nhận của Owner.',
  resident_email_required: 'Mỗi người ở cần có email riêng trước khi kích hoạt.',
  verified_residents_with_email_required:
    'Cần xác minh hồ sơ và email riêng hợp lệ cho tất cả người ở.',
  internal_signing_flow_required: 'Hợp đồng này dùng lời mời ký nội bộ qua OTP.',
  signing_otp_key_not_configured: 'Dịch vụ xác nhận OTP chưa được cấu hình.',
  verified_residents_required: 'Cần xác minh tất cả người ở và người đại diện.',
  invalid_contract_signers: 'Tài khoản bên ký chưa hợp lệ.',
  security_deposit_insufficient: 'Tiền cọc đã xác minh chưa đủ.',
  room_contract_conflict: 'Phòng có hợp đồng đang xung đột.',
  financial_ledger_and_deposit_policy:
    'Chờ đối chiếu nghĩa vụ, cọc và giao dịch thực tế; trạng thái bàn giao được theo dõi riêng.',
  contract_not_ready_for_activation:
    'Chưa đủ điều kiện kích hoạt. Hãy tải lại điều kiện từ máy chủ.',
  bank_transaction_already_allocated: 'Giao dịch ngân hàng đã được phân bổ. Hãy kiểm tra sao kê.',
  idempotency_key_reused: 'Nội dung thao tác đã thay đổi. Hãy tải lại và kiểm tra.',
  contract_concurrent_or_duplicate_operation: 'Có thao tác trùng hoặc đồng thời. Hãy tải lại.',
  renewal_already_pending: 'Đã có bản gia hạn đang chờ.',
  contract_not_renewable: 'Hợp đồng chưa thể gia hạn hoặc đang có yêu cầu trả phòng.',
  confirmed_final_readings_required:
    'Cần chỉ số điện và nước chốt đã xác nhận, đúng hợp đồng và ngày kiểm tra.',
  move_out_not_ready_for_inspection:
    'Cần duyệt yêu cầu, đặt lịch và đến ngày trả phòng trước khi lập biên bản.',
  settlement_unresolved: 'Nghĩa vụ quyết toán chưa hoàn tất hoặc đã thay đổi.',
  deposit_deduction_review_changed:
    'Số liệu hoặc phiên bản quyết định đã đổi. Tải lại và xem xét trước khi duyệt.',
  deposit_deduction_not_ready: 'Chưa đủ điều kiện khấu trừ hoặc đã có khoản hoàn giữ chỗ/hoàn tất.',
  settlement_receivables_replace_legacy_deductions:
    'Luồng khấu trừ cũ chỉ đọc. Ghi thiệt hại thành khoản phải thu rồi duyệt cấn trừ cọc riêng.',
  deposit_deduction_exceeds_available:
    'Tổng khấu trừ vượt cọc còn khả dụng. Cần xử lý phần nghĩa vụ còn thiếu.',
  invalid_deposit_deduction_item:
    'Kiểm tra loại thiệt hại, số tiền nguyên và ảnh đúng biên bản/phạm vi.',
  duplicate_deposit_deduction: 'Mỗi phòng hoặc tài sản chỉ được ghi một khoản trong quyết định.',
  deposit_deduction_idempotency_conflict:
    'Mã quyết định đã dùng với nội dung khác. Hãy tải lại để kiểm tra.',
  deduction_evidence_integrity_failed:
    'Chứng từ thiệt hại không khớp bản đã duyệt. Cần Owner đối chiếu lại.',
  settlement_review_changed:
    'Số liệu quyết toán đã thay đổi. Tải lại để đối chiếu và xác nhận phiên bản mới.',
  final_utility_inputs_required:
    'Còn thiếu mốc đã tính tiền, chỉ số chốt, ảnh hoặc chính sách giá hợp lệ. Bổ sung rồi xem lại trước khi duyệt.',
  settlement_source_already_charged:
    'Nguồn thiệt hại này đã có khoản phải thu được duyệt. Kiểm tra sổ hiện có để tránh tính hai lần.',
  settlement_idempotency_conflict:
    'Mã thao tác đã được dùng với nội dung khác. Kiểm tra kết quả trước khi tạo quyết định mới.',
  settlement_charge_not_ready:
    'Cần biên bản đã được Owner duyệt và nhóm người thuê đủ điều kiện trước khi ghi nhận khoản phải thu.',
  settlement_evidence_integrity_failed:
    'Ảnh nguồn không còn khớp với bản đã duyệt. Cần đối chiếu lại trước khi ghi giảm nợ.',
  deposit_offset_not_available:
    'Cọc còn dùng không đủ hoặc đang có khoản giữ cho hoàn tiền. Tải lại số dư để kiểm tra.',
  deposit_offset_target_invalid:
    'Khoản đích hoặc số tiền cấn trừ không còn hợp lệ. Tải lại số dư nghĩa vụ.',
  payer_not_settlement_recipient:
    'Tài khoản người trả chưa thuộc nhóm người thuê của khoản phải thu. Kiểm tra lại người thực chuyển tiền.',
  move_out_version_changed: 'Lịch / biên bản đã thay đổi. Tải lại trước khi thực hiện.',
  inspection_changed_or_reviewed:
    'Biên bản đã thay đổi hoặc đã được xem xét. Tải lại phiên bản hiện tại.',
  move_out_not_settled: 'Chưa thể đóng hợp đồng: kiểm tra quyết toán và ngày biên bản.',
  move_out_handover_required: 'Cần biên bản đã kiểm tra và ngày bàn giao thực tế hợp lệ.',
  owner_confirmed_inspection_required:
    'Owner cần duyệt biên bản kiểm tra và chỉ số chốt trước khi bàn giao.',
  inspection_snapshot_invalid: 'Biên bản hoặc chỉ số chốt đã thay đổi; cần kiểm tra lại.',
  signer_already_requested: 'Đã có yêu cầu ký. Hãy kiểm tra trạng thái trước khi thử lại.',
  previous_signature_pending: 'Bên ký trước chưa hoàn tất. Hãy chờ xác minh.',
  inspection_evidence_not_available: 'Ảnh không thuộc người lập biên bản hoặc đã được sử dụng.',
  inspection_upload_not_allowed: 'Chưa được tải ảnh hoặc đã đủ 5 ảnh.',
  invalid_contract_period_or_residents: 'Kiểm tra kỳ thuê, người đại diện và danh sách người ở.',
};
export const text = (value: string) =>
  labels[value] ?? 'Trạng thái hoặc điều kiện cần kiểm tra với Owner';
export function contractError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError')
    return 'Đã dừng chờ phản hồi. Hãy tải lại trước khi thử lại.';
  const e = error as {
    status?: number;
    code?: string;
    requestPath?: string;
    correlationId?: string;
    method?: string;
    problem?: { code?: string };
  } | null;
  const code = e?.code ?? e?.problem?.code;
  const diagnostic = e ? requestDiagnostic(e) : '';
  if (code === 'request_timeout')
    return (
      'Máy chủ không phản hồi trong 15 giây. Hãy tải lại để kiểm tra trước khi gửi lại.' +
      diagnostic
    );
  if (code === 'invalid_response')
    return (
      'Phản hồi máy chủ không đúng định dạng BHOME. Hãy kiểm tra địa chỉ API và phiên bản ứng dụng.' +
      diagnostic
    );
  if (code && labels[code]) return labels[code] + diagnostic;
  return (
    ((
      {
        0: 'Không kết nối được máy chủ. Kết quả thao tác chưa được xác nhận. Hãy tải lại trước khi thử lại.',
        400: 'Dữ liệu chưa hợp lệ. Kiểm tra các trường và ngày thực hiện.',
        401: 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.',
        403: 'Bạn không có quyền thực hiện thao tác này.',
        404: 'Hợp đồng hoặc tài nguyên không khả dụng trong phạm vi của bạn.',
        409: 'Dữ liệu đã thay đổi hoặc chưa đủ điều kiện. Hãy tải lại trước khi thử lại.',
        413: 'Ảnh vượt quá 5 MB.',
        500: 'Máy chủ gặp lỗi xử lý. Hãy tải lại và cung cấp mã truy vết nếu lỗi tiếp diễn.',
        502: 'Phản hồi máy chủ không hợp lệ. Hãy kiểm tra địa chỉ API.',
        503: 'Dịch vụ ký hoặc thành phần xử lý chưa sẵn sàng. Hãy kiểm tra trạng thái trước khi thử lại.',
      } as Record<number, string>
    )[e?.status ?? 0] ?? 'Chưa xác nhận thành công. Hãy tải lại để kiểm tra.') + diagnostic
  );
}
export function formatContractMoney(value: string) {
  if (!/^\d+$/.test(value)) return '—';
  return groupVietnameseIntegerDigits(value) + '\u00a0₫';
}
export function dateOnly(value: string): string {
  const iso = /^\d{2}\/\d{2}\/\d{4}$/.test(value) ? value.split('/').reverse().join('-') : value;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
    iso.startsWith('0000-') ||
    !Number.isFinite(Date.parse(iso)) ||
    new Date(iso + 'T00:00:00Z').toISOString().slice(0, 10) !== iso
  )
    throw new Error('Ngày không hợp lệ. Nhập dd/MM/yyyy.');
  return iso;
}
export const displayContractDate = (value: string) => value.split('-').reverse().join('/');
export function businessToday() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day']
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join('-');
}
export function localSchedule(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error('Nhập lịch theo yyyy-MM-ddTHH:mm, giờ Việt Nam.');
  dateOnly(value.slice(0, 10));
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14)) > 59)
    throw new Error('Giờ không hợp lệ.');
  const instant = new Date(value + ':00+07:00');
  if (instant.getTime() < Date.now()) throw new Error('Lịch kiểm tra không được trong quá khứ.');
  return instant.toISOString();
}
export function vnd(value: string, positive = false) {
  if (!/^(0|[1-9]\d{0,17})$/.test(value) || (positive && value === '0'))
    throw new Error('Nhập số nguyên VND hợp lệ, tối đa 18 chữ số.');
  return value;
}
export function guid(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ||
    /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)
  )
    throw new Error('Mã định danh phải là UUID hợp lệ.');
  return value;
}
export function required(value: string, max: number) {
  if (!value.trim() || value.trim().length > max)
    throw new Error(`Nội dung bắt buộc, tối đa ${max} ký tự.`);
  return value.trim();
}
export interface ActionField {
  name: string;
  label: string;
  type?: 'date' | 'money' | 'multiline' | 'schedule' | 'certificate';
  max?: number;
}
export interface ContractAction {
  operation: string;
  label: string;
  fields: ActionField[];
  warning: string;
}
const action = (
  operation: string,
  label: string,
  fields: ActionField[] = [],
  warning = 'Máy chủ sẽ kiểm tra lại quyền và điều kiện trước khi lưu.',
): ContractAction => ({ operation, label, fields, warning });
const proposedFields: ActionField[] = [
  { name: 'proposedDate', label: 'Ngày dự kiến trả phòng', type: 'date' },
  { name: 'reason', label: 'Lý do', type: 'multiline', max: 2000 },
];
export function contractActions(
  c: ContractView,
  m: MoveOut | null,
  role: string,
  actorId: string,
): ContractAction[] {
  if (c.onboardingDraft) return [];
  const owner = role === 'Owner',
    staff = role === 'Staff',
    tenant = role === 'Tenant' && c.tenantUserId === actorId;
  const signer = (owner || tenant) && (c.ownerSignerId === actorId || c.tenantUserId === actorId);
  const active = c.status === 'Active',
    waiting = ['Draft', 'PendingSigning', 'PendingActivation'].includes(c.status);
  const mine = c.signatures.filter((s) => s.signerUserId === actorId);
  const open = c.signatures.some((s) => !['Signed', 'Simulated', 'Failed'].includes(s.status));
  const result: ContractAction[] = [];
  if (
    signer &&
    c.signingMode !== 'INTERNAL_OTP_DRAWN' &&
    (c.kind !== 'Holding' || !!c.approvedAt) &&
    ['Draft', 'PendingSigning'].includes(c.status) &&
    !mine.some((s) => s.status !== 'Failed') &&
    !open
  )
    result.push(
      action(
        'signing',
        c.isDevelopmentDemo ? 'Mô phỏng ký (Development)' : 'Yêu cầu ký MySign',
        c.isDevelopmentDemo
          ? []
          : [{ name: 'certificateId', label: 'Chứng thư của bạn', type: 'certificate' }],
        c.isDevelopmentDemo
          ? 'SIMULATED SIGNING: chỉ thử nghiệm, không phải chữ ký điện tử có giá trị pháp lý.'
          : 'Hãy đọc kỹ điều khoản. Xác nhận ký trên ứng dụng của nhà cung cấp. Gửi yêu cầu chưa đồng nghĩa đã ký hoặc kích hoạt.',
      ),
    );
  if (signer && mine.some((s) => s.status === 'Pending'))
    result.push(action('signing/sync', 'Kiểm tra kết quả ký'));
  if (signer && mine.some((s) => ['Dispatching', 'ManualReview'].includes(s.status)))
    result.push(
      action(
        'signing/recover',
        'Khôi phục tham chiếu ký',
        [
          {
            name: 'providerReference',
            label: 'Mã giao dịch đã kiểm tra tại nhà cung cấp',
            max: 200,
          },
        ],
        'Chỉ nhập mã đã đối chiếu với nhà cung cấp. Sau khôi phục vẫn phải kiểm tra kết quả ký.',
      ),
    );
  if (owner && waiting && c.kind !== 'Holding')
    result.push(
      action(
        'activate',
        'Kích hoạt hợp đồng',
        [],
        'Chỉ kích hoạt khi đủ chữ ký, cọc, người ở và kỳ hiệu lực. Phòng chuyển sang đang thuê sau khi máy chủ xác nhận.',
      ),
    );
  if (
    owner &&
    !c.previousContractId &&
    !['Terminated', 'Superseded', 'Cancelled'].includes(c.status)
  )
    result.push(
      action(
        'deposit-verifications',
        'Xác minh cọc ngân hàng',
        [
          { name: 'bankTransactionReference', label: 'Mã giao dịch trên sao kê', max: 150 },
          { name: 'amount', label: 'Số tiền cọc đã nhận (VND)', type: 'money' },
          {
            name: 'verificationReason',
            label: 'Căn cứ đối chiếu sao kê',
            type: 'multiline',
            max: 2000,
          },
        ],
        'Chỉ xác minh giao dịch đã đối chiếu sao kê ngân hàng. Ảnh chuyển khoản riêng lẻ chưa đủ chứng minh tiền đã về.',
      ),
    );
  if (c.kind === 'Holding') {
    const expired = !!c.holdingExpiresAt && Date.parse(c.holdingExpiresAt) <= Date.now();
    if (owner && c.status === 'Draft' && !c.approvedAt && !expired)
      result.push(
        action(
          'holding-approval',
          'Phê duyệt hợp đồng giữ chỗ',
          [{ name: 'reason', label: 'Căn cứ phê duyệt', type: 'multiline', max: 2000 }],
          'Kiểm tra phòng, thời hạn, giá và tiền giữ chỗ trước khi phê duyệt. Phê duyệt chưa đồng nghĩa phòng đã được giữ.',
        ),
      );
    if (owner && waiting && c.approvedAt && !expired)
      result.push(
        action(
          'holding-activation',
          'Kích hoạt giữ chỗ',
          [],
          'Chỉ kích hoạt sau khi máy chủ xác nhận đủ phê duyệt, chữ ký, tiền giữ chỗ và phòng hợp lệ.',
        ),
      );
    if (owner && ['Draft', 'PendingSigning', 'PendingActivation', 'Active'].includes(c.status))
      result.push(
        action(
          'holding-cancellation',
          'Hủy hợp đồng giữ chỗ',
          [{ name: 'reason', label: 'Lý do hủy', type: 'multiline', max: 2000 }],
          'Chọn rõ nguyên nhân: Tenant tự hủy thì mất cọc; Owner không cung cấp được phòng phải hoàn bên ngoài và ghi nhận bằng chứng thực chi. Lịch sử được giữ lại.',
        ),
      );
    if ((owner || staff) && active && !expired && !c.convertedMainContractId)
      result.push(
        action(
          'holding-conversion',
          'Chuyển sang hợp đồng thuê chính',
          [
            {
              name: 'requiredSecurityDeposit',
              label: 'Tiền cọc thuê yêu cầu (VND)',
              type: 'money',
            },
          ],
          'Tạo bản nháp hợp đồng thuê chính và áp dụng tiền giữ chỗ đã xác minh; chưa tự kích hoạt hợp đồng thuê.',
        ),
      );
    return result;
  }
  if ((owner || staff) && active && !m)
    result.push(
      action(
        'renewals',
        'Chuẩn bị gia hạn',
        [
          { name: 'endDate', label: 'Ngày hết hạn mới', type: 'date' },
          { name: 'monthlyRent', label: 'Tiền thuê kỳ mới (VND)', type: 'money' },
          { name: 'terms', label: 'Điều khoản gia hạn', type: 'multiline', max: 12000 },
        ],
        'Tạo phiên bản mới để hai bên ký. Hợp đồng hiện tại giữ nguyên đến khi Owner kích hoạt bản gia hạn.',
      ),
    );
  if (owner && c.kind === 'Renewal' && waiting)
    result.push(
      action(
        'renewal-cancellation',
        'Hủy bản gia hạn',
        [],
        'Hủy bản gia hạn đang chờ; giữ nguyên hợp đồng gốc và lịch sử.',
      ),
    );
  if (active && !m && tenant)
    result.push(
      action(
        'termination-requests',
        'Yêu cầu chấm dứt trước hạn',
        proposedFields,
        'Owner cần duyệt yêu cầu. Gửi yêu cầu chưa kết thúc hợp đồng hoặc giải phóng phòng.',
      ),
    );
  if (active && !m && owner && c.kind !== 'Holding')
    result.push(action('expiry-move-out', 'Lập yêu cầu trả phòng khi hết hạn', proposedFields));
  if (owner && m?.status === 'Requested')
    result.push(action('move-out/approve', 'Duyệt yêu cầu trả phòng'));
  if ((owner || staff) && m?.status === 'Approved')
    result.push(
      action('move-out/schedule', 'Đặt lịch kiểm tra', [
        { name: 'scheduledAt', label: 'Lịch kiểm tra (giờ Việt Nam)', type: 'schedule' },
      ]),
    );
  if (staff && m?.status === 'Approved' && m.inspectionScheduledAt)
    result.push(
      action(
        'move-out/inspection',
        'Lưu biên bản trả phòng',
        [
          { name: 'electricityReadingId', label: 'Mã chỉ số điện chốt đã xác nhận' },
          { name: 'waterReadingId', label: 'Mã chỉ số nước chốt đã xác nhận' },
          {
            name: 'notes',
            label: 'Hiện trạng phòng, tài sản, chìa khóa',
            type: 'multiline',
            max: 4000,
          },
        ],
        'Cần đến ngày trả phòng, đủ ảnh hiện trạng và chỉ số chốt đúng hợp đồng/ngày kiểm tra.',
      ),
    );
  if (owner && m && ['Inspected', 'PendingSettlement', 'Settled', 'Completed'].includes(m.status))
    result.push(
      action(
        'move-out/settlement',
        'Ghi nhận xem xét quyết toán',
        [
          {
            name: 'decision',
            label: 'Quyết định và căn cứ của Owner',
            type: 'multiline',
            max: 2000,
          },
        ],
        'Lưu quyết định vào lịch sử. Chỉ đánh dấu đã quyết toán khi máy chủ đối chiếu đầy đủ nghĩa vụ, cọc và giao dịch thực tế.',
      ),
    );
  if (
    owner &&
    active &&
    m &&
    ['Inspected', 'PendingSettlement', 'Settled'].includes(m.status) &&
    (m.ownerConfirmedInspection || m.status === 'Settled')
  )
    result.push(
      action(
        'move-out/complete',
        'Hoàn tất trả phòng',
        [{ name: 'actualEndDate', label: 'Ngày kết thúc thực tế', type: 'date' }],
        'Xác nhận hoàn tất bàn giao vật lý theo biên bản Owner đã duyệt. Nợ, cọc và hoàn tiền tiếp tục được theo dõi riêng. Ngày phải trùng ngày lập biên bản.',
      ),
    );
  return result;
}
export function actionPayload(
  a: ContractAction,
  values: Record<string, string>,
  c: ContractView,
  evidenceIds: string[] = [],
): Record<string, unknown> | undefined {
  if (a.operation === 'signing' && c.isDevelopmentDemo)
    return { certificateId: '00000000-0000-0000-0000-000000000000' };
  if (!a.fields.length) return undefined;
  const body: Record<string, unknown> = {};
  for (const f of a.fields) {
    const value = values[f.name] ?? '';
    body[f.name] =
      f.type === 'date'
        ? dateOnly(value)
        : f.type === 'money'
          ? vnd(value, true)
          : f.type === 'schedule'
            ? localSchedule(value)
            : f.name.endsWith('Id')
              ? guid(value)
              : required(value, f.max ?? 200);
  }
  if (a.operation === 'renewals' && String(body.endDate) <= c.endDate)
    throw new Error('Ngày hết hạn mới phải sau ngày hết hạn hiện tại.');
  if (a.operation === 'holding-cancellation') {
    if (!['0', '1'].includes(values.cause) || values.humanConfirmed !== 'true')
      throw new Error('Chọn nguyên nhân hủy và xác nhận đã đối chiếu trách nhiệm về cọc.');
    body.cause = Number(values.cause);
    body.humanConfirmed = true;
  }
  if (a.operation === 'termination-requests' || a.operation === 'expiry-move-out') {
    if (String(body.proposedDate) < businessToday())
      throw new Error('Ngày trả phòng không được trong quá khứ.');
    if (a.operation === 'termination-requests' && String(body.proposedDate) >= c.endDate)
      throw new Error('Yêu cầu trước hạn cần ngày trả phòng trước ngày hết hạn.');
    if (a.operation === 'expiry-move-out' && String(body.proposedDate) < c.endDate)
      throw new Error('Trả phòng hết hạn cần ngày từ ngày hết hạn trở đi.');
  }
  if (a.operation === 'move-out/inspection') {
    if (!evidenceIds.length || evidenceIds.length > 5)
      throw new Error('Cần từ 1 đến 5 ảnh hiện trạng đã tải lên.');
    body.evidenceIds = evidenceIds.map(guid);
  }
  return body;
}
function draftCore(values: Record<string, string>, residentIds: string[]) {
  const startDate = dateOnly(values.startDate ?? ''),
    endDate = dateOnly(values.endDate ?? '');
  if (endDate <= startDate) throw new Error('Ngày hết hạn phải sau ngày bắt đầu.');
  if (
    !residentIds.length ||
    residentIds.length > 50 ||
    !residentIds.includes(values.representativeResidentId)
  )
    throw new Error('Chọn người ở và một người đại diện trong danh sách.');
  return {
    roomId: guid(values.roomId ?? ''),
    ownerSignerId: guid(values.ownerSignerId ?? ''),
    tenantUserId: guid(values.tenantUserId ?? ''),
    representativeResidentId: guid(values.representativeResidentId),
    residentIds: residentIds.map(guid),
    startDate,
    endDate,
    terms: required(values.terms ?? '', 12000),
  };
}
export function draftPayload(values: Record<string, string>, residentIds: string[]) {
  return {
    ...draftCore(values, residentIds),
    monthlyRent: vnd(values.monthlyRent ?? '', true),
    requiredDeposit: vnd(values.requiredDeposit ?? ''),
    holdingContractId: values.holdingContractId ? guid(values.holdingContractId) : null,
  };
}
export function holdingDraftPayload(values: Record<string, string>, residentIds: string[]) {
  const capacity = Number(values.reservedCapacity || residentIds.length);
  const expires = new Date((values.expiresAt ?? '') + ':00+07:00');
  if (
    !Number.isInteger(capacity) ||
    capacity < residentIds.length ||
    capacity > 32767 ||
    !Number.isFinite(expires.getTime())
  )
    throw new Error('Kiểm tra số người giữ chỗ và thời điểm hết hạn.');
  return {
    ...draftCore(values, residentIds),
    holdingDeposit: vnd(values.requiredDeposit ?? ''),
    expiresAt: expires.toISOString(),
    reservedCapacity: capacity,
  };
}
// Retain the same key after an ambiguous response. Forget only once the server confirms success.
export function mutationKeys(newKey: () => string) {
  const keys = new Map<string, string>();
  const fingerprint = (scope: string, body: unknown) => JSON.stringify([scope, body]);
  return {
    get(scope: string, body: unknown) {
      const f = fingerprint(scope, body);
      let k = keys.get(f);
      if (!k) {
        k = newKey();
        keys.set(f, k);
      }
      return k;
    },
    confirmed(scope: string, body: unknown) {
      keys.delete(fingerprint(scope, body));
    },
  };
}
