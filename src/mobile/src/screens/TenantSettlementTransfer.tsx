import React, { useState } from 'react';
import { Image } from 'react-native';
import { Text } from 'react-native-paper';
import {
  formatContractMoney,
  type SettlementTransferInstructions,
} from '../../../../packages/client-core/src/contracts';
import { Action, Box, ui } from '../components/WorkspaceKit';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';

export function TenantSettlementTransfer({
  contractId,
  chargeId,
  changed,
}: {
  contractId: string;
  chargeId: string;
  changed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const query = useWorkspaceQuery<SettlementTransferInstructions>(
    open
      ? `/api/v1/contracts/${encodeURIComponent(contractId)}/move-out/receivables/${encodeURIComponent(chargeId)}/transfer-instructions`
      : null,
    { notifyError: false },
  );
  if (!open)
    return (
      <Action secondary onPress={() => setOpen(true)}>
        Xem thông tin chuyển khoản cho khoản phải thu
      </Action>
    );
  const data = query.data;
  return (
    <Box>
      {query.loading && <Text>Đang tải thông tin chuyển khoản…</Text>}
      {!!query.error && <Text style={ui.red}>{query.error}</Text>}
      {data?.availability === 'ReceivingAccountUnavailable' && (
        <Text>
          Owner chưa cấu hình tài khoản nhận tiền phù hợp. Chờ Owner cập nhật trước khi chuyển
          khoản.
        </Text>
      )}
      {data?.availability === 'Settled' && (
        <Text>Máy chủ xác nhận khoản phải thu đã được thanh toán đủ.</Text>
      )}
      {data && ['Available', 'InstructionsOnly'].includes(data.availability) && (
        <>
          {data.isDevelopmentDemo && (
            <Text style={ui.red}>Dữ liệu thử nghiệm; không chuyển tiền thật.</Text>
          )}
          <Text>Số còn phải trả: {formatContractMoney(data.outstandingAmount)}</Text>
          <Text selectable>Ngân hàng: {data.bankIdentifier}</Text>
          <Text selectable>
            Tài khoản: {data.accountNumber} · {data.accountHolder}
          </Text>
          <Text selectable>Nội dung chuyển khoản: {data.transferReference}</Text>
          {data.qrImageDataUri?.startsWith('data:image/png;base64,') && (
            <Image
              accessibilityLabel="Mã chuyển khoản khoản phải thu"
              source={{ uri: data.qrImageDataUri }}
              style={{ width: 220, height: 220 }}
            />
          )}
          <Text>
            Chuyển khoản đúng nội dung. Thanh toán chỉ được ghi nhận sau khi máy chủ xác minh giao
            dịch; ảnh chụp hoặc mở mã QR chưa xác nhận thanh toán.
          </Text>
        </>
      )}
      <Action
        secondary
        disabled={query.loading}
        onPress={() => {
          query.reload();
          changed();
        }}
      >
        Kiểm tra lại trạng thái khoản phải thu
      </Action>
      <Action secondary onPress={() => setOpen(false)}>
        Ẩn thông tin chuyển khoản
      </Action>
    </Box>
  );
}
