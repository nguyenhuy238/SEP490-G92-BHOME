import React from 'react';
import { Text } from 'react-native-paper';
import type { Named } from '../../lib/api';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import { queryPolicies } from '../../lib/queryPolicies';
import { colors } from '../../theme/theme';

export function OwnerStaffName({ staffId }: { staffId?: string | null }) {
  const staff = useWorkspaceQuery<Named[]>(staffId ? '/api/v1/capture/staff' : null, {
    cache: queryPolicies.rooms,
  });
  const name = Array.isArray(staff.data)
    ? staff.data.find((item) => item.id === staffId)?.label
    : undefined;
  return (
    <Text style={{ color: colors.muted }}>
      Phụ trách:{' '}
      {name ||
        (!staffId ? 'Chưa có nhân viên' : staff.loading ? 'Đang tải…' : 'Nhân viên được phân công')}
    </Text>
  );
}
