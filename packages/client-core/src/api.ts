export interface ApiProblem {
  title?: string;
  status?: number;
  correlationId?: string;
  errors?: Record<string, string[]>;
}
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem?: ApiProblem,
  ) {
    super('Không thể hoàn thành yêu cầu. Vui lòng thử lại.');
    this.name = 'ApiError';
  }
}
export function createApiClient(
  baseUrl: string,
  getToken: () => string | undefined = () => undefined,
  onUnauthorized: () => void = () => {},
) {
  return async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!path.startsWith('/api/v1/') || path.includes('..') || path.includes('://')) {
      throw new Error('Expected a versioned relative API path.');
    }
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    const token = getToken();
    if (token) headers.set('Authorization', 'Bearer ' + token);
    let response: Response;
    try {
      response = await fetch(baseUrl + path, { ...init, headers, credentials: 'omit' });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError(0);
    }
    if (!response.ok) {
      if (response.status === 401) onUnauthorized();
      const problem = response.headers.get('content-type')?.includes('json')
        ? ((await response.json().catch(() => undefined)) as ApiProblem | undefined)
        : undefined;
      throw new ApiError(response.status, problem);
    }
    return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
  };
}
