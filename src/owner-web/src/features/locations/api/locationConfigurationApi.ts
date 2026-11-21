import { useMemo } from 'react';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { createApiClient } from '../../../../../../packages/client-core/src/api';
import { apiBaseUrl } from '../../../services/config';
import type { Page } from '../../property-api/propertyApi';

export interface SetupDocument<T> {
  id: string;
  locationId: string;
  kind: string;
  status: string;
  version: number;
  data: T;
  recordedAt: string | null;
}

export interface OperatingPolicyData {
  locationId: string;
  title: string;
  content: string;
  effectiveFrom: string;
  expectedVersion: number;
}

export interface AssetTemplateItemData {
  id: string;
  name: string;
  category: string;
  trackingMode: string;
  quantity: number;
}

export interface AssetTemplateData {
  locationId: string;
  name: string;
  items: AssetTemplateItemData[];
  expectedVersion: number;
}

export interface BillingPolicyDto {
  id: string;
  locationId: string;
  roomId: string | null;
  category: number | string;
  chargeCode: string;
  name: string;
  method: number | string;
  rate: string | number;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
  firstUsedAt: string | null;
}

export interface BillingPolicyWrite {
  locationId: string;
  roomId: string | null;
  category: number;
  chargeCode: string;
  name: string;
  method: number;
  rate: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string;
}

const json = <T>(
  request: <R>(path: string, init?: RequestInit) => Promise<R>,
  path: string,
  body: unknown,
  method = 'POST',
) => request<T>(path, { method, body: JSON.stringify(body) });

export function useLocationConfigurationApi() {
  const { client } = useAuth();
  return useMemo(() => {
    const request = createApiClient(
      apiBaseUrl,
      () => client.session?.accessToken,
      client.clear,
      client.refresh,
    );
    return {
      operatingPolicies: (locationId: string, signal?: AbortSignal) =>
        request<SetupDocument<OperatingPolicyData>[]>(
          `/api/v1/operating-policies?locationId=${encodeURIComponent(locationId)}`,
          { signal },
        ),
      operatingPolicyVersions: (id: string, signal?: AbortSignal) =>
        request<SetupDocument<OperatingPolicyData>[]>(
          `/api/v1/operating-policies/${encodeURIComponent(id)}/versions`,
          { signal },
        ),
      createOperatingPolicy: (input: OperatingPolicyData) =>
        json<SetupDocument<OperatingPolicyData>>(request, '/api/v1/operating-policies', input),
      updateOperatingPolicy: (id: string, input: OperatingPolicyData) =>
        json<SetupDocument<OperatingPolicyData>>(
          request,
          `/api/v1/operating-policies/${encodeURIComponent(id)}/draft`,
          input,
          'PUT',
        ),
      publishOperatingPolicy: (id: string, expectedVersion: number) =>
        json<SetupDocument<OperatingPolicyData>>(
          request,
          `/api/v1/operating-policies/${encodeURIComponent(id)}/publish`,
          { expectedVersion },
        ),
      assetTemplates: (locationId: string, signal?: AbortSignal) =>
        request<SetupDocument<AssetTemplateData>[]>(
          `/api/v1/asset-templates?locationId=${encodeURIComponent(locationId)}`,
          { signal },
        ),
      createAssetTemplate: (input: AssetTemplateData) =>
        json<SetupDocument<AssetTemplateData>>(request, '/api/v1/asset-templates', input),
      updateAssetTemplate: (id: string, input: AssetTemplateData) =>
        json<SetupDocument<AssetTemplateData>>(
          request,
          `/api/v1/asset-templates/${encodeURIComponent(id)}/draft`,
          input,
          'PUT',
        ),
      cloneAssetTemplate: (id: string) =>
        json<SetupDocument<AssetTemplateData>>(
          request,
          `/api/v1/asset-templates/${encodeURIComponent(id)}/drafts`,
          undefined,
        ),
      publishAssetTemplate: (id: string, expectedVersion: number) =>
        json<unknown>(request, `/api/v1/asset-templates/${encodeURIComponent(id)}/publish`, {
          expectedVersion,
        }),
      syncAssetTemplate: (id: string) =>
        request<unknown>(`/api/v1/asset-templates/${encodeURIComponent(id)}/sync`, {
          method: 'POST',
        }),
      billingPolicies: (locationId: string, signal?: AbortSignal) =>
        request<Page<BillingPolicyDto>>(
          `/api/v1/billing-policies?locationId=${encodeURIComponent(locationId)}&page=1&pageSize=100`,
          { signal },
        ),
      createBillingPolicy: (input: BillingPolicyWrite) =>
        json<BillingPolicyDto>(request, '/api/v1/billing-policies', input),
      updateBillingPolicy: (id: string, input: BillingPolicyWrite, expectedVersion: number) =>
        json<BillingPolicyDto>(
          request,
          `/api/v1/billing-policies/${encodeURIComponent(id)}`,
          { policy: input, expectedVersion },
          'PUT',
        ),
      replaceBillingPolicy: (id: string, input: BillingPolicyWrite, expectedVersion: number) =>
        json<BillingPolicyDto>(
          request,
          `/api/v1/billing-policies/${encodeURIComponent(id)}/replacement`,
          { policy: input, expectedVersion },
        ),
    };
  }, [client]);
}
