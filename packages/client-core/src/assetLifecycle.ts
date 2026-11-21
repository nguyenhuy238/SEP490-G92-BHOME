import type { SetupDocument, SetupRequest } from './propertySetup';

export interface RecordPage<T> {
  items: SetupDocument<T>[];
  page: number;
  pageSize: number;
  totalCount: number;
}
export interface LegalRecordDetails {
  documentType: string;
  name: string;
  number: string | null;
  issuer: string | null;
  issuedOn: string;
  expiresOn: string | null;
  note: string | null;
  status: 'Active' | 'Archived';
  expectedVersion: number;
}
export interface LegalRecord {
  details: LegalRecordDetails;
  objectKey: string;
  contentType: string;
  length: number;
}
export const lifecycleCategories = [
  { value: 'Furniture', label: 'Nội thất' },
  { value: 'ElectricalEquipment', label: 'Thiết bị điện' },
  { value: 'FireSafetyEquipment', label: 'Thiết bị PCCC' },
  { value: 'SafetyEquipment', label: 'Thiết bị an toàn' },
  { value: 'TechnicalEquipment', label: 'Thiết bị kỹ thuật' },
  { value: 'Other', label: 'Khác' },
] as const;
export interface LifecyclePolicy {
  name: string;
  category: string;
  individualTracking: boolean;
  inspectionIntervalDays: number | null;
  maintenanceIntervalDays: number | null;
  certificationRequired: boolean;
  evidenceRequired: boolean;
  checklist: { code: string; label: string; notApplicableReasonRequired: boolean }[];
  basisType: 'Legal' | 'TechnicalStandard' | 'Manufacturer' | 'OwnerPolicy';
  sourceReference: string;
  technicalStandard: string | null;
  manufacturerInstructions: string | null;
  effectiveFrom: string;
  expectedVersion?: number;
  replacesId?: string | null;
}
export interface EquipmentDetails {
  label: string;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  manufacturedOn: string | null;
  commissionedOn: string | null;
  position: string;
  status: 'InService' | 'Unsafe' | 'Retired';
  retiredOn: string | null;
  retirementReason: string | null;
  replacesUnitId: string | null;
  expectedVersion?: number;
}
export interface EquipmentUnit {
  assetId: string;
  details: EquipmentDetails;
}
export interface LifecycleSummary {
  quantity: number;
  recordedUnits: number;
  activeUnits: number;
  failedUnits: number;
  retiredUnits: number;
  configurationStatus: string;
  applicablePolicies?: { id: string; version: number; name: string }[];
}
export function assetLifecycleClient(request: SetupRequest) {
  const put = <T>(path: string, value: unknown) =>
    request<SetupDocument<T>>(path, { method: 'PUT', body: JSON.stringify(value) });
  return {
    legalRecords: (location: string, page = 1, signal?: AbortSignal) =>
      request<RecordPage<LegalRecord>>(`/api/v1/locations/${location}/legal-records?page=${page}`, {
        signal,
      }),
    legalVersions: (id: string) =>
      request<SetupDocument<LegalRecord>[]>(`/api/v1/location-legal-records/${id}/versions`),
    saveLegal: (location: string, id: string, form: FormData) =>
      request<SetupDocument<LegalRecord>>(`/api/v1/locations/${location}/legal-records/${id}`, {
        method: 'PUT',
        body: form,
      }),
    policies: (location: string, page = 1, signal?: AbortSignal) =>
      request<RecordPage<LifecyclePolicy>>(
        `/api/v1/locations/${location}/asset-lifecycle-policies?page=${page}`,
        { signal },
      ),
    savePolicy: (location: string, id: string, value: LifecyclePolicy) =>
      put<LifecyclePolicy>(`/api/v1/locations/${location}/asset-lifecycle-policies/${id}`, value),
    publishPolicy: (id: string, expectedVersion: number) =>
      request<SetupDocument<LifecyclePolicy>>(`/api/v1/asset-lifecycle-policies/${id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion }),
      }),
    units: (asset: string, page = 1, signal?: AbortSignal) =>
      request<RecordPage<EquipmentUnit>>(`/api/v1/assets/${asset}/equipment-units?page=${page}`, {
        signal,
      }),
    saveUnit: (asset: string, id: string, value: EquipmentDetails) =>
      put<EquipmentUnit>(`/api/v1/assets/${asset}/equipment-units/${id}`, value),
    summary: (asset: string, signal?: AbortSignal) =>
      request<LifecycleSummary>(`/api/v1/assets/${asset}/lifecycle-summary`, { signal }),
  };
}
export function lifecycleError(error: unknown): string {
  const value = error as { status?: number; code?: string; problem?: { code?: string } };
  if (value.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if (value.status === 403 || value.status === 404)
    return 'Bạn không có quyền truy cập hoặc hồ sơ không còn khả dụng.';
  if (value.status === 409)
    return 'Dữ liệu đã thay đổi hoặc thao tác chưa đủ điều kiện. Tải lại dữ liệu và kiểm tra trước khi lưu.';
  if (value.status === 400 || value.status === 413)
    return 'Thông tin hoặc tệp không hợp lệ. Kiểm tra ngày, số lượng và giới hạn tệp 5 MB.';
  return 'Chưa thể hoàn thành yêu cầu. Dữ liệu nhập vẫn được giữ lại, hãy thử lại.';
}
