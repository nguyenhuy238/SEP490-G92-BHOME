import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { staffColors as s, colors as c } from '../../../theme/theme';

export const mainContractSteps = [
  { key: 'room', label: 'Chọn phòng' },
  { key: 'identity', label: 'CCCD' },
  { key: 'draft', label: 'Bản nháp' },
  { key: 'preview', label: 'Xem hợp đồng' },
  { key: 'sign', label: 'Ký hợp đồng' },
  { key: 'payment', label: 'Tạo mã QR' },
  { key: 'activate', label: 'Kích hoạt hợp đồng' },
] as const;

export function MainContractProgress({ current }: { current: number }) {
  const step = Math.max(0, Math.min(current > 0 ? current - 1 : 0, mainContractSteps.length - 1));
  return (
    <View style={{ gap: 8 }} accessibilityLabel={`Bước ${step + 1}/${mainContractSteps.length}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ color: s.navy }}>
          Bước {step + 1}/{mainContractSteps.length}
        </Text>
        <Text style={{ color: s.navy, fontWeight: '700' }}>{mainContractSteps[step].label}</Text>
      </View>
      <View style={{ height: 5, borderRadius: 4, backgroundColor: c.border, overflow: 'hidden' }}>
        <View
          style={{
            height: 5,
            width: `${((step + 1) / mainContractSteps.length) * 100}%`,
            backgroundColor: s.blue,
          }}
        />
      </View>
      <Text style={{ color: c.muted }}>
        {step < mainContractSteps.length - 1
          ? `Tiếp theo: ${mainContractSteps[step + 1].label}`
          : 'Hoàn tất theo trạng thái xác nhận từ máy chủ'}
      </Text>
    </View>
  );
}
