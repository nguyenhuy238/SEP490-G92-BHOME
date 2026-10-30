import { ApiError } from './api';
import type { Session } from './auth';

type SessionResponse = Session & { refreshToken?: string | null };
export type AuthTransport = 'web' | 'mobile';

// Credentials live only here in memory. Web refresh credentials are managed by the HttpOnly cookie.
export class SessionClient {
  private current: SessionResponse | null = null;
  private pendingRefresh: Promise<string | undefined> | undefined;
  private revision = 0;
  private listeners = new Set<(session: Session | null) => void>();

  constructor(
    private readonly baseUrl: string,
    private readonly transport: AuthTransport,
  ) {}

  get token() {
    return this.current?.accessToken;
  }
  get session() {
    return this.current;
  }

  subscribe(listener: (session: Session | null) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  accept = (session: Session) => {
    this.revision++;
    this.publish(session);
  };

  clear = () => {
    this.revision++;
    this.publish(null);
  };

  private publish(session: SessionResponse | null) {
    this.current = session;
    for (const listener of this.listeners) listener(session);
  }

  async login(email: string, password: string) {
    if (this.pendingRefresh) await this.pendingRefresh.catch(() => undefined);
    const version = ++this.revision;
    const response = await this.send<SessionResponse>('login', { email: email.trim(), password });
    if (version === this.revision) this.publish(response);
  }

  refresh = (): Promise<string | undefined> => {
    if (this.pendingRefresh) return this.pendingRefresh;
    if (this.transport === 'mobile' && !this.current?.refreshToken)
      return Promise.resolve(undefined);
    const version = this.revision;
    this.pendingRefresh = this.send<SessionResponse>(
      'refresh',
      this.transport === 'web' ? {} : { refreshToken: this.current?.refreshToken },
    )
      .then((response) => {
        if (version !== this.revision) return undefined;
        this.publish(response);
        return response.accessToken;
      })
      .catch((error: unknown) => {
        if (version === this.revision && error instanceof ApiError && error.status === 401)
          this.clear();
        throw error;
      })
      .finally(() => {
        this.pendingRefresh = undefined;
      });
    return this.pendingRefresh;
  };

  async logout(allDevices = false) {
    // Wait for rotation first so a late Set-Cookie cannot recreate a logged-out web credential.
    if (this.pendingRefresh) await this.pendingRefresh.catch(() => undefined);
    try {
      if (this.current) await this.send(allDevices ? 'logout-all' : 'logout', {});
    } finally {
      this.clear();
    }
  }

  async changePassword(currentPassword: string, newPassword: string) {
    await this.send('change-password', { currentPassword, newPassword });
    this.clear();
  }

  requestPasswordReset(userName: string) {
    return this.send('forgot-password', { userName });
  }
  resetPassword(userName: string, token: string, newPassword: string) {
    return this.send('reset-password', { userName, token, newPassword });
  }

  private async send<T>(action: string, body: unknown, retry = true): Promise<T> {
    // Web Locks also serializes cookie mutations across tabs on supporting browsers.
    const operation =
      this.transport === 'web' && typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request('bhome-auth-cookie', () => this.fetchAuth<T>(action, body))
        : this.fetchAuth<T>(action, body);
    const response = await operation.catch(async (error: unknown) => {
      if (
        retry &&
        error instanceof ApiError &&
        error.status === 401 &&
        this.current &&
        !['login', 'refresh', 'forgot-password', 'reset-password'].includes(action)
      ) {
        if (await this.refresh()) return this.send<T>(action, body, false);
      }
      throw error;
    });
    return response;
  }

  private async fetchAuth<T>(action: string, body: unknown): Promise<T> {
    const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
    if (this.transport === 'web') headers.set('X-BHome-Client', 'web');
    if (
      this.current?.accessToken &&
      !['login', 'refresh', 'forgot-password', 'reset-password'].includes(action)
    )
      headers.set('Authorization', 'Bearer ' + this.current.accessToken);
    let response: Response;
    try {
      response = await fetch(this.baseUrl + '/api/v1/auth/' + action, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        credentials: this.transport === 'web' ? 'include' : 'omit',
      });
    } catch {
      throw new ApiError(0);
    }
    if (!response.ok) throw new ApiError(response.status);
    return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
  }
}
