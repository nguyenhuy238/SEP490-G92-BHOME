import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { formatContractMoney } from '../../../../../packages/client-core/src/contracts';
import { TenantSettlementTransfer } from '../../screens/TenantSettlementTransfer';
import { colors } from '../../theme/theme';

/** A server-issued SePay obligation, created only after accepted charges and deposit offsets. */
export function TenantMoveOutExcessPayment({
  contractId,
  chargeId,
  payableAmount,
  onChanged,
}: {
  contractId: string;
  chargeId: string;
  payableAmount: string;
  onChanged: () => void;
}) {
  return (
    <View
      style={{
        gap: 10,
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.white,
      }}
    >
      <Text style={{ fontWeight: '700', color: colors.navy }}>Thanh toán phần vượt cọc</Text>
      <Text>
        Khoản cần thanh toán thêm sau khi đã cấn trừ cọc: {formatContractMoney(payableAmount)}.
        Thông tin chuyển khoản bên dưới do máy chủ cấp cho khoản phải thu đã xác minh.
      </Text>
      <TenantSettlementTransfer
        contractId={contractId}
        chargeId={chargeId}
        autoOpen
        changed={onChanged}
      />
    </View>
  );
}
