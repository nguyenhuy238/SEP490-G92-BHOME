import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { useMeterApi } from '../meters/useMeterApi';
import type { OwnerLocation, OwnerPage } from '../../hooks/useOwnerWorkspace';
import type { Staff, StaffAssignment } from './staffContracts';

export type AssignmentRow = {
  location: OwnerLocation;
  assignments?: StaffAssignment[];
  error?: unknown;
};
export async function readAllPages<T>(
  read: (path: string, init: { signal?: AbortSignal }) => Promise<OwnerPage<T>>,
  path: string,
  signal?: AbortSignal,
) {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    signal?.throwIfAborted();
    const result = await read(`${path}?page=${page}&pageSize=100`, { signal });
    if (!Array.isArray(result.items) || !Number.isFinite(result.totalCount))
      throw new Error('Không đọc được danh sách đầy đủ.');
    items.push(...result.items);
    if (items.length >= result.totalCount) return items;
    if (!result.items.length) throw new Error('Danh sách chưa tải đủ. Hãy làm mới.');
  }
}
export async function mapFour<T, R>(items: T[], work: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, items.length) }, async () => {
      while (index < items.length) {
        const next = index++;
        results[next] = await work(items[next]);
      }
    }),
  );
  return results;
}
export const assignmentState = (item: StaffAssignment, today: string) =>
  item.startDate > today ? 'future' : item.endDate < today ? 'past' : 'current';
export const assignmentDate = (date: string) =>
  date === '9999-12-31' ? 'Không xác định thời hạn' : date.split('-').reverse().join('/');
export const overlaps = (items: StaffAssignment[], start: string, end: string, exclude?: string) =>
  items.some((item) => item.id !== exclude && item.startDate <= end && start <= item.endDate);
export function useLocationAssignments() {
  const { request } = useMeterApi();
  const { session } = useAuth();
  const cache = useQueryClient();
  const root = ['owner-workspace', session?.userId, 'location-assignment-workspace'];
  const enabled = !!session?.roles.includes('Owner');
  const directory = useQuery({
    queryKey: [...root, 'staff'],
    enabled,
    staleTime: 60000,
    queryFn: ({ signal }) => readAllPages<Staff>(request, '/api/v1/staff', signal),
  });
  const data = useQuery({
    queryKey: [...root, 'overview'],
    enabled,
    staleTime: 60000,
    queryFn: async ({ signal }) => {
      const locations = await readAllPages<OwnerLocation>(request, '/api/v1/locations', signal);
      return mapFour(locations, async (location): Promise<AssignmentRow> => {
        signal.throwIfAborted();
        try {
          const assignments = await cache.fetchQuery({
            queryKey: [...root, 'assignments', location.id],
            staleTime: 60000,
            queryFn: () =>
              request<StaffAssignment[]>(
                `/api/v1/staff-location-assignments?locationId=${location.id}`,
                { signal },
              ),
          });
          if (!Array.isArray(assignments)) throw new Error('Không đọc được lịch phân công.');
          return { location, assignments };
        } catch (error) {
          signal.throwIfAborted();
          return { location, error };
        }
      });
    },
  });
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: root, refetchType: 'none' });
    await Promise.all([directory.refetch(), data.refetch()]);
  };
  const retryLocation = async (id: string) => {
    await cache.invalidateQueries({ queryKey: [...root, 'assignments', id], refetchType: 'none' });
    await data.refetch();
  };
  return { directory, data, refresh, retryLocation };
}
