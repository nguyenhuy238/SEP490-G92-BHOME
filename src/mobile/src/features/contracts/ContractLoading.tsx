import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { colors } from '../../theme/theme';

/** Keep the summary/form footprint visible while the server response is pending. */
export function ContractLoading({
  label = 'Đang tải hợp đồng…',
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  return (
    <View style={styles.root} accessibilityRole="progressbar" accessibilityLabel={label}>
      <Text>{label}</Text>
      {Array.from({ length: compact ? 1 : 2 }, (_, index) => (
        <View
          key={index}
          style={styles.card}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={[styles.line, styles.title]} />
          <View style={styles.line} />
          <View style={[styles.line, styles.short]} />
          <View style={[styles.line, styles.field]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 16 },
  card: { padding: 16, gap: 16, borderRadius: 16, backgroundColor: colors.white },
  line: { height: 14, width: '85%', borderRadius: 6, backgroundColor: colors.border },
  title: { width: '55%', height: 20 },
  short: { width: '65%' },
  field: { height: 48, width: '100%', borderRadius: 10 },
});
