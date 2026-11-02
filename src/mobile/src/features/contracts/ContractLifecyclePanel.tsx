import React, { useRef, useState } from 'react';
import { Checkbox, Text } from 'react-native-paper';
import { randomUUID } from 'expo-crypto';
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
  settlementBlocker,
  useContractLifecycle,
} from '../../../../../packages/client-core/src/useContractLifecycle';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { ChoiceField, Input } from '../../components/WorkflowControls';

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
    [checked, setChecked] = useState(false),
    [noCharges, setNoCharges] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [keys] = useState(() => mutationKeys(randomUUID));
  const lock = useRef(false);
  const set = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));
  async function save(operation: string, body: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.mutate(id, operation, body, keys.get(operation, body));
      keys.confirmed(operation, body);
      setChecked(false);
      setNoCharges(false);
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
    inspection = q.inspections[0],
    summary = q.summary;
  const money = (v: string | null) => (v === null ? 'Chờ xác minh' : formatContractMoney(v));
  const usedEvidence = new Set(q.inspections.flatMap((i) => i.observed.evidenceIds));
  const unusedEvidence = evidenceIds.filter((e) => !usedEvidence.has(e));
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
            Phòng: {i.baseline.roomCondition} → {i.observed.roomCondition}
          </Text>
          <Text>
            Chìa khóa / quyền truy cập: {i.baseline.keysAndAccess} → {i.observed.keysAndAccess}
          </Text>
          {i.observed.assets.map((a) => (
            <Text key={a.id}>
              {a.name}: {i.baseline.assets.find((b) => b.id === a.id)?.observedCondition} →{' '}
              {a.observedCondition}
            </Text>
          ))}
          <Text>
            Điện: {i.baseline.electricity.value} → {i.observed.electricity.value} · Nước:{' '}
            {i.baseline.water.value} → {i.observed.water.value}
          </Text>
          <Text>{i.observed.notes}</Text>
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
            {!baseline && (
              <Text style={ui.red}>
                Thiếu biên bản nhận phòng đã xác nhận. Cần Owner xử lý trước khi lập đối chiếu.
              </Text>
            )}
            {baseline && (
              <>
                <Text>
                  Hiện trạng khi nhận: {baseline.roomCondition} · Chìa khóa:{' '}
                  {baseline.keysAndAccess}
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
                {baseline.assets.map((a) => (
                  <Input
                    key={a.id}
                    label={`${a.name} · Khi nhận: ${a.observedCondition}`}
                    value={values[a.id] ?? ''}
                    onChange={(v) => set(a.id, v)}
                    multiline
                    disabled={busy}
                  />
                ))}
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
                <Text>Chọn 1–5 ảnh hiện trạng đã tải lên cho biên bản này:</Text>
                {unusedEvidence.map((e, n) => (
                  <Checkbox.Item
                    key={e}
                    label={`Ảnh hiện trạng ${n + 1}`}
                    status={selected.includes(e) ? 'checked' : 'unchecked'}
                    disabled={busy}
                    onPress={() =>
                      setSelected((v) => (v.includes(e) ? v.filter((x) => x !== e) : [...v, e]))
                    }
                  />
                ))}
                <Checkbox.Item
                  label="Tôi xác nhận hiện trạng và chỉ số đã đối chiếu thực tế"
                  status={checked ? 'checked' : 'unchecked'}
                  onPress={() => setChecked((v) => !v)}
                />
                <Action
                  disabled={busy || !checked || !selected.length || selected.length > 5}
                  onPress={() => {
                    try {
                      const body = {
                        electricityReadingId: required(values.electricityReadingId ?? '', 100),
                        waterReadingId: required(values.waterReadingId ?? '', 100),
                        roomCondition: required(values.roomCondition ?? '', 2000),
                        keysAndAccess: required(values.keysAndAccess ?? '', 2000),
                        notes: required(values.notes ?? '', 4000),
                        assets: baseline.assets.map((a) => ({
                          id: a.id,
                          condition: required(values[a.id] ?? '', 1000),
                        })),
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
                {money(i.financials.approvedAdjustmentTotal)} · Phải thu{' '}
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
      {role === 'Owner' && !q.loading && !q.error && moveOut.status !== 'Completed' && (
        <>
          <Input
            label="Căn cứ quyết định"
            value={values.reason ?? ''}
            onChange={(v) => set('reason', v)}
            multiline
            disabled={busy}
          />
          {inspection && !inspection.ownerDecision && moveOut.status === 'Inspected' && (
            <>
              <Checkbox.Item
                label="Đã đối chiếu: không phát sinh phí bổ sung hoặc thiệt hại cần thu"
                status={noCharges ? 'checked' : 'unchecked'}
                onPress={() => setNoCharges((v) => !v)}
              />
              <Action
                disabled={busy || !values.reason?.trim()}
                onPress={() =>
                  void save('move-out/inspection-review', {
                    version: inspection.version,
                    confirmed: true,
                    reason: values.reason,
                    noAdditionalCharges: noCharges,
                  })
                }
              >
                Xác nhận kiểm tra
              </Action>
              <Action
                secondary
                disabled={busy || !values.reason?.trim()}
                onPress={() =>
                  void save('move-out/inspection-review', {
                    version: inspection.version,
                    confirmed: false,
                    reason: values.reason,
                  })
                }
              >
                Yêu cầu kiểm tra lại
              </Action>
            </>
          )}
          {summary && ['Inspected', 'PendingSettlement', 'Settled'].includes(moveOut.status) && (
            <>
              <Checkbox.Item
                label="Tôi đã đọc số liệu và các nghĩa vụ còn chờ xử lý"
                status={checked ? 'checked' : 'unchecked'}
                onPress={() => setChecked((v) => !v)}
              />
              <Action
                disabled={busy || !checked || !values.reason?.trim()}
                onPress={() =>
                  void save('move-out/settlement', {
                    decision: values.reason,
                    expectedReference: summary.reference,
                  })
                }
              >
                Lưu xem xét quyết toán
              </Action>
            </>
          )}
        </>
      )}
      {q.history.map((h) => (
        <Text key={h.version} variant="bodySmall">
          {formatInstant(h.occurredAt)} · Phiên bản {h.version} · {h.action}
        </Text>
      ))}
    </Box>
  );
}
