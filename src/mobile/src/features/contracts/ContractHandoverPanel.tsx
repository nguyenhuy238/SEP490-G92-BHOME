import { UserFeedbackError } from '../../../../../packages/client-core/src/api';
import { ContractNotice } from './ContractNotice';
import { useFeedbackState } from '../../lib/useFeedbackState';
import React, { useRef, useState } from 'react';
import { Checkbox, Text } from 'react-native-paper';
import { randomUUID } from '../../lib/randomUUID';
import {
  businessToday,
  contractError,
  dateOnly,
  displayContractDate,
  mutationKeys,
  text,
  type ContractClient,
  type ContractView,
} from '../../../../../packages/client-core/src/contracts';
import { useContractHandover } from '../../../../../packages/client-core/src/useContractHandover';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { ChoiceField, Input } from '../../components/WorkflowControls';
import { CameraCapture } from '../../components/CameraCapture';
import { ContractEvidence } from './ContractEvidence';
import { HandoverAssetFields } from './HandoverAssetFields';
import {
  assetInspectionInput,
  handoverAssetSummary,
  quantityFields,
} from '../../../../../packages/client-core/src/handoverForm';
import { ContractAssetChangesPanel } from './ContractAssetChangesPanel';
import { ContractInitialMeterTasks } from './ContractInitialMeterTasks';

export function ContractHandoverPanel({
  api,
  contract,
  role,
  autoRefreshMs = 10000,
}: {
  api: ContractClient;
  contract: ContractView;
  role: string;
  autoRefreshMs?: number;
}) {
  const staff = role === 'Staff' && contract.status === 'Active' && contract.kind === 'Main';
  const [editing, setEditing] = useState(false),
    [values, setValues] = useState<Record<string, string>>({}),
    [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useFeedbackState('warning', false),
    [notice, setNotice] = useFeedbackState('success'),
    [safePhoto, setSafePhoto] = useState(false);
  const query = useContractHandover(api, contract.id, staff, !editing && !busy ? autoRefreshMs : 0),
    h = query.data?.record,
    choices = query.data?.choices;
  const sourceId = h?.sourceContractId ?? contract.id;
  const confirmationKey = `${contract.id}:${h?.version ?? ''}`;
  const [confirmation, setConfirmation] = useState({ key: '', checked: false, note: '' });
  const checked = confirmation.key === confirmationKey && confirmation.checked;
  const note = confirmation.key === confirmationKey ? confirmation.note : '';
  const setChecked = (value: boolean) =>
    setConfirmation((current) => ({
      key: confirmationKey,
      checked: value,
      note: current.key === confirmationKey ? current.note : '',
    }));
  const setNote = (value: string) =>
    setConfirmation((current) => ({
      key: confirmationKey,
      checked: current.key === confirmationKey && current.checked,
      note: value,
    }));
  const [keys] = useState(() => mutationKeys(randomUUID)),
    lock = useRef(false);
  const set = (name: string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    if (value === 'true')
      setSelected((ids) => ids.filter((id) => !name.endsWith(`.evidence.${id}`)));
  };
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      query.reload();
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function edit() {
    const s = h?.snapshot;
    setValues({
      date: displayContractDate(s?.date ?? businessToday()),
      roomCondition: s?.roomCondition ?? '',
      keysAndAccess: s?.keysAndAccess ?? '',
      notes: s?.notes ?? '',
      electricityReadingId: s?.electricity.id ?? '',
      waterReadingId: s?.water.id ?? '',
      ...Object.fromEntries(
        (choices?.assets ?? []).map((a) => [
          'asset-' + a.id,
          s?.assets.find((old) => old.id === a.id)?.observedCondition ?? '',
        ]),
      ),
      ...Object.fromEntries(
        (s?.assets ?? []).flatMap((a) => [
          ...quantityFields.map(([key]) => [
            `${a.id}.${key}`,
            a[key] == null ? '' : String(a[key]),
          ]),
          [`${a.id}.checked`, 'false'],
          [`${a.id}.notes`, a.notes ?? ''],
          ...(a.evidenceIds ?? []).map((id) => [`${a.id}.evidence.${id}`, 'true']),
          ...(a.physicalObservations ?? []).flatMap((p) => [
            [`${p.id}.physicalQuantity`, String(p.quantity)],
            [`${p.id}.physicalCondition`, p.condition],
          ]),
        ]),
      ),
    });
    const groupEvidence = new Set((s?.assets ?? []).flatMap((a) => a.evidenceIds ?? []));
    setSelected((s?.evidenceIds ?? []).filter((id) => !groupEvidence.has(id)));
    setError('');
    setEditing(true);
  }
  async function decide(operation: string) {
    if (!h) return;
    const body = { version: h.version, note };
    await api.mutate(contract.id, 'handover/' + operation, body, keys.get(operation, body));
    keys.confirmed(operation, body);
    setChecked(false);
    setNote('');
    setNotice('Đã lưu xác nhận / phản hồi tại máy chủ.');
  }
  return (
    <Box>
      <Heading
        title="Bàn giao nhận phòng (UC-17)"
        detail="Tenant xác nhận nội dung · Staff hoàn tất cùng phiên bản"
      />
      {staff && <ContractInitialMeterTasks contract={contract} />}
      {query.loading && <Text>Đang tải bàn giao…</Text>}
      {!!query.error && <ContractNotice message={query.error} />}
      {!query.loading && !query.error && !h && <Text>Chưa có biên bản nhận phòng.</Text>}
      {h && !editing && (
        <>
          <Text>
            {text(h.status)} · {displayContractDate(h.snapshot.date)}
          </Text>
          <Text>
            Phòng {h.snapshot.roomNumber}: {h.snapshot.roomCondition}
          </Text>
          <Text>Chìa khóa / quyền truy cập: {h.snapshot.keysAndAccess}</Text>
          <Text>{h.snapshot.notes}</Text>
          {h.snapshot.assets.map((a) => (
            <Text key={a.id}>{handoverAssetSummary(a)}</Text>
          ))}
          {h.snapshot.noAssetsConfirmed && (
            <Text>Owner đã xác nhận phòng không có tài sản bàn giao.</Text>
          )}
          {h.snapshot.ownerAcceptance && (
            <Text>
              Owner đã chấp nhận ngoại lệ: {h.snapshot.ownerAcceptance.reason}. Phương án:{' '}
              {h.snapshot.ownerAcceptance.handlingPlan}
            </Text>
          )}
          {h.status !== 'Confirmed' && (
            <Text>
              Bàn giao còn chờ hoàn tất. Hợp đồng Active và quyền ở phòng vẫn giữ hiệu lực.
            </Text>
          )}
          <Text>
            Điện: {h.snapshot.electricity.value} · Nước: {h.snapshot.water.value} · chỉ số đã xác
            nhận ngày {displayContractDate(h.snapshot.date)}
          </Text>
          <ContractEvidence api={api} contractId={sourceId} readingId={h.snapshot.electricity.id} />
          <ContractEvidence api={api} contractId={sourceId} readingId={h.snapshot.water.id} />
          <Text>
            Tenant:{' '}
            {h.tenantConfirmedAt
              ? formatInstant(h.tenantConfirmedAt)
              : 'Chưa xác nhận phiên bản này'}
          </Text>
          <Text>
            Staff: {h.staffConfirmedAt ? formatInstant(h.staffConfirmedAt) : 'Chưa hoàn tất'}
          </Text>
          {h.snapshot.evidenceIds.map((id, i) => (
            <ContractEvidence
              key={id}
              api={api}
              contractId={sourceId}
              evidenceId={id}
              handover
              number={i + 1}
            />
          ))}
          {h.snapshot.assets.flatMap((a) =>
            (a.evidenceIds ?? []).map((fileId, index) => (
              <ContractEvidence
                key={`${a.id}-${fileId}`}
                api={api}
                contractId={sourceId}
                evidenceId={fileId}
                handover
                label={`${a.name} · Ảnh ${index + 1}`}
              />
            )),
          )}
        </>
      )}
      {staff && h?.status !== 'Confirmed' && !editing && (
        <Action disabled={query.loading || busy || !!query.error} onPress={edit}>
          {h ? 'Sửa biên bản bàn giao' : 'Lập biên bản bàn giao'}
        </Action>
      )}
      {editing && (
        <>
          {[
            ['date', 'Ngày nhận phòng (dd/MM/yyyy)'],
            ['roomCondition', 'Hiện trạng phòng'],
            ['keysAndAccess', 'Chìa khóa / quyền truy cập đã bàn giao'],
            ['notes', 'Ghi chú / vấn đề cần Owner xem xét'],
          ].map(([name, label]) => (
            <Input
              key={name}
              label={label}
              value={values[name] ?? ''}
              onChange={(v) => set(name, v)}
              disabled={busy}
              multiline={name !== 'date'}
            />
          ))}
          {choices?.inventoryState && (
            <Text>
              Trạng thái kiểm kê: {text(choices.inventoryState)} · {choices.assets.length} nhóm cần
              kiểm tra
            </Text>
          )}
          {choices?.assets.length === 0 && (
            <Text>
              {choices.noAssetsConfirmed
                ? 'Owner đã xác nhận không có tài sản.'
                : 'Owner cần xác nhận phòng không có tài sản trong màn hình kiểm kê.'}
            </Text>
          )}
          {choices?.assets.map((a) => (
            <HandoverAssetFields
              key={a.id}
              asset={a}
              values={values}
              set={set}
              evidenceIds={(choices.evidence ?? []).map((f) => f.id)}
              disabled={busy}
              quantities={!!choices.inventoryToken}
            />
          ))}
          <Text>
            Chọn chỉ số đã xác nhận đúng ngày bàn giao. Không nhập hoặc đặt lại số công tơ tại đây.
          </Text>
          {[
            ['electricityReadingId', 'Chỉ số điện', 0],
            ['waterReadingId', 'Chỉ số nước', 1],
          ].map(([name, label, type]) => (
            <ChoiceField
              key={name}
              label={String(label)}
              value={values[String(name)] ?? ''}
              disabled={busy}
              options={(choices?.readings ?? [])
                .filter((r) => r.utilityType === type)
                .map((r) => ({ id: r.id, label: `${r.meterCode} · ${r.date} · ${r.value}` }))}
              onChange={(v) => set(String(name), v)}
            />
          ))}
          <Text>
            Chụp và xác nhận chỉ số điện, nước đầu kỳ của hợp đồng ngay trong bước bàn giao ở trên.
          </Text>
          <Text>
            Ảnh toàn cảnh phòng; tối đa 10 ảnh được chọn, mỗi ảnh tối đa 5 MB. Ảnh riêng của nhóm
            chọn ở trên. Không chụp giấy tờ cá nhân.
          </Text>
          <Checkbox.Item
            label="Tôi đã kiểm tra ảnh không có giấy tờ cá nhân"
            status={safePhoto ? 'checked' : 'unchecked'}
            onPress={() => setSafePhoto((v) => !v)}
            disabled={busy}
          />
          <CameraCapture
            label="Chụp ảnh nhận phòng"
            reviewActionLabel="Tải ảnh nhận phòng"
            reviewNotice="Ảnh được lưu riêng tư làm bằng chứng bàn giao; ảnh tạm trên thiết bị được xóa sau khi tải hoặc rời màn hình. Không chụp giấy tờ cá nhân."
            reviewBeforeSubmit
            disabled={busy || !safePhoto}
            onCapture={(bytes) =>
              run(async () => {
                if (bytes.byteLength > 5 * 1024 * 1024)
                  throw new UserFeedbackError('Ảnh vượt quá 5 MB.');
                const file = await api.uploadHandover(contract.id, bytes, 'image/jpeg');
                setSelected((ids) => (ids.length < 10 ? [...ids, file.id] : ids));
                setSafePhoto(false);
              })
            }
          />
          {choices?.evidence.map((f, i) => (
            <Checkbox.Item
              key={f.id}
              label={`Ảnh ${i + 1} · ${formatInstant(f.recordedAt)}`}
              disabled={
                busy ||
                (choices?.assets ?? []).some((a) => values[`${a.id}.evidence.${f.id}`] === 'true')
              }
              status={selected.includes(f.id) ? 'checked' : 'unchecked'}
              onPress={() =>
                setSelected((ids) =>
                  ids.includes(f.id)
                    ? ids.filter((v) => v !== f.id)
                    : ids.length < 10
                      ? [...ids, f.id]
                      : ids,
                )
              }
            />
          ))}
          <Action
            disabled={busy || query.loading}
            onPress={() =>
              void run(async () => {
                const body = {
                  version: h?.version ?? 0,
                  date: dateOnly(values.date ?? ''),
                  roomCondition: values.roomCondition ?? '',
                  keysAndAccess: values.keysAndAccess ?? '',
                  notes: values.notes ?? '',
                  assets: (choices?.assets ?? []).map((a) =>
                    assetInspectionInput(
                      a,
                      values,
                      (choices?.evidence ?? []).map((f) => f.id),
                      !!choices?.inventoryToken,
                    ),
                  ),
                  inventoryToken: choices?.inventoryToken,
                  electricityReadingId: values.electricityReadingId,
                  waterReadingId: values.waterReadingId,
                  evidenceIds: selected,
                };
                await api.mutate(contract.id, 'handover', body, keys.get('handover', body));
                keys.confirmed('handover', body);
                setEditing(false);
                setNotice('Đã lưu phiên bản bàn giao; cần Tenant xác nhận lại nội dung.');
              })
            }
          >
            Lưu biên bản nhận phòng
          </Action>
          <Action secondary disabled={busy} onPress={() => setEditing(false)}>
            Đóng chỉnh sửa
          </Action>
        </>
      )}
      {h &&
        h.status !== 'Confirmed' &&
        !editing &&
        contract.status === 'Active' &&
        (role === 'Tenant' || staff) && (
          <>
            <Input
              label="Ghi chú / nội dung không đồng ý"
              value={note}
              onChange={setNote}
              multiline
              disabled={busy}
            />
            <Checkbox.Item
              label="Tôi đã kiểm tra nội dung biên bản"
              status={checked ? 'checked' : 'unchecked'}
              onPress={() => setChecked(!checked)}
              disabled={busy}
            />
            {role === 'Tenant' && (
              <>
                <Action
                  disabled={busy || !checked || h.status === 'Disputed'}
                  onPress={() => void run(() => decide('tenant-confirmation'))}
                >
                  Xác nhận nhận phòng
                </Action>
                <Action
                  secondary
                  disabled={busy || !checked || !note.trim()}
                  onPress={() => void run(() => decide('disputes'))}
                >
                  Gửi nội dung cần sửa
                </Action>
              </>
            )}
            {staff && (
              <Action
                disabled={
                  busy ||
                  !checked ||
                  h.tenantConfirmedVersion !== h.version ||
                  h.status === 'Disputed'
                }
                onPress={() => void run(() => decide('staff-confirmation'))}
              >
                Staff xác nhận hoàn tất bàn giao
              </Action>
            )}
          </>
        )}
      {query.data?.history.map((event, i) => (
        <Text key={i}>
          {formatInstant(event.occurredAt)} · v{event.version} · {text(event.action)} {event.note}
        </Text>
      ))}
      {query.data?.documents.map((document) => (
        <ContractEvidence
          key={document.id}
          api={api}
          contractId={document.contractId}
          handoverDocumentId={document.id}
          label={`${text(document.kind)} · PDF v${document.templateVersion}`}
        />
      ))}
      {h?.status === 'Confirmed' && (
        <ContractAssetChangesPanel api={api} contract={contract} role={role} />
      )}
      {!!error && <ContractNotice message={error} />}
      {!!notice && <Text style={ui.green}>{notice}</Text>}
    </Box>
  );
}
