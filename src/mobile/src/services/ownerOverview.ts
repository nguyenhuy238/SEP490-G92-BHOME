import { MobileApiError, type MobileApi } from '../lib/api';

export interface OwnerOverview {
  locations: number;
  rooms: number;
  occupiedRooms: number;
  contracts: number;
}

// Counts come from server-scoped, paginated queries, never from a truncated item list.
export async function loadOwnerOverview(
  api: MobileApi,
  signal: AbortSignal,
): Promise<OwnerOverview> {
  const paths = [
    '/api/v1/locations?page=1&pageSize=1',
    '/api/v1/rooms?page=1&pageSize=1',
    '/api/v1/rooms?page=1&pageSize=1&roomStatus=2',
    '/api/v1/contracts?page=1&pageSize=1',
  ];
  const counts = await Promise.all(
    paths.map(async (path) => {
      const page = await api.request<{ items: unknown[]; totalCount: number }>(path, { signal });
      if (
        !page ||
        !Array.isArray(page.items) ||
        !Number.isSafeInteger(page.totalCount) ||
        page.totalCount < page.items.length
      )
        throw new MobileApiError(502, 'invalid_response', path);
      return page.totalCount;
    }),
  );
  return {
    locations: counts[0]!,
    rooms: counts[1]!,
    occupiedRooms: counts[2]!,
    contracts: counts[3]!,
  };
}
