import messageCatalog from './errorMessages.json';

export interface FieldError {
  code: string;
  message: string;
}
// Only local validation code creates this type; server/transport failures never do.
export class UserFeedbackError extends Error {
  override name = 'UserFeedbackError';
}
export interface ApiProblem {
  code?: string;
  title?: string;
  detail?: string;
  status?: number;
  correlationId?: string;
  traceId?: string;
  message?: string;
  errors?: Record<string, string[]>;
  fieldErrors?: Record<string, FieldError[]>;
}
const messages: Readonly<Record<string, string>> = messageCatalog;
const knownMessages = new Set(Object.values(messages));
export function knownApiMessage(value: unknown): string | undefined {
  return typeof value === 'string' && knownMessages.has(value) ? value : undefined;
}
const statuses: Readonly<Record<number, string>> = {
  0: 'Kết nối máy chủ bị gián đoạn. Kiểm tra mạng và trạng thái dữ liệu trước khi gửi lại.',
  400: 'Thông tin nhập chưa hợp lệ. Vui lòng kiểm tra các trường được đánh dấu.',
  401: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
  403: 'Tài khoản không được phép thực hiện thao tác này.',
  404: 'Tài nguyên không khả dụng hoặc nằm ngoài phạm vi được phân công.',
  409: 'Dữ liệu đã thay đổi hoặc xung đột. Tải lại và kiểm tra trước khi lưu.',
  413: 'Dữ liệu tải lên quá lớn. Giảm dung lượng tệp rồi thử lại.',
  415: 'Định dạng dữ liệu không được hỗ trợ. Kiểm tra loại tệp và định dạng yêu cầu.',
  429: 'Bạn gửi quá nhiều yêu cầu. Vui lòng chờ rồi thử lại.',
  503: 'Dịch vụ đang tạm gián đoạn. Kiểm tra trạng thái dữ liệu trước khi gửi lại.',
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function safeFieldMessage(value: unknown): string {
  return typeof value === 'string' &&
    value.length <= 600 &&
    [...value].some((c) => c.charCodeAt(0) > 127) &&
    !/\b(?:exception|stacktrace|select|insert|update|delete|password\s*[:=]|token\s*[:=]|connection\s*string)\b|[\r\n<>]/i.test(
      value,
    )
    ? value
    : 'Trường này chưa hợp lệ. Kiểm tra định dạng và giá trị cho phép.';
}
function fieldName(value: string) {
  return value
    .replace(/^\$\.?/, '')
    .split('.')
    .map((part) => part.charAt(0).toLowerCase() + part.slice(1))
    .join('.');
}
export function normalizeApiProblem(
  value: unknown,
  status: number,
  correlationId?: string | null,
): ApiProblem {
  const source = record(value);
  const errors: Record<string, string[]> = Object.create(null);
  const fieldErrors: Record<string, FieldError[]> = Object.create(null);
  for (const [key, values] of Object.entries(record(source?.errors) ?? {})) {
    if (
      !Array.isArray(values) ||
      !/^[\w.$[\]-]{0,200}$/.test(key) ||
      /__proto__|constructor|prototype/.test(key)
    )
      continue;
    errors[key] = values.slice(0, 20).map(safeFieldMessage);
  }
  for (const [key, values] of Object.entries(record(source?.fieldErrors) ?? {})) {
    if (
      !Array.isArray(values) ||
      !/^[\w.$[\]-]{0,200}$/.test(key) ||
      /__proto__|constructor|prototype/.test(key)
    )
      continue;
    fieldErrors[fieldName(key)] = values.slice(0, 20).map((item) => ({
      code: typeof record(item)?.code === 'string' ? String(record(item)!.code) : 'invalid_field',
      message: safeFieldMessage(record(item)?.message),
    }));
  }
  return {
    status,
    code: typeof source?.code === 'string' ? source.code : undefined,
    correlationId:
      correlationId ??
      (typeof source?.correlationId === 'string' ? source.correlationId : undefined),
    traceId: typeof source?.traceId === 'string' ? source.traceId : undefined,
    // The signing application explicitly publishes bounded, localized refusals.
    // Other server detail/title text remains outside the user-facing contract.
    message:
      knownApiMessage(source?.message ?? source?.detail) ??
      (typeof source?.code === 'string' && source.code.startsWith('digital_signing_')
        ? safeFieldMessage(source.message ?? source.detail)
        : undefined),
    errors,
    fieldErrors,
  };
}
export function getFieldErrors(error: unknown): Record<string, string> {
  const value = record(error);
  if (typeof value?.status === 'number' && ![400, 409, 422].includes(value.status)) return {};
  const problem = normalizeApiProblem(
    value?.problem ?? value,
    typeof value?.status === 'number' ? value.status : 400,
  );
  const result: Record<string, string> = Object.create(null);
  for (const [key, values] of Object.entries(problem.errors ?? {}))
    result[fieldName(key)] = values.join(' ');
  for (const [key, values] of Object.entries(problem.fieldErrors ?? {}))
    result[key] = values.map((item) => item.message).join(' ');
  const knownField: Record<string, string> = {
    email_already_used: 'email',
    phone_already_used: 'phone',
    invalid_phone_number: 'phone',
    current_password_required: 'currentPassword',
    current_password_invalid: 'currentPassword',
  };
  if (problem.code && knownField[problem.code])
    result[knownField[problem.code]] = messages[problem.code] ?? statuses[400];
  return result;
}
export function getUserFriendlyMessage(error: unknown): string {
  if (error instanceof UserFeedbackError) return error.message;
  const value = record(error);
  const problem = record(value?.problem);
  const code = value?.code ?? problem?.code;
  const status = typeof value?.status === 'number' ? value.status : 500;
  // Access refusals always use scope-neutral messages, even if a server returns a specific code.
  if ([401, 403, 404].includes(status)) return statuses[status];
  const known = knownApiMessage(problem?.message);
  if (known) return known;
  if (
    typeof code === 'string' &&
    code.startsWith('digital_signing_') &&
    typeof problem?.message === 'string'
  )
    return safeFieldMessage(problem.message);
  return (
    (typeof code === 'string' && messages[code]) ||
    statuses[status] ||
    'Máy chủ chưa xử lý được yêu cầu. Tải lại để kiểm tra kết quả; cung cấp mã truy vết nếu lỗi tiếp diễn.'
  );
}
export function catalogError(error: unknown): string | undefined {
  if (error instanceof UserFeedbackError) return error.message;
  const value = record(error),
    problem = record(value?.problem);
  const code = value?.code ?? problem?.code;
  return (typeof code === 'string' && messages[code]) || knownApiMessage(problem?.message)
    ? getUserFriendlyMessage(error)
    : undefined;
}
export function infrastructureError(error: unknown): string | undefined {
  const value = error as { code?: string; problem?: { code?: string } } | null;
  if ((value?.code ?? value?.problem?.code) === 'database_schema_incompatible')
    return 'Máy chủ và cơ sở dữ liệu chưa đồng bộ. Cần quản trị viên cập nhật hệ thống.';
  return undefined;
}
export function requestDiagnostic(error: {
  status?: number;
  requestPath?: string;
  correlationId?: string;
  method?: string;
}): string {
  const path = error.requestPath?.split('?')[0];
  const route = path && /^\/(?:api\/v1\/[a-zA-Z0-9/-]+|health\/ready)$/.test(path) ? path : '';
  const id =
    error.correlationId &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(error.correlationId)
      ? ` · Mã truy vết: ${error.correlationId}`
      : '';
  return `${route ? ` · ${/^(GET|POST|PUT|DELETE|PATCH)$/.test(error.method ?? '') ? error.method : 'GET'} ${route}` : ''}${error.status ? ` · HTTP ${error.status}` : ''}${id}`;
}
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem?: ApiProblem,
  ) {
    super(getUserFriendlyMessage({ status, problem }));
    this.name = 'ApiError';
  }
}
export function createApiClient(
  baseUrl: string,
  getToken: () => string | undefined = () => undefined,
  onUnauthorized: () => void = () => {},
  refresh?: () => Promise<string | undefined>,
) {
  return async function request<T>(
    path: string,
    init: RequestInit = {},
    responseType: 'json' | 'blob' | 'bytes' = 'json',
  ): Promise<T> {
    if (!path.startsWith('/api/v1/') || path.includes('..') || path.includes('://')) {
      throw new Error('Expected a versioned relative API path.');
    }
    const headers = new Headers(init.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    const multipart = typeof FormData !== 'undefined' && init.body instanceof FormData;
    if (init.body && !multipart && !headers.has('Content-Type'))
      headers.set('Content-Type', 'application/json');
    const token = getToken();
    if (token) headers.set('Authorization', 'Bearer ' + token);
    let response: Response;
    try {
      response = await fetch(baseUrl + path, {
        ...init,
        headers,
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError(0);
    }
    if (response.status === 401 && refresh && token) {
      const nextToken = getToken() !== token ? getToken() : await refresh();
      if (nextToken) {
        headers.set('Authorization', 'Bearer ' + nextToken);
        try {
          response = await fetch(baseUrl + path, {
            ...init,
            headers,
            credentials: 'omit',
            cache: 'no-store',
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
          throw new ApiError(0);
        }
      }
    }
    if (!response.ok) {
      if (response.status === 401) onUnauthorized();
      const problem = normalizeApiProblem(
        response.headers.get('content-type')?.includes('json')
          ? await response.json().catch(() => undefined)
          : undefined,
        response.status,
        response.headers.get('X-Correlation-ID'),
      );
      throw new ApiError(response.status, problem);
    }
    if (response.status === 204) return undefined as T;
    try {
      if (responseType === 'bytes') return new Uint8Array(await response.arrayBuffer()) as T;
      return responseType === 'blob'
        ? ((await response.blob()) as T)
        : ((await response.json()) as T);
    } catch (error) {
      if (init.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError'))
        throw error;
      throw new ApiError(502, { code: 'invalid_response' });
    }
  };
}
