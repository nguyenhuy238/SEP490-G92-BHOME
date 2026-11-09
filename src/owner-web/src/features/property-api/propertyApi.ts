import { useMemo } from 'react';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { createApiClient, ApiError } from '../../../../../packages/client-core/src/api';
import { getApiBaseUrl } from '../../../../../packages/client-core/src/config';

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}
export interface LocationDto {
  id: string;
  chainId: string | null;
  name: string;
  address: string;
  isActive: boolean;
  version: number;
}
export interface RoomTypeDto {
  id: string;
  locationId: string;
  name: string;
  description: string | null;
  defaultCapacity: number;
  areaM2: number | null;
  amenities: string[];
  isActive: boolean;
  version: number;
}
export interface RoomDto {
  id: string;
  locationId: string;
  roomTypeId: string | null;
  roomNumber: string;
  floor: string | null;
  capacity: number;
  status: number | string;
  version: number;
}
export interface AssetDto {
  id: string;
  locationId: string;
  roomId: string | null;
  commonArea: string | null;
  code: string | null;
  name: string;
  category: string;
  condition: string;
  status: number | string;
  version: number;
}
export interface OccupancySummary {
  locationId: string;
  asOf: string;
  snapshot: {
    totalRooms: number;
    availableRooms: number;
    occupiedRooms: number;
    onHoldRooms: number;
    unavailableRooms: number;
    occupancyRate: number;
  };
}
export interface NamedResource {
  id: string;
  label: string;
  parentId: string | null;
}
export interface StaffAssignment {
  id: string;
  staffUserId: string;
  startDate: string;
  endDate: string;
}

export type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
const json = <T>(request: Request, path: string, body: unknown, method = 'POST') =>
  request<T>(path, { method, body: JSON.stringify(body) });

export function usePropertyApi() {
  const { client } = useAuth();
  return useMemo(() => {
    const request = createApiClient(
      getApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV),
      () => client.session?.accessToken,
      client.clear,
      client.refresh,
    );
    return {
      request,
      locations: (signal?: AbortSignal) =>
        request<Page<LocationDto>>('/api/v1/locations?page=1&pageSize=100', { signal }),
      saveLocation: (
        value: Omit<LocationDto, 'id' | 'chainId'> & { reason: string },
        id?: string,
      ) =>
        json<LocationDto>(
          request,
          id ? `/api/v1/locations/${encodeURIComponent(id)}` : '/api/v1/locations',
          value,
          id ? 'PUT' : 'POST',
        ),
      occupancy: (id: string, signal?: AbortSignal) =>
        request<OccupancySummary>(`/api/v1/locations/${encodeURIComponent(id)}/occupancy-summary`, {
          signal,
        }),
      roomTypes: (locationId?: string, signal?: AbortSignal) =>
        request<Page<RoomTypeDto>>(
          `/api/v1/room-types?page=1&pageSize=100${locationId ? `&locationId=${encodeURIComponent(locationId)}` : ''}`,
          { signal },
        ),
      saveRoomType: (value: Omit<RoomTypeDto, 'id'> & { reason: string }, id?: string) =>
        json<RoomTypeDto>(
          request,
          id ? `/api/v1/room-types/${encodeURIComponent(id)}` : '/api/v1/room-types',
          value,
          id ? 'PUT' : 'POST',
        ),
      rooms: (locationId?: string, signal?: AbortSignal) =>
        request<Page<RoomDto>>(
          `/api/v1/rooms?page=1&pageSize=100${locationId ? `&locationId=${encodeURIComponent(locationId)}` : ''}`,
          { signal },
        ),
      saveRoom: (value: Omit<RoomDto, 'id'> & { reason: string }, id?: string) =>
        json<RoomDto>(
          request,
          id ? `/api/v1/rooms/${encodeURIComponent(id)}` : '/api/v1/rooms',
          value,
          id ? 'PUT' : 'POST',
        ),
      assets: (locationId?: string, signal?: AbortSignal) =>
        request<Page<AssetDto>>(
          `/api/v1/assets?page=1&pageSize=100${locationId ? `&locationId=${encodeURIComponent(locationId)}` : ''}`,
          { signal },
        ),
      saveAsset: (value: Omit<AssetDto, 'id'> & { reason: string }, id?: string) =>
        json<AssetDto>(
          request,
          id ? `/api/v1/assets/${encodeURIComponent(id)}` : '/api/v1/assets',
          value,
          id ? 'PUT' : 'POST',
        ),
      staff: (signal?: AbortSignal) =>
        request<NamedResource[]>('/api/v1/capture/staff', { signal }),
      createStaff: (value: { userName: string; email: string; password: string }) =>
        json<{ id: string }>(request, '/api/v1/capture/staff', value),
      assignments: (locationId: string, signal?: AbortSignal) =>
        request<StaffAssignment[]>(
          `/api/v1/staff-location-assignments?locationId=${encodeURIComponent(locationId)}`,
          { signal },
        ),
      createAssignment: (value: {
        locationId: string;
        staffUserId: string;
        startDate: string;
        endDate: string;
      }) => json<StaffAssignment>(request, '/api/v1/staff-location-assignments', value),
    };
  }, [client]);
}

export function propertyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Tài khoản không có quyền thực hiện thao tác này.';
    if (error.status === 404) return 'Không tìm thấy dữ liệu trong phạm vi tài khoản.';
    if (error.status === 409)
      return error.problem?.title || 'Dữ liệu đã thay đổi hoặc bị trùng. Hãy tải lại.';
    const first = error.problem?.errors && Object.values(error.problem.errors)[0]?.[0];
    return first || error.problem?.detail || error.problem?.title || error.message;
  }
  return error instanceof Error ? error.message : 'Không thể hoàn thành yêu cầu.';
}
