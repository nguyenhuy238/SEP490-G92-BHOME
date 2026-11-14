import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import type { Page } from '../../../../../../packages/client-core/src/invoices';
import type { Incident } from '../../incidents/incidentContracts';

export interface RoomOccupancy {
  roomId: string;
  locationId: string;
  roomNumber: string;
  roomStatus: string;
  contractId: string | null;
  occupancyFrom: string | null;
  occupancyTo: string | null;
  occupants: { residentId: string; displayLabel: string; role: string }[];
}

// Bounded, Location-scoped list reads avoid one occupants/incidents call per card.
// A partial response must never be represented as zero occupants or no incidents.
export async function readRoomOperationsPages<T>(
  request: <R>(path: string, init?: RequestInit) => Promise<R>,
  path: string,
  signal: AbortSignal,
  matches?: (items: T[]) => boolean,
) {
  const items: T[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await request<Page<T>>(`${path}&page=${page}&pageSize=100`, { signal });
    if (!Array.isArray(result.items) || typeof result.totalCount !== 'number')
      throw new Error('Không đọc được dữ liệu vận hành phòng.');
    items.push(...result.items);
    if (items.length >= result.totalCount) return { items, complete: true };
    if (matches?.(items)) return { items, complete: false };
    if (!result.items.length) break;
  }
  return { items, complete: false };
}

export function useRoomOperations(locationId: string, roomIds: string[]) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const ids = [...roomIds].sort();
  const occupancy = useQuery({
    queryKey: ['property-setup', 'floor-occupancy', session?.userId, locationId, ids],
    queryFn: ({ signal }) =>
      readRoomOperationsPages<RoomOccupancy>(
        api.request,
        `/api/v1/occupancy?locationId=${encodeURIComponent(locationId)}`,
        signal,
        (items) => ids.every((id) => items.some((item) => item.roomId === id)),
      ),
    enabled: !!locationId && ids.length > 0,
    staleTime: 30_000,
  });
  const incidents = useQuery({
    queryKey: ['property-setup', 'floor-incidents', session?.userId, locationId],
    queryFn: async ({ signal }) => {
      const results = await Promise.all(
        [0, 1].map((status) =>
          readRoomOperationsPages<Incident>(
            api.request,
            `/api/v1/incidents?locationId=${encodeURIComponent(locationId)}&status=${status}`,
            signal,
          ),
        ),
      );
      return {
        items: [
          ...new Map(
            results.flatMap((result) => result.items).map((item) => [item.id, item]),
          ).values(),
        ],
        complete: results.every((result) => result.complete),
      };
    },
    enabled: !!locationId && ids.length > 0,
    staleTime: 30_000,
  });
  return { occupancy, incidents };
}
