import {
  MobileApi,
  MobileApiError,
  apiBaseUrl,
  errorMessage,
  mobileResponse,
  type Session,
} from './api';

export interface CredentialStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}
export interface SessionView {
  session: Session | null;
  baseUrl: string;
  ready: boolean;
  api: MobileApi | null;
  restoreError?: string;
}
// Refresh, restore and Keychain writes are serialized, including React Strict Mode/remounts.
export class MobileSessions {
  private value: SessionView;
  private epoch = 0;
  private credential: string | undefined;
  private refreshTask: Promise<string | undefined> | null = null;
  private restoreTask: Promise<void> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private listeners = new Set<(view: SessionView) => void>();
  constructor(
    private store: CredentialStore,
    private configuredBase = '',
    private transport: typeof fetch = fetch,
    private serverId?: string,
  ) {
    this.value = { session: null, baseUrl: configuredBase, ready: false, api: null };
  }
  get snapshot() {
    return this.value;
  }
  subscribe(callback: (view: SessionView) => void) {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }
  private emit(change: Partial<SessionView>) {
    this.value = { ...this.value, ...change };
    for (const callback of this.listeners) callback(this.value);
  }
  private persist(epoch: number, value: string | null) {
    const work = this.writes
      .catch(() => {})
      .then(async () => {
        if (epoch === this.epoch) {
          if (value === null) await this.store.remove();
          else await this.store.write(value);
        }
      });
    const protectedWork = work.catch(() => {
      throw new MobileApiError(0, 'secure_storage_unavailable');
    });
    this.writes = protectedWork;
    return protectedWork;
  }
  async clear() {
    const epoch = ++this.epoch;
    this.credential = undefined;
    this.emit({ session: null, api: null, restoreError: undefined });
    await this.persist(epoch, null);
  }
  private api(base: string) {
    const epoch = this.epoch;
    return new MobileApi(
      base,
      () => (epoch === this.epoch ? this.value.session?.accessToken : undefined),
      () => (epoch === this.epoch ? this.refresh() : Promise.resolve(undefined)),
      () => {
        if (epoch === this.epoch) void this.clear().catch(() => {});
      },
      this.transport,
    );
  }
  private async auth(base: string, route: string, body: unknown): Promise<Session> {
    try {
      return await mobileResponse(
        base,
        '/api/v1/auth/' + route,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        this.transport,
        async (response) => {
          const value: unknown = await response.json();
          if (!value || typeof value !== 'object') throw new Error('Invalid session');
          const result = value as Session;
          if (
            ![result.userId, result.accessToken, result.refreshToken].every(
              (field) => typeof field === 'string' && field.trim().length > 0,
            ) ||
            !Array.isArray(result.roles) ||
            !result.roles.length ||
            !result.roles.every((role) => typeof role === 'string')
          )
            throw new Error('Invalid session');
          return result;
        },
      );
    } catch (error) {
      if (error instanceof MobileApiError && route === 'login' && error.status === 401)
        error.code = 'invalid_credentials';
      throw error;
    }
  }
  restore() {
    if (this.restoreTask) return this.restoreTask;
    const epoch = this.epoch;
    this.restoreTask = (async () => {
      try {
        const encoded = await this.store.read();
        if (epoch !== this.epoch) return;
        if (encoded) {
          const saved = JSON.parse(encoded) as {
            base: string;
            refreshToken: string;
            serverId?: string;
          };
          if (typeof saved.refreshToken !== 'string' || !saved.refreshToken.trim())
            throw new MobileApiError(502, 'invalid_response');
          const base = apiBaseUrl(saved.base);
          if (
            (this.configuredBase && apiBaseUrl(this.configuredBase) !== base) ||
            saved.serverId !== this.serverId
          ) {
            await this.clear();
            return;
          }
          this.credential = saved.refreshToken;
          this.emit({ baseUrl: base });
          await this.refresh();
        }
      } catch (error) {
        if (this.epoch === epoch || !this.value.session) {
          await this.clear().catch(() => {});
          this.emit({ restoreError: errorMessage(error) });
        }
      } finally {
        this.emit({ ready: true });
      }
    })();
    return this.restoreTask;
  }
  refresh() {
    if (this.refreshTask) return this.refreshTask;
    const previous = this.credential;
    if (!previous) return Promise.resolve(undefined);
    const epoch = this.epoch;
    const base = this.value.baseUrl;
    this.refreshTask = (async () => {
      try {
        const next = await this.auth(base, 'refresh', { refreshToken: previous });
        if (epoch !== this.epoch) return undefined;
        await this.persist(
          epoch,
          JSON.stringify({ base, refreshToken: next.refreshToken, serverId: this.serverId }),
        );
        if (epoch !== this.epoch) return undefined;
        this.credential = next.refreshToken;
        this.emit({ session: next, api: this.value.api || this.api(base) });
        return next.accessToken;
      } catch (error) {
        if (epoch === this.epoch) await this.clear();
        throw error;
      } finally {
        this.refreshTask = null;
      }
    })();
    return this.refreshTask;
  }
  async login(input: string, email: string, password: string) {
    const base = apiBaseUrl(input);
    await this.clear();
    this.emit({ baseUrl: base, restoreError: undefined });
    const epoch = this.epoch;
    const next = await this.auth(base, 'login', {
      email: email.trim(),
      password,
      device: 'BHOME Mobile',
    });
    if (epoch !== this.epoch) return;
    await this.persist(
      epoch,
      JSON.stringify({ base, refreshToken: next.refreshToken, serverId: this.serverId }),
    );
    if (epoch !== this.epoch) return;
    this.credential = next.refreshToken;
    this.emit({ baseUrl: base, session: next, api: this.api(base), ready: true });
  }
  async logout() {
    try {
      if (this.value.api) await this.value.api.json('/api/v1/auth/logout', {});
    } finally {
      await this.clear();
    }
  }
}
