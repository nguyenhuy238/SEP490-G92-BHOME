import { dateOnly, guid } from './contracts';

export type ResidenceStatus = 'Pending' | 'InProgress' | 'Completed';
export interface ResidenceTask {
  contractId: string;
  residentId: string;
  locationId: string;
  roomId: string;
  roomNumber: string;
  residentLabel: string;
  residentRole: 'Representative' | 'CoOccupant';
  tenantUserId: string | null;
  residenceFrom: string;
  actualResidenceFrom: string | null;
  status: ResidenceStatus;
  hasEvidence: boolean;
  resultAt: string | null;
  ownerConfirmed: boolean;
  ownerConfirmedAt: string | null;
  history: { action: string; actorId: string; occurredAt: string; note: string | null }[];
  reference?: string;
  accommodationConfirmed?: boolean;
  registrationDeadline?: string | null;
  trackingActive?: boolean;
  registrationExpiresOn?: string | null;
  registrationRequired?: boolean;
  householdCompleted?: boolean;
}
export interface ResidencePage {
  items: ResidenceTask[];
  page: number;
  pageSize: number;
  totalCount: number;
}
export interface ResidenceUpdate {
  actualResidenceFrom: string;
  status: ResidenceStatus;
  resultAt: string | null;
  note: string | null;
  expectedReference?: string;
  registrationExpiresOn?: string | null;
}
type Transport = <T>(
  path: string,
  init?: RequestInit,
  type?: 'json' | 'blob' | 'bytes',
) => Promise<T>;
const root = '/api/v1/residence-tasks';
export const residenceKey = (task: Pick<ResidenceTask, 'contractId' | 'residentId'>) =>
  `${task.contractId}/${task.residentId}`;
export const residenceStatus: Record<string, string> = {
  Pending: 'Chưa thực hiện',
  InProgress: 'Đang thực hiện',
  Completed: 'Đã ghi nhận kết quả',
};
export const residenceAction: Record<string, string> = {
  TenantStatusUpdated: 'Cập nhật trạng thái',
  OwnerConfirmed: 'Owner xác nhận',
  AccommodationConfirmed: 'Owner ghi nhận xác nhận chỗ ở trên kênh chính thức',
  EvidenceUploaded: 'Cập nhật ảnh minh chứng',
  TrackingConfigured: 'Owner cập nhật theo dõi',
};
export function residenceAlert(
  task: ResidenceTask,
  today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()),
) {
  if (task.registrationRequired === false || task.trackingActive === false) return null;
  if (task.registrationExpiresOn) {
    const days = (Date.parse(task.registrationExpiresOn) - Date.parse(today)) / 86_400_000;
    if (days < 0) return 'Tạm trú đã hết hạn';
    if (days <= 15) return 'Tạm trú sắp hết hạn (trong 15 ngày)';
  }
  if (task.registrationDeadline && task.registrationDeadline < today && !task.ownerConfirmed)
    return 'Đã quá hạn đăng ký được ghi nhận';
  return null;
}
export function residenceImageType(bytes: Uint8Array): 'image/png' | 'image/jpeg' {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024)
    throw new Error('Ảnh cần nhỏ hơn hoặc bằng 5 MB.');
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value))
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  throw new Error('Chỉ nhận ảnh JPG hoặc PNG.');
}
export function residenceImageUri(bytes: Uint8Array) {
  const type = residenceImageType(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${type};base64,${btoa(binary)}`;
}
export function residenceError(error: unknown): string {
  const failure = error as { status?: number; code?: string; problem?: { code?: string } } | null;
  const code = failure?.code ?? failure?.problem?.code;
  const codes: Record<string, string> = {
    invalid_residence_state: 'Kiểm tra ngày cư trú và thời điểm có kết quả.',
    invalid_residence_transition:
      'Hồ sơ chưa đủ điều kiện: kiểm tra hợp đồng đang thuê, ngày cư trú và ảnh kết quả. Hãy tải lại hồ sơ.',
    residence_not_ready_for_confirmation:
      'Hồ sơ chưa đủ điều kiện xác nhận hoặc đã được xác nhận. Hãy tải lại.',
    invalid_operations_image: 'Ảnh không hợp lệ. Hãy chọn ảnh JPG/PNG khác.',
    operations_image_too_large: 'Ảnh vượt quá 5 MB. Hãy chọn ảnh nhỏ hơn.',
  };
  if (code && codes[code]) return codes[code];
  return (
    (
      {
        400: 'Thông tin hoặc ảnh chưa hợp lệ. Kiểm tra rồi thử lại.',
        401: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
        403: 'Bạn không có quyền xử lý hồ sơ này.',
        404: 'Không tìm thấy hồ sơ hoặc ảnh trong phạm vi tài khoản của bạn.',
        409: 'Hồ sơ đã thay đổi hoặc chưa đủ điều kiện. Hãy tải lại trước khi tiếp tục.',
        413: 'Ảnh vượt quá 5 MB. Hãy chọn ảnh nhỏ hơn.',
      } as Record<number, string>
    )[failure?.status ?? 0] ??
    'Chưa xác nhận được kết quả từ máy chủ. Hãy tải lại để kiểm tra trước khi gửi lại.'
  );
}
export function residencePayload(
  task: ResidenceTask,
  actual: string,
  resultDate: string,
  resultTime: string,
  note: string,
  completed: boolean,
  expiresOn = '',
): ResidenceUpdate {
  const actualResidenceFrom = dateOnly(actual);
  if (actualResidenceFrom < task.residenceFrom)
    throw new Error('Ngày cư trú thực tế không được trước ngày bắt đầu cư trú.');
  if (note.trim().length > 1000) throw new Error('Ghi chú tối đa 1.000 ký tự.');
  let resultAt: string | null = null;
  if (completed) {
    if (!task.hasEvidence) throw new Error('Tải ảnh minh chứng lên trước khi xác nhận kết quả.');
    const date = dateOnly(resultDate);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(resultTime))
      throw new Error('Nhập giờ có kết quả theo HH:mm.');
    resultAt = new Date(`${date}T${resultTime}:00+07:00`).toISOString();
    if (Date.parse(resultAt) > Date.now() + 5 * 60_000)
      throw new Error('Thời điểm có kết quả không được ở tương lai.');
  }
  if (task.status === 'Completed' && !completed)
    throw new Error('Hồ sơ đã ghi nhận kết quả không thể chuyển về trạng thái trước.');
  return {
    actualResidenceFrom,
    status: completed ? 'Completed' : 'InProgress',
    resultAt,
    note: note.trim() || null,
    ...(expiresOn ? { registrationExpiresOn: dateOnly(expiresOn) } : {}),
  };
}
export function residenceClient(request: Transport) {
  const path = (contract: string, resident: string) =>
    `${root}/${guid(contract)}/${guid(resident)}`;
  return {
    list: (
      page = 1,
      signal?: AbortSignal,
      filters: { locationId?: string; status?: string } = {},
    ) => {
      const query = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (filters.locationId) query.set('locationId', guid(filters.locationId));
      if (filters.status) query.set('status', filters.status);
      return request<ResidencePage>(`${root}?${query}`, { signal });
    },
    get: (contract: string, resident: string, signal?: AbortSignal) =>
      request<ResidenceTask>(path(contract, resident), { signal }),
    update: (task: ResidenceTask, input: ResidenceUpdate) =>
      request<ResidenceTask>(path(task.contractId, task.residentId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, expectedReference: task.reference }),
      }),
    upload: (task: ResidenceTask, bytes: Uint8Array<ArrayBuffer>, residentIds?: string[]) =>
      request<ResidenceTask>(
        `${path(task.contractId, task.residentId)}/evidence${residentIds?.length ? '?' + new URLSearchParams(residentIds.map((id) => ['residentIds', guid(id)])) : ''}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': residenceImageType(bytes) },
          body: bytes,
        },
      ),
    configure: (
      task: ResidenceTask,
      registrationRequired: boolean,
      registrationExpiresOn: string | null,
      reason: string,
    ) =>
      request<ResidenceTask>(`${path(task.contractId, task.residentId)}/tracking-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationRequired,
          registrationExpiresOn,
          expectedReference: task.reference,
          reason: reason.trim(),
        }),
      }),
    image: (task: ResidenceTask, signal?: AbortSignal) =>
      request<Uint8Array<ArrayBuffer>>(
        `${path(task.contractId, task.residentId)}/evidence`,
        { signal, headers: { Accept: 'image/png, image/jpeg' } },
        'bytes',
      ),
    confirm: (task: ResidenceTask, note: string) =>
      request<ResidenceTask>(`${path(task.contractId, task.residentId)}/owner-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() }),
      }),
    confirmAccommodation: (
      task: ResidenceTask,
      note: string,
      registrationDeadline: string | null,
    ) =>
      request<ResidenceTask>(
        `${path(task.contractId, task.residentId)}/accommodation-confirmation`,
        {
          method: 'POST',
          body: JSON.stringify({
            note: note.trim(),
            expectedReference: task.reference,
            registrationDeadline,
          }),
        },
      ),
  };
}
export type ResidenceClient = ReturnType<typeof residenceClient>;
