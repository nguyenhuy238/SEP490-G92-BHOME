import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { formatContractMoney } from '../../../../../packages/client-core/src/contracts';
import { Action } from '../../components/WorkspaceKit';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { colors } from '../../theme/theme';

/** A server-issued SePay obligation, created only after accepted charges and deposit offsets. */
export function TenantMoveOutExcessPayment({
  contractId,
  chargeId,
  payableAmount,
}: {
  contractId: string;
  chargeId: string;
  payableAmount: string;
}) {
  const { go } = useWorkspace();
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
        Khoản phải thu sau khi cấn trừ cọc: {formatContractMoney(payableAmount)}. Xem trạng thái
        thanh toán và thông tin chuyển khoản tại chi tiết khoản phải thu.
      </Text>
      <Action
        onPress={() =>
          go('invoice', {
            view: 'settlement',
            settlementContractId: contractId,
            settlementChargeId: chargeId,
          })
        }
      >
        Xem khoản phải thu trả phòng
      </Action>
    </View>
  );
}
