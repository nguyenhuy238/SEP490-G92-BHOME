import type { RecordPage } from './assetLifecycle';
import type { SetupDocument, SetupRequest } from './propertySetup';

export interface BusinessProfile {
  subjectType: string;
  name: string;
  taxIdentifier: string;
  registrationNumber: string | null;
  address: string;
  locationIds: string[];
  effectiveFrom: string;
  effectiveTo: string | null;
  expectedVersion?: number;
}
export interface TaxTrackingInput {
  businessProfileId: string;
  periodFrom: string;
  periodTo: string;
  obligationType: string;
  deadline: string;
  declaredAmount: string;
  paidAmount: string;
  paidOn: string | null;
  evidenceRecordId: string | null;
  evidenceVersion: number | null;
  status: string;
  note: string;
  expectedVersion?: number;
}
export interface TaxTracking {
  details: TaxTrackingInput;
  businessProfileVersion: number;
  locationIdsSnapshot: string[];
  referenceRevenue: string;
  referenceSnapshotAt: string;
}
export interface PersonalDataRequest {
  id: string;
  requestedBy: string;
  requesterLabel: string;
  requestType: string;
  description: string;
  status: string;
  version: number;
  requestedAt: string;
  history: {
    actorId: string;
    occurredAt: string;
    status: string;
    resolution: string | null;
    basis: string | null;
  }[];
}
export const dataRequestTypes = [
  { id: 'Access', label: 'Xem thông tin' },
  { id: 'Correction', label: 'Chỉnh sửa thông tin sai' },
  { id: 'Restriction', label: 'Hạn chế xử lý' },
  { id: 'Deletion', label: 'Yêu cầu xóa dữ liệu' },
];
export const dataRequestStatuses: Record<string, string> = {
  Pending: 'Chờ xử lý',
  InReview: 'Đang xem xét',
  Resolved: 'Đã xử lý',
  Rejected: 'Từ chối',
};
export const taxTrackingStatuses: Record<string, string> = {
  Pending: 'Chưa thực hiện',
  InProgress: 'Đang xử lý',
  Recorded: 'Đã ghi nhận',
  Archived: 'Lưu trữ',
};
export function taxPrivacyClient(request: SetupRequest) {
  const put = <T>(path: string, value: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(value) });
  return {
    profiles: (page = 1, signal?: AbortSignal) =>
      request<RecordPage<BusinessProfile>>(`/api/v1/finance/business-profiles?page=${page}`, {
        signal,
      }),
    profile: (id: string, input: BusinessProfile) =>
      put<SetupDocument<BusinessProfile>>(`/api/v1/finance/business-profiles/${id}`, input),
    taxes: (page = 1, signal?: AbortSignal) =>
      request<RecordPage<TaxTracking>>(`/api/v1/finance/tax-obligations?page=${page}`, { signal }),
    tax: (id: string, input: TaxTrackingInput) =>
      put<SetupDocument<TaxTracking>>(`/api/v1/finance/tax-obligations/${id}`, input),
    taxVersions: (id: string, signal?: AbortSignal) =>
      request<SetupDocument<TaxTracking>[]>(`/api/v1/finance/tax-obligations/${id}/versions`, {
        signal,
      }),
    requests: (page = 1, signal?: AbortSignal) =>
      request<{ items: PersonalDataRequest[]; page: number; pageSize: number; totalCount: number }>(
        `/api/v1/personal-data-requests?page=${page}`,
        { signal },
      ),
    createRequest: (id: string, requestType: string, description: string) =>
      put<PersonalDataRequest>(`/api/v1/personal-data-requests/${id}`, {
        requestType,
        description,
      }),
    decideRequest: (item: PersonalDataRequest, status: string, resolution: string, basis: string) =>
      request<PersonalDataRequest>(
        `/api/v1/personal-data-requests/${item.requestedBy}/${item.id}/decisions`,
        {
          method: 'POST',
          body: JSON.stringify({ expectedVersion: item.version, status, resolution, basis }),
        },
      ),
  };
}
