import { useFeedbackState } from '../lib/useFeedbackState';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';
import { Action, Box, Heading, ui } from '../components/WorkspaceKit';
import { ChoiceField } from '../components/WorkflowControls';
import { MainContractProgress } from '../features/contracts/main/MainContractProgress';
import { MainDraftScreen } from '../features/contracts/main/MainDraftScreen';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useSession } from '../lib/SessionProvider';
import { captureService } from '../services/captureService';
import { errorMessage, MobileApiError } from '../lib/api';
import { useCaptureScope } from '../features/onboarding/useCaptureScope';
import { WorkspaceFooter } from '../components/WorkspaceFooter';
import { IdentityWizard } from '../features/onboarding/IdentityWizard';
import { ResidentProfile } from '../features/onboarding/ResidentProfile';
import { OnboardingPeopleStep } from '../features/onboarding/OnboardingPeopleStep';
import { HoldingMainStart } from '../features/contracts/holding/HoldingMainStart';
import { HoldingRoomPicker } from '../features/contracts/holding/HoldingRoomPicker';
import { contractClient } from '../../../../packages/client-core/src/contracts';
import {
  allIdentitiesConfirmed,
  peopleReady,
  residentType,
  type HouseholdMode,
  type IdentityStatus,
  type IdentityCaptureRequest,
  type OnboardingPerson,
} from '../features/onboarding/onboarding';
import { staffColors as s } from '../theme/theme';

const blankPerson = (key: string, number = 1): OnboardingPerson => ({
  key,
  label: `Người ở ${number}`,
  email: '',
  status: 'unscanned',
});
export function OnboardingScreen() {
  const { residentId, locationId, representativeResidentId } = useLocalSearchParams<{
    residentId?: string;
    locationId?: string;
    representativeResidentId?: string;
  }>();
  return residentId ? (
    <ResidentProfile
      key={residentId}
      residentId={residentId}
      locationId={locationId}
      representativeResidentId={representativeResidentId}
    />
  ) : (
    <NewResidentOnboarding />
  );
}
function NewResidentOnboarding() {
  const { locationId, roomId } = useLocalSearchParams<{ locationId?: string; roomId?: string }>();
  const { preview, go, resetScroll, registerExitGuard, requestNavigation } = useWorkspace();
  const { api } = useSession();
  const contracts = useMemo(
    () => (api ? contractClient((path, init, type) => api.request(path, init, type)) : null),
    [api],
  );
  const scope = useCaptureScope({
    autoSelectAssignedLocation: true,
    inlineErrors: true,
    initialLocationId: locationId,
  });
  const appliedInitialRoom = useRef(false);
  const { location, rooms, setRoom } = scope;
  const selectableRooms = rooms.filter(
    (room) =>
      !room.waitingForOwnerSignature &&
      ['Available', 'Occupied', 'OnHold'].includes(room.status ?? ''),
  );
  useEffect(() => {
    if (
      !appliedInitialRoom.current &&
      roomId &&
      location === locationId &&
      rooms.some(
        (room) =>
          room.id === roomId && ['Available', 'Occupied', 'OnHold'].includes(room.status ?? ''),
      )
    ) {
      setRoom(roomId);
      appliedInitialRoom.current = true;
    }
  }, [roomId, locationId, location, rooms, setRoom]);
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<HouseholdMode>('individual');
  const [people, setPeople] = useState<OnboardingPerson[]>([blankPerson('person-1')]);
  const [representative, setRepresentative] = useState('person-1');
  const [editing, setEditing] = useState('person-1');
  const [mainDraftId, setMainDraftId] = useState('');
  const [identityKey, setIdentityKey] = useState('person-1');
  const [identityOpen, setIdentityOpen] = useState(false);
  const [identityMode, setIdentityMode] = useState<'capture' | 'verify'>('capture');
  const [captureRequest, setCaptureRequest] = useState<
    IdentityCaptureRequest & { personKey: string }
  >();
  const [busy, setBusy] = useState(false);
  const [emailConflict, setEmailConflict] = useState<{
    personKey: string;
    locationId: string;
    residentId?: string;
  } | null>(null);
  const [error, setError] = useFeedbackState('error', false);
  const [finished, setFinished] = useState(false);
  const [contractInput, setContractInput] = useState<{
    roomId: string;
    representativeResidentId: string;
    residentIds: string[];
  } | null>(null);
  const [contractOpen, setContractOpen] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const serial = useRef(1);
  const lock = useRef(false);
  const alive = useRef(true);
  const dirty =
    !finished &&
    !discarded &&
    step === 2 &&
    !contractOpen &&
    identityOpen &&
    people.some(
      (person) =>
        person.key === identityKey && person.status !== 'confirmed' && person.hasUnsavedIdentity,
    );
  const disablePrevention = usePreventRemove(dirty, ({ repeat }) => requestNavigation(repeat));
  useFocusEffect(
    useCallback(() => {
      if (dirty)
        return registerExitGuard(
          () => true,
          () => {
            setDiscarded(true);
            disablePrevention();
          },
          true,
        );
    }, [dirty, registerExitGuard, disablePrevention]),
  );
  useFocusEffect(useCallback(() => () => setIdentityOpen(false), [setIdentityOpen]));
  const openSigning = (contractId = '') => {
    setFinished(true);
    disablePrevention();
    router.replace({ pathname: '/workspace/[screen]', params: { screen: 'signing', contractId } });
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const patch = (key: string, changes: Partial<OnboardingPerson>) =>
    setPeople((before) => before.map((p) => (p.key === key ? { ...p, ...changes } : p)));
  const personLabel = (person: OnboardingPerson) => {
    const index = people.findIndex((candidate) => candidate.key === person.key);
    const label = person.label.trim();
    return (
      person.member?.fullName.trim() ||
      (/^Người ở \d+$/.test(label) ? `Người ở ${index + 1}` : label)
    );
  };
  const changeStatus = (key: string, status: IdentityStatus) =>
    setPeople((before) =>
      before.map((p) =>
        p.key === key && p.status !== 'confirmed' && p.status !== status ? { ...p, status } : p,
      ),
    );
  const move = (next: number) => {
    setError('');
    setEmailConflict(null);
    setStep(next);
    resetScroll();
  };
  const selectedRoom = scope.rooms.find((room) => room.id === scope.room);
  const maxPeople =
    selectedRoom?.capacity == null
      ? 0
      : Math.max(
          0,
          Math.min(selectedRoom.capacity, selectedRoom.remainingCapacity ?? selectedRoom.capacity),
        );
  const roomValid =
    maxPeople > 0 &&
    !!scope.location &&
    !!scope.room &&
    !scope.loading &&
    !scope.error &&
    scope.locations.some((l) => l.id === scope.location) &&
    selectableRooms.some((r) => r.id === scope.room && r.remainingCapacity !== 0);
  const peopleValid = people.length <= maxPeople && peopleReady(people, representative);
  const allConfirmed = allIdentitiesConfirmed(people);
  const created = people.some((p) => !!p.residentId);
  const confirmedCount = people.filter((p) => p.status === 'confirmed').length;
  const completedCount = confirmedCount;
  const pendingPerson = people.find((p) => !p.residentId || p.status !== 'confirmed') ?? people[0];
  const recognizing = people.some((p) => p.status === 'recognizing');
  const checkSavedIdentities = async () => {
    if (!api || preview || lock.current || recognizing || !scope.location) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const residents = await captureService(api).residents(scope.location);
      if (!alive.current) return;
      const verified = new Set(
        residents
          .filter((r) => r.roomId === scope.room && r.verificationStatus === 1)
          .map((r) => r.id),
      );
      setPeople((before) =>
        before.map((p) =>
          p.residentId && verified.has(p.residentId)
            ? { ...p, status: 'confirmed', verificationError: '' }
            : p,
        ),
      );
      if (
        people.some(
          (p) => p.status !== 'confirmed' && (!p.residentId || !verified.has(p.residentId)),
        )
      )
        setError(
          'Còn hồ sơ chưa được máy chủ xác nhận. Mở Nhập thủ công, kiểm tra thông tin và bấm Xác nhận thông tin; nếu có lỗi, xem thông báo trên hồ sơ.',
        );
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const openIdentity = async (
    person: OnboardingPerson,
    entryMode: 'capture' | 'verify' = person.status === 'pending' ? 'verify' : 'capture',
  ) => {
    if (lock.current || recognizing || person.creationUncertain) return;
    if (!roomValid || !peopleValid) {
      setError('Kiểm tra phòng và thông tin người ở trước khi tiếp tục.');
      return;
    }
    setIdentityKey(person.key);
    setIdentityMode(entryMode);
    if (person.residentId) {
      setIdentityOpen(true);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setEmailConflict(null);
    try {
      let id = preview ? `sample-${person.key}` : null;
      if (!preview && api) {
        id = (
          await captureService(api).createResident(
            scope.room,
            personLabel(person),
            residentType(mode, person.key, representative),
          )
        ).id;
      }
      if (!id) throw new Error('Không thể kết nối. Hãy đăng nhập lại rồi thử tiếp.');
      if (alive.current) {
        patch(person.key, { residentId: id });
        setIdentityOpen(true);
      }
    } catch (e) {
      if (alive.current) {
        if (e instanceof MobileApiError && (e.status === 0 || e.status >= 500)) {
          patch(person.key, { creationUncertain: true });
          setError(
            'Chưa xác định hồ sơ đã được tạo hay chưa. Kiểm tra danh sách người ở trước khi tạo tiếp.',
          );
        } else if (
          e instanceof MobileApiError &&
          e.status === 409 &&
          e.code === 'resident_email_already_associated'
        ) {
          setError(errorMessage(e));
          const conflict = { personKey: person.key, locationId: scope.location };
          setEmailConflict(conflict);
          try {
            // Only inspect the existing scoped summary API. Never resolve a global email
            // or attach an identity to the new draft based on an email match.
            const residents = await captureService(api!).residents(scope.location);
            const matches = residents.filter(
              (resident) =>
                resident.roomId === scope.room &&
                resident.email?.trim().toLowerCase() === person.email?.trim().toLowerCase(),
            );
            if (alive.current && matches.length === 1)
              setEmailConflict({ ...conflict, residentId: matches[0].id });
          } catch {
            if (alive.current)
              setError(
                `${errorMessage(e)} Chưa tải được danh sách hồ sơ; hãy kiểm tra lại từ danh sách người ở.`,
              );
          }
        } else setError(errorMessage(e));
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  if (discarded)
    return (
      <Box>
        <Text>Đã rời phiên tiếp nhận. Những hồ sơ đã xác nhận vẫn được giữ lại.</Text>
        <Action onPress={() => go('rooms')}>Xem người ở</Action>
      </Box>
    );
  return (
    <>
      <View
        style={contractOpen ? styles.hidden : styles.identity}
        accessibilityElementsHidden={contractOpen}
        importantForAccessibility={contractOpen ? 'no-hide-descendants' : 'auto'}
      >
        <Heading
          title={step === 1 ? 'Thông tin người ở' : 'Tiếp nhận khách thuê'}
          detail={
            step === 1
              ? 'Bước 2/8 · Người ở'
              : 'Chuẩn bị hồ sơ người ở, kiểm tra và xác nhận thông tin.'
          }
        />
        <MainContractProgress current={step} />
        {step === 0 && (
          <Box style={styles.panel}>
            <Heading title="Chọn nơi ở" detail="Chọn phòng tại cơ sở bạn đang phụ trách." />
            {scope.locations.length === 1 ? (
              <View style={styles.summary}>
                <Text variant="labelMedium">Cơ sở được phân công</Text>
                <Text variant="titleMedium">{scope.locations[0].label}</Text>
              </View>
            ) : (
              <ChoiceField
                label="Cơ sở được phân công *"
                value={scope.location}
                options={scope.locations}
                disabled={created || scope.loading}
                onChange={scope.selectLocation}
              />
            )}
            <HoldingRoomPicker
              key={scope.location}
              value={scope.room}
              rooms={selectableRooms.map((room) => ({
                ...room,
                capacity: room.capacity ?? undefined,
              }))}
              loading={scope.loading}
              error={scope.error}
              onRetry={scope.reload}
              disabled={created || !scope.location || scope.loading}
              fieldLabel="Phòng *"
              title="Chọn phòng"
              onChange={scope.setRoom}
            />
            {scope.rooms.find((room) => room.id === scope.room)?.remainingCapacity === 0 && (
              <Text accessibilityRole="alert" style={{ color: '#B42318' }}>
                Phòng đã đủ người theo hợp đồng đang hiệu lực hôm nay. Hãy chọn phòng còn chỗ.
              </Text>
            )}
            {scope.loading && (
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                accessibilityRole="progressbar"
                accessibilityLabel={scope.location ? 'Đang tải danh sách phòng' : 'Đang tải cơ sở'}
              >
                <ActivityIndicator size="small" />
                <Text style={ui.muted}>
                  {scope.location ? 'Đang tải danh sách phòng…' : 'Đang tải cơ sở…'}
                </Text>
              </View>
            )}
            {selectedRoom?.waitingForOwnerSignature && (
              <Text accessibilityRole="alert" style={ui.red}>
                Phòng có hợp đồng đang chờ Owner ký.
              </Text>
            )}
            {!!scope.error && (
              <>
                <Text style={ui.red}>{scope.error}</Text>
                <Button onPress={scope.reload}>Thử lại</Button>
              </>
            )}
            {!scope.loading && !scope.error && !scope.locations.length && (
              <View style={styles.empty}>
                <Icon source="home-search-outline" size={40} color={s.blue} />
                <Text>Chưa có cơ sở được phân công.</Text>
                <Text style={ui.muted}>Liên hệ chủ cơ sở để được hỗ trợ.</Text>
              </View>
            )}
            {!!scope.location && !scope.loading && !scope.error && !selectableRooms.length && (
              <Text>Chưa có phòng phù hợp để tiếp nhận tại cơ sở này.</Text>
            )}
            {roomValid && (
              <View style={styles.summary}>
                <Text variant="titleMedium">Phòng {selectedRoom?.label}</Text>
                {selectedRoom?.capacity != null && (
                  <Text style={ui.muted}>Sức chứa: {selectedRoom.capacity} người</Text>
                )}
                {!!selectedRoom?.currentTenantLabels?.length && (
                  <Text style={ui.muted}>
                    Người đang thuê: {selectedRoom.currentTenantLabels.join(', ')}
                  </Text>
                )}
              </View>
            )}
            {created && (
              <Text style={ui.muted}>
                Phòng được giữ nguyên cho các hồ sơ đã tạo trong phiên này.
              </Text>
            )}
            {scope.rooms.find((r) => r.id === scope.room)?.status === 'OnHold' && contracts ? (
              <HoldingMainStart
                api={contracts}
                locationId={scope.location}
                roomId={scope.room}
                onConverted={openSigning}
              />
            ) : (
              <Action disabled={!roomValid} onPress={() => move(2)}>
                Tiếp tục
              </Action>
            )}
          </Box>
        )}
        {step === 2 && (
          <OnboardingPeopleStep
            inline
            mode={mode}
            people={people}
            maxPeople={maxPeople}
            representative={representative}
            editing={editing}
            created={created}
            canContinue={peopleValid}
            completedCount={completedCount}
            backDisabled={busy || recognizing}
            onModeChange={(next) => {
              if (next === 'individual' && people.length > 1) {
                setError('Xóa thành viên chưa tạo trước khi chuyển sang Cá nhân.');
                return;
              }
              setMode(next);
            }}
            onEdit={setEditing}
            onRepresentative={setRepresentative}
            onAdd={() => {
              if (mode !== 'family' || people.length >= maxPeople || busy || recognizing) return;
              const key = `person-${++serial.current}`;
              setPeople((before) =>
                before.length >= maxPeople
                  ? before
                  : [...before, blankPerson(key, before.length + 1)],
              );
              setEditing(key);
            }}
            onDelete={(key) => {
              const next = people.filter((p) => p.key !== key);
              setPeople(next);
              setEditing(next[0].key);
              if (representative === key) setRepresentative(next[0].key);
            }}
            onLabelChange={(key, label) => patch(key, { label })}
            onEmailChange={(key, email) => patch(key, { email })}
            onScan={(person, side) => {
              if (side)
                setCaptureRequest((before) => ({
                  side,
                  personKey: person.key,
                  id: (before?.id ?? 0) + 1,
                }));
              const progress = person.captureProgress;
              const both = progress?.front === 'recognized' && progress?.back === 'recognized';
              const started =
                progress && (progress.front !== 'unscanned' || progress.back !== 'unscanned');
              if (person.status === 'confirmed') return;
              void openIdentity(
                person,
                side
                  ? 'capture'
                  : both || (!started && person.status === 'pending')
                    ? 'verify'
                    : 'capture',
              );
            }}
            onManual={(person) => void openIdentity(person, 'verify')}
            personLabel={personLabel}
            disabledFor={(person) => busy || recognizing || !!person.creationUncertain}
            onBack={() => move(0)}
            onContinue={() => move(2)}
          />
        )}
        {step === 2 && created && !allConfirmed && !preview && (
          <Button disabled={busy || recognizing} onPress={() => void checkSavedIdentities()}>
            Kiểm tra trạng thái đã lưu
          </Button>
        )}
        <View
          style={step === 2 ? undefined : styles.hidden}
          accessibilityElementsHidden={step !== 2}
          importantForAccessibility={step === 2 ? 'auto' : 'no-hide-descendants'}
        >
          {people
            .filter((p) => !!p.residentId)
            .map((person) => (
              <IdentityWizard
                key={person.key}
                residentId={person.residentId!}
                locationId={scope.location}
                roomId={scope.room}
                preview={preview}
                active={step === 2 && identityKey === person.key}
                modal
                visible={!contractOpen && identityOpen && identityKey === person.key && step === 2}
                personLabel={personLabel(person)}
                mode={identityMode}
                captureRequest={
                  captureRequest?.personKey === person.key ? captureRequest : undefined
                }
                onModeChange={setIdentityMode}
                onDismiss={() => setIdentityOpen(false)}
                onStatusChange={(status) => changeStatus(person.key, status)}
                onUnsavedChanges={(hasUnsavedIdentity) => patch(person.key, { hasUnsavedIdentity })}
                onCaptureProgress={(captureProgress) => patch(person.key, { captureProgress })}
                onSaveError={(verificationError) => patch(person.key, { verificationError })}
                onConfirmed={() => {
                  patch(person.key, { status: 'confirmed', verificationError: '' });
                  setIdentityOpen(false);
                  resetScroll();
                }}
                onComplete={() => {
                  const next =
                    mode === 'family'
                      ? undefined
                      : people.find((p) => p.status !== 'confirmed' && p.key !== person.key);
                  if (next) void openIdentity(next);
                  else setIdentityOpen(false);
                }}
                onCancel={() => move(0)}
              />
            ))}
        </View>
        {!!error && (
          <Text accessibilityRole="alert" style={ui.red}>
            {error}
          </Text>
        )}
        {step === 2 && emailConflict && (
          <Box>
            <Heading title="Kiểm tra hồ sơ đã có" />
            <Text>
              Hồ sơ có thể đã được tạo ở lần tiếp nhận trước. Kiểm tra đúng người và phòng trước khi
              tiếp tục xác minh; hồ sơ trong phiên này chưa được xác nhận.
            </Text>
            {emailConflict.residentId ? (
              <Button
                disabled={busy}
                onPress={() =>
                  go(
                    'onboarding',
                    { residentId: emailConflict.residentId!, locationId: emailConflict.locationId },
                    true,
                  )
                }
              >
                Mở hồ sơ đã có tại phòng này
              </Button>
            ) : (
              <Button disabled={busy} onPress={() => go('rooms', undefined, true)}>
                Kiểm tra danh sách người ở
              </Button>
            )}
            <Button
              disabled={busy}
              onPress={() => {
                setEditing(emailConflict.personKey);
                move(1);
              }}
            >
              Sửa email người ở
            </Button>
          </Box>
        )}
        {people.some((person) => person.creationUncertain) && (
          <Button onPress={() => go('rooms', undefined, true)}>Kiểm tra danh sách người ở</Button>
        )}
        {step > 0 && step !== 1 && !finished && (
          <Button
            disabled={busy || recognizing}
            icon="arrow-left"
            onPress={() => move(step === 2 ? 0 : step - 1)}
          >
            Quay lại
          </Button>
        )}
      </View>
      <WorkspaceFooter>
        {step === 2 && !contractOpen && (
          <View style={styles.footerContent}>
            <Text style={styles.footerHint}>
              {!roomValid
                ? 'Chọn phòng còn chỗ trước khi tiếp tục.'
                : !peopleValid
                  ? 'Kiểm tra danh sách người ở theo sức chứa của phòng.'
                  : allConfirmed
                    ? `Đã hoàn tất thông tin ${completedCount}/${people.length} người ở. Sẵn sàng tạo bản nháp hợp đồng.`
                    : `Xác minh CCCD của ${personLabel(pendingPerson)} để tiếp tục.`}
            </Text>
            <Button
              mode="contained"
              icon="arrow-right"
              loading={busy}
              buttonColor={s.blue}
              textColor="#FFFFFF"
              contentStyle={styles.footerButtonContent}
              style={styles.footerButton}
              disabled={
                !roomValid || !peopleValid || !allConfirmed || busy || recognizing || preview
              }
              onPress={() => {
                if (!roomValid || !peopleValid) return;
                const representativePerson = people.find((p) => p.key === representative)!;
                const ids =
                  mode === 'individual'
                    ? [representativePerson.residentId!]
                    : people.map((p) => p.residentId!);
                setContractInput({
                  roomId: scope.room,
                  representativeResidentId: representativePerson.residentId!,
                  residentIds: ids,
                });
                setContractOpen(true);
                resetScroll();
              }}
            >
              Tiếp tục tạo hợp đồng
            </Button>
          </View>
        )}
      </WorkspaceFooter>
      {contractInput && (
        <MainDraftScreen
          key={`${contractInput.roomId}:${contractInput.representativeResidentId}:${contractInput.residentIds.join(',')}`}
          {...contractInput}
          initialId={mainDraftId || undefined}
          onSaved={setMainDraftId}
          visible={contractOpen}
          persistRoute={false}
          onPrevious={() => {
            setContractOpen(false);
            move(2);
          }}
          onCancel={() => go('staff-home')}
          onList={() => openSigning()}
          onReleased={openSigning}
        />
      )}
    </>
  );
}
const styles = StyleSheet.create({
  panel: { borderRadius: 16, padding: 16, gap: 16 },
  summary: { padding: 12, borderRadius: 12, backgroundColor: s.blueSoft, gap: 4 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  identity: { gap: 16 },
  footerContent: { gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  footerHint: { color: '#475569', fontSize: 12, lineHeight: 17 },
  footerButton: { borderRadius: 12 },
  footerButtonContent: { minHeight: 52, flexDirection: 'row-reverse' },
  hidden: { display: 'none' },
});
