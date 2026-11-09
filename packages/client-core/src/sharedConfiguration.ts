import type { SetupDocument } from './propertySetup';

export type SharedResource =
  | 'room-type-templates'
  | 'asset-catalog'
  | 'asset-templates'
  | 'fee-templates'
  | 'policy-templates';
export interface RoomTemplateData {
  capacity: number;
  area: string;
  amenities: string[];
  referenceRent: string | null;
}
export interface AssetCatalogData {
  category: string;
  unit: string;
  referencePrice: string;
}
export interface SharedAssetItem {
  catalogId: string;
  catalogVersion: number;
  quantity: number;
  required: boolean;
  trackingMode: 'Serialized' | 'BulkQuantity';
  catalog?: AssetCatalogData & { familyId: string; edition: number; name: string };
}
export interface AssetTemplateData {
  items: SharedAssetItem[];
}
export interface FeeTemplateData {
  category: string;
  chargeCode: string;
  method: string;
  referenceRate: string;
  unit: string;
  scope: 'Location' | 'Room';
  effectiveFrom: string;
  effectiveTo: string | null;
}
export interface PolicyTemplateData {
  content: string;
  effectiveFrom: string;
}
export type SharedData =
  RoomTemplateData | AssetCatalogData | AssetTemplateData | FeeTemplateData | PolicyTemplateData;
export interface SharedDocument {
  id: string;
  resource: SharedResource;
  familyId: string;
  edition: number;
  version: number;
  name: string;
  description: string;
  status: 'Draft' | 'Published' | 'Archived';
  managementScope: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  data: SharedData;
}
export interface SharedWrite {
  name: string;
  description: string;
  data: SharedData;
  expectedVersion: number;
}
export interface SharedPage {
  items: SharedDocument[];
  total: number;
  page: number;
  pageSize: number;
}
export interface SharedApply {
  locationId: string;
  expectedVersion: number;
  conflictStrategy: 'Reject';
  targetState: string;
  roomId: string | null;
  includeOptionalItems: boolean;
}
export interface ConfigurationPlan {
  sourceId: string;
  targetLocationId: string;
  targetState: string;
  canProceed: boolean;
  changes: string[];
  conflicts: string[];
  unsupportedReferences: string[];
}
export interface SharedOperation {
  id: string;
  kind: string;
  key: string;
  sourceId: string;
  sourceLocationId: string | null;
  familyId: string;
  sourceVersion: number;
  sourceEdition: number;
  resource: string;
  targetLocationId: string;
  status: string;
  actorId: string;
  appliedAt: string;
  createdReferences: string[];
}
export interface SharedUsage {
  items: SharedOperation[];
  total: number;
  locationsUsing: number;
  page: number;
  pageSize: number;
}
export type CopyGroup = 'RoomDefaults' | 'AssetTemplates' | 'FeePolicies' | 'OperatingPolicies';
export interface ConfigurationCopy {
  sourceLocationId: string;
  targetLocationId: string;
  groups: CopyGroup[];
  effectiveFrom: string | null;
  conflictStrategy: 'Reject';
  sourceState: string;
  targetState: string;
}
export interface ConfigurationCopyPlan {
  sourceLocationId: string;
  targetLocationId: string;
  groups: CopyGroup[];
  sourceState: string;
  targetState: string;
  canProceed: boolean;
  changes: string[];
  conflicts: string[];
  unsupportedReferences: string[];
}
export function sharedConfigurationClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
) {
  const route = (resource: SharedResource, id?: string) =>
    `/api/v1/shared-configuration/${resource}${id ? '/' + encodeURIComponent(id) : ''}`;
  const write = <T>(path: string, body: unknown, method = 'POST', key?: string) =>
    request<T>(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify(body),
    });
  return {
    list: (
      resource: SharedResource,
      search = '',
      status = '',
      page = 1,
      pageSize = 20,
      signal?: AbortSignal,
    ) =>
      request<SharedPage>(
        `${route(resource)}?${new URLSearchParams({ search, status, page: String(page), pageSize: String(pageSize) })}`,
        { signal },
      ),
    get: (resource: SharedResource, id: string, signal?: AbortSignal) =>
      request<SharedDocument>(route(resource, id), { signal }),
    save: (resource: SharedResource, id: string | null, input: SharedWrite) =>
      write<SharedDocument>(route(resource, id ?? undefined), input, id ? 'PUT' : 'POST'),
    publish: (resource: SharedResource, id: string, expectedVersion: number) =>
      write<SharedDocument>(route(resource, id) + '/publish', { expectedVersion }),
    archive: (resource: SharedResource, id: string, expectedVersion: number) =>
      write<SharedDocument>(route(resource, id) + '/archive', { expectedVersion }),
    duplicate: (resource: SharedResource, id: string, name: string, expectedVersion: number) =>
      write<SharedDocument>(route(resource, id) + '/duplicate', { name, expectedVersion }),
    edition: (resource: SharedResource, id: string, expectedVersion: number) =>
      write<SharedDocument>(route(resource, id) + '/versions', { expectedVersion }),
    versions: (resource: SharedResource, id: string, signal?: AbortSignal) =>
      request<SharedDocument[]>(route(resource, id) + '/versions', { signal }),
    history: (resource: SharedResource, id: string, signal?: AbortSignal) =>
      request<SharedDocument[]>(route(resource, id) + '/history', { signal }),
    applications: (resource: SharedResource, id: string, page = 1, signal?: AbortSignal) =>
      request<SharedUsage>(route(resource, id) + `/applications?page=${page}&pageSize=20`, {
        signal,
      }),
    preview: (resource: SharedResource, id: string, input: SharedApply) =>
      write<ConfigurationPlan>(route(resource, id) + '/apply-preview', input),
    apply: (resource: SharedResource, id: string, input: SharedApply, key: string) =>
      write<SharedOperation>(route(resource, id) + '/apply', input, 'POST', key),
    copyPreview: (input: ConfigurationCopy) =>
      write<ConfigurationCopyPlan>('/api/v1/location-configuration/copy-preview', input),
    copy: (input: ConfigurationCopy, key: string) =>
      write<SharedOperation>('/api/v1/location-configuration/copy', input, 'POST', key),
    roomDefaults: (location: string, signal?: AbortSignal) =>
      request<SetupDocument<{ name: string; defaults: RoomTemplateData }>[]>(
        `/api/v1/locations/${encodeURIComponent(location)}/room-defaults`,
        { signal },
      ),
    publishedCatalog: async (signal?: AbortSignal) => {
      const items: SharedDocument[] = [];
      for (let page = 1; ; page++) {
        const result = await request<SharedPage>(
          `${route('asset-catalog')}?status=Published&page=${page}&pageSize=100`,
          { signal },
        );
        items.push(...result.items);
        if (items.length >= result.total) return items;
        if (!result.items.length)
          throw new Error('Catalog pagination changed. Reload the catalog.');
      }
    },
  };
}
