import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { colors as c } from '../theme/theme';

export function MeterProgress({ step }: { step: number }) {
  return (
    <View accessibilityLabel={`Bước ${step + 1} trên 4`} style={{ flexDirection: 'row', gap: 6 }}>
      {['Chọn tác vụ', 'Chụp ảnh', 'OCR', 'Xác nhận'].map((label, index) => (
        <View key={label} style={{ flex: 1, gap: 8 }}>
          <View
            style={{
              height: 4,
              borderRadius: 4,
              backgroundColor: index <= step ? c.blue : c.border,
            }}
          />
          <Text variant="labelSmall" style={{ color: index === step ? c.blue : c.muted }}>
            {index + 1}. {label}
          </Text>
        </View>
      ))}
    </View>
  );
}
