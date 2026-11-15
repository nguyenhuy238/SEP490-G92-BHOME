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
        color="#193653"
        style={styles.bar}
        accessibilityLabel={`Tiến độ giữ chỗ: bước ${current + 1} trên ${holdingSteps.length}`}
      />
      <View style={styles.row}>
        {current < holdingSteps.length - 1 && (
          <Text style={styles.next}>Tiếp theo: {holdingSteps[current + 1]?.label}</Text>
        )}
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
  root: { gap: 6, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  count: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  title: { fontSize: 14, fontWeight: '700', color: '#193653', flexShrink: 1, textAlign: 'right' },
  next: { fontSize: 12, color: '#64748B', flexShrink: 1 },
  bar: { height: 5, borderRadius: 8, backgroundColor: '#E2E8F0' },
  info: { fontSize: 12, color: '#193653' },
  details: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, gap: 6, borderWidth: 1, borderColor: '#E2E8F0' },
});
