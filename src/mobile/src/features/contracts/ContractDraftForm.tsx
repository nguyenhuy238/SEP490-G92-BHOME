import { conciseMessage } from '../../lib/toast';
import { useFeedbackState } from '../../lib/useFeedbackState';
import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { randomUUID } from '../../lib/randomUUID';
import {
  contractError,
  holdingDraftPayload,
  dateOnly,
  mutationKeys,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import { useHoldingPreparation } from './useHoldingPreparation';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { ChoiceField, Input } from '../../components/WorkflowControls';
import { ContractDateField } from '../../components/ContractDateField';
import { showSuccess } from '../../lib/toast';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { HoldingNewTenant } from './HoldingNewTenant';
import { OnboardingStepper } from '../../components/OnboardingStepper';
import { staffColors } from '../../theme/theme';

const holdingSteps = [
  { key: 'room', label: 'Chọn phòng' },
  { key: 'applicant', label: 'Người giữ chỗ' },
  { key: 'confirm', label: 'Xác nhận' },
] as const;

export function ContractDraftForm({
  api,
  onCancel,
  onCreated,
  initialRoomId = '',
}: {
  api: ContractClient;
  onCancel: () => void;
  onCreated: (id: string) => void;
  initialRoomId?: string;
}) {
  const { role } = useWorkspace();
  const [values, setValues] = useState<Record<string, string>>({ roomId: initialRoomId });
  const [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useFeedbackState();
  const lock = useRef(false),
    [keys] = useState(() => mutationKeys(randomUUID));
  const query = useHoldingPreparation(api, values.roomId);
  const room = query.data?.rooms.find((item) => item.id === values.roomId);
  const p = room ? query.data?.byLocation[room.locationId] : undefined;
  const eligible = (p?.residents ?? []).filter(
    (r) => r.roomId === room?.id && r.verified && r.residentType !== 'CoOccupant',
  );
  const representative = eligible.find((r) => r.id === values.representativeResidentId);
  const owners = p?.ownerSigners ?? [];
  // Preparation exposes eligible Owners, without a separate designation field.
  // Resolve only a unique result; never guess among multiple accounts.
  const owner = owners.length === 1 ? owners[0] : undefined;
  const ownerError =
    owners.length > 1
      ? 'Chưa xác định được Owner ký hợp đồng: cơ sở có nhiều Owner hợp lệ. Vui lòng liên hệ quản trị viên.'
      : 'Chưa xác định được Owner ký hợp đồng cho cơ sở này. Vui lòng liên hệ quản trị viên.';
  const roomOptions = (query.data?.rooms ?? []).map((item) => ({
    id: item.id,
    label: `${item.label} · ${query.data?.locations.find((location) => location.id === item.locationId)?.label ?? ''}`,
  }));
  const set = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));
  const roomValid = !!room && !!p && !query.loading && !query.error;
  function validateSelection() {
    if (query.loading || query.error || !room) throw new Error('Chọn phòng giữ chỗ hợp lệ.');
    if (!representative)
      throw new Error('Nhập và xác minh thông tin người giữ chỗ trước khi tiếp tục.');
    if (!owner) throw new Error(ownerError);
    if (!query.data?.configuration.template.available)
      throw new Error('Mẫu hợp đồng chưa sẵn sàng. Vui lòng thử lại sau.');
  }
  async function save() {
    if (lock.current) return;
    let body;
    try {
      validateSelection();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(values.expiryTime ?? ''))
        throw new Error('Giờ hết hạn phải theo định dạng HH:mm (00:00–23:59).');
      body = holdingDraftPayload(
        {
          ...values,
          roomId: room!.id,
          locationId: room!.locationId,
          ownerSignerId: owner!.id,
          tenantUserId: representative!.tenantUserId ?? '',
          expiresAt: `${dateOnly(values.expiryDate ?? '')}T${values.expiryTime ?? ''}`,
        },
        [representative!.id],
      );
      if (Date.parse(body.expiresAt) <= Date.now())
        throw new Error('Hạn giữ chỗ phải ở tương lai.');
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (!(await api.holdingRoomReady(body.roomId, undefined, body.startDate))) {
        setError('Phòng không còn đủ điều kiện giữ chỗ. Vui lòng chọn lại phòng.');
        query.reload();
        return;
      }
      const r = await api.mutate<{ id: string }>(
        null,
        'holdings',
        body,
        keys.get('holding-draft', body),
      );
      keys.confirmed('holding-draft', body);
      showSuccess('Đã tạo nháp hợp đồng giữ chỗ.');
      onCreated(r.id);
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function back() {
    if (busy) return;
    setError('');
    if (step > 0) setStep((value) => value - 1);
    else onCancel();
  }
  function next() {
    try {
      if (!roomValid) throw new Error('Chọn phòng giữ chỗ hợp lệ.');
      if (step === 1) validateSelection();
      setError('');
      setStep((value) => value + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Heading title="Tạo hợp đồng giữ chỗ" detail="Chọn phòng và nhập thông tin người giữ chỗ." />
      <OnboardingStepper
        steps={holdingSteps}
        current={step}
        completed={holdingSteps.slice(0, step).map((item) => item.key)}
      />
      <Box style={styles.panel}>
        {step === 0 && (
          <>
            <Heading
              title="Chọn phòng giữ chỗ"
              detail="Chọn phòng còn trống và đủ điều kiện giữ chỗ."
            />
            <ChoiceField
              label="Phòng giữ chỗ *"
              placeholder="Chọn phòng..."
              searchable
              value={values.roomId ?? ''}
              options={roomOptions}
              disabled={busy || query.loading || !!values.representativeResidentId}
              onChange={(roomId) => {
                setValues((before) => ({
                  ...before,
                  roomId,
                  locationId:
                    query.data?.rooms.find((item) => item.id === roomId)?.locationId ?? '',
                  representativeResidentId: '',
                  ownerSignerId: '',
                }));
                setError('');
              }}
            />
            {query.loading && (
              <ActivityIndicator accessibilityLabel="Đang kiểm tra phòng giữ chỗ" />
            )}
            {!query.loading && !query.error && !roomOptions.length && (
              <Text>Chưa có phòng trống đủ điều kiện giữ chỗ.</Text>
            )}
          </>
        )}
        {step === 1 && (
          <>
            <Heading
              title="Thông tin người giữ chỗ"
              detail="Nhập thông tin của người đăng ký giữ chỗ."
            />
            {!!room && (
              <HoldingNewTenant
                key={room.id}
                api={api}
                roomId={room.id}
                role={role ?? ''}
                context="holding"
                initialResidentId={values.representativeResidentId}
                initialName={values.tenantName}
                initialEmail={values.tenantEmail}
                initialConfirmed={!!representative?.verified}
                onCreated={(id, name, email) => {
                  setValues((before) => ({
                    ...before,
                    representativeResidentId: id,
                    tenantName: name,
                    tenantEmail: email,
                  }));
                  query.reload();
                }}
                onVerifiedSummary={(summary) =>
                  setValues((before) => ({
                    ...before,
                    applicantFullName: summary.fullName,
                    applicantDateOfBirth: summary.dateOfBirth ?? '',
                  }))
                }
                onConfirmed={query.reload}
                onBusyChange={setBusy}
              />
            )}
          </>
        )}
        {step === 2 && (
          <>
            <Heading
              title="Xác nhận thông tin giữ chỗ"
              detail="Kiểm tra thông tin trước khi tạo hợp đồng giữ chỗ."
            />
            <View style={styles.summary}>
              <Text variant="titleMedium">Phòng giữ chỗ: {room?.label ?? 'Chưa chọn'}</Text>
              <Text>
                Cơ sở:{' '}
                {query.data?.locations.find((item) => item.id === room?.locationId)?.label ??
                  'Chưa xác định'}
              </Text>
              <Text>Họ và tên người giữ chỗ: {values.applicantFullName || values.tenantName}</Text>
              <Text>Email: {values.tenantEmail}</Text>
              {!!values.applicantDateOfBirth && (
                <Text>Ngày sinh: {values.applicantDateOfBirth.split('-').reverse().join('/')}</Text>
              )}
              {representative?.verified && <Text>Thông tin CCCD: Đã xác minh</Text>}
              {owner && <Text>Owner ký hợp đồng: {owner.label}</Text>}
            </View>
            {[
              ['startDate', 'Ngày dự kiến bắt đầu thuê (dd/MM/yyyy)'],
              ['endDate', 'Ngày dự kiến kết thúc thuê (dd/MM/yyyy)'],
              ['expiryDate', 'Ngày hết hạn giữ chỗ (dd/MM/yyyy)'],
              ['expiryTime', 'Giờ hết hạn giữ chỗ (HH:mm, giờ Việt Nam)'],
              ['requiredDeposit', 'Cọc giữ chỗ (VND)'],
              ['terms', 'Điều khoản đã thống nhất'],
            ].map(([name, label]) =>
              ['startDate', 'endDate', 'expiryDate'].includes(name) ? (
                <ContractDateField
                  key={name}
                  label={label}
                  value={values[name] ?? ''}
                  disabled={busy}
                  onChange={(value) => set(name, value)}
                />
              ) : (
                <Input
                  key={name}
                  label={label}
                  value={values[name] ?? ''}
                  disabled={busy}
                  money={name === 'requiredDeposit'}
                  multiline={name === 'terms'}
                  onChange={(value) => set(name, value)}
                />
              ),
            )}
          </>
        )}
        {step > 0 && !query.loading && !!p && !owner && (
          <Text accessibilityRole="alert" style={ui.red}>
            {ownerError}
          </Text>
        )}
        {!!query.error && (
          <Text accessibilityRole="alert" style={ui.red}>
            {conciseMessage(query.error)}
          </Text>
        )}
        {!!query.error && (
          <Button disabled={busy || query.loading} onPress={query.reload}>
            Thử lại
          </Button>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={ui.red}>
            {error}
          </Text>
        )}
        {step < 2 ? (
          <Action disabled={busy || !roomValid || (step === 1 && !owner)} onPress={next}>
            Tiếp tục
          </Action>
        ) : (
          <Action
            disabled={busy || query.loading || !!query.error || !owner}
            onPress={() => void save()}
          >
            {busy ? 'Đang tạo…' : 'Tạo hợp đồng giữ chỗ'}
          </Action>
        )}
        {step > 0 && (
          <Button disabled={busy} onPress={back}>
            Quay lại
          </Button>
        )}
      </Box>
    </>
  );
}
const styles = StyleSheet.create({
  panel: { borderRadius: 16, padding: 16, gap: 16 },
  summary: { padding: 12, borderRadius: 12, backgroundColor: staffColors.blueSoft, gap: 4 },
});
