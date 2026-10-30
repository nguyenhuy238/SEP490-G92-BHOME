import React, { useEffect, useRef, useState } from 'react';
import { Checkbox, Text } from 'react-native-paper';
import { randomUUID } from 'expo-crypto';
import {
  contractError,
  draftPayload,
  mutationKeys,
  type ContractClient,
  type NamedOption,
  type ResidentOption,
} from '../../../../../packages/client-core/src/contracts';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { ChoiceField, Input } from '../../components/WorkflowControls';

export function ContractDraftForm({
  api,
  onCancel,
  onCreated,
}: {
  api: ContractClient;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [location, setLocation] = useState('');
  const [locations, setLocations] = useState<NamedOption[]>([]),
    [rooms, setRooms] = useState<NamedOption[]>([]),
    [people, setPeople] = useState<ResidentOption[]>([]);
  const [residents, setResidents] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const [keys] = useState(() => mutationKeys(randomUUID));
  const lock = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    void api
      .locations(c.signal)
      .then(setLocations)
      .catch((e) => {
        if (!c.signal.aborted) setError(contractError(e));
      });
    return () => c.abort();
  }, [api, revision]);
  useEffect(() => {
    if (!location) return;
    const c = new AbortController();
    async function load() {
      setLoading(true);
      try {
        const [r, p] = await Promise.all([
          api.rooms(location, c.signal),
          api.residents(location, c.signal),
        ]);
        if (!c.signal.aborted) {
          setRooms(r);
          setPeople(p);
        }
      } catch (e) {
        if (!c.signal.aborted) setError(contractError(e));
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => c.abort();
  }, [api, location, revision]);
  const set = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));
  const eligible = people.filter((r) => r.roomId === values.roomId && r.verificationStatus === 1);
  async function save() {
    if (lock.current) return;
    let body;
    try {
      body = draftPayload(values, residents);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api.mutate<{ id: string }>(null, '', body, keys.get('draft', body));
      keys.confirmed('draft', body);
      onCreated(result.id);
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
        detail="UC-15 • Nháp chưa giữ chỗ hoặc kích hoạt phòng"
      />
      <Box>
        <ChoiceField
          label="Cơ sở được phân công"
          value={location}
          disabled={busy}
          options={locations}
          onChange={(v) => {
            setLocation(v);
            setRooms([]);
            setPeople([]);
            setResidents([]);
            set('roomId', '');
            set('representativeResidentId', '');
          }}
        />
        <ChoiceField
          label="Phòng"
          value={values.roomId ?? ''}
          disabled={busy || loading}
          options={rooms}
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
            label={r.displayLabel}
            disabled={busy}
            status={residents.includes(r.id) ? 'checked' : 'unchecked'}
            onPress={() => {
              setResidents((ids) =>
                ids.includes(r.id) ? ids.filter((i) => i !== r.id) : [...ids, r.id],
              );
              if (values.representativeResidentId === r.id) set('representativeResidentId', '');
            }}
          />
        ))}
        {!!values.roomId && !eligible.length && (
          <Text>Chưa có người ở đã xác minh. Hoàn tất tiếp nhận và xác nhận CCCD trước.</Text>
        )}
        <ChoiceField
          label="Người đại diện"
          value={values.representativeResidentId ?? ''}
          disabled={busy}
          options={eligible
            .filter((r) => residents.includes(r.id))
            .map((r) => ({ id: r.id, label: r.displayLabel }))}
          onChange={(v) => set('representativeResidentId', v)}
        />
        {[
          { name: 'ownerSignerId', label: 'UUID tài khoản Owner ký' },
          { name: 'tenantUserId', label: 'UUID tài khoản Tenant ký' },
          { name: 'startDate', label: 'Ngày bắt đầu (dd/MM/yyyy)' },
          { name: 'endDate', label: 'Ngày hết hạn (dd/MM/yyyy)' },
          { name: 'monthlyRent', label: 'Tiền thuê tháng (VND)' },
          { name: 'requiredDeposit', label: 'Cọc yêu cầu (VND)' },
          { name: 'terms', label: 'Điều khoản đã thống nhất' },
          { name: 'holdingContractId', label: 'UUID hợp đồng giữ chỗ (tùy chọn)' },
        ].map((f) => (
          <Input
            key={f.name}
            label={f.label}
            value={values[f.name] ?? ''}
            disabled={busy}
            numeric={['monthlyRent', 'requiredDeposit'].includes(f.name)}
            multiline={f.name === 'terms'}
            onChange={(v) => set(f.name, v)}
          />
        ))}
        <Text variant="bodySmall">
          Mã tài khoản bên ký khác mã hồ sơ người ở. Backend kiểm tra tài khoản có sẵn, vai trò,
          phòng và cọc; Staff không ký thay.
        </Text>
      </Box>
      {!!error && <Text style={ui.red}>{error}</Text>}
      <Action disabled={busy || loading || !eligible.length} onPress={() => void save()}>
        {busy ? 'Đang lưu…' : 'Lưu bản nháp'}
      </Action>
      <Action
        secondary
        disabled={busy}
        onPress={() => {
          setError('');
          setRevision((v) => v + 1);
        }}
      >
        Tải lại lựa chọn
      </Action>
      <Action secondary disabled={busy} onPress={onCancel}>
        Về danh sách
      </Action>
    </>
  );
}
