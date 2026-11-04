import React from 'react';
import { View } from 'react-native';
import { Heading } from './WorkspaceKit';
import { MeterProgress } from './MeterProgress';

export function MeterFlowHeader({ step }: { step: number }) {
  return (
    <View style={{ gap: 14 }}>
      <Heading
        title="Ghi chỉ số điện nước"
        detail={
          [
            'Chọn phòng và tác vụ cần ghi.',
            'Chụp rõ mặt số công tơ, tránh lóa.',
            'Kiểm tra và chỉnh sửa chỉ số.',
            'Đối chiếu thông tin trước khi lưu.',
          ][step]
        }
      />
      <MeterProgress step={step} />
    </View>
  );
}
