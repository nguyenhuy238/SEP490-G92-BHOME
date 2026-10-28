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
}
export class MobileApiError extends Error {
  constructor(
    public status: number,
    public code?: string,
  ) {
    super('Yêu cầu không thành công.');
  }
}
export function apiBaseUrl(input: string): string {
  const url = new URL(input.trim());
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
  if (!(error instanceof MobileApiError))
    return 'Không thể hoàn thành. Kiểm tra kết nối và địa chỉ HTTPS.';
  const messages: Record<string, string> = {
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
    (error.code && messages[error.code]) ||
    (
      {
        0: 'Không kết nối được API. Kiểm tra Wi-Fi, địa chỉ HTTPS và chứng chỉ trên iPhone.',
        400: 'Dữ liệu chưa hợp lệ. Hãy kiểm tra các trường rồi thử lại.',
        401: 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.',
        403: 'Tài khoản không được phép thực hiện thao tác này.',
        404: 'Tài nguyên không khả dụng hoặc nằm ngoài phạm vi được phân công.',
        409: 'Dữ liệu đã thay đổi hoặc chưa đủ điều kiện. Hãy tải lại.',
        413: 'Ảnh quá lớn. Hãy chụp lại.',
        503: 'OCR tạm chưa sẵn sàng. Bạn có thể nhập thủ công.',
      } as Record<number, string>
    )[error.status] ||
    'Không thể lưu. Chưa có xác nhận thành công từ máy chủ.'
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
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (
      !path.startsWith('/api/v1/') ||
      path.includes('..') ||
      path.includes('://') ||
      path.includes('?')
    )
      throw new Error('Invalid API path.');
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    const original = this.token();
    if (original) headers.set('Authorization', 'Bearer ' + original);
    const send = async () => {
      try {
        return await this.transport(this.base + path, {
          ...init,
          headers,
          credentials: 'omit',
          cache: 'no-store',
        });
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') throw e;
        throw new MobileApiError(0);
      }
    };
    let response = await send();
    if (response.status === 401 && original) {
      const next = this.token() !== original ? this.token() : await this.refresh();
      if (next) {
        headers.set('Authorization', 'Bearer ' + next);
        response = await send();
      }
    }
    if (!response.ok) {
      if (response.status === 401) this.expired();
      const problem = (await response.json().catch(() => ({}))) as { code?: string };
      throw new MobileApiError(response.status, problem.code);
    }
    return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
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
