import React from 'react';
import { ScrollView } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { colors as c } from '../theme/theme';

export interface StaffWorkflowTab {
  id: string;
  label: string;
}

export function StaffWorkflowTabs({
  tabs,
  selected,
  onChange,
  accessibilityLabel,
}: {
  tabs: readonly StaffWorkflowTab[];
  selected: string;
  onChange: (id: string) => void;
  accessibilityLabel: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={accessibilityLabel}
      contentContainerStyle={{ flexDirection: 'row', gap: 6, paddingVertical: 2 }}
    >
      {tabs.map((tab) => {
        const active = selected === tab.id;
        return (
          <TouchableRipple
            key={tab.id}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(tab.id)}
            style={{
              minHeight: 44,
              justifyContent: 'center',
              paddingHorizontal: 13,
              paddingVertical: 8,
              borderRadius: 8,
              borderBottomWidth: active ? 2 : 0,
              borderColor: active ? c.blue : c.border,
              backgroundColor: active ? c.tint : c.white,
            }}
          >
            <Text
              variant="labelLarge"
              style={{ color: active ? c.blue : c.muted, fontWeight: active ? '700' : '500' }}
            >
              {tab.label}
            </Text>
          </TouchableRipple>
        );
      })}
    </ScrollView>
  );
}
