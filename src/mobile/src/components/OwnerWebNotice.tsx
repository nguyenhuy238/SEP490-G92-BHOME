import React from 'react';
import { Text } from 'react-native-paper';
import { Box, Heading, ui } from './WorkspaceKit';

export function OwnerWebNotice({ task = 'Xử lý hợp đồng và tài chính' }: { task?: string }) {
  return (
    <Box>
      <Heading title="Thực hiện trên Owner Web" />
      <Text>{task} tại Owner Web. Mobile dùng để theo dõi trạng thái, lịch sử và thông báo.</Text>
      <Text style={ui.muted}>
        Mở cổng Owner Web đã được quản trị viên cung cấp trên trình duyệt để tiếp tục.
      </Text>
    </Box>
  );
}
