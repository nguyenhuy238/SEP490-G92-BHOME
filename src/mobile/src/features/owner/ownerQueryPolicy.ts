import type { QueryPolicy } from '../../lib/queryCache';

export const ownerQueuePolicy: QueryPolicy = {
  staleTime: 30_000,
  gcTime: 20 * 60_000,
  tags: ['contracts', 'tasks', 'incidents', 'invoices', 'payments', 'notifications'],
};
