import { createApiClient } from '../../../../packages/client-core/src/api';
import { getApiBaseUrl } from '../../../../packages/client-core/src/config';

export interface PublicPhoto {
  index: number;
  contentType: string;
  length: number;
  url: string;
}
export interface PublicLocation {
  locationId: string;
  name: string;
  address: string;
  summary: string;
  amenities: string[];
  contactPhone: string | null;
  contactEmail: string | null;
  photos: PublicPhoto[];
  published: boolean;
  publishedAt: string | null;
}
export interface PublicRoom {
  roomId: string;
  locationId: string;
  roomNumber: string;
  floor: string | null;
  capacity: number;
  description: string;
  amenities: string[];
  indicativePrice: number | null;
  vacancy: string;
  photos: PublicPhoto[];
  published: boolean;
  publishedAt: string | null;
}
const baseUrl = import.meta.env.DEV ? '' : getApiBaseUrl(import.meta.env.VITE_API_BASE_URL, false);
const request = createApiClient(baseUrl);
export const publicInformation = {
  locations: () => request<PublicLocation[]>('/api/v1/public/locations'),
  location: (id: string) =>
    request<PublicLocation>(`/api/v1/public/locations/${encodeURIComponent(id)}`),
  rooms: (id: string) =>
    request<PublicRoom[]>(`/api/v1/public/locations/${encodeURIComponent(id)}/rooms`),
  room: (id: string) => request<PublicRoom>(`/api/v1/public/rooms/${encodeURIComponent(id)}`),
};
// Only the backend's anonymous photo routes may be used, never private object keys.
export function publicPhotoUrl(photo: PublicPhoto): string | undefined {
  if (!/^\/api\/v1\/public\/(locations|rooms)\/[0-9a-f-]+\/photos\/\d+$/i.test(photo.url))
    return undefined;
  return baseUrl + photo.url;
}
