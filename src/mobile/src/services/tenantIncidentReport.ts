import { MobileApiError, type MobileApi } from '../lib/api';
import {
  incidentClient,
  validateIncidentPhoto,
  type IncidentPage,
  type IncidentPhoto,
  type IncidentSubmit,
  type IncidentResult,
  type ReportingRoom,
  type ReportingAsset,
} from './incidents';
const id = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value) &&
  !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value);
const obj = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
async function lookup(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
  valid: (row: Record<string, unknown>) => boolean,
) {
  const value = await api.request<unknown>(path, { signal });
  const query = new URLSearchParams(path.split('?')[1]);
  if (
    !obj(value) ||
    !Array.isArray(value.items) ||
    value.page !== Number(query.get('page')) ||
    value.pageSize !== 20 ||
    !Number.isSafeInteger(value.totalCount) ||
    (value.totalCount as number) < value.items.length ||
    value.items.length > 20 ||
    !value.items.every((row) => obj(row) && valid(row))
  )
    throw new MobileApiError(502, 'invalid_response');
  return value;
}
export async function loadReportingRooms(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<IncidentPage<ReportingRoom>> {
  return (await lookup(
    api,
    path,
    signal,
    (row) =>
      id(row.roomId) &&
      id(row.locationId) &&
      typeof row.roomNumber === 'string' &&
      typeof row.locationName === 'string',
  )) as unknown as IncidentPage<ReportingRoom>;
}
export async function loadReportingAssets(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<IncidentPage<ReportingAsset>> {
  const query = new URLSearchParams(path.split('?')[1]);
  return (await lookup(
    api,
    path,
    signal,
    (row) =>
      id(row.assetId) &&
      row.locationId === query.get('locationId') &&
      (row.roomId === null || id(row.roomId)) &&
      (!query.get('roomId') || row.roomId === query.get('roomId')) &&
      (row.commonArea === null || typeof row.commonArea === 'string') &&
      ['name', 'category', 'status'].every((key) => typeof row[key] === 'string'),
  )) as unknown as IncidentPage<ReportingAsset>;
}
export function incidentFormError(input: IncidentSubmit, photos: IncidentPhoto[]) {
  if (!id(input.locationId) || (input.roomId !== null && !id(input.roomId)))
    return 'Vui lòng chọn phòng hoặc cơ sở hợp lệ.';
  const common = input.commonArea?.trim() ?? '';
  if (input.roomId ? !!common : !common || common.length > 200)
    return 'Chọn phòng hoặc nhập khu vực chung từ 1–200 ký tự.';
  if (input.assetId !== null && !id(input.assetId)) return 'Vui lòng chọn lại tài sản liên quan.';
  if (!['Normal', 'Emergency'].includes(input.severity)) return 'Vui lòng chọn mức độ sự cố.';
  if (input.description.trim().length < 10 || input.description.length > 8000)
    return 'Mô tả cần từ 10 đến 8.000 ký tự.';
  if (photos.length > 5) return 'Chỉ chọn tối đa 5 ảnh.';
  for (const photo of photos) {
    const error = validateIncidentPhoto(photo.bytes);
    if (error) return error;
    if (photo.contentType !== (photo.bytes[0] === 137 ? 'image/png' : 'image/jpeg'))
      return 'Định dạng ảnh không khớp nội dung. Vui lòng chọn lại.';
  }
  return '';
}
export async function submitTenantIncident(
  api: MobileApi,
  input: IncidentSubmit,
  photos: IncidentPhoto[],
  key: string,
  signal: AbortSignal,
) {
  const error = incidentFormError(input, photos);
  if (error) throw new Error(error);
  const upload = new AbortController();
  const cancel = () => upload.abort();
  let timedOut = false;
  signal.addEventListener('abort', cancel);
  if (signal.aborted) cancel();
  const timer = setTimeout(() => {
    timedOut = true;
    upload.abort();
  }, 90_000);
  let result: IncidentResult;
  try {
    result = await incidentClient(api).submit(input, photos, key, upload.signal);
  } catch (cause) {
    if (timedOut)
      throw new Error(
        'Gửi báo cáo quá thời gian chờ. Chưa xác định được máy chủ đã nhận hay chưa. Hãy thử lại báo cáo này để tránh gửi trùng.',
        { cause },
      );
    throw cause;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
  if (
    !result ||
    !id(result.incidentId) ||
    (result.workOrderId !== null && !id(result.workOrderId)) ||
    (result.resourceId !== null && !id(result.resourceId))
  )
    throw new MobileApiError(502, 'invalid_response');
  return result;
}
