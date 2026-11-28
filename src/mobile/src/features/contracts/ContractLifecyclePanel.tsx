import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { ContractNotice } from './ContractNotice';
import {
  displayContractDate,
  formatContractMoney,
  type ContractClient,
  type MoveOut,
} from '../../../../../packages/client-core/src/contracts';
import {
  moveOutActionLabel,
  settlementBlocker,
  useContractLifecycle,
} from '../../../../../packages/client-core/src/useContractLifecycle';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { signedVnd } from '../../../../../packages/client-core/src/adjustments';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { OwnerWebNotice } from '../../components/OwnerWebNotice';
import { OwnerMoveOutDecisions } from '../owner/OwnerMoveOutDecisions';
import { handoverAssetSummary } from '../../../../../packages/client-core/src/handoverForm';
import { ContractEvidence } from './ContractEvidence';
import { TenantMoveOutProposalPanel } from './moveOut/TenantMoveOutProposalPanel';
import { TenantMoveOutInspectionSummary } from './moveOut/TenantMoveOutInspectionSummary';

export function ContractLifecyclePanel({
  api,
  id,
  role,
  moveOut,
  onChanged,
}: {
  api: ContractClient;
  id: string;
  role: string;
  moveOut: MoveOut;
  onChanged: () => void;
}) {
  const q = useContractLifecycle(api, id, role, !!moveOut.isForced);
  const summary = moveOut.isForced ? null : q.summary;
  const money = (v: string | null) => (v === null ? 'Chờ xác minh' : formatContractMoney(v));

  if (role === 'Tenant') {
    const latest = q.inspections[0];
    return (
      <View style={{ gap: 14, minWidth: 0 }}>
        {q.loading && (
          <Box>
            <Text style={ui.muted}>Đang tải kết quả trả phòng…</Text>
          </Box>
        )}
        {!!q.error && (
          <Box>
            <Text style={ui.red}>{q.error}</Text>
          </Box>
        )}
        {!!latest && (
          <Box>
            <TenantMoveOutInspectionSummary api={api} contractId={id} inspection={latest} />
          </Box>
        )}
        {!q.loading && !q.error && !latest && (
          <Box>
            <Heading title="Kiểm tra trả phòng" />
            <Text style={ui.muted}>Staff chưa gửi kết quả kiểm kê cho hợp đồng này.</Text>
          </Box>
        )}
        {!!latest && (
          <TenantMoveOutProposalPanel
            api={api}
            contractId={id}
            onChanged={() => {
              q.reload();
              onChanged();
            }}
          />
        )}
      </View>
    );
  }

  return (
    <Box>
      <Heading title="Kết quả kiểm tra trả phòng" />
      <Action secondary disabled={q.loading} onPress={q.reload}>
        Tải lại kết quả và quyết toán
      </Action>
      {q.loading && <Text>Đang đối chiếu dữ liệu…</Text>}
      {!!q.error && <ContractNotice message={q.error} />}
      {q.inspections.map((i) => (
        <Box key={i.id}>
          <Heading
            title={`Kết quả kiểm tra lần ${i.version}`}
            detail={formatInstant(i.inspectedAt)}
          />
          {i.baseline && <Text>Có dữ liệu đối chiếu lúc bàn giao</Text>}
          <Text>
            Phòng: {i.baseline?.roomCondition ?? 'Chưa có dữ liệu ban đầu'} →{' '}
            {i.observed.roomCondition}
          </Text>
          <Text>
            Chìa khóa / quyền truy cập: {i.baseline?.keysAndAccess ?? 'Chưa rõ'} →{' '}
            {i.observed.keysAndAccess}
          </Text>
          {i.observed.assets.map((a) => (
            <Text key={a.id}>
              {handoverAssetSummary(a)} · Khi nhận:{' '}
              {i.baseline?.assets.find((b) => b.id === a.id)?.observedCondition ?? 'Chưa rõ'}
            </Text>
          ))}
          <Text>
            Điện: {i.baseline?.electricity.value ?? 'Chưa rõ'} → {i.observed.electricity.value} ·
            Nước: {i.baseline?.water.value ?? 'Chưa rõ'} → {i.observed.water.value}
          </Text>
          <Text>{i.observed.notes}</Text>
          {!!i.observed.missingBaselineReason && (
            <Text style={ui.red}>
              Thiếu dữ liệu ban đầu: {i.observed.missingBaselineReason}. Không tự suy đoán thiệt
              hại.
            </Text>
          )}
          {!!i.observed.proposedCompensation && (
            <Text>
              Đề xuất của Staff, chưa phải khoản phải thu: {i.observed.proposedCompensation}
            </Text>
          )}
          {i.observed.evidenceIds.map((evidenceId, n) => (
            <ContractEvidence
              key={evidenceId}
              api={api}
              contractId={id}
              evidenceId={evidenceId}
              number={n + 1}
            />
          ))}
          {i.observed.assets.flatMap((a) =>
            (a.evidenceIds ?? []).map((evidenceId, n) => (
              <ContractEvidence
                key={`${a.id}-${evidenceId}`}
                api={api}
                contractId={id}
                evidenceId={evidenceId}
                label={`${a.name} · Ảnh ${n + 1}`}
              />
            )),
          )}
          {(i.observed.physicalItemEvidence ?? []).flatMap((item) =>
            item.evidenceIds.map((evidenceId, n) => (
              <ContractEvidence
                key={`${item.assetId}-${item.physicalAssetId}-${evidenceId}`}
                api={api}
                contractId={id}
                evidenceId={evidenceId}
                label={`Tài sản ${item.physicalAssetId.slice(0, 8)} · Ảnh riêng ${n + 1}`}
              />
            )),
          )}
          <Text>
            {i.ownerDecision === 'Reinspection'
              ? 'Staff đang kiểm tra lại'
              : 'Staff đã gửi kết quả kiểm kê'}
            {i.ownerReason ? ` · ${i.ownerReason}` : ''}
          </Text>
        </Box>
      ))}
      {summary && (
        <>
          <Heading title="Quyết toán từ máy chủ" />
          <Text>
            Cọc bảo đảm đã xác minh: {money(summary.verifiedSecurityDeposit)} · Cọc giữ chỗ áp dụng:{' '}
            {money(summary.appliedHoldingDeposit)}
          </Text>
          <Text>
            Nợ riêng hợp đồng: {money(summary.contractSpecificOutstanding)} · Phí cuối kỳ:{' '}
            {money(summary.approvedFinalCharges)}
          </Text>
          <Text>
            Khấu trừ đã duyệt: {money(summary.approvedDeductions)} · Hoàn tiền:{' '}
            {money(summary.refundAmount)}
          </Text>
          {summary.calculation && (
            <>
              <Text>
                Đã phát hành: {money(summary.calculation.issuedTotal)} · Phải thu hiệu lực:{' '}
                {money(summary.calculation.payableTotal)} · Đã phân bổ hóa đơn:{' '}
                {money(summary.calculation.verifiedInvoicePayments)}
              </Text>
              <Text>
                Cọc đã dùng: {money(summary.calculation.depositAllocated)} · Đã hoàn cọc:{' '}
                {money(summary.calculation.depositRefunded)}
              </Text>
              <Text>
                Cọc giữ chỗ hoàn: {money(summary.calculation.depositReserved)} · Cọc khả dụng:{' '}
                {money(summary.calculation.availableSecurityDeposit)}
              </Text>
            </>
          )}
          <Text>
            {summary.transferVerificationStatus === 'VerifiedManual'
              ? 'Hoàn cọc đã được Owner xác minh thủ công bằng sao kê và chứng từ.'
              : summary.transferVerificationStatus === 'NotRequired'
                ? 'Không có khoản cọc cần hoàn theo nguồn hiện tại.'
                : 'Cọc đang được đối chiếu hoặc chờ giao dịch hoàn được xác minh.'}
          </Text>
          <Text>
            {summary.otherActiveContracts
              ? 'Phòng còn hợp đồng đang thuê khác; hoàn tất người này vẫn giữ phòng Đang thuê.'
              : 'Máy chủ kiểm tra lại điều kiện giải phóng phòng khi hoàn tất.'}
          </Text>
          {summary.invoices.map((i) => (
            <Box key={i.invoiceId}>
              <Text>
                Kỳ {displayContractDate(i.billingPeriod)} ·{' '}
                {i.shared ? 'Hóa đơn chung phòng' : 'Hóa đơn'}
              </Text>
              <Text>
                Gốc {money(i.financials.originalIssuedAmount)} · Điều chỉnh{' '}
                {signedVnd(i.financials.approvedAdjustmentTotal)} · Phải thu{' '}
                {money(i.financials.effectivePayableAmount)}
              </Text>
              <Text>
                Đã trả {money(i.financials.allocatedPayments)} · Còn nợ{' '}
                {money(i.financials.outstandingAmount)} · Dư{' '}
                {money(i.financials.potentialExcessAmount)}
              </Text>
            </Box>
          ))}
          {summary.unresolvedItems.map((b) => (
            <Text key={b} style={ui.red}>
              {settlementBlocker(b)}
            </Text>
          ))}
          {summary.resolved && (
            <Text style={ui.blue}>Các nguồn hiện tại đủ điều kiện xem xét hoàn tất.</Text>
          )}
        </>
      )}
      {role === 'Owner' && !moveOut.isForced && (
        <>
          {!q.loading && !q.error && (
            <OwnerMoveOutDecisions
              key={`${id}:${moveOut.version}:${q.inspections[0]?.version}:${summary?.reference}`}
              api={api}
              id={id}
              moveOut={moveOut}
              inspection={q.inspections[0]}
              summary={summary}
              onChanged={() => {
                q.reload();
                onChanged();
              }}
            />
          )}
          <OwnerWebNotice task="Quản lý khoản phải thu, cấn trừ cọc và thực chi hoàn tiền" />
        </>
      )}
      {q.history.map((h) => (
        <Text key={h.version} variant="bodySmall">
          {formatInstant(h.occurredAt)} · {moveOutActionLabel(h.action)}
        </Text>
      ))}
    </Box>
  );
}
