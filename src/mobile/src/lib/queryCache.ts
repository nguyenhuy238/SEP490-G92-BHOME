// Private, memory-only cache owned by one MobileApi/session. No tokens or persisted data.
export type QueryTag =
  | 'profile'
  | 'rooms'
  | 'contracts'
  | 'invoices'
  | 'payments'
  | 'debts'
  | 'notifications'
  | 'tasks'
  | 'meters'
  | 'incidents';
export interface QueryPolicy {
  staleTime: number;
  gcTime: number;
  tags: readonly QueryTag[];
}
export interface QuerySnapshot {
  data: unknown;
  hasData: boolean;
  error: unknown;
  updatedAt: number;
  fetching: boolean;
  invalidated: boolean;
}
export interface CachedQuery {
  key: string;
  path: string;
  policy: QueryPolicy;
  load: (signal: AbortSignal) => Promise<unknown>;
  state: QuerySnapshot;
  listeners: Set<() => void>;
  active: number;
  version: number;
  retired: boolean;
  request?: AbortController;
  pending?: Promise<void>;
  gc?: ReturnType<typeof setTimeout>;
}
const empty = (): QuerySnapshot => ({
  data: undefined,
  hasData: false,
  error: null,
  updatedAt: 0,
  fetching: false,
  invalidated: true,
});
export class QueryCache {
  private entries = new Map<string, CachedQuery>();
  private decoderIds = new WeakMap<object, number>();
  private decoderSequence = 0;
  private closed = false;
  private foreground = true;
  private paymentStates = new Map<string, string>();
  private notificationPages = new Map<string, Set<string>>();
  private unreadCount: number | undefined;

  query(
    scope: string,
    path: string,
    policy: QueryPolicy,
    load: CachedQuery['load'],
    decoder?: object,
  ) {
    let id = decoder ? this.decoderIds.get(decoder) : 0;
    if (decoder && id === undefined) {
      id = ++this.decoderSequence;
      this.decoderIds.set(decoder, id);
    }
    const key = JSON.stringify([scope, path, id]);
    const existing = this.entries.get(key);
    if (existing) return existing;
    // Bound memory even during long sessions visiting many filters/rooms.
    if (this.entries.size >= 100) {
      const idle = [...this.entries.values()].find(
        (entry) => !entry.listeners.size && !entry.active,
      );
      if (idle) this.remove(idle);
    }
    const entry: CachedQuery = {
      key,
      path,
      policy,
      load,
      state: empty(),
      listeners: new Set(),
      active: 0,
      version: 0,
      retired: this.closed,
    };
    if (!this.closed) this.entries.set(key, entry);
    return entry;
  }
  private publish(entry: CachedQuery, change: Partial<QuerySnapshot>) {
    entry.state = { ...entry.state, ...change };
    entry.listeners.forEach((listener) => listener());
  }
  subscribe(entry: CachedQuery, listener: () => void) {
    if (entry.gc) clearTimeout(entry.gc);
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size && !entry.retired && !this.closed) {
        entry.gc = setTimeout(() => this.remove(entry), entry.policy.gcTime);
      }
    };
  }
  activate(entry: CachedQuery) {
    entry.active++;
    void this.fetch(entry);
    return () => {
      entry.active = Math.max(0, entry.active - 1);
    };
  }
  isStale(entry: CachedQuery) {
    return (
      entry.state.invalidated ||
      !entry.state.hasData ||
      Date.now() - entry.state.updatedAt >= entry.policy.staleTime
    );
  }
  fetch(entry: CachedQuery, force = false): Promise<void> {
    if (this.closed || entry.retired || !this.foreground) return Promise.resolve();
    if (entry.pending) return entry.pending;
    if (!force && !this.isStale(entry)) return Promise.resolve();
    const request = new AbortController(),
      version = ++entry.version;
    entry.request = request;
    this.publish(entry, { fetching: true, error: null });
    const valid = () =>
      !this.closed && !entry.retired && !request.signal.aborted && entry.version === version;
    const pending = Promise.resolve()
      .then(() => (valid() ? entry.load(request.signal) : undefined))
      .then(
        (data) => {
          if (valid())
            this.publish(entry, {
              data,
              hasData: true,
              error: null,
              updatedAt: Date.now(),
              fetching: false,
              invalidated: false,
            });
        },
        (error) => {
          if (!valid()) return;
          const status = error && typeof error === 'object' && 'status' in error ? error.status : 0;
          // Authorization/resource failures must never leave private cached content visible.
          const denied = status === 401 || status === 403 || status === 404;
          this.publish(entry, {
            ...(denied ? { data: undefined, hasData: false, updatedAt: 0 } : {}),
            error,
            fetching: false,
            invalidated: true,
          });
        },
      )
      .finally(() => {
        if (entry.pending === pending) {
          entry.pending = undefined;
          entry.request = undefined;
        }
      });
    entry.pending = pending;
    return pending;
  }
  // Publish a confirmed mutation response and retire reads of the older version.
  setData(entry: CachedQuery, data: unknown) {
    if (this.closed || entry.retired) return;
    entry.version++;
    entry.request?.abort();
    entry.request = undefined;
    entry.pending = undefined;
    this.publish(entry, {
      data,
      hasData: true,
      error: null,
      updatedAt: Date.now(),
      fetching: false,
      invalidated: false,
    });
  }
  invalidate(tags: readonly QueryTag[], exceptPath?: string) {
    if (this.closed) return;
    for (const entry of this.entries.values()) {
      if (entry.path === exceptPath || !entry.policy.tags.some((tag) => tags.includes(tag)))
        continue;
      entry.version++;
      entry.request?.abort();
      entry.pending = undefined;
      this.publish(entry, { invalidated: true, fetching: false });
      if (entry.active) void this.fetch(entry);
    }
  }
  setForeground(active: boolean) {
    if (this.foreground === active) return;
    this.foreground = active;
    for (const entry of this.entries.values()) {
      if (active) {
        if (entry.active) void this.fetch(entry);
      } else if (entry.pending) {
        entry.version++;
        entry.request?.abort();
        entry.pending = undefined;
        this.publish(entry, { fetching: false });
      }
    }
  }
  observePayment(path: string, value: unknown) {
    if (this.closed) return;
    if (!/^\/api\/v1\/invoices\/[^/]+\/payment$/.test(path) || !value || typeof value !== 'object')
      return;
    const state = value as Record<string, unknown>;
    if (!['Paid', 'Unpaid', 'NotIssued'].includes(String(state.paymentStatus))) return;
    const signature = JSON.stringify([
      state.paymentStatus,
      state.payableAmount,
      state.paidAmount,
      state.outstandingAmount,
      state.pendingReview,
      state.reviewStatus,
    ]);
    const before = this.paymentStates.get(path);
    if (this.paymentStates.size >= 100)
      this.paymentStates.delete(this.paymentStates.keys().next().value!);
    this.paymentStates.set(path, signature);
    if (before !== undefined && before !== signature)
      this.invalidate(['invoices', 'payments', 'debts'], path);
  }
  observeNotifications(path: string, value: unknown) {
    if (this.closed || !value || typeof value !== 'object') return;
    const result = value as Record<string, unknown>;
    if (path === '/api/v1/notifications/unread-count' && Number.isSafeInteger(result.unreadCount)) {
      const count = result.unreadCount as number;
      const previous = this.unreadCount;
      this.unreadCount = count;
      if (previous !== undefined && count > previous) this.invalidate(['notifications'], path);
      return;
    }
    if (!path.startsWith('/api/v1/notifications?') || !Array.isArray(result.items)) return;
    const rows = result.items.filter(
      (row): row is Record<string, unknown> =>
        !!row && typeof row === 'object' && typeof row.id === 'string',
    );
    const previous = this.notificationPages.get(path);
    if (this.notificationPages.size >= 50)
      this.notificationPages.delete(this.notificationPages.keys().next().value!);
    this.notificationPages.set(path, new Set(rows.map((row) => row.id as string)));
    if (!previous) return;
    const tags = new Set<QueryTag>();
    for (const row of rows) {
      if (previous.has(row.id as string)) continue;
      if (['Invoice', 'Payment', 'Adjustment'].includes(String(row.category)))
        ['invoices', 'payments', 'debts'].forEach((tag) => tags.add(tag as QueryTag));
      if (row.category === 'Contract') {
        tags.add('contracts');
        tags.add('rooms');
      }
      if (row.category === 'Task') tags.add('tasks');
      if (row.relatedObjectType === 'MeterTask') {
        tags.add('meters');
        tags.add('tasks');
      }
      if (row.relatedObjectType === 'Incident' || row.relatedObjectType === 'WorkOrder')
        tags.add('incidents');
    }
    this.invalidate([...tags], path);
  }
  private remove(entry: CachedQuery) {
    entry.retired = true;
    entry.version++;
    entry.request?.abort();
    if (entry.gc) clearTimeout(entry.gc);
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    this.publish(entry, empty());
  }
  dispose() {
    this.closed = true;
    for (const entry of this.entries.values()) this.remove(entry);
    this.paymentStates.clear();
    this.notificationPages.clear();
    this.unreadCount = undefined;
  }
}
