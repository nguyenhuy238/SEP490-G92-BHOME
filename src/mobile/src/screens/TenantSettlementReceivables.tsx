import React, { useState } from 'react';
import { Text } from 'react-native-paper';
import {
  formatContractMoney,
  type SettlementReceivables,
} from '../../../../packages/client-core/src/contracts';
import { Action, Box, Heading, ui } from '../components/WorkspaceKit';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { TenantSettlementTransfer } from './TenantSettlementTransfer';
import { formatBillingDecimal } from '../../../../packages/client-core/src/invoices';

export function TenantSettlementReceivables() {
  const [page, setPage] = useState(1);
  const query = useWorkspaceQuery<{ items: SettlementReceivables[]; total: number }>(
    `/api/v1/tenant/settlement-receivables?page=${page}&pageSize=10`,
    { notifyError: false },
  );
  return (
    <Box>
      <Heading
        title="Khoản phải thu khi trả phòng"
        detail="Nợ phòng được giữ sau bàn giao; chỉ người thuê thuộc khoản phải thu mới xem được."
      />
      {query.loading && <Text>Đang tải khoản phải thu…</Text>}
      {!!query.error && <Text style={ui.red}>{query.error}</Text>}
      {query.data && !query.data.items?.length && <Text>Chưa có khoản phải thu chuyển ra.</Text>}
      {(query.data?.items ?? []).map((source) => (
        <Box key={source.contractId}>
          <Text variant="titleSmall">Phòng {source.roomNumber}</Text>
          {source.receivables.map((r) => (
            <Box key={r.charge.id}>
              <Text>{r.charge.description}</Text>
              {r.charge.fixedCharge && (
                <Text>
                  {r.charge.fixedCharge.partialMonth === 0
                    ? 'Theo chính sách đủ tháng'
                    : `Theo ${r.charge.fixedCharge.occupiedDays}/${r.charge.fixedCharge.periodDays} ngày phòng có người ở`}{' '}
                  · Đơn giá tháng {formatContractMoney(r.charge.fixedCharge.rate)}
                </Text>
              )}
              {r.charge.utility && (
                <Text>
                  Mốc đã ghi nhận {formatBillingDecimal(r.charge.utility.baseline.value)} → chỉ số
                  chốt {formatBillingDecimal(r.charge.utility.final.value)} · Phần tăng thêm{' '}
                  {formatBillingDecimal(r.charge.utility.quantity)}
                </Text>
              )}
              <Text>Phải thu: {formatContractMoney(r.charge.amount)}</Text>
              <Text>
                Đã phân bổ: {formatContractMoney(r.allocated)} · Còn nợ:{' '}
                {formatContractMoney(r.outstanding)}
              </Text>
              <Text>
                {r.status === 'Paid'
                  ? 'Đã thanh toán'
                  : r.status === 'PartiallyPaid'
                    ? 'Đã thanh toán một phần'
                    : 'Chưa thanh toán'}
              </Text>
              <Text>
                Chi phí theo biên bản kiểm tra được Owner duyệt. Số đã phân bổ do máy chủ xác nhận.
              </Text>
              {r.status !== 'Paid' && (
                <TenantSettlementTransfer
                  contractId={source.contractId}
                  chargeId={r.charge.id}
                  changed={query.reload}
                />
              )}
            </Box>
          ))}
          {source.offsets.map((o) => (
            <Text key={o.id}>
              Cấn trừ cọc đã duyệt: {formatContractMoney(o.amount)} · {o.reason}
            </Text>
          ))}
        </Box>
      ))}
      <Action secondary disabled={query.loading} onPress={query.reload}>
        Tải lại khoản phải thu
      </Action>
      {page > 1 && (
        <Action secondary onPress={() => setPage((v) => v - 1)}>
          Trang khoản phải thu trước
        </Action>
      )}
      {(query.data?.total ?? 0) > page * 10 && (
        <Action secondary onPress={() => setPage((v) => v + 1)}>
          Trang khoản phải thu sau
        </Action>
      )}
    </Box>
  );
}
