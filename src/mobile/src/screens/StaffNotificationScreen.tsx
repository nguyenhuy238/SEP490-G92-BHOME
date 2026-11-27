import React from 'react';
import { Icon, Text } from 'react-native-paper';
import { Action, Box, Heading, ui } from '../components/WorkspaceKit';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { staffColors } from '../theme/theme';

export function StaffNotificationScreen() {
  const { go } = useWorkspace();
  return (
    <>
      <Heading title="Gửi thông báo" />
      <Box style={{ padding: 16, gap: 8 }}>
        <Icon source="bullhorn-outline" size={28} color={staffColors.navy} />
        <Text variant="titleMedium">Chức năng chưa triển khai</Text>
        <Text style={ui.muted}>
          Ứng dụng chưa hỗ trợ gửi thông báo đến người thuê. Chưa có thông báo nào được gửi.
        </Text>
        <Action secondary onPress={() => go('notifications')}>
          Xem thông báo của tôi
        </Action>
      </Box>
    </>
  );
}
