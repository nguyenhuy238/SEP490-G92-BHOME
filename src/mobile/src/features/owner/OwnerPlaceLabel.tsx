import React from 'react';
import { Text } from 'react-native-paper';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import { queryPolicies } from '../../lib/queryPolicies';
import type { AttentionRecord } from '../../services/ownerAttention';
import type { Named } from '../../lib/api';
import { colors } from '../../theme/theme';

export function OwnerPlaceLabel({ item }: { item: AttentionRecord }) {
  const locations = useWorkspaceQuery<Named[]>(
    !item.locationName && item.locationId ? '/api/v1/capture/locations' : null,
    { cache: queryPolicies.rooms },
  );
  const room = useWorkspaceQuery<{ roomNumber: string }>(
    !item.roomNumber && item.roomId ? `/api/v1/rooms/${item.roomId}` : null,
    { cache: queryPolicies.rooms },
  );
  const locationName =
    item.locationName || locations.data?.find((location) => location.id === item.locationId)?.label;
  const roomNumber = item.roomNumber || room.data?.roomNumber;
  return (
    <Text style={{ color: colors.muted }}>
      {[locationName, roomNumber ? `Phòng ${roomNumber}` : null].filter(Boolean).join(' · ') ||
        (locations.loading || room.loading ? 'Đang tải vị trí…' : 'Chi tiết vị trí trong hồ sơ')}
    </Text>
  );
}
