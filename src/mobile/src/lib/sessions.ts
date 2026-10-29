import { MobileApi, MobileApiError, apiBaseUrl, type Session } from './api';

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
    this.writes = work;
    return work;
  }
  async clear() {
    const epoch = ++this.epoch;
    this.credential = undefined;
    this.emit({ session: null, api: null });
    await this.persist(epoch, null);
  }
  private api(base: string) {
    return new MobileApi(
      base,
      () => this.value.session?.accessToken,
      () => this.refresh(),
      () => {
        void this.clear().catch(() => {});
      },
      this.transport,
    );
  }
  private async auth(base: string, route: string, body: unknown): Promise<Session> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.transport(base + '/api/v1/auth/' + route, {
        method: 'POST',
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw new MobileApiError(
          response.status,
          route === 'login' && response.status === 401 ? 'invalid_credentials' : undefined,
        );
      return (await response.json()) as Session;
    } catch (error) {
      if (error instanceof MobileApiError) throw error;
      throw new MobileApiError(0);
    } finally {
      clearTimeout(timeout);
    }
  }
  restore() {
    if (this.restoreTask) return this.restoreTask;
    this.restoreTask = (async () => {
      try {
        const encoded = await this.store.read();
        if (encoded) {
          const saved = JSON.parse(encoded) as {
            base: string;
            refreshToken: string;
            serverId?: string;
          };
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
      } catch {
        await this.clear();
      } finally {
        this.emit({ ready: true });
      }
    })();
    return this.restoreTask;
  }
  refresh() {
    if (this.refreshTask) return this.refreshTask;
    const previous = this.credential;
    const epoch = this.epoch;
    const base = this.value.baseUrl;
    this.refreshTask = (async () => {
      if (!previous) return undefined;
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
      } catch {
        if (epoch === this.epoch) await this.clear();
        return undefined;
      } finally {
        this.refreshTask = null;
      }
    })();
    return this.refreshTask;
  }
  async login(input: string, email: string, password: string) {
    const base = apiBaseUrl(input);
    await this.clear();
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
