import type { Page } from './invoices';

export interface LocationConfiguration {
  id: string;
  name: string;
  address: string;
  isActive: boolean;
  version: number;
}
export interface RoomConfiguration {
  id: string;
  locationId: string;
  roomNumber: string;
  floor: string | null;
  capacity: number;
  status: number;
  version: number;
}
export interface PhysicalAsset {
  id: string;
  locationId: string;
  roomId: string | null;
  commonArea: string | null;
  code: string | null;
  name: string;
  category: string;
  condition: string;
  status: number;
  version: number;
}
export type LocationInput = Omit<LocationConfiguration, 'id' | 'version'> & {
  version: number;
  reason: string;
};
export type RoomInput = Omit<RoomConfiguration, 'id' | 'version'> & {
  version: number;
  reason: string;
};
export type AssetInput = Omit<PhysicalAsset, 'id' | 'version'> & {
  version: number;
  reason: string;
};
export type SetupDocument<T> = {
  id: string;
  locationId: string;
  kind: string;
  status: string;
  version: number;
  data: T;
  recordedAt?: string;
  recordedBy?: string;
};
export interface LocalAssetItem {
  id: string;
  name: string;
  category: string;
  trackingMode: 'Serialized' | 'BulkQuantity';
  quantity: number;
}
export interface LocalAssetTemplate {
  locationId: string;
  name: string;
  items: LocalAssetItem[];
  expectedVersion?: number;
}
export interface DesiredAssets {
  templateId: string;
  templateVersion: number;
  roomId: string;
  items: LocalAssetItem[];
  status: string;
}
export interface AssetInventory {
  physical: PhysicalAsset[];
  desired: SetupDocument<DesiredAssets>[];
  currentDesiredId?: string | null;
  discrepancies?: { assetId: string; action: string }[];
  metadata?: Record<string, AssetMetadata>;
  assignmentVersion: number;
  assignedTemplateId: string | null;
}
export interface AssetVerificationInput {
  templateId: string;
  itemId: string;
  code: string;
  quantity: number;
  condition: string;
  evidenceObjectKey: string;
  expectedVersion: number;
  existingAssetId?: string | null;
}
export interface OperatingPolicyInput {
  locationId: string;
  title: string;
  content: string;
  effectiveFrom: string;
  expectedVersion?: number;
}
export interface PolicyBinding {
  policyId: string;
  version: number;
  contentHash: string;
  title: string;
  content: string;
}
export interface AgreedPolicy {
  contractId: string;
  status: string;
  policy: PolicyBinding | null;
  amendmentId: string | null;
}
export interface AssetSyncRun {
  templateId: string;
  templateVersion: number;
  rooms: { roomId: string; status: string }[];
  runId?: string;
}
export type DecimalValue = string | number;
export interface UtilityTier {
  through: DecimalValue | null;
  rate: DecimalValue;
}
export interface UtilityTariffInput {
  replacesId?: string;
  locationId: string;
  utilityType: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  supplier: string;
  classification: string;
  sourceReference: string;
  tiers: UtilityTier[];
  rounding: number;
  verified: boolean;
}
export interface UtilityProfileInput {
  replacesId?: string;
  locationId: string;
  roomId: string;
  utilityType: number;
  tariffId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  requireQuota: boolean;
  requireReconciliation: boolean;
  expectedVersion?: number;
}
export interface UtilityMeter {
  locationId: string;
  utilityType: number;
  scope: 'Source' | 'Common';
  code: string;
  parentMeterId: string | null;
}
export interface UtilityQuotaInput {
  locationId: string;
  roomId: string;
  utilityType: number;
  period: string;
  freeQuantity: DecimalValue;
  sourceReference: string;
  verified: boolean;
  expectedVersion?: number;
}
export interface UtilityBill {
  locationId: string;
  meterId: string;
  utilityType: number;
  period: string;
  consumption: DecimalValue;
  amount: DecimalValue;
  reference: string;
  evidenceObjectKey: string;
}
export interface ReconcileInput {
  locationId: string;
  sourceBillId: string;
  tolerance: DecimalValue;
  reason: string;
  expectedVersion?: number;
}
export interface Reconciliation {
  sourceBillId: string;
  sourceConsumption: DecimalValue;
  roomConsumption: DecimalValue;
  commonConsumption: DecimalValue;
  variance: DecimalValue;
  tolerance: DecimalValue;
  status: string;
  reason: string;
  inputsHash: string;
}
export interface AssetMetadata {
  trackingMode: 'Serialized' | 'BulkQuantity';
  quantity: number;
  purchaseCost: DecimalValue | null;
  purchaseDate: string | null;
  usefulLifeMonths: number | null;
}

export type SetupRequest = <T>(path: string, init?: RequestInit) => Promise<T>;
export function propertySetupClient(request: SetupRequest) {
  const write = <T>(path: string, body: unknown, method = 'POST', key?: string) =>
    request<T>(path, {
      method,
      body: JSON.stringify(body),
      ...(key ? { headers: { 'Idempotency-Key': key } } : {}),
    });
  const paged = <T>(
    resource: string,
    query: Record<string, string | number | undefined>,
    signal?: AbortSignal,
  ) => {
    const values = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== '') values.set(key, String(value));
    });
    return request<Page<T>>(`/api/v1/${resource}?${values}`, { signal });
  };
  const documents = <T>(resource: string, locationId: string, signal?: AbortSignal) =>
    request<SetupDocument<T>[]>(
      `/api/v1/${resource}?locationId=${encodeURIComponent(locationId)}`,
      { signal },
    );
  return {
    request,
    documents,
    locations: (page = 1, search = '', signal?: AbortSignal) =>
      paged<LocationConfiguration>('locations', { page, pageSize: 20, search }, signal),
    location: (id: string, signal?: AbortSignal) =>
      request<LocationConfiguration>(`/api/v1/locations/${encodeURIComponent(id)}`, { signal }),
    rooms: (locationId: string, page = 1, search = '', signal?: AbortSignal) =>
      paged<RoomConfiguration>('rooms', { locationId, page, pageSize: 20, search }, signal),
    assets: (locationId: string, page = 1, search = '', signal?: AbortSignal) =>
      paged<PhysicalAsset>('assets', { locationId, page, pageSize: 20, search }, signal),
    roomOptions: (locationId: string, signal?: AbortSignal) =>
      request<{ id: string; label: string }[]>(
        `/api/v1/capture/locations/${encodeURIComponent(locationId)}/rooms`,
        { signal },
      ),
    locationOptions: (signal?: AbortSignal) =>
      request<{ id: string; label: string }[]>('/api/v1/capture/locations', { signal }),
    saveLocation: (id: string | null, input: LocationInput) =>
      write<LocationConfiguration>(
        `/api/v1/locations${id ? '/' + encodeURIComponent(id) : ''}`,
        input,
        id ? 'PUT' : 'POST',
      ),
    saveRoom: (id: string | null, input: RoomInput) =>
      write<RoomConfiguration>(
        `/api/v1/rooms${id ? '/' + encodeURIComponent(id) : ''}`,
        input,
        id ? 'PUT' : 'POST',
      ),
    saveAsset: (id: string | null, input: AssetInput) =>
      write<PhysicalAsset>(
        `/api/v1/assets${id ? '/' + encodeURIComponent(id) : ''}`,
        input,
        id ? 'PUT' : 'POST',
      ),
    templates: (locationId: string, signal?: AbortSignal) =>
      documents<LocalAssetTemplate>('asset-templates', locationId, signal),
    saveTemplate: (id: string | null, input: LocalAssetTemplate) =>
      write<SetupDocument<LocalAssetTemplate>>(
        `/api/v1/asset-templates${id ? '/' + encodeURIComponent(id) + '/draft' : ''}`,
        input,
        id ? 'PUT' : 'POST',
      ),
    cloneTemplate: (id: string) =>
      request<SetupDocument<LocalAssetTemplate>>(
        `/api/v1/asset-templates/${encodeURIComponent(id)}/drafts`,
        { method: 'POST' },
      ),
    publishTemplate: (id: string, expectedVersion: number) =>
      write<AssetSyncRun>(`/api/v1/asset-templates/${encodeURIComponent(id)}/publish`, {
        expectedVersion,
      }),
    syncTemplate: (id: string) =>
      request<AssetSyncRun>(`/api/v1/asset-templates/${encodeURIComponent(id)}/sync`, {
        method: 'POST',
      }),
    assignTemplate: (roomId: string, templateId: string | null, expectedVersion: number) =>
      write<SetupDocument<{ templateId: string | null }>>(
        `/api/v1/rooms/${encodeURIComponent(roomId)}/asset-template`,
        { templateId, expectedVersion },
        'PUT',
      ),
    inventory: (roomId: string, signal?: AbortSignal) =>
      request<AssetInventory>(`/api/v1/rooms/${encodeURIComponent(roomId)}/asset-inventory`, {
        signal,
      }),
    verifyAsset: (roomId: string, input: AssetVerificationInput) =>
      write<{ assetId: string }>(
        `/api/v1/rooms/${encodeURIComponent(roomId)}/assets/verify`,
        input,
      ),
    assetHistory: (id: string, signal?: AbortSignal) =>
      request<
        {
          id: string;
          action: string;
          reason: string;
          occurredAt: string;
          actorId: string;
          snapshot: string;
        }[]
      >(`/api/v1/assets/${encodeURIComponent(id)}/history`, { signal }),
    assetMetadata: (id: string, signal?: AbortSignal) =>
      request<SetupDocument<AssetMetadata>>(`/api/v1/assets/${encodeURIComponent(id)}/metadata`, {
        signal,
      }),
    saveMetadata: (id: string, metadata: AssetMetadata, expectedVersion: number, reason: string) =>
      write<SetupDocument<AssetMetadata>>(
        `/api/v1/assets/${encodeURIComponent(id)}/metadata`,
        { metadata, expectedVersion, reason },
        'PUT',
      ),
    replaceAsset: (
      id: string,
      input: { code: string; condition: string; reason: string; expectedVersion: number },
    ) => write<{ assetId: string }>(`/api/v1/assets/${encodeURIComponent(id)}/replace`, input),
    policies: (locationId: string, signal?: AbortSignal) =>
      documents<OperatingPolicyInput>('operating-policies', locationId, signal),
    savePolicy: (id: string | null, input: OperatingPolicyInput) =>
      write<SetupDocument<OperatingPolicyInput>>(
        `/api/v1/operating-policies${id ? '/' + encodeURIComponent(id) + '/draft' : ''}`,
        input,
        id ? 'PUT' : 'POST',
      ),
    publishPolicy: (id: string, expectedVersion: number) =>
      write<SetupDocument<OperatingPolicyInput>>(
        `/api/v1/operating-policies/${encodeURIComponent(id)}/publish`,
        { expectedVersion },
      ),
    policyRevisions: (id: string, signal?: AbortSignal) =>
      request<SetupDocument<OperatingPolicyInput>[]>(
        `/api/v1/operating-policies/${encodeURIComponent(id)}/versions`,
        { signal },
      ),
    agreedPolicy: (contractId: string, signal?: AbortSignal) =>
      request<AgreedPolicy>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/agreed-operating-policy`,
        { signal },
      ),
    amendPolicy: (
      contractId: string,
      policyId: string,
      effectiveFrom: string,
      reason: string,
      key: string,
    ) =>
      write<{ contractId: string }>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/operating-policy-amendments`,
        { policyId, effectiveFrom, reason },
        'POST',
        key,
      ),
    cancelAmendment: (contractId: string, reason: string, key: string) =>
      write<unknown>(
        `/api/v1/contracts/${encodeURIComponent(contractId)}/operating-policy-amendment-cancellation`,
        { reason },
        'POST',
        key,
      ),
    uploadEvidence: (locationId: string, file: File) =>
      request<{ objectKey: string }>(
        `/api/v1/locations/${encodeURIComponent(locationId)}/setup-evidence`,
        { method: 'POST', body: file, headers: { 'Content-Type': file.type } },
      ),
    tariffs: (locationId: string, signal?: AbortSignal) =>
      documents<UtilityTariffInput>('utility-tariffs', locationId, signal),
    saveTariff: (input: UtilityTariffInput, replaces?: string) =>
      write<SetupDocument<UtilityTariffInput>>(
        `/api/v1/utility-tariffs${replaces ? '/' + encodeURIComponent(replaces) + '/replacement' : ''}`,
        input,
      ),
    profiles: (locationId: string, signal?: AbortSignal) =>
      documents<UtilityProfileInput>('utility-profiles', locationId, signal),
    saveProfile: (input: UtilityProfileInput, replaces?: string) =>
      write<SetupDocument<UtilityProfileInput>>(
        `/api/v1/utility-profiles${replaces ? '/' + encodeURIComponent(replaces) + '/replacement' : ''}`,
        input,
      ),
    quotas: (locationId: string, signal?: AbortSignal) =>
      documents<UtilityQuotaInput>('utility-quotas', locationId, signal),
    saveQuota: (input: UtilityQuotaInput) =>
      write<SetupDocument<UtilityQuotaInput>>('/api/v1/utility-quotas', input),
    utilityMeters: (locationId: string, signal?: AbortSignal) =>
      documents<UtilityMeter>('utility-source-meters', locationId, signal),
    saveUtilityMeter: (input: UtilityMeter) =>
      write<SetupDocument<UtilityMeter>>('/api/v1/utility-source-meters', input),
    linkMeter: (input: {
      meterId: string;
      parentMeterId: string;
      scope: 'Room';
      effectiveFrom: string;
      effectiveTo: string | null;
    }) => write<SetupDocument<unknown>>('/api/v1/utility-meter-links', input),
    meterLinks: (locationId: string, signal?: AbortSignal) =>
      documents<{
        meterId: string;
        parentMeterId: string;
        scope: 'Room';
        effectiveFrom: string;
        effectiveTo: string | null;
      }>('utility-meter-links', locationId, signal),
    sourceReadings: (locationId: string, signal?: AbortSignal) =>
      documents<{
        meterId: string;
        period: string;
        opening: DecimalValue;
        closing: DecimalValue;
        evidenceObjectKey: string;
        humanConfirmed: boolean;
      }>('utility-source-readings', locationId, signal),
    sourceReading: (input: {
      meterId: string;
      period: string;
      opening: DecimalValue;
      closing: DecimalValue;
      evidenceObjectKey: string;
      humanConfirmed: boolean;
    }) => write<SetupDocument<unknown>>('/api/v1/utility-source-readings', input),
    sourceBills: (locationId: string, signal?: AbortSignal) =>
      documents<UtilityBill>('utility-source-bills', locationId, signal),
    sourceBill: (input: UtilityBill, key: string) =>
      write<SetupDocument<UtilityBill>>('/api/v1/utility-source-bills', input, 'POST', key),
    previewReconciliation: (input: ReconcileInput) =>
      write<Reconciliation>('/api/v1/utility-reconciliations/preview', input),
    saveReconciliation: (input: ReconcileInput) =>
      write<SetupDocument<Reconciliation>>('/api/v1/utility-reconciliations', input),
    reconciliations: (locationId: string, signal?: AbortSignal) =>
      documents<Reconciliation>('utility-reconciliations', locationId, signal),
    breakdowns: (locationId: string, signal?: AbortSignal) =>
      documents<{
        roomId: string;
        utilityType: number;
        period: string;
        segments: {
          from: string;
          to: string;
          tariffId: string;
          consumption: DecimalValue;
          freeQuantity: DecimalValue;
          evidenceObjectKey: string;
        }[];
        humanConfirmed: boolean;
      }>('utility-period-breakdowns', locationId, signal),
    reconciliation: (id: string, signal?: AbortSignal) =>
      request<SetupDocument<Reconciliation>>(
        `/api/v1/utility-reconciliations/${encodeURIComponent(id)}`,
        { signal },
      ),
    reviewReconciliation: (
      id: string,
      acceptVariance: boolean,
      reason: string,
      expectedVersion: number,
    ) =>
      write<SetupDocument<Reconciliation>>(
        `/api/v1/utility-reconciliations/${encodeURIComponent(id)}/review`,
        { acceptVariance, reason, expectedVersion },
      ),
    breakdown: (input: {
      locationId: string;
      roomId: string;
      utilityType: number;
      period: string;
      segments: {
        from: string;
        to: string;
        tariffId: string;
        consumption: DecimalValue;
        freeQuantity: DecimalValue;
        evidenceObjectKey: string;
      }[];
      humanConfirmed: boolean;
      expectedVersion: number;
    }) => write<SetupDocument<unknown>>('/api/v1/utility-period-breakdowns', input),
  };
}
