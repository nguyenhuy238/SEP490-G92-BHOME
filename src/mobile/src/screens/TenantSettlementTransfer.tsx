import React, { useEffect, useState } from 'react';
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
  autoOpen = false,
}: {
  contractId: string;
  chargeId: string;
  changed: () => void;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const query = useWorkspaceQuery<SettlementTransferInstructions>(
    open
      ? `/api/v1/contracts/${encodeURIComponent(contractId)}/move-out/receivables/${encodeURIComponent(chargeId)}/transfer-instructions`
      : null,
    { notifyError: false },
  );
  const availability = query.data?.availability;
  const reload = query.reload;
  // SePay verifies bank transfers asynchronously. Follow the existing Tenant
  // payment UX: refresh the server-issued obligation while its QR is visible,
  // then stop once the verified outstanding becomes zero. Never infer paid
  // from QR visibility or a client-side action.
  useEffect(() => {
    if (!open || !['Available', 'InstructionsOnly'].includes(availability ?? '')) return;
    const timer = setInterval(reload, 5000);
    return () => clearInterval(timer);
  }, [open, availability, reload]);
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
      {data?.availability === 'TenantConfirmationRequired' && (
        <Text>Vui lòng xác nhận đề xuất quyết toán trước khi nhận mã chuyển khoản.</Text>
      )}
      {data?.availability === 'OwnerFinalCloseRequired' && (
        <Text>
          Owner đang chốt các khoản phải thu và tiền cọc. Mã QR sẽ được cấp sau khi máy chủ xác minh
          số cần thanh toán.
        </Text>
      )}
      {data?.availability === 'DepositAllocationRequired' && (
        <Text>Cần hoàn tất cấn trừ tiền cọc trước khi cấp mã thanh toán để tránh thu dư.</Text>
      )}
      {data?.availability === 'OwnerFinancialReviewRequired' && (
        <Text>Owner cần đối chiếu lại khoản phải thu trước khi hệ thống cấp mã thanh toán.</Text>
      )}
      {data?.availability === 'AutomaticPaymentUnavailable' && (
        <Text>
          Thanh toán tự động SePay chưa được cấu hình. Vui lòng đợi Owner kích hoạt trước khi chuyển
          khoản; hệ thống chưa cấp QR thanh toán cho khoản này.
        </Text>
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
          <Text>Trạng thái thanh toán được tự động kiểm tra lại trong lúc hiển thị mã QR.</Text>
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
