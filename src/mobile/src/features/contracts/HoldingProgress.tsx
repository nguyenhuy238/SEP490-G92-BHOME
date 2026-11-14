import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, ProgressBar, Text } from 'react-native-paper';
import { holdingSteps } from './holdingSteps';

export function HoldingProgress({ current }: { current: number }) {
  const [expanded, setExpanded] = useState(false);
  const step = holdingSteps[current];
  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <Text style={styles.count}>
          Bước {current + 1}/{holdingSteps.length}
        </Text>
        <Text style={styles.title}>{step?.label}</Text>
      </View>
      <ProgressBar
        progress={(current + 1) / holdingSteps.length}
        color="#2563EB"
        style={styles.bar}
        accessibilityLabel={`Tiến độ giữ chỗ: bước ${current + 1} trên ${holdingSteps.length}`}
      />
      <View style={styles.row}>
        <Text style={styles.next}>
          {current < holdingSteps.length - 1
            ? `Tiếp theo: ${holdingSteps[current + 1]?.label}`
            : 'Đối chiếu tiền cọc và xác nhận giữ chỗ'}
        </Text>
      </View>
      <Button
        compact
        icon="information-outline"
        onPress={() => setExpanded((value) => !value)}
        accessibilityState={{ expanded }}
        contentStyle={{ minHeight: 36 }}
        style={{ alignSelf: 'flex-start', marginLeft: -8 }}
        labelStyle={styles.info}
      >
        Xem quy trình giữ chỗ
      </Button>
      {expanded && (
        <View style={styles.details}>
          {holdingSteps.map((item, index) => (
            <Text key={item.key} style={[styles.next, index === current && styles.title]}>
              {index < current ? '✓' : index === current ? '●' : '○'} {index + 1}. {item.label}
              {index < current
                ? ' · Đã hoàn thành'
                : index === current
                  ? ' · Đang thực hiện'
                  : ' · Chưa thực hiện'}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { gap: 8, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  count: { fontSize: 14, fontWeight: '600', color: '#52647A' },
  title: { fontSize: 15, fontWeight: '700', color: '#173654', flexShrink: 1 },
  next: { fontSize: 13, color: '#52647A', flexShrink: 1 },
  bar: { height: 6, borderRadius: 8, backgroundColor: '#E2E8F0' },
  info: { fontSize: 13, color: '#315984' },
  details: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12, gap: 8 },
});
