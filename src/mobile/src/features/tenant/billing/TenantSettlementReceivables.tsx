import React, { useState } from 'react';
import { Text } from 'react-native-paper';
import {
  formatContractMoney,
  type SettlementReceivables,
} from '../../../../../../packages/client-core/src/contracts';
import { Action, Box, Heading, ui } from '../../../components/WorkspaceKit';
import { useWorkspaceQuery } from '../../workspace/useWorkspaceQuery';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { formatBillingDecimal } from '../../../../../../packages/client-core/src/invoices';
import { loadTenantSettlements } from '../../workspace/tenantFinancialLoads';

export function TenantSettlementReceivables() {
  const { go } = useWorkspace();
  const [page, setPage] = useState(1);
  const query = useWorkspaceQuery<{ items: SettlementReceivables[]; total: number }>(
    `/api/v1/tenant/settlement-receivables?page=${page}&pageSize=10`,
    { notifyError: false, load: loadTenantSettlements },
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
          <Text>Cọc còn khả dụng để đối chiếu: {formatContractMoney(source.availableDeposit)}</Text>
          <Text style={ui.muted}>
            Số cọc khả dụng chưa phải số tiền hoàn. Owner duyệt từng khoản phải thu, việc cấn trừ và
            yêu cầu hoàn tiền được xác minh riêng.
          </Text>
          {source.receivables.some((row) => row.charge.kind === 'TenantDamage') && (
            <Heading
              title="Thiệt hại đã được Owner duyệt"
              detail="Các khoản bên dưới được Owner xét duyệt từ kết quả kiểm tra và bằng chứng thực tế khi trả phòng"
            />
          )}
          {source.receivables.map((r) => (
            <Box key={r.charge.id}>
              <Text variant="titleSmall">
                {r.charge.kind === 'TenantDamage'
                  ? r.charge.assetId
                    ? 'Thiệt hại tài sản'
                    : 'Thiệt hại phòng'
                  : r.charge.kind === 'FinalUtility'
                    ? 'Điện/nước cuối kỳ'
                    : 'Khoản phải thu cuối kỳ'}
              </Text>
              <Text>{r.charge.description}</Text>
              {r.charge.fixedCharge && (
                <Text>
                  {r.charge.fixedCharge.partialMonth === 0
                    ? 'Theo chính sách đủ tháng'
                    : `Theo ${r.charge.fixedCharge.occupiedDays}/${r.charge.fixedCharge.periodDays} ngày phòng có người ở`}{' '}
                  · Đơn giá tháng {formatBillingDecimal(r.charge.fixedCharge.rate)} ₫
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
              {!!r.charge.fixedCharge?.approvedAdjustmentIds?.length && (
                <Text>
                  Tiền thuê/phí đã được đối chiếu với điều chỉnh do Owner duyệt. Xem lịch sử điều
                  chỉnh của hóa đơn để theo dõi căn cứ.
                </Text>
              )}
              <Text>
                Đã phân bổ: {formatContractMoney(r.allocated)} · Còn nợ:{' '}
                {formatContractMoney(r.outstanding)}
              </Text>
              {source.offsets
                .filter((offset) => offset.receivableId === r.charge.id)
                .map((offset) => (
                  <Text key={offset.id}>
                    Cấn trừ cọc đã duyệt cho khoản này: {formatContractMoney(offset.amount)}
                    {' · '}
                    {offset.reason}
                  </Text>
                ))}
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
              <Action
                secondary
                onPress={() =>
                  go('invoice', {
                    view: 'settlement',
                    settlementContractId: source.contractId,
                    settlementChargeId: r.charge.id,
                  })
                }
              >
                Xem chi tiết khoản phải thu
              </Action>
            </Box>
          ))}
          {source.offsets
            .filter(
              (offset) =>
                !offset.receivableId ||
                !source.receivables.some((r) => r.charge.id === offset.receivableId),
            )
            .map((o) => (
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
