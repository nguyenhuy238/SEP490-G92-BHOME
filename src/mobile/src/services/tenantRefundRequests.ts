import type { Page } from '../../../../packages/client-core/src/invoices';
import {
  refundPetitionClient,
  type TenantRefundPetition,
  type TenantRefundPetitionInput,
  type TenantRefundPetitionSources,
} from '../../../../packages/client-core/src/refunds';
import {
  isResponseRecord as object,
  isResponseInstant as instant,
  invalidResponse as invalid,
  type MobileApi,
} from '../lib/api';

export const tenantRefundRequestRoot = '/api/v1/tenant/refund-requests';

export type TenantRefundRequest = Omit<TenantRefundPetition, 'tenantLabel'>;
export type TenantRefundRequestInput = TenantRefundPetitionInput;
export type TenantRefundRequestSources = TenantRefundPetitionSources;

const guidPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const optionalInstant = (value: unknown) => value === null || instant(value);
const optionalText = (value: unknown) => value === null || typeof value === 'string';
const optionalId = (value: unknown) =>
  value === null || (typeof value === 'string' && guidPattern.test(value));

export function refundRequestFormError(value: TenantRefundRequestInput): string {
  if (!/^[1-9]\d*$/.test(value.amount)) return 'Nhập số tiền hoàn lớn hơn 0, theo đơn vị VND.';
  if (!value.reason.trim() || value.reason.trim().length > 2000)
    return 'Nhập lý do yêu cầu, tối đa 2.000 ký tự.';
  if (!optionalId(value.sourcePaymentId ?? null) || !optionalId(value.sourceContractId ?? null))
    return 'Mã giao dịch hoặc hợp đồng chưa đúng định dạng.';
  if (
    !optionalId(value.moveOutProposalId ?? null) ||
    (value.moveOutProposalId && (!value.sourceContractId || value.sourcePaymentId))
  )
    return 'Yêu cầu hoàn cọc trả phòng phải gắn với đề xuất và đúng hợp đồng.';
  return '';
}

export function tenantRefundRequestPath(page: number) {
  return `${tenantRefundRequestRoot}?page=${page}&pageSize=20`;
}

export async function loadTenantRefundRequestSources(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<TenantRefundRequestSources> {
  if (path !== `${tenantRefundRequestRoot}/sources`) invalid();
  const data: unknown = await refundPetitionClient(api.request.bind(api)).sources(signal);
  if (!object(data) || !Array.isArray(data.payments) || !Array.isArray(data.contracts)) invalid();
  const read = (input: unknown[]): TenantRefundRequestSources['payments'] => {
    const rows = input.map((entry) => {
      if (
        !object(entry) ||
        typeof entry.id !== 'string' ||
        !guidPattern.test(entry.id) ||
        typeof entry.label !== 'string' ||
        !entry.label.trim()
      )
        invalid();
      return { id: entry.id as string, label: entry.label as string };
    });
    if (new Set(rows.map((row) => row.id)).size !== rows.length) invalid();
    return rows;
  };
  return { payments: read(data.payments), contracts: read(data.contracts) };
}

export function parseTenantRefundRequest(value: unknown): TenantRefundRequest {
  if (
    !object(value) ||
    typeof value.id !== 'string' ||
    !guidPattern.test(value.id) ||
    typeof value.amount !== 'string' ||
    !/^[1-9]\d*(?:\.0+)?$/.test(value.amount) ||
    typeof value.reason !== 'string' ||
    !value.reason.trim() ||
    !['REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED'].includes(value.status as string) ||
    !optionalId(value.sourcePaymentId) ||
    !optionalId(value.sourceContractId) ||
    (value.moveOutProposalId !== undefined && !optionalId(value.moveOutProposalId)) ||
    !instant(value.createdAt) ||
    !optionalInstant(value.decidedAt) ||
    !optionalInstant(value.executedAt) ||
    !optionalText(value.decisionReason) ||
    !optionalText(value.externalReference) ||
    typeof value.hasEvidence !== 'boolean' ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 0 ||
    (value.status === 'COMPLETED' && !instant(value.executedAt))
  )
    invalid();
  // The Tenant presentation only keeps the documented fields, even if the server returns more.
  return {
    id: value.id as string,
    amount: value.amount as string,
    reason: value.reason as string,
    status: value.status as TenantRefundRequest['status'],
    sourcePaymentId: value.sourcePaymentId as string | null,
    sourceContractId: value.sourceContractId as string | null,
    moveOutProposalId: (value.moveOutProposalId ?? null) as string | null,
    createdAt: value.createdAt as string,
    decidedAt: value.decidedAt as string | null,
    decisionReason: value.decisionReason as string | null,
    executedAt: value.executedAt as string | null,
    externalReference: value.externalReference as string | null,
    hasEvidence: value.hasEvidence as boolean,
    version: value.version as number,
  };
}

export async function loadTenantRefundRequests(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<Page<TenantRefundRequest>> {
  const requested = new URLSearchParams(path.split('?')[1]);
  if (!path.startsWith(`${tenantRefundRequestRoot}?`)) invalid();
  const page = Number(requested.get('page'));
  const pageSize = Number(requested.get('pageSize'));
  const data: unknown = await refundPetitionClient(api.request.bind(api)).tenantList(
    page,
    pageSize,
    signal,
  );
  if (
    !object(data) ||
    !Array.isArray(data.items) ||
    !Number.isSafeInteger(data.totalCount) ||
    (data.totalCount as number) < data.items.length ||
    data.page !== Number(requested.get('page')) ||
    data.pageSize !== Number(requested.get('pageSize')) ||
    data.items.length > (data.pageSize as number)
  )
    invalid();
  const items = data.items.map(parseTenantRefundRequest);
  if (new Set(items.map((item) => item.id)).size !== items.length) invalid();
  return {
    items,
    page: data.page as number,
    pageSize: data.pageSize as number,
    totalCount: data.totalCount as number,
  };
}

export async function createTenantRefundRequest(
  api: MobileApi,
  input: TenantRefundRequestInput,
  idempotencyKey: string,
): Promise<TenantRefundRequest> {
  const error = refundRequestFormError(input);
  if (error) throw new Error(error);
  const response: unknown = await refundPetitionClient(api.request.bind(api)).create(
    { ...input, reason: input.reason.trim() },
    idempotencyKey,
  );
  return parseTenantRefundRequest(response);
}
