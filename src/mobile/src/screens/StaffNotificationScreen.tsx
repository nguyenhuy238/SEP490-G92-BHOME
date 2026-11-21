import React from 'react';
import { Icon, Text } from 'react-native-paper';
import { Action, Box, Heading, ui } from '../components/WorkspaceKit';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { staffColors } from '../theme/theme';

export function StaffNotificationScreen() {
  const { go } = useWorkspace();
  return (
    <>
      <Heading title="Gửi thông báo" detail="Thông báo đến người thuê" />
      <Box>
        <Icon source="bullhorn-outline" size={40} color={staffColors.purple} />
        <Text variant="titleMedium">Chức năng chưa triển khai</Text>
        <Text style={ui.muted}>
          Ứng dụng chưa hỗ trợ gửi thông báo đến người thuê. Chưa có thông báo nào được gửi.
        </Text>
        <Text style={ui.muted}>
          Khi được triển khai, người nhận phải nằm trong cơ sở được phân công và theo quyền của tài
          khoản.
        </Text>
        <Action secondary onPress={() => go('notifications')}>
          Xem thông báo của tôi
        </Action>
      </Box>
    </>
  );
}
