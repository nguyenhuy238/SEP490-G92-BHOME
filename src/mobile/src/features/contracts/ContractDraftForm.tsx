import React, { useRef, useState } from 'react';
import { Checkbox, Text } from 'react-native-paper';
import { randomUUID } from 'expo-crypto';
import {
  contractError,
  draftPayload,
  mutationKeys,
  text,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import { useContractPreparation } from '../../../../../packages/client-core/src/useContractPreparation';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { ChoiceField, Input } from '../../components/WorkflowControls';
import { useWorkspace } from '../workspace/WorkspaceProvider';

export function ContractDraftForm({
  api,
  onCancel,
  onCreated,
}: {
  api: ContractClient;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const { role } = useWorkspace();
  const [values, setValues] = useState<Record<string, string>>({}),
    [location, setLocation] = useState('');
  const [residents, setResidents] = useState<string[]>([]),
    [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    [keys] = useState(() => mutationKeys(randomUUID));
  const query = useContractPreparation(api, location, role === 'Owner');
  const p = query.data?.preparation,
    template = query.data?.configuration.template;
  const eligible = (p?.residents ?? []).filter((r) => r.roomId === values.roomId && r.verified);
  const representative = eligible.find((r) => r.id === values.representativeResidentId);
  const set = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));
  async function save() {
    if (lock.current) return;
    let body;
    try {
      body = draftPayload(
        { ...values, tenantUserId: representative?.tenantUserId ?? '' },
        residents,
      );
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const r = await api.mutate<{ id: string }>(null, '', body, keys.get('draft', body));
      keys.confirmed('draft', body);
      onCreated(r.id);
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Chuẩn bị hợp đồng thuê"
        detail={`Bước ${step + 1}/3 · ${['Cấu hình', 'Phòng & Người ở', 'Điều khoản'][step]}`}
      />
      {query.loading && <Text>Đang tải lựa chọn…</Text>}
      {!!query.error && <Text style={ui.red}>{query.error}</Text>}
      <Box>
        {step === 0 && template && (
          <>
            <Heading title={template.title} detail={`Phiên bản ${template.version}`} />
            <Text>{template.notice}</Text>
            <Text>{template.fields.join(', ')}</Text>
            <Text>
              {query.data?.configuration.signingMode === 'Simulated'
                ? 'SIMULATED SIGNING — không có giá trị pháp lý'
                : 'Ký bằng nhà cung cấp điện tử'}
            </Text>
            {!template.available && <Text style={ui.red}>{text(template.blocker ?? '')}</Text>}
            <Text>{text(query.data?.configuration.holdingBlocker ?? '')}</Text>
          </>
        )}
        {step === 1 && (
          <>
            <ChoiceField
              label="Cơ sở"
              value={location}
              options={p?.locations ?? []}
              disabled={busy || query.loading}
              onChange={(v) => {
                setLocation(v);
                set('roomId', '');
                set('representativeResidentId', '');
                setResidents([]);
              }}
            />
            <ChoiceField
              label="Phòng sẵn sàng"
              value={values.roomId ?? ''}
              options={p?.rooms ?? []}
              disabled={busy || query.loading || !location}
              onChange={(v) => {
                set('roomId', v);
                set('representativeResidentId', '');
                setResidents([]);
              }}
            />
            <Heading title="Người ở đã xác minh" />
            {eligible.map((r) => (
              <Checkbox.Item
                key={r.id}
                label={r.label}
                disabled={busy}
                status={residents.includes(r.id) ? 'checked' : 'unchecked'}
                onPress={() => {
                  setResidents((ids) =>
                    ids.includes(r.id) ? ids.filter((id) => id !== r.id) : [...ids, r.id],
                  );
                  if (representative?.id === r.id) set('representativeResidentId', '');
                }}
              />
            ))}
            {!!values.roomId && !eligible.length && (
              <Text>Chưa có người ở đã xác minh. Hoàn tất tiếp nhận trước.</Text>
            )}
            <ChoiceField
              label="Người đại diện"
              value={values.representativeResidentId ?? ''}
              options={eligible.filter((r) => residents.includes(r.id))}
              disabled={busy}
              onChange={(v) => set('representativeResidentId', v)}
            />
            {representative && (
              <Text>
                {representative.tenantUserId
                  ? 'Đã liên kết tài khoản Tenant ký hợp đồng.'
                  : 'Owner cần liên kết tài khoản Tenant với hồ sơ đã xác minh trên Owner Web.'}
              </Text>
            )}
            <ChoiceField
              label="Owner ký hợp đồng"
              value={values.ownerSignerId ?? ''}
              options={p?.ownerSigners ?? []}
              disabled={busy}
              onChange={(v) => set('ownerSignerId', v)}
            />
          </>
        )}
        {step === 2 && (
          <>
            <Text>
              Hợp đồng thuê chính · {p?.rooms.find((r) => r.id === values.roomId)?.label} ·{' '}
              {representative?.label} · {residents.length} người ở
            </Text>
            {[
              ['startDate', 'Ngày bắt đầu (dd/MM/yyyy)'],
              ['endDate', 'Ngày hết hạn (dd/MM/yyyy)'],
              ['monthlyRent', 'Tiền thuê tháng (VND)'],
              ['requiredDeposit', 'Cọc yêu cầu (VND)'],
              ['terms', 'Điều khoản đã thống nhất'],
            ].map(([name, label]) => (
              <Input
                key={name}
                label={label}
                value={values[name] ?? ''}
                disabled={busy}
                numeric={['monthlyRent', 'requiredDeposit'].includes(name)}
                multiline={name === 'terms'}
                onChange={(v) => set(name, v)}
              />
            ))}
          </>
        )}
      </Box>
      {!!error && <Text style={ui.red}>{error}</Text>}
      {step > 0 && (
        <Action secondary disabled={busy} onPress={() => setStep((v) => v - 1)}>
          Quay lại
        </Action>
      )}
      {step < 2 ? (
        <Action
          disabled={busy || query.loading || !!query.error || !template?.available}
          onPress={() => {
            if (
              step === 1 &&
              (!representative?.tenantUserId ||
                !residents.includes(representative.id) ||
                !values.ownerSignerId)
            ) {
              setError('Chọn phòng, người ở và đại diện đã liên kết tài khoản Tenant.');
              return;
            }
            setError('');
            setStep((v) => v + 1);
          }}
        >
          Tiếp theo
        </Action>
      ) : (
        <Action disabled={busy || query.loading || !!query.error} onPress={() => void save()}>
          {busy ? 'Đang lưu…' : 'Lưu bản nháp'}
        </Action>
      )}
      <Action secondary disabled={busy} onPress={query.reload}>
        Tải lại lựa chọn
      </Action>
      <Action secondary disabled={busy} onPress={onCancel}>
        Về danh sách
      </Action>
    </>
  );
}
