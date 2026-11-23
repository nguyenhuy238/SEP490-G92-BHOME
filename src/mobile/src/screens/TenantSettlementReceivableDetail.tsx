import React, { useCallback, useEffect } from 'react';
import { router } from 'expo-router';
import { Text } from 'react-native-paper';
import {
  formatContractMoney,
  type SettlementReceivables,
  type SettlementReceivableBalance,
} from '../../../../packages/client-core/src/contracts';
import { Action, Box, Heading, Pill, ui } from '../components/WorkspaceKit';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import { TenantSettlementTransfer } from './TenantSettlementTransfer';

const guidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
// Keep verified detail visible while checking for a webhook-allocated payment.
// Uncached queries clear their data on every reload, which used to flash the QR.
const receivableCache = { staleTime: 0, gcTime: 30_000, tags: ['payments', 'contracts'] as const };

function receivableTitle(row: SettlementReceivableBalance): string {
  if (row.charge.kind === 'TenantDamage')
    return row.charge.assetId ? 'Thiệt hại tài sản khi trả phòng' : 'Thiệt hại phòng khi trả phòng';
  if (row.charge.kind === 'FinalUtility') return 'Điện/nước cuối kỳ';
  return 'Khoản phải thu quyết toán trả phòng';
}

const hasOutstanding = (amount: string) => /^[1-9]\d*(?:\.\d+)?$/.test(amount);

/** Dedicated receivable detail. This is not a periodic invoice and has no invoiceId. */
export function TenantSettlementReceivableDetail({
  contractId,
  chargeId,
}: {
  contractId: string;
  chargeId: string;
}) {
  const { session } = useSession();
  const { go } = useWorkspace();
  const allowed = !!session?.roles.includes('Tenant');
  const valid = guidPattern.test(contractId) && guidPattern.test(chargeId);
  const query = useWorkspaceQuery<SettlementReceivables>(
    allowed && valid
      ? `/api/v1/contracts/${encodeURIComponent(contractId)}/move-out/receivables`
      : null,
    { notifyError: false, cache: receivableCache },
  );
  const row =
    query.data?.contractId === contractId
      ? query.data.receivables.find((item) => item.charge.id === chargeId)
      : undefined;
  const paid = row?.status === 'Paid';
  const payable = !!row && !paid && hasOutstanding(row.outstanding);
  const reload = query.reload;
  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else go('invoice');
  }, [go]);
  const header = useWorkspaceHeaderRefresh(reload, query.loading, {
    title: 'Chi tiết khoản phải thu trả phòng',
    onBack: back,
  });

  // Once the verified webhook allocates payment, the next read removes the QR.
  // Keep this source of truth separate from the transfer instruction snapshot.
  useEffect(() => {
    if (!payable) return;
    const timer = setInterval(reload, 5000);
    return () => clearInterval(timer);
  }, [payable, reload]);

  return (
    <Box>
      {!header && <Heading title="Chi tiết khoản phải thu trả phòng" />}
      <Text style={ui.muted}>
        Khoản phải thu phát sinh khi quyết toán trả phòng, không phải hóa đơn điện nước hoặc tiền
        phòng định kỳ. Số tiền và trạng thái do máy chủ xác minh.
      </Text>
      {!allowed && <Text>Tài khoản không có quyền xem khoản phải thu Tenant.</Text>}
      {allowed && !valid && <Text style={ui.red}>Liên kết khoản phải thu không hợp lệ.</Text>}
      {query.loading && <Text>Đang tải chi tiết khoản phải thu…</Text>}
      {!!query.error && <Text style={ui.red}>{query.error}</Text>}
      {query.data && !row && (
        <Text style={ui.red}>Không tìm thấy khoản phải thu thuộc hợp đồng này.</Text>
      )}
      {row && (
        <>
          <Heading title={receivableTitle(row)} detail={`Phòng ${query.data?.roomNumber ?? ''}`} />
          <Text>{row.charge.description}</Text>
          <Text>Tổng khoản phải thu: {formatContractMoney(row.charge.amount)}</Text>
          <Text>Đã phân bổ (bao gồm cấn trừ cọc): {formatContractMoney(row.allocated)}</Text>
          <Text>Còn phải thanh toán: {formatContractMoney(row.outstanding)}</Text>
          {query.data?.offsets
            .filter((offset) => offset.receivableId === chargeId)
            .map((offset) => (
              <Text key={offset.id}>
                Cấn trừ cọc đã duyệt: {formatContractMoney(offset.amount)} · {offset.reason}
              </Text>
            ))}
          <Pill tone={paid ? 'green' : 'blue'}>
            {paid
              ? 'Đã thanh toán'
              : row.status === 'PartiallyPaid'
                ? 'Đã thanh toán một phần'
                : 'Chưa thanh toán'}
          </Pill>
          {paid ? (
            <Text>Máy chủ đã xác nhận thanh toán đủ. Không còn mã QR cần thanh toán.</Text>
          ) : payable ? (
            <TenantSettlementTransfer
              key={`${contractId}:${chargeId}`}
              contractId={contractId}
              chargeId={chargeId}
              autoOpen
              expectedOutstanding={row.outstanding}
              changed={reload}
            />
          ) : (
            <Text>Chưa có số dư cần chuyển khoản. Hãy cập nhật trạng thái từ máy chủ.</Text>
          )}
        </>
      )}
      <Action secondary disabled={query.loading || !allowed || !valid} onPress={reload}>
        Cập nhật trạng thái thanh toán
      </Action>
      {!header && (
        <Action secondary onPress={back}>
          Quay lại hóa đơn và thanh toán
        </Action>
      )}
    </Box>
  );
}
