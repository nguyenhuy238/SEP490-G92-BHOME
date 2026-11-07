import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useWorkspaceQuery } from './useWorkspaceQuery';
import type { Named } from '../../lib/api';

// Existing Property AssetDto fields used by the local-only reporting form.
interface IncidentAssetOption {
  id: string;
  locationId: string;
  roomId?: string | null;
  commonArea?: string | null;
  code?: string | null;
  name: string;
}
interface AssetPage {
  items: IncidentAssetOption[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export function useStaffIncidentScope(enabled: boolean) {
  const [locationId, setLocationId] = useState('');
  const [area, setArea] = useState('');
  const [assetId, setAssetId] = useState('');
  const [page, setPage] = useState(1);
  const locations = useWorkspaceQuery<Named[]>(enabled ? '/api/v1/capture/locations' : null);
  const location =
    enabled && locations.data?.some((item) => item.id === locationId) ? locationId : '';
  const rooms = useWorkspaceQuery<Named[]>(
    location ? `/api/v1/capture/locations/${encodeURIComponent(location)}/rooms` : null,
  );
  const roomId = rooms.data?.some((item) => item.id === area) ? area : '';
  const selectedArea = location && (area === 'common' || roomId) ? area : '';
  const assets = useWorkspaceQuery<AssetPage>(
    location && selectedArea
      ? `/api/v1/assets?locationId=${encodeURIComponent(location)}${roomId ? `&roomId=${encodeURIComponent(roomId)}` : ''}&page=${page}&pageSize=100`
      : null,
  );
  const options = (assets.data?.items ?? []).filter(
    (item) => item.locationId === location && (roomId ? item.roomId === roomId : !item.roomId),
  );
  const selectedAsset = options.some((item) => item.id === assetId) ? assetId : '';
  const { reload: reloadLocations } = locations;
  const { reload: reloadRooms } = rooms;
  const { reload: reloadAssets } = assets;
  useFocusEffect(
    useCallback(() => {
      if (enabled) {
        reloadLocations();
        reloadRooms();
        reloadAssets();
      }
    }, [enabled, reloadLocations, reloadRooms, reloadAssets]),
  );
  return {
    locations,
    rooms,
    assets,
    location,
    area: selectedArea,
    asset: selectedAsset,
    options,
    page,
    selectLocation: (id: string) => {
      setLocationId(id);
      setArea('');
      setAssetId('');
      setPage(1);
    },
    selectArea: (id: string) => {
      setArea(id);
      setAssetId('');
      setPage(1);
    },
    selectAsset: setAssetId,
    selectPage: (value: number) => {
      setPage(value);
      setAssetId('');
    },
  };
}
