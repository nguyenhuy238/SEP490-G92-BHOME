import { useFeedbackState } from '../../lib/useFeedbackState';
import React, { useRef, useState } from 'react';
import { Checkbox, Text } from 'react-native-paper';
import { randomUUID } from '../../lib/randomUUID';
import {
  contractError,
  displayContractDate,
  formatContractMoney,
  mutationKeys,
  required,
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
import { ChoiceField, Input } from '../../components/WorkflowControls';
import { OwnerWebNotice } from '../../components/OwnerWebNotice';
import { OwnerMoveOutDecisions } from '../owner/OwnerMoveOutDecisions';
import { HandoverAssetFields } from './HandoverAssetFields';
import {
  assetInspectionInput,
  handoverAssetSummary,
} from '../../../../../packages/client-core/src/handoverForm';
import { ContractEvidence } from './ContractEvidence';

export function ContractLifecyclePanel({
  api,
  id,
  role,
  moveOut,
  evidenceIds,
  onChanged,
}: {
  api: ContractClient;
  id: string;
  role: string;
  moveOut: MoveOut;
  evidenceIds: string[];
  onChanged: () => void;
}) {
  const q = useContractLifecycle(api, id, role);
  const [values, setValues] = useState<Record<string, string>>({}),
    [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [confirmedInspectionInput, setConfirmedInspectionInput] = useState<string | null>(null);
  const [error, setError] = useFeedbackState(),
    [notice, setNotice] = useFeedbackState('success');
  const [keys] = useState(() => mutationKeys(randomUUID));
  const lock = useRef(false);
  const set = (name: string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    if (value === 'true')
      setSelected((ids) => ids.filter((id) => !name.endsWith(`.evidence.${id}`)));
  };
  async function save(operation: string, body: Record<string, unknown>) {
    if (role === 'Owner' || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.mutate(id, operation, body, keys.get(operation, body));
      keys.confirmed(operation, body);
      setConfirmedInspectionInput(null);
      setSelected([]);
      setValues({});
      setNotice('Máy chủ đã lưu.');
      q.reload();
      onChanged();
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const baseline = q.preparation?.baseline?.snapshot,
    summary = q.summary;
  const inspectionGroups = q.preparation?.inspectionGroups ?? baseline?.assets ?? [];
  const canInspect =
    (!!baseline && !q.preparation?.legacyExceptionRequired) ||
    !!q.preparation?.legacyExceptionReason;
  const inspectionInput = JSON.stringify([
    id,
    moveOut.version,
    q.preparation?.baselineContractId,
    q.preparation?.baseline?.version,
    q.preparation?.inventory?.stateToken,
    q.preparation?.finalReadings,
    values,
    selected,
  ]);
  const inspectionChecked = canInspect && confirmedInspectionInput === inspectionInput;
  const money = (v: string | null) => (v === null ? 'Chờ xác minh' : formatContractMoney(v));
  const usedEvidence = new Set(
    q.inspections.flatMap((i) => [
      ...i.observed.evidenceIds,
      ...i.observed.assets.flatMap((a) => a.evidenceIds ?? []),
    ]),
  );
  const unusedEvidence = evidenceIds.filter((e) => !usedEvidence.has(e));
  const feedbackKey = `${id}:${q.inspections[0]?.id ?? ''}:${q.inspections[0]?.version ?? ''}`;
  return (
    <Box>
      <Heading title="Đối chiếu trả phòng" />
      <Action secondary disabled={busy || q.loading} onPress={q.reload}>
        Tải lại biên bản & quyết toán
      </Action>
      {q.loading && <Text>Đang đối chiếu dữ liệu…</Text>}
      {!!(error || q.error) && <Text style={ui.red}>{error || q.error}</Text>}
      {!!notice && <Text style={ui.blue}>{notice}</Text>}
      {q.inspections.map((i) => (
        <Box key={i.id}>
          <Heading
            title={`Biên bản phiên bản ${i.version}`}
            detail={formatInstant(i.inspectedAt)}
          />
          <Text>Bàn giao nhận phòng phiên bản {i.baselineVersion}</Text>
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
          <Text>
            Tenant:{' '}
            {i.observed.tenantFeedback
              ? `${i.observed.tenantFeedback.confirmed ? 'Xác nhận hiện trạng' : 'Không đồng ý'} · ${i.observed.tenantFeedback.reason}`
              : 'Chưa phản hồi'}
          </Text>
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
          {role === 'Tenant' &&
            !i.ownerDecision &&
            !i.observed.tenantFeedback &&
            i.id === q.inspections[0]?.id && (
              <>
                <Input
                  label="Nội dung phản hồi biên bản trả phòng"
                  value={values[`feedback.${feedbackKey}`] ?? ''}
                  onChange={(v) => set(`feedback.${feedbackKey}`, v)}
                  disabled={busy}
                  multiline
                />
                <Checkbox.Item
                  label={`Tôi đã xem biên bản trả phòng phiên bản ${i.version}`}
                  status={
                    values[`feedbackChecked.${feedbackKey}`] === 'true' ? 'checked' : 'unchecked'
                  }
                  onPress={() =>
                    set(
                      `feedbackChecked.${feedbackKey}`,
                      values[`feedbackChecked.${feedbackKey}`] === 'true' ? 'false' : 'true',
                    )
                  }
                  disabled={busy}
                />
                <Text>Xác nhận hiện trạng không đồng nghĩa chấp nhận số tiền bồi thường.</Text>
                <Action
                  disabled={busy || values[`feedbackChecked.${feedbackKey}`] !== 'true'}
                  onPress={() =>
                    void save('move-out/tenant-feedback', {
                      version: i.version,
                      confirmed: true,
                      reason: values[`feedback.${feedbackKey}`] ?? '',
                    })
                  }
                >
                  Xác nhận hiện trạng trả phòng
                </Action>
                <Action
                  secondary
                  disabled={
                    busy ||
                    values[`feedbackChecked.${feedbackKey}`] !== 'true' ||
                    !values[`feedback.${feedbackKey}`]?.trim()
                  }
                  onPress={() =>
                    void save('move-out/tenant-feedback', {
                      version: i.version,
                      confirmed: false,
                      reason: values[`feedback.${feedbackKey}`],
                    })
                  }
                >
                  Không đồng ý biên bản trả phòng
                </Action>
              </>
            )}
          <Text>
            {i.ownerDecision === 'Confirmed'
              ? 'Owner đã xác nhận'
              : i.ownerDecision === 'Reinspection'
                ? 'Yêu cầu kiểm tra lại'
                : 'Chờ Owner xác nhận'}{' '}
            · {i.ownerReason}
          </Text>
        </Box>
      ))}
      {role === 'Staff' &&
        moveOut.status === 'Approved' &&
        moveOut.inspectionScheduledAt &&
        !q.loading &&
        !q.error && (
          <>
            <Heading title="Lập biên bản kiểm tra cuối kỳ" />
            {!canInspect && (
              <Text style={ui.red}>
                Thiếu biên bản nhận phòng đã xác nhận. Cần Owner xử lý trước khi lập đối chiếu.
              </Text>
            )}
            {canInspect && (
              <>
                <Text>
                  Hiện trạng khi nhận:{' '}
                  {baseline?.roomCondition ?? 'Không có baseline; Owner đã duyệt ngoại lệ'} · Chìa
                  khóa: {baseline?.keysAndAccess ?? 'Chưa rõ'}
                </Text>
                {q.preparation?.otherTenantsRemain && (
                  <Text>
                    Phòng còn người thuê khác. Chỉ ghi nhận hiện trạng; giữ nguyên đồng hồ và tài
                    sản dùng chung.
                  </Text>
                )}
                {[
                  ['roomCondition', 'Hiện trạng phòng khi trả'],
                  ['keysAndAccess', 'Chìa khóa / quyền truy cập khi trả'],
                  ['notes', 'Ghi chú kiểm tra'],
                ].map(([name, label]) => (
                  <Input
                    key={name}
                    label={label}
                    value={values[name] ?? ''}
                    onChange={(v) => set(name, v)}
                    multiline
                    disabled={busy}
                  />
                ))}
                {inspectionGroups.map((a) => (
                  <HandoverAssetFields
                    key={a.id}
                    asset={a}
                    values={values}
                    set={set}
                    evidenceIds={unusedEvidence}
                    disabled={busy}
                    quantities={!!q.preparation?.inventory}
                  />
                ))}
                <Input
                  label="Đề xuất xử lý / bồi thường của Staff (chờ Owner quyết định)"
                  value={values.proposedCompensation ?? ''}
                  onChange={(v) => set('proposedCompensation', v)}
                  disabled={busy}
                  multiline
                />
                {[
                  { name: 'electricityReadingId', type: 0, label: 'Chỉ số điện chốt đã xác nhận' },
                  { name: 'waterReadingId', type: 1, label: 'Chỉ số nước chốt đã xác nhận' },
                ].map((f) => (
                  <ChoiceField
                    key={f.name}
                    label={f.label}
                    value={values[f.name] ?? ''}
                    options={(q.preparation?.finalReadings ?? [])
                      .filter((r) => r.utilityType === f.type)
                      .map((r) => ({
                        id: r.id,
                        label: `${r.meterCode} · ${r.value} · ${displayContractDate(r.date)}`,
                      }))}
                    onChange={(v) => set(f.name, v)}
                    disabled={busy}
                  />
                ))}
                <Text>
                  Chọn 1–10 ảnh toàn cảnh đã tải lên cho biên bản này; ảnh riêng nhóm tài sản chọn ở
                  từng nhóm:
                </Text>
                {unusedEvidence.map((e, n) => (
                  <Checkbox.Item
                    key={e}
                    label={`Ảnh hiện trạng ${n + 1}`}
                    status={selected.includes(e) ? 'checked' : 'unchecked'}
                    disabled={
                      busy ||
                      inspectionGroups.some((a) => values[`${a.id}.evidence.${e}`] === 'true')
                    }
                    onPress={() =>
                      setSelected((v) => (v.includes(e) ? v.filter((x) => x !== e) : [...v, e]))
                    }
                  />
                ))}
                <Checkbox.Item
                  label="Tôi xác nhận hiện trạng và chỉ số đã đối chiếu thực tế"
                  status={inspectionChecked ? 'checked' : 'unchecked'}
                  onPress={() =>
                    setConfirmedInspectionInput(inspectionChecked ? null : inspectionInput)
                  }
                />
                <Action
                  disabled={busy || !inspectionChecked || !selected.length || selected.length > 10}
                  onPress={() => {
                    try {
                      const body = {
                        electricityReadingId: required(values.electricityReadingId ?? '', 100),
                        waterReadingId: required(values.waterReadingId ?? '', 100),
                        roomCondition: required(values.roomCondition ?? '', 2000),
                        keysAndAccess: required(values.keysAndAccess ?? '', 2000),
                        notes: required(values.notes ?? '', 4000),
                        assets: inspectionGroups.map((a) =>
                          assetInspectionInput(
                            a,
                            values,
                            unusedEvidence,
                            !!q.preparation?.inventory,
                            !q.preparation?.legacyExceptionRequired,
                          ),
                        ),
                        inventoryToken: q.preparation?.inventory?.stateToken,
                        proposedCompensation: values.proposedCompensation ?? '',
                        evidenceIds: selected,
                        expectedVersion: moveOut.version,
                      };
                      void save('move-out/inspection', body);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Lưu biên bản đối chiếu
                </Action>
              </>
            )}
          </>
        )}
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
      {role === 'Owner' && (
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
          {formatInstant(h.occurredAt)} · Phiên bản {h.version} · {moveOutActionLabel(h.action)}
        </Text>
      ))}
    </Box>
  );
}
