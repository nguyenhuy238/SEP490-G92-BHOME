import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { staffColors as s, colors as c } from '../theme/theme';

export interface ProgressStep {
  key: string;
  label: string;
}

export function OnboardingStepper({
  steps,
  current,
  completed = [],
  comfortable = false,
  showCaption = true,
  wrap = false,
}: {
  steps: readonly ProgressStep[];
  current: number;
  completed?: readonly string[];
  comfortable?: boolean;
  showCaption?: boolean;
  wrap?: boolean;
}) {
  return (
    <View style={styles.root} accessibilityLabel={`Bước ${current + 1}/${steps.length}`}>
      {showCaption && (
        <Text variant="labelMedium" style={styles.caption}>
          Bước {current + 1}/{steps.length} · {steps[current]?.label}
        </Text>
      )}
      <View style={[styles.track, wrap && { flexWrap: 'wrap', rowGap: 12 }]}>
        {steps.map((step, index) => {
          const done = completed.includes(step.key);
          const active = index === current;
          const color = done ? s.green : active ? s.blue : c.muted;
          return (
            <View key={step.key} style={[styles.step, wrap && { flex: 0, width: '25%' }]}>
              {index > 0 && (!wrap || index % 4 !== 0) && (
                <View
                  style={[
                    styles.line,
                    comfortable && styles.comfortableLine,
                    done && { backgroundColor: s.green },
                  ]}
                />
              )}
              <View
                accessibilityLabel={`${step.label}: ${done ? 'Đã hoàn thành' : active ? 'Đang thực hiện' : 'Chưa hoàn thành'}`}
                style={[
                  styles.circle,
                  comfortable && styles.comfortableCircle,
                  { backgroundColor: done || active ? color : c.soft },
                ]}
              >
                {done ? (
                  <Icon source="check" size={16} color={c.white} />
                ) : (
                  <Text style={{ color: active ? c.white : c.muted, fontWeight: '700' }}>
                    {index + 1}
                  </Text>
                )}
              </View>
              <Text
                style={[
                  styles.label,
                  comfortable && styles.comfortableLabel,
                  { color },
                  active && { fontWeight: '700' },
                ]}
              >
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12, paddingVertical: 4 },
  caption: { color: s.navy },
  track: { flexDirection: 'row' },
  step: { flex: 1, alignItems: 'center', gap: 6 },
  circle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: {
    position: 'absolute',
    left: '-50%',
    right: '50%',
    top: 13,
    height: 2,
    backgroundColor: c.border,
  },
  label: { fontSize: 11, lineHeight: 16, textAlign: 'center', paddingHorizontal: 2 },
  comfortableCircle: { width: 32, height: 32, borderRadius: 16 },
  comfortableLine: { top: 15 },
  comfortableLabel: { fontSize: 12, lineHeight: 18 },
});
