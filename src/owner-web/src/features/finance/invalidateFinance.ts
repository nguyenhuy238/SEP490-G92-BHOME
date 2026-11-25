import type { QueryClient } from '@tanstack/react-query';

// Financial views use both the shared ledger keys and Location workspace keys.
export function invalidateFinance(client: QueryClient, actor?: string, locationId?: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['expenses', actor] }),
    client.invalidateQueries({ queryKey: ['financial-report', actor] }),
    client.invalidateQueries({ queryKey: ['finance-expense-sources', actor] }),
    client.invalidateQueries({ queryKey: ['finance-ledger-sources', actor] }),
    client.invalidateQueries({ queryKey: ['finance-depreciation-sources', actor] }),
    client.invalidateQueries({ queryKey: ['asset-replacement-review', actor] }),
    client.invalidateQueries({ queryKey: ['scenario-defaults', actor] }),
    ...['report', 'capital-report', 'capital-assets', 'expenses', 'recurring'].map((section) =>
      client.invalidateQueries({
        queryKey: ['location-finance', section, actor, ...(locationId ? [locationId] : [])],
      }),
    ),
  ]);
}
