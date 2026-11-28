import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { StaffFeatureCard } from './StaffFeatureCard';
import { frequentStaffFeatures } from '../features/workspace/staffFeatures';
import type { WorkspaceScreen } from '../features/workspace/navigation';
import { staffColors } from '../theme/theme';
import { staffHomePalette } from '../theme/staffLayout';
import { fontStyle } from '../theme/typography';

export function StaffFeatureDirectory({
  onOpen,
  onContracts,
  overdueMeterRooms = null,
}: {
  onOpen: (screen: WorkspaceScreen, params?: Record<string, string>) => void;
  onContracts: () => void;
  overdueMeterRooms?: number | null;
}) {
  const features = [
    ...frequentStaffFeatures,
    {
      title: 'Hợp đồng',
      detail: 'Tạo và theo dõi hợp đồng',
      icon: 'file-document-outline',
      screen: 'signing' as const,
    },
    {
      title: 'Tạm trú',
      detail: 'Theo dõi tạm trú trong phạm vi phân công',
      icon: 'shield-home-outline',
      screen: 'residence' as const,
    },
  ];
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <View style={styles.headingAccent} />
        <Text style={styles.headingTitle}>Truy cập nhanh</Text>
      </View>
      <View style={styles.grid}>
        {[0, 2, 4].map((start) => (
          <View key={start} testID="staff-shortcut-row" style={styles.row}>
            {features.slice(start, start + 2).map((item) => (
              <View key={item.screen} style={styles.cell}>
                <StaffFeatureCard
                  title={item.title}
                  description={item.detail}
                  icon={item.icon}
                  color={
                    item.screen === 'meter-reading' && !!overdueMeterRooms
                      ? staffColors.red
                      : staffColors.blue
                  }
                  background={
                    item.screen === 'meter-reading' && !!overdueMeterRooms
                      ? staffColors.redSoft
                      : staffColors.blueSoft
                  }
                  status={
                    item.screen === 'meter-reading' && overdueMeterRooms
                      ? `${overdueMeterRooms} phòng quá hạn`
                      : undefined
                  }
                  danger={item.screen === 'meter-reading' && !!overdueMeterRooms}
                  onPress={() => (item.screen === 'signing' ? onContracts() : onOpen(item.screen))}
                  shortcut
                />
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 3 },
  headingAccent: { width: 4, height: 18, borderRadius: 2, backgroundColor: staffColors.blue },
  headingTitle: { ...fontStyle('bold', 18, 25), color: staffHomePalette.ink },
  grid: { gap: 8 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  cell: { flex: 1, minWidth: 0 },
});
