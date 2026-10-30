import { requestDiagnostic } from '../../../../packages/client-core/src/api';

export interface Session {
  userId: string;
  roles: string[];
  accessToken: string;
  refreshToken: string;
}
export interface Proposal {
  engineVersion?: string;
  proposedFields: Record<string, string>;
  warnings: string[];
  missingFields: string[];
  confidence: Record<string, number>;
  isFallback: boolean;
  requiresConfirmation: boolean;
}
export interface Named {
  id: string;
  label: string;
  parentId?: string;
}
export interface Resident {
  id: string;
  roomId: string;
  displayLabel: string;
  verificationStatus: number;
}
export interface MeterTask {
  id: string;
  meterId: string;
  location: string;
  room: string;
  meterCode: string;
  utilityType: number;
  display: number;
  decimalPlaces: number;
  purpose: number;
  readingDate: string;
  billingPeriod: string | null;
  status: number;
  previousValue: string | null;
  contractId?: string | null;
  confirmedReadingId?: string | null;
}
export class MobileApiError extends Error {
  constructor(
    public status: number,
    public code?: string,
    public requestPath?: string,
    public correlationId?: string,
    public method = 'GET',
  ) {
    super('Yêu cầu không thành công.');
  }
}

export async function mobileResponse<T>(
  base: string,
  path: string,
  init: RequestInit,
  transport: typeof fetch,
  decode: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const caller = init.signal;
  if (caller?.aborted) controller.abort();
  else caller?.addEventListener('abort', cancel);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15000);
  try {
    const response = await transport(base + path, {
      ...init,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as {
        code?: unknown;
        correlationId?: unknown;
      } | null;
      throw new MobileApiError(
        response.status,
        typeof problem?.code === 'string' ? problem.code : undefined,
        path,
        response.headers.get('X-Correlation-ID') ??
          (typeof problem?.correlationId === 'string' ? problem.correlationId : undefined),
        init.method ?? 'GET',
      );
    }
    try {
      return await decode(response);
    } catch (error) {
      if (controller.signal.aborted || error instanceof MobileApiError) throw error;
      throw new MobileApiError(
        502,
        'invalid_response',
        path,
        response.headers.get('X-Correlation-ID') ?? undefined,
        init.method ?? 'GET',
      );
    }
  } catch (error) {
    if (error instanceof MobileApiError) throw error;
    if (caller?.aborted) throw error;
    throw new MobileApiError(
      0,
      timedOut ? 'request_timeout' : 'network_unavailable',
      path,
      undefined,
      init.method ?? 'GET',
    );
  } finally {
    clearTimeout(timeout);
    caller?.removeEventListener('abort', cancel);
  }
}

export async function checkApiConnection(input: string, transport: typeof fetch = fetch) {
  return mobileResponse(apiBaseUrl(input), '/health/ready', {}, transport, async (response) => {
    if ((await response.text()).trim() !== 'Healthy')
      throw new MobileApiError(502, 'invalid_response', '/health/ready');
  });
}
export function apiBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Cần địa chỉ gốc HTTPS của BHOME API.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Cần địa chỉ gốc HTTPS của BHOME API.');
  return url.origin;
}
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError')
    return 'Đã dừng chờ phản hồi. Hãy tải lại để kiểm tra dữ liệu đã được lưu hay chưa.';
  if (error instanceof Error && error.message === 'Cần địa chỉ gốc HTTPS của BHOME API.')
    return error.message;
  if (!(error instanceof MobileApiError))
    return 'Không thể hoàn thành. Kiểm tra kết nối và địa chỉ HTTPS.';
  const messages: Record<string, string> = {
    secure_storage_unavailable:
      'Không truy cập được kho bảo mật của thiết bị. Hãy mở khóa thiết bị và thử đăng nhập lại.',
    request_timeout:
      'Máy chủ không phản hồi trong 15 giây. Kết quả chưa được xác nhận; hãy tải lại trước khi gửi lại.',
    invalid_response:
      'Phản hồi máy chủ không đúng định dạng BHOME. Kiểm tra địa chỉ API và phiên bản ứng dụng.',
    invalid_credentials: 'Email hoặc mật khẩu không đúng, hoặc tài khoản chưa thể đăng nhập.',
    human_confirmation_required: 'Bạn cần xác nhận đã kiểm tra dữ liệu.',
    duplicate_or_conflicting_record:
      'Dữ liệu bị trùng hoặc đã thay đổi. Hãy tải lại danh sách; hệ thống không tự gộp hồ sơ.',
    identity_already_confirmed: 'Hồ sơ đã xác nhận với nội dung khác. Hãy liên hệ Owner.',
    confirmed_baseline_required: 'Cần xác nhận chỉ số ban đầu của đồng hồ trước.',
    meter_reset_or_rollover_requires_review:
      'Chỉ số giảm. Cần Owner xử lý thay/reset hoặc quay vòng đồng hồ theo quy trình riêng.',
    reading_period_out_of_order: 'Kỳ ghi chỉ số không nối tiếp dữ liệu đã xác nhận.',
    evidence_not_available: 'Ảnh đã hết thời gian chờ hoặc không thuộc tác vụ. Hãy chụp lại.',
    task_already_confirmed: 'Tác vụ đã được xác nhận với nội dung khác. Hãy tải lại.',
    reading_date_or_precision: 'Kiểm tra ngày ghi và số chữ số thập phân của đồng hồ.',
    staff_not_currently_assigned: 'Staff chưa được phân công Location có hiệu lực.',
    invalid_citizen_number: 'Số CCCD cần đúng 12 chữ số.',
  };
  return (
    ((error.code && messages[error.code]) ||
      (
        {
          0: 'Không kết nối được API. Kiểm tra máy chủ đang chạy, iPhone cùng mạng và chứng chỉ HTTPS. Nếu vừa đổi Wi-Fi, hãy quét mã QR Expo mới trong terminal.',
          400: 'Dữ liệu chưa hợp lệ. Hãy kiểm tra các trường rồi thử lại.',
          401: 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.',
          403: 'Tài khoản không được phép thực hiện thao tác này.',
          404: 'Tài nguyên không khả dụng hoặc nằm ngoài phạm vi được phân công.',
          409: 'Dữ liệu đã thay đổi hoặc chưa đủ điều kiện. Hãy tải lại.',
          413: 'Ảnh quá lớn. Hãy chụp lại.',
          429: 'Quá nhiều yêu cầu. Hãy chờ rồi thử lại.',
          500: 'Máy chủ gặp lỗi xử lý. Hãy tải lại và cung cấp mã truy vết nếu lỗi tiếp diễn.',
          502: 'Phản hồi máy chủ không hợp lệ.',
          503: 'Dịch vụ tạm chưa sẵn sàng. Hãy thử tải lại sau.',
        } as Record<number, string>
      )[error.status] ||
      'Yêu cầu chưa thành công. Hãy tải lại để kiểm tra.') + requestDiagnostic(error)
  );
}
export class MobileApi {
  constructor(
    private base: string,
    private token: () => string | undefined,
    private refresh: () => Promise<string | undefined>,
    private expired: () => void,
    private transport: typeof fetch = fetch,
  ) {
    this.base = apiBaseUrl(base);
  }
  async request<T>(
    path: string,
    init: RequestInit = {},
    responseType: 'json' | 'blob' | 'bytes' = 'json',
  ): Promise<T> {
    if (
      !path.startsWith('/api/v1/') ||
      path.includes('..') ||
      path.includes('://') ||
      path.includes('#')
    )
      throw new Error('Invalid API path.');
    const headers = new Headers(init.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const original = this.token();
    if (original) headers.set('Authorization', 'Bearer ' + original);
    const send = () =>
      mobileResponse(this.base, path, { ...init, headers }, this.transport, async (response) => {
        if (response.status === 204) return undefined as T;
        if (responseType === 'bytes') return new Uint8Array(await response.arrayBuffer()) as T;
        return responseType === 'blob'
          ? (response.blob() as Promise<T>)
          : (response.json() as Promise<T>);
      });
    try {
      try {
        return await send();
      } catch (error) {
        if (!(error instanceof MobileApiError) || error.status !== 401 || !original) throw error;
        const next = this.token() !== original ? this.token() : await this.refresh();
        if (!next) throw error;
        headers.set('Authorization', 'Bearer ' + next);
        return await send();
      }
    } catch (error) {
      if (error instanceof MobileApiError && error.status === 401) this.expired();
      throw error;
    }
  }
  json<T>(path: string, value: unknown, signal?: AbortSignal) {
    return this.request<T>(path, {
      method: 'POST',
      body: JSON.stringify(value),
      headers: { 'Content-Type': 'application/json' },
      signal,
    });
  }
  image<T>(path: string, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal, method = 'POST') {
    return this.request<T>(path, {
      method,
      body: bytes,
      headers: { 'Content-Type': 'image/jpeg' },
      signal,
    });
  }
}
