import type { QueryPolicy, QueryTag } from './queryCache';
const policy = (staleTime: number, ...tags: QueryTag[]): QueryPolicy => ({
  staleTime,
  gcTime: 20 * 60_000,
  tags,
});
export const queryPolicies = {
  profile: policy(5 * 60_000, 'profile'),
  rooms: policy(10 * 60_000, 'rooms'),
  contracts: policy(10 * 60_000, 'contracts'),
  invoices: policy(60_000, 'invoices'),
  payments: policy(30_000, 'payments'),
  debts: policy(60_000, 'debts'),
  notifications: policy(30_000, 'notifications'),
  tasks: policy(30_000, 'tasks'),
  meters: policy(5 * 60_000, 'meters'),
  incidents: policy(30_000, 'incidents'),
} as const;

// Only successful server mutations reach this mapping. Never update business status locally.
export function mutationTags(path: string): QueryTag[] {
  if (/\/(?:evidence|ocr|diagnostics|preview|previews)(?:\/|$)/.test(path)) return [];
  if (/^\/api\/v1\/notifications(?:\/|$)/.test(path)) return ['notifications'];
  if (/^\/api\/v1\/operational-tasks(?:\/|$)/.test(path)) return ['tasks', 'notifications'];
  if (path === '/api/v1/incidents') return ['incidents', 'notifications'];
  if (/^\/api\/v1\/(?:incidents|maintenance|work-orders)(?:\/|$)/.test(path))
    return ['incidents', 'tasks', 'notifications'];
  if (
    /^\/api\/v1\/(?:invoices|invoice-adjustments|payment-transactions|payments|bank-statements)(?:\/|$)/.test(
      path,
    )
  )
    return ['invoices', 'payments', 'debts', 'notifications'];
  if (/^\/api\/v1\/contracts(?:\/|$)/.test(path)) {
    if (path.includes('/handover'))
      return ['contracts', 'rooms', 'meters', 'tasks', 'notifications'];
    if (
      /\/(?:activate|holding-activation|holding-cancellation|holding-conversion|deposit-verifications|renewals|move-out|expiry-move-out)(?:\/|$)/.test(
        path,
      )
    )
      return ['contracts', 'rooms', 'meters', 'invoices', 'payments', 'debts', 'notifications'];
    return ['contracts', 'rooms', 'notifications'];
  }
  if (/^\/api\/v1\/capture\//.test(path))
    return /meter|reading/.test(path)
      ? ['meters', 'tasks', 'invoices', 'notifications']
      : ['rooms', 'contracts'];
  if (
    /^\/api\/v1\/(?:locations|rooms|staff|staff-assignments|assignments|residents)(?:\/|$)/.test(
      path,
    )
  )
    return ['rooms', 'contracts', 'tasks', 'meters'];
  return [];
}
