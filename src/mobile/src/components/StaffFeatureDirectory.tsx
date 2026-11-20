import React from 'react';
import { StyleSheet, View } from 'react-native';
import { DashboardHeading, dashboardStyles } from './DashboardKit';
import { StaffFeatureCard } from './StaffFeatureCard';
import { frequentStaffFeatures } from '../features/workspace/staffFeatures';
import type { WorkspaceScreen } from '../features/workspace/navigation';
import { staffColors } from '../theme/theme';

export function StaffFeatureDirectory({
  onOpen,
}: {
  onOpen: (screen: WorkspaceScreen, params?: Record<string, string>) => void;
}) {
  return (
    <View style={dashboardStyles.section}>
      <DashboardHeading title="Truy cập nhanh" />
      <View style={styles.grid}>
        {frequentStaffFeatures.map((item) => (
          <View key={item.screen} style={styles.cell}>
            <StaffFeatureCard
              title={item.title}
              description={item.detail}
              icon={item.icon}
              color={staffColors.blue}
              background={staffColors.blueSoft}
              onPress={() => onOpen(item.screen)}
              compact
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' },
  cell: { flexBasis: '45%', flexGrow: 1, maxWidth: '48%' },
});
