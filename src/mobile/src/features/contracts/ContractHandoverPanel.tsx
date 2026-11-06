import React, { useRef, useState } from 'react';
import { router } from 'expo-router';
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

export function ContractHandoverPanel({
  api,
  contract,
  role,
}: {
  api: ContractClient;
  contract: ContractView;
  role: string;
}) {
  const staff = role === 'Staff' && contract.status === 'Active' && contract.kind === 'Main';
  const query = useContractHandover(api, contract.id, staff),
    h = query.data?.record,
    choices = query.data?.choices;
  const [editing, setEditing] = useState(false),
    [values, setValues] = useState<Record<string, string>>({}),
    [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [safePhoto, setSafePhoto] = useState(false);
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
  const set = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));
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
      setError(
        e instanceof Error && !(e as { status?: number }).status ? e.message : contractError(e),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function edit() {
    const s = h?.snapshot;
    setValues({
      date: s?.date ?? businessToday(),
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
    });
    setSelected(s?.evidenceIds ?? []);
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
      {query.loading && <Text>Đang tải bàn giao…</Text>}
      {!!query.error && <Text style={ui.red}>{query.error}</Text>}
      {!query.loading && !query.error && !h && <Text>Chưa có biên bản nhận phòng.</Text>}
      {h && !editing && (
        <>
          <Text>
            Phiên bản {h.version} · {text(h.status)} · {displayContractDate(h.snapshot.date)}
          </Text>
          <Text>
            Phòng {h.snapshot.roomNumber}: {h.snapshot.roomCondition}
          </Text>
          <Text>Chìa khóa / quyền truy cập: {h.snapshot.keysAndAccess}</Text>
          <Text>{h.snapshot.notes}</Text>
          {h.snapshot.assets.map((a) => (
            <Text key={a.id}>
              {a.name}: {a.observedCondition} (kiểm kê: {a.inventoryCondition})
            </Text>
          ))}
          <Text>
            Điện: {h.snapshot.electricity.value} · Nước: {h.snapshot.water.value} · chỉ số đã xác
            nhận ngày {displayContractDate(h.snapshot.date)}
          </Text>
          <ContractEvidence
            api={api}
            contractId={contract.id}
            readingId={h.snapshot.electricity.id}
          />
          <ContractEvidence api={api} contractId={contract.id} readingId={h.snapshot.water.id} />
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
              contractId={contract.id}
              evidenceId={id}
              handover
              number={i + 1}
            />
          ))}
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
          {choices?.assets.map((a) => (
            <Input
              key={a.id}
              label={`${a.name} · Kiểm kê: ${a.inventoryCondition}`}
              value={values['asset-' + a.id] ?? ''}
              onChange={(v) => set('asset-' + a.id, v)}
              disabled={busy}
              multiline
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
          <Action secondary disabled={busy} onPress={() => router.push('/capture')}>
            Mở tác vụ điện / nước
          </Action>
          <Text>
            Ảnh phòng / tài sản; tối đa 5 ảnh được chọn, mỗi ảnh tối đa 5 MB. Không chụp giấy tờ cá
            nhân.
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
                if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('Ảnh vượt quá 5 MB.');
                const file = await api.uploadHandover(contract.id, bytes, 'image/jpeg');
                setSelected((ids) => (ids.length < 5 ? [...ids, file.id] : ids));
                setSafePhoto(false);
              })
            }
          />
          {choices?.evidence.map((f, i) => (
            <Checkbox.Item
              key={f.id}
              label={`Ảnh ${i + 1} · ${formatInstant(f.recordedAt)}`}
              disabled={busy}
              status={selected.includes(f.id) ? 'checked' : 'unchecked'}
              onPress={() =>
                setSelected((ids) =>
                  ids.includes(f.id)
                    ? ids.filter((v) => v !== f.id)
                    : ids.length < 5
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
                  assets: (choices?.assets ?? []).map((a) => ({
                    id: a.id,
                    condition: values['asset-' + a.id] ?? '',
                  })),
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
              label={`Tôi đã kiểm tra nội dung phiên bản ${h.version}`}
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
      {!!error && <Text style={ui.red}>{error}</Text>}
      {!!notice && <Text style={ui.green}>{notice}</Text>}
      <Action secondary disabled={query.loading || busy} onPress={query.reload}>
        Tải lại bàn giao
      </Action>
    </Box>
  );
}
