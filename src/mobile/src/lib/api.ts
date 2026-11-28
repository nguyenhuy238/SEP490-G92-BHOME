import {
  requestDiagnostic,
  normalizeApiProblem,
  getUserFriendlyMessage,
  type ApiProblem,
  UserFeedbackError,
} from '../../../../packages/client-core/src/api';
import { invalidCredentialsMessage } from '../../../../packages/client-core/src/loginValidation';
import { QueryCache } from './queryCache';
import { mutationTags } from './queryPolicies';
import type { TokenSession } from '../../../../packages/client-core/src/jwtSession';
import { mobileRequestUrl } from './mobileRequestUrl';
export { mobileRequestUrl };

export interface Session extends TokenSession {
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
  status?: string | null;
  capacity?: number | null;
  remainingCapacity?: number | null;
  currentTenantLabels?: string[] | null;
  waitingForOwnerSignature?: boolean | null;
}
export interface Resident {
  id: string;
  roomId: string;
  displayLabel: string;
  verificationStatus: number;
  residentType?: number;
  confirmedAt?: string | null;
  email?: string | null;
}
export type { MeterTask } from '../../../../packages/client-core/src/meter';
export class MobileApiError extends Error {
  constructor(
    public status: number,
    public code?: string,
    public requestPath?: string,
    public correlationId?: string,
    public method = 'GET',
    public problem?: ApiProblem,
  ) {
    super(getUserFriendlyMessage({ status, code, problem }));
    this.name = 'MobileApiError';
  }
}

const stagingOrigin = 'https://api-staging.103.146.23.157.sslip.io';
const productOrigin = 'https://api.103.146.23.157.sslip.io';

export async function mobileResponse<T>(
  base: string,
  path: string,
  init: RequestInit,
  transport: typeof fetch,
  decode: (response: Response) => Promise<T>,
  timeoutMilliseconds = 15000,
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
  }, timeoutMilliseconds);
  try {
    const response = await transport(mobileRequestUrl(base, path), {
      ...init,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) {
      const problem = normalizeApiProblem(
        await response.json().catch(() => undefined),
        response.status,
        response.headers.get('X-Correlation-ID'),
      );
      throw new MobileApiError(
        response.status,
        typeof problem?.code === 'string' ? problem.code : undefined,
        path,
        response.headers.get('X-Correlation-ID') ??
          (typeof problem?.correlationId === 'string' ? problem.correlationId : undefined),
        init.method ?? 'GET',
        problem,
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
  const base = apiBaseUrl(input);
  const checkPublic = async () => {
    const path = '/api/v1/public/locations';
    await mobileResponse(base, path, {}, transport, async (response) => {
      const locations: unknown = await response.json().catch(() => null);
      if (!Array.isArray(locations)) throw new MobileApiError(502, 'invalid_response', path);
    });
  };
  // Deployed environments block /health/* at their public edge. Browsers can
  // hide that 404 as a network error because the edge does not emit CORS headers.
  if (base === stagingOrigin || base === productOrigin) return checkPublic();
  try {
    await mobileResponse(base, '/health/ready', {}, transport, async (response) => {
      if ((await response.text()).trim() !== 'Healthy')
        throw new MobileApiError(502, 'invalid_response', '/health/ready');
    });
  } catch (error) {
    if (!(error instanceof MobileApiError) || error.status !== 404) throw error;
    // Deployed gateways deliberately keep readiness private. Use the anonymous API there.
    await checkPublic();
  }
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
  if (error instanceof UserFeedbackError) return error.message;
  if (error instanceof Error && error.name === 'AbortError')
    return 'Đã dừng chờ phản hồi. Hãy tải lại để kiểm tra dữ liệu đã được lưu hay chưa.';
  if (error instanceof Error && error.message === 'Cần địa chỉ gốc HTTPS của BHOME API.')
    return error.message;
  if (!(error instanceof MobileApiError))
    return 'Không thể hoàn thành. Kiểm tra kết nối và địa chỉ HTTPS.';
  if (error.code === 'invalid_credentials')
    return invalidCredentialsMessage + requestDiagnostic(error);
  if (error.problem && !['request_timeout', 'invalid_response'].includes(error.code ?? ''))
    return getUserFriendlyMessage(error) + requestDiagnostic(error);
  if (
    error.code === 'request_timeout' &&
    (contractDocumentTimeout(error.requestPath ?? '') > 15000 ||
      locationAssetHandoverDocumentTimeout(error.requestPath ?? ''))
  )
    return (
      'Tạo hoặc hiển thị tài liệu PDF mất quá nhiều thời gian. Dữ liệu đã lưu không bị thay đổi; hãy thử tải lại bản xem trước.' +
      requestDiagnostic(error)
    );
  const messages: Record<string, string> = {
    development_seed_unavailable:
      'Tính năng sinh hợp đồng mẫu chỉ dùng được trên Backend Development với DB local và đã bật cấu hình kiểm thử.',
    development_seed_password_not_configured:
      'Backend chưa cấu hình mật khẩu Tenant mẫu trong môi trường Development local.',
    development_seed_account_creation_failed:
      'Không tạo được tài khoản Tenant mẫu. Hãy kiểm tra cấu hình mật khẩu trong Backend.',
    resident_email_already_associated:
      'Email này đã gắn với một hồ sơ người ở. Hãy kiểm tra hồ sơ đã có hoặc sửa email nếu nhập nhầm.',
    resident_email_required: 'Mỗi người ở cần một email riêng hợp lệ.',
    secure_storage_unavailable:
      'Không truy cập được kho bảo mật của thiết bị. Hãy mở khóa thiết bị và thử đăng nhập lại.',
    request_timeout:
      'Máy chủ không phản hồi trong 15 giây. Kết quả chưa được xác nhận; hãy tải lại trước khi gửi lại.',
    invalid_response:
      'Phản hồi máy chủ không đúng định dạng BHOME. Kiểm tra địa chỉ API và phiên bản ứng dụng.',
    invalid_credentials: invalidCredentialsMessage,
    human_confirmation_required: 'Bạn cần xác nhận đã kiểm tra dữ liệu.',
    duplicate_or_conflicting_record:
      'Dữ liệu bị trùng hoặc đã thay đổi. Hãy tải lại danh sách; hệ thống không tự gộp hồ sơ.',
    identity_already_confirmed:
      'Hồ sơ đã được xác nhận trước đó. Dữ liệu vừa nhập không được ghi đè. Dùng hồ sơ đã xác nhận để tiếp tục; liên hệ Owner nếu cần sửa hồ sơ.',
    confirmed_baseline_required: 'Chưa có chỉ số đầu kỳ. Hãy xác nhận chỉ số đầu kỳ trước.',
    meter_reset_or_rollover_requires_review:
      'Chỉ số thấp hơn lần ghi trước. Nếu đã thay công tơ, hãy báo chủ trọ.',
    reading_period_out_of_order: 'Ngày ghi không hợp lệ so với lần ghi trước. Hãy kiểm tra lại.',
    evidence_not_available: 'Ảnh minh chứng không còn hợp lệ. Hãy chụp lại.',
    task_already_confirmed: 'Chỉ số đã được xác nhận. Hãy tải lại để xem kết quả.',
    reading_correction_not_allowed: 'Chỉ số đã được sử dụng hoặc đã chốt, không thể sửa trực tiếp.',
    task_version_changed: 'Chỉ số đã thay đổi. Hãy tải lại trước khi sửa.',
    reading_date_or_precision: 'Ngày ghi hoặc chỉ số không hợp lệ. Hãy kiểm tra lại.',
    reading_integer_required: 'Chỉ số phải là số nguyên không âm.',
    invalid_reading_value: 'Chỉ số hoặc xác nhận đối chiếu ảnh không hợp lệ.',
    reading_date_in_future: 'Chưa đến ngày ghi chỉ số theo lịch.',
    task_closed: 'Nhiệm vụ đã kết thúc. Hãy tải lại danh sách.',
    active_contract_initial_required: 'Hợp đồng chưa đủ điều kiện ghi chỉ số đầu kỳ.',
    baseline_already_confirmed: 'Chỉ số đầu kỳ đã được xác nhận. Hãy tải lại.',
    staff_not_currently_assigned: 'Staff chưa được phân công Location có hiệu lực.',
    invalid_citizen_number: 'Số CCCD cần đúng 12 chữ số.',
    invalid_confirmed_identity:
      'Kiểm tra họ tên, ngày sinh và ngày cấp CCCD. Ngày sinh và ngày cấp không được ở tương lai.',
    invalid_input: 'Kiểm tra các ô bắt buộc và độ dài thông tin đã nhập.',
    stale_version: 'Công việc đã thay đổi. Hãy tải lại và kiểm tra trước khi gửi tiếp.',
    move_in_inventory_reinspection_not_passed:
      'Tài sản Owner yêu cầu kiểm tra lại chưa đạt hoặc thiếu số lượng. Hãy kiểm tra thực tế và lưu kết quả mới.',
    move_in_inventory_reinspection_new_evidence_required:
      'Chưa có ảnh mới sau yêu cầu kiểm tra lại của chủ trọ. Hãy chụp ảnh mới cho tài sản được chọn, kể cả khi đã Đạt.',
    move_in_inventory_checklist_incomplete:
      'Phiếu kiểm kê chưa đủ tình trạng, số lượng, ghi chú hoặc ảnh minh chứng bắt buộc.',
    move_in_inventory_evidence_missing:
      'Không tìm thấy một số ảnh kiểm kê đã liên kết. Hãy mở tài sản để kiểm tra và bổ sung ảnh.',
    no_responsible_staff:
      'Cơ sở chưa có nhân viên phụ trách có hiệu lực. Owner cần cập nhật phân công.',
    completion_evidence_required: 'Cần chọn ảnh kết quả trước khi gửi Owner kiểm tra.',
    invalid_task_work_or_deadline:
      'Kiểm tra tên, yêu cầu và thời hạn công việc; thời hạn mới phải ở tương lai.',
    task_note_required: 'Nhập nội dung, kết quả hoặc lý do cho thao tác công việc.',
    invalid_task_transition: 'Trạng thái công việc không cho phép thao tác này. Hãy tải lại.',
    task_resource_not_found: 'Công việc không khả dụng hoặc không thuộc phạm vi hiện tại của bạn.',
  };
  return (
    ((error.code && messages[error.code]) ||
      (
        {
          0: 'Kết nối tới máy chủ đang gián đoạn. Hãy kiểm tra mạng rồi thử lại. API nội bộ cần cùng mạng với máy chủ và chứng chỉ HTTPS được tin cậy; dùng API HTTPS công khai để kết nối qua mạng khác hoặc 4G/5G.',
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
// DOCX→PDF and PDF→PNG each have a 45-second server conversion deadline.
// Final Move-Out inspection verifies private evidence files and can require
// more time than an ordinary read. Mutations are never automatically replayed.
function contractDocumentTimeout(path: string): number {
  return /^\/api\/v1\/contracts\/main-drafts\/[a-f0-9-]{36}\/(?:signing-review|documents(?:\/[a-f0-9-]{36}\/pages\/[1-9][0-9]*)?)$/i.test(
    path,
  )
    ? 60000
    : 15000;
}
function locationAssetHandoverDocumentTimeout(path: string): boolean {
  return (
    /^\/api\/v1\/operational-tasks\/[a-f0-9-]{36}\/location-asset-handover\/document(?:\/preview|\/pages\/[1-9][0-9]*)?$/i.test(
      path,
    ) ||
    /^\/api\/v1\/location-asset-handovers\/archive\/[a-f0-9-]{36}\/revisions\/[1-9][0-9]*\/document$/i.test(
      path,
    )
  );
}
function requestTimeout(path: string): number {
  if (locationAssetHandoverDocumentTimeout(path)) return 60000;
  if (/^\/api\/v1\/contracts\/[a-f0-9-]{36}\/move-out\/inspection$/i.test(path)) return 60000;
  return contractDocumentTimeout(path);
}
export class MobileApi {
  readonly queryCache = new QueryCache();
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
    const sendOnce = () =>
      mobileResponse(
        this.base,
        path,
        { ...init, headers },
        this.transport,
        async (response) => {
          if (response.status === 204) return undefined as T;
          if (responseType === 'bytes') {
            const draftDocument =
              /^\/api\/v1\/contracts\/main-drafts\/[^/]+\/documents\/[^/]+$/.test(path);
            const mime = (response.headers.get('content-type') ?? '')
              .split(';')[0]!
              .trim()
              .toLowerCase();
            if (
              draftDocument &&
              ![
                'application/pdf',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              ].includes(mime)
            )
              throw new MobileApiError(502, 'draft_download_invalid', path);
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (draftDocument) {
              const signature = mime === 'application/pdf' ? [37, 80, 68, 70, 45] : [80, 75, 3, 4];
              if (
                bytes.length < signature.length ||
                signature.some((value, index) => bytes[index] !== value)
              ) {
                bytes.fill(0);
                throw new MobileApiError(502, 'draft_download_invalid', path);
              }
            }
            return bytes as T;
          }
          return responseType === 'blob'
            ? (response.blob() as Promise<T>)
            : (response.json() as Promise<T>);
        },
        requestTimeout(path),
      );
    const send = async () => {
      try {
        return await sendOnce();
      } catch (error) {
        // Only retry reads on a brief transport interruption, against the same trusted origin.
        // A lost mutation/refresh response may already have committed on the server.
        if (
          !['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase()) ||
          !(error instanceof MobileApiError) ||
          error.code !== 'network_unavailable' ||
          init.signal?.aborted
        )
          throw error;
        await new Promise<void>((resolve, reject) => {
          const finish = () => {
            init.signal?.removeEventListener('abort', cancel);
            resolve();
          };
          const timer = setTimeout(finish, 750);
          const cancel = () => {
            clearTimeout(timer);
            init.signal?.removeEventListener('abort', cancel);
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          };
          init.signal?.addEventListener('abort', cancel);
          if (init.signal?.aborted) cancel();
        });
        return sendOnce();
      }
    };
    const received = (value: T) => {
      if (['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase())) {
        if (responseType === 'json') {
          this.queryCache.observePayment(path, value);
          this.queryCache.observeNotifications(path, value);
        }
      } else this.queryCache.invalidate(mutationTags(path.split('?')[0]));
      return value;
    };
    try {
      try {
        return received(await send());
      } catch (error) {
        if (!(error instanceof MobileApiError) || error.status !== 401 || !original) throw error;
        const next = this.token() !== original ? this.token() : await this.refresh();
        if (!next) throw error;
        headers.set('Authorization', 'Bearer ' + next);
        return received(await send());
      }
    } catch (error) {
      if (error instanceof MobileApiError && error.status === 401) {
        this.queryCache.dispose();
        this.expired();
      }
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
