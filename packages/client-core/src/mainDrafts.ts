import type { PreviewDocument as ContractDocumentView } from './contracts';
import { formatBillingDecimal } from './invoices';
export function formatDraftMoney(value: string): string {
  const amount = formatBillingDecimal(value);
  return amount === '—' ? amount : amount + ' ₫';
}
export interface MainDraftInput {
  roomId: string;
  representativeResidentId: string;
  residentIds: string[];
  startDate: string;
  endDate: string;
  notes: string;
  tenantPhone: string;
  tenantPlaceOfIssue: string;
  expectedVersion: number;
}
export interface MainDraftPreparation {
  roomId: string;
  locationId: string;
  locationName: string;
  roomNumber: string;
  address: string;
  effectiveOn: string;
  residents: {
    id: string;
    fullName: string;
    maskedCitizenNumber: string;
    dateOfIssue: string | null;
    representative: boolean;
    phone?: string | null;
  }[];
  charges: { id: string; name: string; chargeCode: string; rate: string; version: number }[];
  securityDeposit: string | null;
  paymentTerms: string | null;
  ownerName: string | null;
  blockers: string[];
}
export interface MainDraftView {
  id: string;
  status: string;
  version: number;
  input: MainDraftInput;
  preparation: MainDraftPreparation;
}
export interface MainDraftFiles {
  docx: ContractDocumentView;
  pdf: ContractDocumentView | null;
  previewError: string | null;
}
export interface MainContractSettings {
  ownerSignerId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  securityDeposit: string;
  paymentTerms: string;
  additionalTerms: string;
  version: number;
  owner: {
    fullName: string;
    dateOfBirth: string;
    citizenNumber: string;
    dateOfIssue: string;
    placeOfIssue: string;
    address: string;
    phone: string;
  };
}
export type MainDraftRequest = <T>(
  path: string,
  init?: RequestInit,
  type?: 'json' | 'blob' | 'bytes',
) => Promise<T>;
const base = '/api/v1/contracts/main-drafts';
export function mainDraftClient(request: MainDraftRequest) {
  return {
    prepare(
      input: Pick<
        MainDraftInput,
        'roomId' | 'representativeResidentId' | 'residentIds' | 'startDate'
      >,
      signal?: AbortSignal,
    ) {
      const query = new URLSearchParams({
        roomId: input.roomId,
        representativeResidentId: input.representativeResidentId,
        effectiveOn: input.startDate,
      });
      input.residentIds.forEach((id) => query.append('residentIds', id));
      return request<MainDraftPreparation>(`${base}/preparation?${query}`, { signal });
    },
    get: (id: string, signal?: AbortSignal) => request<MainDraftView>(`${base}/${id}`, { signal }),
    save: (id: string | null, input: MainDraftInput, key: string, signal?: AbortSignal) =>
      request<MainDraftView>(id ? `${base}/${id}` : base, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(input),
        signal,
      }),
    generate: (id: string, signal?: AbortSignal) =>
      request<MainDraftFiles>(`${base}/${id}/documents`, { method: 'POST', signal }),
    file: (id: string, fileId: string, signal?: AbortSignal) =>
      request<Uint8Array<ArrayBuffer>>(`${base}/${id}/documents/${fileId}`, { signal }, 'bytes'),
    settings: (id: string, signal?: AbortSignal) =>
      request<MainContractSettings | null>(`${base}/settings/${id}`, { signal }),
    setSettings: (
      id: string,
      input: Omit<MainContractSettings, 'version'> & { expectedVersion: number },
    ) =>
      request<void>(`${base}/settings/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
  };
}
export const mainDraftMessages: Record<string, string> = {
  individual_representatives_require_separate_contracts:
    'Chọn đúng người đại diện và thành viên gia đình. Các người thuê đại diện độc lập cần lập hợp đồng riêng.',
  draft_template_changed_save_again: 'Mẫu hợp đồng đã đổi. Lưu lại bản nháp rồi tạo tài liệu mới.',
  unsupported_contract_charge_unit:
    'Đơn vị tính phí chưa tương thích mẫu hợp đồng. Owner cần kiểm tra biểu phí.',
  confirmed_identity_required:
    'Hồ sơ định danh đã lưu chưa đủ thông tin hợp lệ. Cần kiểm tra lại hồ sơ.',
  owner_contract_settings_required:
    'Owner cần cấu hình thông tin bên cho thuê, tiền cọc và chính sách thanh toán tại cơ sở.',
  tenant_issue_date_and_address_required:
    'Hồ sơ đại diện thiếu Ngày cấp hoặc địa chỉ thường trú đã xác nhận. Cần hoàn thiện theo quy trình hồ sơ.',
  missing_policy_rent: 'Chưa có giá thuê hiệu lực tại ngày bắt đầu.',
  missing_policy_electricity: 'Chưa có giá điện hiệu lực tại ngày bắt đầu.',
  missing_policy_water: 'Chưa có giá nước hiệu lực tại ngày bắt đầu.',
  room_not_available: 'Phòng chưa đủ điều kiện lập hợp đồng.',
  location_address_required: 'Owner cần bổ sung địa chỉ cơ sở.',
  draft_version_or_status_changed:
    'Bản nháp đã thay đổi hoặc không còn ở trạng thái Draft. Hãy tải lại.',
  draft_configuration_changed_save_again:
    'Cấu hình đã thay đổi. Tải lại giá và lưu nháp trước khi tạo tài liệu.',
  contract_pdf_converter_unavailable:
    'Máy chủ chưa cấu hình LibreOffice để tạo PDF. Bản nháp và DOCX đã được giữ lại.',
  contract_pdf_conversion_failed:
    'Chuyển DOCX sang PDF chưa thành công. Bản nháp vẫn được giữ lại.',
  contract_pdf_conversion_timeout: 'Tạo PDF quá thời gian chờ. Bản nháp vẫn được giữ lại.',
  draft_document_outdated: 'Tài liệu thuộc phiên bản cũ. Hãy tạo lại bản xem trước.',
};
