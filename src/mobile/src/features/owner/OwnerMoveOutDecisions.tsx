import React, { useRef, useState } from 'react';
import { Checkbox, Text } from 'react-native-paper';
import { useSession } from '../../lib/SessionProvider';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { ChoiceField, Input } from '../../components/WorkflowControls';
import { randomUUID } from '../../lib/randomUUID';
import {
  contractError,
  mutationKeys,
  type ContractClient,
  type FinalInspection,
  type MoveOut,
  type SettlementSummary,
} from '../../../../../packages/client-core/src/contracts';

export function OwnerMoveOutDecisions({
  api,
  id,
  moveOut,
  inspection,
  summary,
  onChanged,
}: {
  api: ContractClient;
  id: string;
  moveOut: MoveOut;
  inspection?: FinalInspection;
  summary: SettlementSummary | null;
  onChanged: () => void;
}) {
  const { session } = useSession();
  const [reason, setReason] = useState(''),
    [checked, setChecked] = useState(false),
    [noCharges, setNoCharges] = useState(false);
  const [tenantException, setTenantException] = useState(false),
    [disposition, setDisposition] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [keys] = useState(() => mutationKeys(randomUUID));
  const lock = useRef(false);
  const allowed = !!session?.roles.includes('Owner');
  async function save(operation: string, input: Record<string, unknown>) {
    if (!allowed || lock.current || !checked || !reason.trim() || reason.trim().length > 2000)
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const scope = `${id}/${operation}`;
      await api.mutate(id, operation, input, keys.get(scope, input));
      keys.confirmed(scope, input);
      setReason('');
      setChecked(false);
      onChanged();
    } catch (e) {
      setError(contractError(e));
      setChecked(false);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const review = !!inspection && !inspection.ownerDecision && moveOut.status === 'Inspected';
  const settlement =
    !!summary && ['Inspected', 'PendingSettlement', 'Settled'].includes(moveOut.status);
  const completion = inspection?.ownerDecision === 'Confirmed' && moveOut.status !== 'Completed';
  if (!allowed || (!review && !settlement && !completion)) return null;
  return (
    <Box>
      <Heading title="Quyết định trả phòng" />
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      <Input
        label="Căn cứ quyết định"
        value={reason}
        disabled={busy}
        onChange={(value) => {
          setReason(value);
          setChecked(false);
        }}
      />
      {review && (
        <Checkbox.Item
          label="Đã đối chiếu: không phát sinh phí bổ sung hoặc thiệt hại cần thu"
          status={noCharges ? 'checked' : 'unchecked'}
          disabled={busy}
          onPress={() => {
            setNoCharges((value) => !value);
            setChecked(false);
          }}
        />
      )}
      {review && inspection?.observed.tenantFeedback?.confirmed !== true && (
        <Checkbox.Item
          label="Tôi xử lý ngoại lệ Tenant chưa phản hồi / tranh chấp theo căn cứ đã nhập"
          status={tenantException ? 'checked' : 'unchecked'}
          onPress={() => setTenantException(!tenantException)}
          disabled={busy}
        />
      )}
      <Checkbox.Item
        label="Tôi đã kiểm tra biên bản và các nghĩa vụ hiện tại"
        status={checked ? 'checked' : 'unchecked'}
        disabled={busy}
        onPress={() => setChecked((value) => !value)}
      />
      {review && (
        <>
          <Action
            disabled={
              busy ||
              !checked ||
              !reason.trim() ||
              (inspection?.observed.tenantFeedback?.confirmed !== true && !tenantException)
            }
            onPress={() =>
              void save('move-out/inspection-review', {
                version: inspection!.version,
                confirmed: true,
                reason: reason.trim(),
                noAdditionalCharges: noCharges,
                tenantException,
                tenantExceptionReason: tenantException ? reason.trim() : null,
              })
            }
          >
            Xác nhận biên bản kiểm tra
          </Action>
          <Action
            secondary
            disabled={busy || !checked || !reason.trim()}
            onPress={() =>
              void save('move-out/inspection-review', {
                version: inspection!.version,
                confirmed: false,
                reason: reason.trim(),
              })
            }
          >
            Yêu cầu kiểm tra lại
          </Action>
        </>
      )}
      {completion && (
        <>
          <Text>
            Hoàn tất bàn giao vật lý giữ nguyên nợ và xử lý quyết toán riêng. Phòng có Tenant khác
            vẫn Đang thuê.
          </Text>
          <ChoiceField
            label="Trạng thái phòng nếu không còn Tenant"
            value={disposition}
            options={[
              { id: 'Available', label: 'Có thể cho thuê lại' },
              { id: 'Unavailable', label: 'Chưa cho thuê · cần bảo trì' },
            ]}
            onChange={setDisposition}
            disabled={busy}
          />
          <Action
            disabled={busy || !checked || !reason.trim() || !disposition}
            onPress={() =>
              void save('move-out/complete', {
                actualEndDate: inspection!.observed.date,
                roomDisposition: disposition,
              })
            }
          >
            Hoàn tất trả phòng và lưu PDF
          </Action>
        </>
      )}
      {settlement && (
        <>
          <Text>
            Ghi nhận xem xét không tự xác nhận đã thanh toán hoặc hoàn tất quyết toán. Máy chủ kiểm
            tra lại các nghĩa vụ.
          </Text>
          <Action
            disabled={busy || !checked || !reason.trim()}
            onPress={() =>
              void save('move-out/settlement', {
                decision: reason.trim(),
                expectedReference: summary!.reference,
              })
            }
          >
            Lưu xem xét quyết toán
          </Action>
        </>
      )}
    </Box>
  );
}
