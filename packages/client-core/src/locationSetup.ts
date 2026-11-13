import type {
  LocationConfiguration,
  LocalAssetTemplate,
  RoomConfiguration,
  SetupDocument,
} from './propertySetup';
import type { RoomTemplateData, SharedResource } from './sharedConfiguration';

export interface LocationSetupInformation {
  name: string;
  address: string;
  code: string;
  floors: number;
  contactPhone: string;
  contactEmail: string;
  description: string;
}
export interface SetupAssetRequirement {
  name: string;
  category: string;
  trackingMode: 'Serialized' | 'BulkQuantity';
  quantity: number;
}
export interface SetupRoomDefaults {
  key: string;
  name: string;
  description: string;
  capacity: number;
  area: number;
  referenceRent: number | null;
  amenities: string[];
  assets: SetupAssetRequirement[];
  sourceId: string | null;
  sourceVersion: number | null;
  sourceKind: string | null;
}
export interface SetupRoom {
  key: string;
  roomNumber: string;
  floor: string;
  roomTypeKey: string;
  rent: number;
}
export interface SetupFee {
  roomKey: string | null;
  category: 0 | 1 | 2 | 3;
  chargeCode: string;
  name: string;
  method: 0 | 1;
  rate: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}
export interface SetupPolicy {
  title: string;
  content: string;
  effectiveFrom: string;
}
export interface SetupSourceReference {
  id: string;
  version: number;
  kind: SharedResource | 'RoomDefaults' | 'AssetTemplate' | 'BillingPolicy' | 'OperatingPolicy';
}
export interface LocationSetupInput {
  location: LocationSetupInformation;
  roomTypes: SetupRoomDefaults[];
  rooms: SetupRoom[];
  fees: SetupFee[];
  policy: SetupPolicy | null;
  activate: boolean;
  rentEffectiveFrom: string;
  sourceLocationId: string | null;
  sourceState: string | null;
  sourceReferences?: SetupSourceReference[];
}
export interface LocalRoomDefaultsData {
  name: string;
  description?: string;
  defaults: RoomTemplateData;
  assetTemplateId?: string | null;
  sourceId?: string;
  sourceVersion?: number;
  copiedFromId?: string;
  copiedFromVersion?: number;
  sourceLocationId?: string;
}
export interface SetupSourceFee {
  id: string;
  locationId: string;
  roomId: string | null;
  category: number | string;
  chargeCode: string;
  name: string;
  method: number | string;
  rate: number | string;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
}
export interface LocationSetupSource {
  roomTypes: SetupDocument<LocalRoomDefaultsData>[];
  assetTemplates: SetupDocument<LocalAssetTemplate>[];
  fees: SetupSourceFee[];
  policies: SetupDocument<SetupPolicy>[];
  sourceState: string;
}
export interface LocationSetupResult {
  location: LocationConfiguration;
  createdReferences: string[];
}
export interface LocalRoomDefaultsWrite {
  name: string;
  description: string;
  defaults: RoomTemplateData;
  assetTemplateId: string | null;
  expectedVersion: number;
  reason: string;
  status?: 'Recorded' | 'Archived';
}
export interface RoomProvenanceData {
  roomId: string;
  roomDefaultsId: string;
  roomDefaultsVersion: number;
  name: string;
  area: number | string;
  amenities: string[];
  defaultCapacity: number;
  referenceRent: number | string | null;
}
export interface ConfiguredRoomInput {
  roomNumber: string;
  floor: string | null;
  roomDefaultsId: string;
  expectedVersion: number;
  rent: number;
}
export interface ConfiguredRoomsInput {
  rooms: ConfiguredRoomInput[];
  effectiveFrom: string;
}
export type LocationMetadata = Omit<LocationSetupInformation, 'name' | 'address'> & {
  setupStatus: string;
};

export function locationSetupClient(request: <T>(path: string, init?: RequestInit) => Promise<T>) {
  const route = (location: string, suffix: string) =>
    `/api/v1/locations/${encodeURIComponent(location)}/${suffix}`;
  const write = <T>(path: string, input: unknown, method = 'POST', key?: string) =>
    request<T>(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify(input),
    });
  return {
    source: (id: string, signal?: AbortSignal) =>
      request<LocationSetupSource>(`/api/v1/location-setup/source/${encodeURIComponent(id)}`, {
        signal,
      }),
    complete: (input: LocationSetupInput, key: string) =>
      write<LocationSetupResult>('/api/v1/location-setup', input, 'POST', key),
    localRoomDefaults: (location: string, signal?: AbortSignal) =>
      request<SetupDocument<LocalRoomDefaultsData>[]>(route(location, 'room-defaults'), { signal }),
    saveLocalRoomDefaults: (location: string, id: string | null, input: LocalRoomDefaultsWrite) =>
      write<SetupDocument<LocalRoomDefaultsData>>(
        route(location, `room-defaults${id ? '/' + encodeURIComponent(id) : ''}`),
        input,
        id ? 'PUT' : 'POST',
      ),
    localRoomDefaultsHistory: (location: string, id: string, signal?: AbortSignal) =>
      request<SetupDocument<LocalRoomDefaultsData>[]>(
        route(location, `room-defaults/${encodeURIComponent(id)}/history`),
        { signal },
      ),
    roomProvenance: (location: string, signal?: AbortSignal) =>
      request<SetupDocument<RoomProvenanceData>[]>(route(location, 'room-provenance'), { signal }),
    createConfiguredRooms: (location: string, input: ConfiguredRoomsInput, key: string) =>
      write<{ rooms: RoomConfiguration[] }>(
        route(location, 'configured-rooms'),
        input,
        'POST',
        key,
      ),
    metadata: (location: string, signal?: AbortSignal) =>
      request<SetupDocument<LocationMetadata> | null>(route(location, 'setup-metadata'), {
        signal,
      }),
    saveMetadata: (
      location: string,
      input: Omit<LocationMetadata, 'setupStatus'> & { expectedVersion: number },
    ) => write<SetupDocument<LocationMetadata>>(route(location, 'setup-metadata'), input, 'PUT'),
  };
}
