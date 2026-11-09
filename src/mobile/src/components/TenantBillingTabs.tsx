import React from 'react';
import { View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { invoiceUi } from './InvoiceDetailUi';
export type BillingTab = 'invoices' | 'verified' | 'outstanding';
export function TenantBillingTabs({
  active,
  select,
}: {
  active: BillingTab;
  select?: (tab: BillingTab) => void;
}) {
  const { go } = useWorkspace();
  return (
    <View style={invoiceUi.tabBar}>
      {(
        [
          ['invoices', 'Hóa đơn'],
          ['verified', 'Lịch sử'],
          ['outstanding', 'Công nợ'],
        ] as const
      ).map(([value, label]) => (
        <TouchableRipple
          key={value}
          style={[invoiceUi.tab, active === value && invoiceUi.tabActive]}
          accessibilityRole="tab"
          accessibilityLabel={label}
          accessibilityState={{ selected: active === value }}
          onPress={() => {
            if (active === value) return;
            if (select) select(value);
            else if (value === 'invoices') go('invoice');
            else go('billing-history', { historyTab: value });
          }}
        >
          <Text style={[invoiceUi.tabText, active === value && invoiceUi.tabTextActive]}>
            {label}
          </Text>
        </TouchableRipple>
      ))}
    </View>
  );
}
