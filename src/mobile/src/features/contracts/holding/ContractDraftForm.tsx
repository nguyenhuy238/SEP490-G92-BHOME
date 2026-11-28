import { demoBusinessNow } from '../../../../../../packages/client-core/src/demoClock';
import { UserFeedbackError } from '../../../../../../packages/client-core/src/api';
import { ContractNotice } from '../ContractNotice';
import { useFeedbackState } from '../../../lib/useFeedbackState';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';
import { randomUUID } from '../../../lib/randomUUID';
import {
  contractError,
  holdingDraftPayload,
  dateOnly,
  mutationKeys,
  type ContractClient,
} from '../../../../../../packages/client-core/src/contracts';
import { useHoldingPreparation } from './useHoldingPreparation';
import { ChoiceField } from '../../../components/WorkflowControls';
import { mainDraftClient } from '../../../../../../packages/client-core/src/mainDrafts';
import type { HoldingPreparation } from '../../../../../../packages/client-core/src/holdingSettings';
import { HoldingConfirmationSummary } from './HoldingConfirmationSummary';
import { WorkspaceFooter } from '../../../components/WorkspaceFooter';
import { useWorkspaceHeaderRefresh } from '../../../components/WorkspaceHeaderContext';
import { showSuccess } from '../../../lib/toast';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { HoldingNewTenant } from './HoldingNewTenant';
import { HoldingProgress } from './HoldingProgress';
import { staffColors } from '../../../theme/theme';
import { HoldingSectionCard, HoldingStatusBadge } from './HoldingUi';
import { ContractLoading } from '../ContractLoading';
import { HoldingRoomPicker } from './HoldingRoomPicker';

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
  const { role, staffLocationId } = useWorkspace();
  const [values, setValues] = useState<Record<string, string>>({ roomId: initialRoomId });
  const [defaults, setDefaults] = useState<{
    key: string;
    data?: HoldingPreparation;
    error?: string;
  }>({ key: '' });
  const [defaultsRevision, setDefaultsRevision] = useState(0);
  const [confirmedApplicantId, setConfirmedApplicantId] = useState('');
  const [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useFeedbackState('warning', false);
  const lock = useRef(false),
    [keys] = useState(() => mutationKeys(randomUUID));
  const query = useHoldingPreparation(api, values.roomId);
  const room = query.data?.rooms.find((item) => item.id === values.roomId);
  const p = room ? query.data?.byLocation[room.locationId] : undefined;
  const eligible = (p?.residents ?? []).filter(
    (r) => r.roomId === room?.id && r.verified && r.residentType !== 'CoOccupant',
  );
  // IdentityWizard calls onConfirmed only after the backend confirms this exact
  // resident. Reuse that acknowledgement instead of fetching the entire wizard again.
  const representative =
    eligible.find((r) => r.id === values.representativeResidentId) ??
    (room && confirmedApplicantId && confirmedApplicantId === values.representativeResidentId
      ? {
          id: confirmedApplicantId,
          roomId: room.id,
          label: values.applicantFullName || values.tenantName,
          verified: true,
          tenantUserId: null,
        }
      : undefined);
  const owners = p?.ownerSigners ?? [];
  // Preparation exposes eligible Owners, without a separate designation field.
  // Resolve only a unique result; never guess among multiple accounts.
  const owner = owners.length === 1 ? owners[0] : undefined;
  const ownerError =
    owners.length > 1
      ? 'Chưa xác định được Owner ký hợp đồng: cơ sở có nhiều Owner hợp lệ. Vui lòng liên hệ quản trị viên.'
      : 'Chưa xác định được Owner ký hợp đồng cho cơ sở này. Vui lòng liên hệ quản trị viên.';
  const locations = query.data?.locations ?? [];
  const selectedLocationId =
    values.locationId ||
    room?.locationId ||
    (locations.some((item) => item.id === staffLocationId) ? staffLocationId : '') ||
    (locations.length === 1 ? locations[0].id : '');
  const roomOptions = (query.data?.rooms ?? []).filter(
    (item) => item.locationId === selectedLocationId,
  );
  const roomValid = !!room && !!p && !query.loading && !query.error;
  const stepLoading = step === 0 ? query.checkingRoom : query.loading;
  const preparationAvailable = typeof api.holdingPreparation === 'function';
  const defaultsKey = `${values.roomId}:${defaultsRevision}`;
  useEffect(() => {
    // Fetch the quote while the applicant fills their profile, instead of making
    // them wait again when they reach confirmation. The server checks its version on save.
    if (!values.roomId || !room?.locationId || !api.holdingPreparation) return;
    const controller = new AbortController();
    let active = true;
    void api
      .holdingPreparation(values.roomId, controller.signal)
      .then((data) => {
        if (!active) return;
        if (data.roomId !== values.roomId || data.locationId !== room?.locationId)
          throw new UserFeedbackError('Cấu hình trả về không khớp phòng hoặc ngày giữ chỗ.');
        setDefaults({ key: defaultsKey, data });
      })
      .catch((e) => {
        if (active) setDefaults({ key: defaultsKey, error: contractError(e) });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [values.roomId, room?.locationId, api, defaultsKey]);
  const configured = defaults.key === defaultsKey ? defaults.data : undefined;
  const defaultsError = defaults.key === defaultsKey ? defaults.error : undefined;
  const defaultsLoading = preparationAvailable && !configured && !defaultsError && !!room;
  const defaultsReady =
    !!configured && /^(0|[1-9]\d*)$/.test(configured.holdingDeposit) && !!configured.terms?.trim();
  let datesReady = false;
  try {
    datesReady = dateOnly(configured?.endDate ?? '') > dateOnly(configured?.startDate ?? '');
  } catch {
    /* Missing configuration must not produce invented dates. */
  }
  function validateSelection() {
    if (query.loading || query.error || !room)
      throw new UserFeedbackError('Chọn phòng giữ chỗ hợp lệ.');
    if (!representative)
      throw new UserFeedbackError('Nhập và xác minh thông tin người giữ chỗ trước khi tiếp tục.');
    if (!owner) throw new UserFeedbackError(ownerError);
  }
  async function save() {
    if (lock.current) return;
    let body;
    try {
      validateSelection();
      if (!datesReady)
        throw new UserFeedbackError('Chưa có thời hạn giữ chỗ từ hệ thống. Chưa thể tạo hợp đồng.');
      if (!defaultsReady)
        throw new UserFeedbackError(
          'Chưa có đầy đủ cấu hình tiền cọc và điều khoản cho cơ sở này.',
        );
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
      if (Date.parse(body.expiresAt) <= demoBusinessNow())
        throw new UserFeedbackError('Hạn giữ chỗ phải ở tương lai.');
    } catch (e) {
      setError(contractError(e));
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
    if (step > 0) setStep((value) => (value === 2 ? 0 : value - 1));
    else onCancel();
  }
  function next() {
    try {
      if (!(step === 0 ? query.roomReady : roomValid))
        throw new UserFeedbackError('Chọn phòng giữ chỗ hợp lệ.');
      if (step === 2) {
        validateSelection();
      }
      setError('');
      setStep((value) => (value === 0 ? 2 : value + 1));
    } catch (e) {
      setError(contractError(e));
    }
  }
  const customHeader = useWorkspaceHeaderRefresh(query.reload, busy || query.loading, {
    title: 'Tạo hợp đồng giữ chỗ',
    onBack: back,
  });
  return (
    <>
      <View style={styles.intro}>
        {!customHeader && <Text style={styles.screenTitle}>Tạo hợp đồng giữ chỗ</Text>}
        {!customHeader && (
          <Text style={styles.description}>Hoàn tất thông tin theo từng bước.</Text>
        )}
      </View>
      <HoldingProgress current={busy && step === 3 ? 4 : step} />
      {busy && step === 3 && <ContractLoading label="Đang tạo hợp đồng và chuẩn bị gửi ký…" />}
      <View
        style={[styles.panel, busy && step === 3 && { display: 'none' }]}
        accessibilityElementsHidden={busy && step === 3}
        importantForAccessibility={busy && step === 3 ? 'no-hide-descendants' : 'auto'}
      >
        {step === 0 && (
          <HoldingSectionCard title="Chọn phòng giữ chỗ">
            <Text style={styles.description}>Chọn phòng còn trống để bắt đầu.</Text>
            {locations.length === 1 ? (
              <Text style={styles.description}>Cơ sở được phân công: {locations[0].label}</Text>
            ) : (
              <ChoiceField
                label="Cơ sở được phân công *"
                placeholder="Chọn cơ sở"
                value={selectedLocationId}
                options={locations}
                disabled={busy || query.catalogLoading || !!values.representativeResidentId}
                onChange={(locationId) => {
                  setValues((before) => ({
                    ...before,
                    locationId,
                    roomId: '',
                    representativeResidentId: '',
                    ownerSignerId: '',
                  }));
                  setConfirmedApplicantId('');
                  setError('');
                }}
              />
            )}
            <HoldingRoomPicker
              key={selectedLocationId}
              value={values.roomId ?? ''}
              rooms={roomOptions}
              loading={query.catalogLoading}
              error={query.catalogError}
              onRetry={query.reload}
              disabled={busy || !selectedLocationId || !!values.representativeResidentId}
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
            {room && !query.catalogLoading && (
              <View style={styles.roomSummary}>
                <View style={styles.roomIcon}>
                  <Icon source="door-open" size={22} color={staffColors.navy} />
                </View>
                <View style={styles.roomInfo}>
                  <Text style={styles.roomTitle}>{room.label}</Text>
                  <Text style={styles.description}>
                    {query.data?.locations.find((item) => item.id === room.locationId)?.label}
                  </Text>
                  {typeof room.capacity === 'number' && (
                    <Text style={styles.description}>Sức chứa: {room.capacity} người</Text>
                  )}
                </View>
                <HoldingStatusBadge
                  label={
                    query.checkingRoom
                      ? 'Đang kiểm tra'
                      : query.roomReady
                        ? 'Đủ điều kiện'
                        : query.selectionBlocked
                          ? 'Không đủ điều kiện'
                          : 'Chưa xác nhận'
                  }
                  tone={
                    query.checkingRoom
                      ? 'neutral'
                      : query.roomReady
                        ? 'success'
                        : query.selectionBlocked
                          ? 'error'
                          : 'warning'
                  }
                />
              </View>
            )}
            {query.checkingRoom && (
              <View style={styles.refreshStatus}>
                <ActivityIndicator size="small" accessibilityLabel="Đang kiểm tra phòng giữ chỗ" />
                <Text style={styles.description}>
                  {room ? 'Đang kiểm tra phòng đã chọn…' : 'Đang tải danh sách phòng trống…'}
                </Text>
              </View>
            )}
            {!query.loading && !query.error && !!selectedLocationId && !roomOptions.length && (
              <View style={styles.emptyRooms}>
                <Text style={styles.description}>
                  {query.data?.blockedRooms.length
                    ? `Có ${query.data.blockedRooms.length} phòng trống nhưng chưa đủ điều kiện giữ chỗ.`
                    : 'Chưa có phòng trống đủ điều kiện giữ chỗ.'}
                </Text>
                {query.data?.blockedRooms.slice(0, 5).map((item) => (
                  <Text key={item.id} style={styles.description}>
                    {item.label}:{' '}
                    {item.codes.includes('RENT_POLICY_MISSING')
                      ? 'Chưa cấu hình giá thuê. Owner cần cập nhật giá phòng.'
                      : 'Owner cần kiểm tra điều kiện giữ chỗ của phòng.'}
                  </Text>
                ))}
                <Button disabled={query.loading} onPress={query.reload}>
                  Kiểm tra lại phòng
                </Button>
              </View>
            )}
          </HoldingSectionCard>
        )}
        {!!room && (
          <View style={[styles.identityStage, step !== 2 && { display: 'none' }]}>
            <Text style={styles.sectionTitle}>Thông tin người giữ chỗ</Text>
            <Text style={styles.description}>
              Quét CCCD hoặc nhập thủ công, sau đó xác nhận thông tin.
            </Text>
            {!!room && (
              <HoldingNewTenant
                key={room.id}
                api={api}
                roomId={room.id}
                role={role ?? ''}
                context="holding"
                stage="identity"
                disabled={busy}
                initialResidentId={values.representativeResidentId}
                initialName={values.applicantFullName || values.tenantName || ''}
                initialEmail={values.tenantEmail}
                initialConfirmed={!!representative?.verified}
                onCreated={(id, name, email) => {
                  setValues((before) => ({
                    ...before,
                    representativeResidentId: id,
                    tenantName: name,
                    tenantEmail: email,
                  }));
                }}
                onVerifiedSummary={(summary) =>
                  setValues((before) => ({
                    ...before,
                    applicantFullName: summary.fullName,
                    applicantDateOfBirth: summary.dateOfBirth ?? '',
                  }))
                }
                onConfirmed={() => setConfirmedApplicantId(values.representativeResidentId)}
                onBusyChange={setBusy}
              />
            )}
          </View>
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
            {!datesReady && !defaultsLoading && (
              <ContractNotice message="Chưa có thời hạn giữ chỗ từ hệ thống. Chưa thể tạo hợp đồng." />
            )}
            {preparationAvailable && !configured && !defaultsError && (
              <ActivityIndicator accessibilityLabel="Đang lấy cấu hình giữ chỗ" />
            )}
            {!!defaultsError && <ContractNotice message={defaultsError} />}
            {(!!defaultsError || (!!configured && !defaultsReady) || !preparationAvailable) && (
              <>
                <ContractNotice message="Chưa có đủ cấu hình giữ chỗ. Vui lòng kiểm tra cấu hình cơ sở." />
                <Button disabled={busy} onPress={() => setDefaultsRevision((value) => value + 1)}>
                  Tải lại cấu hình
                </Button>
              </>
            )}
          </>
        )}
        {step > 0 && !query.loading && !!p && !owner && <ContractNotice message={ownerError} />}
        {step > 0 && query.loading && (
          <View style={styles.refreshStatus}>
            <ActivityIndicator
              size="small"
              accessibilityLabel="Đang cập nhật thông tin phòng đã chọn"
            />
            <Text style={[styles.description, styles.refreshDescription]}>
              {step === 2 && role === 'Staff'
                ? 'Đang cập nhật thông tin phòng. Bạn vẫn có thể quét hoặc nhập CCCD.'
                : 'Đang cập nhật thông tin phòng đã chọn…'}
            </Text>
          </View>
        )}
        {!!query.error && <ContractNotice message={query.error} />}
        {!!query.error && (
          <Button disabled={busy || query.loading} onPress={query.reload}>
            Thử lại
          </Button>
        )}
        {!!error && <ContractNotice message={error} />}
      </View>
      {step < 3 && (
        <WorkspaceFooter>
          <View style={styles.footer}>
            <Button
              mode="contained"
              icon="arrow-right"
              buttonColor={staffColors.navy}
              style={styles.footerPrimary}
              contentStyle={styles.footerPrimaryContent}
              disabled={busy || !(step === 0 ? query.roomReady : roomValid && !!owner)}
              loading={busy || stepLoading}
              onPress={next}
            >
              {stepLoading ? 'Đang cập nhật…' : 'Tiếp tục'}
            </Button>
            {step > 0 && (
              <Button disabled={busy} onPress={back} mode="text" contentStyle={styles.footerButton}>
                Quay lại
              </Button>
            )}
          </View>
        </WorkspaceFooter>
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
              style={styles.footerPrimary}
            >
              Tạo bản nháp và tiếp tục
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
  refreshStatus: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  refreshDescription: { flex: 1 },
  intro: { gap: 4 },
  panel: { gap: 12, marginBottom: 12 },
  description: { fontSize: 13, lineHeight: 20, color: '#64748B' },
  sectionTitle: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: staffColors.navy },
  formCard: {
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    gap: 12,
  },
  identityStage: { gap: 10 },
  roomSummary: {
    backgroundColor: '#F5F7FB',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  roomIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F0FE',
  },
  roomInfo: { flex: 1, minWidth: 0, gap: 2 },
  roomTitle: { color: staffColors.navy, fontSize: 15, fontWeight: '700' },
  emptyRooms: { gap: 8 },
  screenTitle: { color: staffColors.navy, fontSize: 18, lineHeight: 24, fontWeight: '700' },
  footer: {
    backgroundColor: '#FFFFFF',
    borderTopColor: '#E2E8F0',
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 4,
  },
  footerButton: { minHeight: 48 },
  footerPrimary: { borderRadius: 12 },
  footerPrimaryContent: { minHeight: 50, flexDirection: 'row-reverse' },
  buttonLabel: { fontSize: 14, fontWeight: '600' },
});
