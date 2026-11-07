import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from 'react-native-paper';
import { DashboardHeading, dashboardStyles } from './DashboardKit';
import { StaffFeatureCard } from './StaffFeatureCard';
import {
  frequentStaffFeatures,
  staffFeatureGroups,
  type StaffFeature,
} from '../features/workspace/staffFeatures';
import type { WorkspaceScreen } from '../features/workspace/navigation';
import { staffColors } from '../theme/theme';

function StaffFeatureGrid({
  items,
  onOpen,
}: {
  items: StaffFeature[];
  onOpen: (screen: WorkspaceScreen) => void;
}) {
  return (
    <View style={styles.grid}>
      {items.map((item) => (
        <View key={item.screen} style={styles.cell}>
          <StaffFeatureCard
            title={item.title}
            description={item.detail}
            icon={item.icon}
            color={item.screen === 'staff-emergencies' ? staffColors.red : staffColors.blue}
            background={
              item.screen === 'staff-emergencies' ? staffColors.redSoft : staffColors.blueSoft
            }
            onPress={() => onOpen(item.screen)}
            compact
            incident={['report-incident', 'staff-maintenance', 'staff-emergencies'].includes(
              item.screen,
            )}
            status={item.pending ? 'Chưa khả dụng' : item.partial ? 'Đã có một phần' : undefined}
          />
        </View>
      ))}
    </View>
  );
}

export function StaffFeatureDirectory({ onOpen }: { onOpen: (screen: WorkspaceScreen) => void }) {
  const [expanded, setExpanded] = useState(false);
  const count = staffFeatureGroups.reduce((total, group) => total + group.items.length, 0);
  return (
    <>
      <View style={dashboardStyles.section}>
        <DashboardHeading title="Thao tác thường dùng" />
        <StaffFeatureGrid items={frequentStaffFeatures} onOpen={onOpen} />
        <Button
          mode="outlined"
          icon={expanded ? 'chevron-up' : 'view-grid-outline'}
          onPress={() => setExpanded(!expanded)}
          accessibilityState={{ expanded }}
        >
          {expanded ? 'Thu gọn chức năng' : `Xem tất cả chức năng (${count})`}
        </Button>
      </View>
      {expanded &&
        staffFeatureGroups.map((group) => (
          <View key={group.title} style={dashboardStyles.section}>
            <DashboardHeading title={group.title} />
            <StaffFeatureGrid items={group.items} onOpen={onOpen} />
          </View>
        ))}
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' },
  cell: { flexBasis: '45%', flexGrow: 1, maxWidth: '48%' },
});
