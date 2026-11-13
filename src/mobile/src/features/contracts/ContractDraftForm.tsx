import { conciseMessage } from '../../lib/toast';
import { useFeedbackState } from '../../lib/useFeedbackState';
import React, { useEffect, useRef, useState } from 'react';
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
import { Box, Heading, ui } from '../../components/WorkspaceKit';
import { ChoiceField } from '../../components/WorkflowControls';
import { mainDraftClient } from '../../../../../packages/client-core/src/mainDrafts';
import type { HoldingPreparation } from '../../../../../packages/client-core/src/holdingSettings';
import { HoldingConfirmationSummary } from './HoldingConfirmationSummary';
import { WorkspaceFooter } from '../../components/WorkspaceFooter';
import { useWorkspaceHeaderRefresh } from '../../components/WorkspaceHeaderContext';
import { showSuccess } from '../../lib/toast';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { HoldingNewTenant } from './HoldingNewTenant';
import { HoldingProgress } from './HoldingProgress';
import { staffColors } from '../../theme/theme';

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
  prepareDefaults?: ReturnType<typeof mainDraftClient>['prepare'];
}) {
  const { role } = useWorkspace();
  const [values, setValues] = useState<Record<string, string>>({ roomId: initialRoomId });
  const [defaults, setDefaults] = useState<{
    key: string;
    data?: HoldingPreparation;
    error?: string;
  }>({ key: '' });
  const [defaultsRevision, setDefaultsRevision] = useState(0);
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
  const roomValid = !!room && !!p && !query.loading && !query.error;
  const preparationAvailable = typeof api.holdingPreparation === 'function';
  const defaultsKey = `${values.roomId}:${defaultsRevision}`;
  useEffect(() => {
    if (step !== 3 || !values.roomId || !api.holdingPreparation) return;
    const controller = new AbortController();
    let active = true;
    void api
      .holdingPreparation(values.roomId, controller.signal)
      .then((data) => {
        if (!active) return;
        if (data.roomId !== values.roomId || data.locationId !== room?.locationId)
          throw new Error('Cấu hình trả về không khớp phòng hoặc ngày giữ chỗ.');
        setDefaults({ key: defaultsKey, data });
      })
      .catch((e) => {
        if (active) setDefaults({ key: defaultsKey, error: contractError(e) });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [step, values.roomId, room?.locationId, api, defaultsKey]);
  const configured = defaults.key === defaultsKey ? defaults.data : undefined;
  const defaultsError = defaults.key === defaultsKey ? defaults.error : undefined;
  const defaultsReady =
    !!configured && /^(0|[1-9]\d*)$/.test(configured.holdingDeposit) && !!configured.terms?.trim();
  let datesReady = false;
  try {
    datesReady = dateOnly(configured?.endDate ?? '') > dateOnly(configured?.startDate ?? '');
  } catch {
    /* Missing configuration must not produce invented dates. */
  }
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
      if (!datesReady)
        throw new Error('Chưa có thời hạn giữ chỗ từ hệ thống. Chưa thể tạo hợp đồng.');
      if (!defaultsReady)
        throw new Error('Chưa có đầy đủ cấu hình tiền cọc và điều khoản cho cơ sở này.');
      body = {
        ...holdingDraftPayload(
          {
            ...values,
            startDate: configured!.startDate,
            endDate: configured!.endDate,
            requiredDeposit: configured!.holdingDeposit,
            terms: configured!.terms,
            roomId: room!.id,
            locationId: room!.locationId,
            ownerSignerId: owner!.id,
            tenantUserId: representative!.tenantUserId ?? '',
            expiresAt: `${configured!.endDate}T00:00`,
          },
          [representative!.id],
        ),
        settingsVersion: configured!.settingsVersion,
        expiresAt: configured!.expiresAt,
      };
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
      if (step === 2) {
        validateSelection();
        setDefaults({ key: '' });
      }
      setError('');
      setStep((value) => value + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const customHeader = useWorkspaceHeaderRefresh(query.reload, busy || query.loading, {
    title: 'Tạo hợp đồng giữ chỗ',
    onBack: back,
  });
  return (
    <>
      <View style={{ gap: 4 }}>
        {!customHeader && <Text style={styles.screenTitle}>Tạo hợp đồng giữ chỗ</Text>}
        <Text style={styles.description}>Nhập thông tin để lập hợp đồng giữ chỗ</Text>
      </View>
      <HoldingProgress current={step} />
      <Box style={styles.panel}>
        {step === 0 && (
          <>
            <Heading title="Chọn phòng giữ chỗ" detail="Chọn phòng còn trống để bắt đầu." />
            <ChoiceField
              label="Phòng giữ chỗ *"
              placeholder="Chọn phòng còn trống"
              icon="door-open"
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
            {room && !query.loading && (
              <View style={styles.roomSummary}>
                <Text style={styles.screenTitle}>{room.label}</Text>
                <Text style={styles.description}>
                  {query.data?.locations.find((item) => item.id === room.locationId)?.label}
                </Text>
                <Text style={styles.description}>
                  {roomValid
                    ? 'Phòng đủ điều kiện · Có thể tiếp tục'
                    : 'Đang kiểm tra điều kiện giữ chỗ'}
                </Text>
              </View>
            )}
            {query.loading && (
              <ActivityIndicator accessibilityLabel="Đang kiểm tra phòng giữ chỗ" />
            )}
            {!query.loading && !query.error && !roomOptions.length && (
              <Text>Chưa có phòng trống đủ điều kiện giữ chỗ.</Text>
            )}
          </>
        )}
        {(step === 1 || step === 2) && (
          <>
            <Heading
              title={step === 1 ? 'Thông tin người giữ chỗ' : 'CCCD của người giữ chỗ'}
              detail={
                step === 1
                  ? 'Nhập thông tin của người đăng ký giữ chỗ.'
                  : 'Quét CCCD hoặc nhập thủ công, sau đó kiểm tra và xác nhận thông tin.'
              }
            />
            {!!room && (
              <HoldingNewTenant
                key={`${room.id}:${step}`}
                api={api}
                roomId={room.id}
                role={role ?? ''}
                context="holding"
                stage={step === 1 ? 'details' : 'identity'}
                disabled={busy || !roomValid || !owner}
                onContinue={() => setStep(2)}
                initialResidentId={values.representativeResidentId}
                initialName={values.applicantFullName || values.tenantName}
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
        {step === 3 && (
          <>
            <HoldingConfirmationSummary
              location={query.data?.locations.find((item) => item.id === room?.locationId)?.label}
              room={room?.label}
              name={values.applicantFullName || values.tenantName}
              email={values.tenantEmail}
              birthDate={values.applicantDateOfBirth}
              verified={!!representative?.verified}
              deposit={configured?.holdingDeposit}
              startDate={configured?.startDate}
              endDate={configured?.endDate}
              terms={configured?.terms}
            />
            {!datesReady && (
              <Text accessibilityRole="alert" style={ui.red}>
                Chưa có thời hạn giữ chỗ từ hệ thống. Chưa thể tạo hợp đồng.
              </Text>
            )}
            {preparationAvailable && !configured && !defaultsError && (
              <ActivityIndicator accessibilityLabel="Đang lấy cấu hình giữ chỗ" />
            )}
            {!!defaultsError && (
              <Text accessibilityRole="alert" style={ui.red}>
                {defaultsError}
              </Text>
            )}
            {(!!defaultsError || (!!configured && !defaultsReady) || !preparationAvailable) && (
              <>
                <Text accessibilityRole="alert" style={ui.red}>
                  Chưa có đủ cấu hình giữ chỗ. Vui lòng kiểm tra cấu hình cơ sở.
                </Text>
                <Button disabled={busy} onPress={() => setDefaultsRevision((value) => value + 1)}>
                  Tải lại cấu hình
                </Button>
              </>
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
      </Box>
      {step < 3 && step !== 1 && (
        <WorkspaceFooter>
          <View style={styles.footer}>
            <Button
              mode="contained"
              icon="arrow-right"
              buttonColor={staffColors.navy}
              style={{ borderRadius: 12 }}
              contentStyle={{ minHeight: 50, flexDirection: 'row-reverse' }}
              disabled={busy || !roomValid || (step === 2 && !owner)}
              onPress={next}
            >
              Tiếp tục
            </Button>
            {step > 0 && (
              <Button disabled={busy} onPress={back}>
                Quay lại
              </Button>
            )}
          </View>
        </WorkspaceFooter>
      )}
      {step === 1 && (
        <Button disabled={busy} onPress={back}>
          Quay lại
        </Button>
      )}
      {step === 3 && (
        <WorkspaceFooter>
          <View style={styles.footer}>
            <Button
              mode="contained"
              buttonColor={staffColors.navy}
              loading={busy}
              disabled={
                busy || query.loading || !!query.error || !owner || !defaultsReady || !datesReady
              }
              onPress={() => void save()}
              contentStyle={styles.footerButton}
              labelStyle={styles.buttonLabel}
              style={{ borderRadius: 10 }}
            >
              Tạo hợp đồng giữ chỗ và tiếp tục bước 5
            </Button>
            <Button
              mode="text"
              disabled={busy}
              onPress={back}
              contentStyle={styles.footerButton}
              labelStyle={styles.buttonLabel}
            >
              Quay lại
            </Button>
          </View>
        </WorkspaceFooter>
      )}
    </>
  );
}
const styles = StyleSheet.create({
  panel: { borderRadius: 16, padding: 16, gap: 12, marginBottom: 8, backgroundColor: '#FFFFFF' },
  description: { fontSize: 14, color: '#52647A' },
  roomSummary: { backgroundColor: '#F5F7FB', borderRadius: 14, padding: 12, gap: 8 },
  screenTitle: { color: staffColors.navy, fontSize: 18, fontWeight: '600' },
  footer: {
    backgroundColor: '#FFFFFF',
    borderTopColor: '#E2E8F0',
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 4,
  },
  footerButton: { minHeight: 48 },
  buttonLabel: { fontSize: 14, fontWeight: '600' },
});
