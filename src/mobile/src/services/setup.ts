import type { MobileApi, Named } from '../lib/api';

type SetupApi = Pick<MobileApi, 'request' | 'json'>;

export async function loadSetup(api: SetupApi, signal?: AbortSignal) {
  const [locations, staff] = await Promise.allSettled([
    api.request<Named[]>('/api/v1/capture/locations', { signal }),
    api.request<Named[]>('/api/v1/capture/staff', { signal }),
  ]);
  return {
    locations: locations.status === 'fulfilled' ? locations.value : [],
    staff: staff.status === 'fulfilled' ? staff.value : [],
    error:
      locations.status === 'rejected'
        ? locations.reason
        : staff.status === 'rejected'
          ? staff.reason
          : undefined,
  };
}

export const setupWritePath = (resource: string) =>
  resource === 'locations' || resource === 'rooms'
    ? `/api/v1/${resource}`
    : `/api/v1/capture/${resource}`;

export function roomSetupInput(locationId: string, roomNumber: string, capacity: string) {
  const count = Number(capacity);
  if (!locationId || !roomNumber.trim() || !Number.isInteger(count) || count < 1 || count > 32767)
    throw new Error('Nhập cơ sở, số phòng và sức chứa nguyên từ 1 đến 32767.');
  return { locationId, roomNumber: roomNumber.trim(), capacity: count };
}
