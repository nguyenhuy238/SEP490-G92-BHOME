import type { MobileApi, Named, Resident } from '../lib/api';
export interface CaptureService {
  locations(signal?: AbortSignal): Promise<Named[]>;
  rooms(locationId: string, signal?: AbortSignal): Promise<Named[]>;
  residents(locationId: string, signal?: AbortSignal): Promise<Resident[]>;
  createResident(
    roomId: string,
    displayLabel: string,
    residentType: 0 | 1,
  ): Promise<{ id: string }>;
}
export function captureService(api: MobileApi): CaptureService {
  return {
    locations: (signal) => api.request('/api/v1/capture/locations', { signal }),
    rooms: (id, signal) =>
      api.request(`/api/v1/capture/locations/${encodeURIComponent(id)}/rooms`, { signal }),
    residents: (id, signal) =>
      api.request(`/api/v1/capture/locations/${encodeURIComponent(id)}/residents`, { signal }),
    createResident: async (roomId, displayLabel, residentType) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        return await api.json(
          '/api/v1/capture/residents',
          { roomId, displayLabel, residentType },
          controller.signal,
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
