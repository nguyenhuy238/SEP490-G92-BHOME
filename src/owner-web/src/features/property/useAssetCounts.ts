import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import type { SetupDocument } from '../../../../../packages/client-core/src/propertySetup';
import { usePropertySetupApi } from './usePropertySetupApi';

export type AssetCount = SetupDocument<{
  roomId: string;
  desiredId: string;
  itemId: string;
  quantity: number;
  evidenceObjectKey: string;
  note: string;
}>;
export function useAssetCounts(roomId: string, desiredId?: string) {
  const { session } = useAuth();
  const api = usePropertySetupApi();
  return useQuery({
    queryKey: ['property-setup', 'asset-counts', session?.userId, roomId, desiredId],
    queryFn: ({ signal }) =>
      api.request<AssetCount[]>(
        `/api/v1/rooms/${encodeURIComponent(roomId)}/asset-count-observations`,
        { signal },
      ),
    enabled: !!desiredId,
  });
}
