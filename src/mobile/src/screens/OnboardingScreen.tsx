import { useFeedbackState } from '../lib/useFeedbackState';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';
import { Action, Box, Heading, ui } from '../components/WorkspaceKit';
import { ChoiceField } from '../components/WorkflowControls';
import { MainContractProgress } from '../features/contracts/MainContractProgress';
import { MainDraftScreen } from '../features/contracts/MainDraftScreen';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useSession } from '../lib/SessionProvider';
import { captureService } from '../services/captureService';
import { errorMessage, MobileApiError } from '../lib/api';
import { useCaptureScope } from '../features/onboarding/useCaptureScope';
import { IdentityPersonCard } from '../features/onboarding/IdentityPersonCard';
import { IdentityWizard } from '../features/onboarding/IdentityWizard';
import { ResidentProfile } from '../features/onboarding/ResidentProfile';
import { OnboardingPeopleStep } from '../features/onboarding/OnboardingPeopleStep';
import { HouseholdMemberEditor, memberReady } from '../features/onboarding/HouseholdMemberEditor';
import {
  householdClient,
  type HouseholdView,
} from '../../../../packages/client-core/src/households';
import { randomUUID } from '../lib/randomUUID';
import { inputDate } from '../lib/identity';
import { HoldingMainStart } from '../features/contracts/HoldingMainStart';
import { contractClient, contractError } from '../../../../packages/client-core/src/contracts';
import {
  allIdentitiesConfirmed,
  peopleReady,
  residentType,
  type HouseholdMode,
  type IdentityStatus,
  type OnboardingPerson,
} from '../features/onboarding/onboarding';
import { staffColors as s } from '../theme/theme';

const blankPerson = (key: string): OnboardingPerson => ({
  key,
  label: `Người ở ${key.replace('person-', '')}`,
  email: '',
  status: 'unscanned',
});
export function OnboardingScreen() {
  const { residentId, locationId } = useLocalSearchParams<{
    residentId?: string;
    locationId?: string;
  }>();
  return residentId ? (
    <ResidentProfile key={residentId} residentId={residentId} locationId={locationId} />
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
  const [householdVersion, setHouseholdVersion] = useState(0);
  const [mainDraftId, setMainDraftId] = useState('');
  const householdRequest = useRef(randomUUID());
  const savedHousehold = useRef<HouseholdView | null>(null);
  const household = useMemo(
    () => (api ? householdClient((path, init, type) => api.request(path, init, type)) : null),
    [api],
  );
  const invalidateHousehold = () => {
    householdRequest.current = randomUUID();
    savedHousehold.current = null;
  };
  const [identityKey, setIdentityKey] = useState('person-1');
  const [identityOpen, setIdentityOpen] = useState(false);
  const [identityMode, setIdentityMode] = useState<'capture' | 'verify'>('capture');
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
    (!!scope.room ||
      (scope.locations.length > 1 && !!scope.location) ||
      people.some((p) => !!p.label || !!p.residentId));
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  const disablePrevention = usePreventRemove(dirty, ({ repeat }) => requestNavigation(repeat));
  useFocusEffect(
    useCallback(() => {
      const unregister = registerExitGuard(
        () => dirtyRef.current,
        () => {
          dirtyRef.current = false;
          setDiscarded(true);
          disablePrevention();
        },
      );
      return () => {
        setIdentityOpen(false);
        unregister();
      };
    }, [registerExitGuard, disablePrevention, setIdentityOpen]),
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const patch = (key: string, changes: Partial<OnboardingPerson>) =>
    setPeople((before) => before.map((p) => (p.key === key ? { ...p, ...changes } : p)));
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
  const allConfirmed =
    mode === 'family'
      ? people.every((p) =>
          p.key === representative ? !!p.residentId && p.status === 'confirmed' : memberReady(p),
        )
      : allIdentitiesConfirmed(people);
  const created = people.some((p) => !!p.residentId);
  const confirmedCount = people.filter((p) => p.status === 'confirmed').length;
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
          (p) =>
            (mode !== 'family' || p.key === representative) &&
            p.status !== 'confirmed' &&
            (!p.residentId || !verified.has(p.residentId)),
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
      const id = preview
        ? `sample-${person.key}`
        : api
          ? (
              await captureService(api).createResident(
                scope.room,
                person.label.trim(),
                residentType(mode, person.key, representative),
              )
            ).id
          : null;
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
            <ChoiceField
              label="Phòng *"
              value={scope.room}
              options={selectableRooms.map((room) => ({
                ...room,
                label:
                  room.remainingCapacity == null
                    ? room.label
                    : `${room.label} · ${room.remainingCapacity === 0 ? 'Đã đủ người' : `Còn ${room.remainingCapacity} chỗ`}`,
              }))}
              disabled={created || !scope.location || scope.loading}
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
                onConverted={(id) => {
                  dirtyRef.current = false;
                  setFinished(true);
                  go('signing', { contractId: id, mainDraftId: '', roomId: '' });
                }}
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
              invalidateHousehold();
              const key = `person-${++serial.current}`;
              setPeople((before) =>
                before.length >= maxPeople ? before : [...before, blankPerson(key)],
              );
              setEditing(key);
            }}
            onDelete={(key) => {
              invalidateHousehold();
              const next = people.filter((p) => p.key !== key);
              setPeople(next);
              setEditing(next[0].key);
              if (representative === key) setRepresentative(next[0].key);
            }}
            onLabelChange={(key, label) => patch(key, { label })}
            onEmailChange={(key, email) => patch(key, { email })}
            onBack={() => move(0)}
            onContinue={() => move(2)}
          />
        )}
        <View
          style={step === 2 ? styles.identity : styles.hidden}
          accessibilityElementsHidden={step !== 2}
          importantForAccessibility={step === 2 ? 'auto' : 'no-hide-descendants'}
        >
          <Heading
            title="CCCD của người ở"
            detail={`Đã xác nhận ${confirmedCount}/${people.length} người ở`}
          />
          {people
            .filter((person) => mode !== 'family' || person.key === representative)
            .map((person, index) => (
              <IdentityPersonCard
                key={person.key}
                person={person}
                label={person.label || `Người ở ${index + 1}`}
                role={person.key === representative ? 'Người đại diện' : 'Thành viên'}
                disabled={busy || recognizing || !!person.creationUncertain}
                onScan={() => {
                  const progress = person.captureProgress;
                  const both = progress?.front === 'recognized' && progress?.back === 'recognized';
                  const started =
                    progress && (progress.front !== 'unscanned' || progress.back !== 'unscanned');
                  if (person.status === 'confirmed') return;
                  void openIdentity(
                    person,
                    both || (!started && person.status === 'pending') ? 'verify' : 'capture',
                  );
                }}
                onManual={() => void openIdentity(person, 'verify')}
              />
            ))}
          {mode === 'family' &&
            people
              .filter((p) => p.key !== representative && p.key === editing)
              .map((person) => (
                <HouseholdMemberEditor
                  key={person.key}
                  person={person}
                  disabled={busy}
                  onChange={(member) => {
                    invalidateHousehold();
                    patch(person.key, { member, label: member.fullName || person.label });
                  }}
                />
              ))}
          {busy && <ActivityIndicator accessibilityLabel="Đang tạo hồ sơ người ở" />}
          {people
            .filter((p) => !!p.residentId && (mode !== 'family' || p.key === representative))
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
                personLabel={person.label}
                mode={identityMode}
                onModeChange={setIdentityMode}
                onDismiss={() => setIdentityOpen(false)}
                onStatusChange={(status) => changeStatus(person.key, status)}
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
          {!allConfirmed && (
            <Text variant="bodySmall" style={ui.muted}>
              Xác nhận thông tin của từng người ở trước khi hoàn tất tiếp nhận.
            </Text>
          )}
          {created && !allConfirmed && !preview && (
            <Button disabled={busy || recognizing} onPress={() => void checkSavedIdentities()}>
              Kiểm tra trạng thái đã lưu
            </Button>
          )}
          {mode === 'individual' && people.length > 1 && (
            <ChoiceField
              label="Người thuê tạo hợp đồng"
              value={representative}
              options={people.map((p) => ({ id: p.key, label: p.label }))}
              onChange={setRepresentative}
              disabled={!allConfirmed || busy}
            />
          )}
          <Action
            disabled={!roomValid || !peopleValid || !allConfirmed || busy || recognizing || preview}
            onPress={async () => {
              if (!roomValid || !peopleValid) return;
              const representativePerson = people.find((p) => p.key === representative)!;
              let ids =
                mode === 'individual'
                  ? [representativePerson.residentId!]
                  : people.map((p) => p.residentId!);
              if (mode === 'family') {
                if (lock.current || !household) return;
                lock.current = true;
                setBusy(true);
                setError('');
                try {
                  const result =
                    savedHousehold.current ??
                    (await household.save(
                      representativePerson.residentId!,
                      people
                        .filter((p) => p.key !== representative)
                        .map((p) => ({
                          clientKey: p.key,
                          residentId: p.residentId,
                          fullName: p.member!.fullName.trim(),
                          dateOfBirth: inputDate(p.member!.dateOfBirth)!,
                          relationship: p.member!.relationship,
                          phone: p.member!.phone || null,
                          citizenNumber: p.member!.citizenNumber || null,
                        })),
                      householdVersion,
                      householdRequest.current,
                    ));
                  savedHousehold.current = result;
                  setHouseholdVersion(result.version);
                  if (result.draftId) setMainDraftId(result.draftId);
                  ids = [
                    representativePerson.residentId!,
                    ...result.members.map((m) => m.residentId),
                  ];
                  setPeople((before) =>
                    before.map((p) => {
                      const member = result.members.find((m) => m.clientKey === p.key);
                      return member
                        ? { ...p, residentId: member.residentId, status: 'confirmed' }
                        : p;
                    }),
                  );
                } catch (e) {
                  setError(contractError(e));
                  return;
                } finally {
                  lock.current = false;
                  setBusy(false);
                }
              }
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
          </Action>
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
                  go('onboarding', {
                    residentId: emailConflict.residentId!,
                    locationId: emailConflict.locationId,
                  })
                }
              >
                Mở hồ sơ đã có tại phòng này
              </Button>
            ) : (
              <Button disabled={busy} onPress={() => go('rooms')}>
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
          <Button onPress={() => go('rooms')}>Kiểm tra danh sách người ở</Button>
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
      {contractInput && (
        <MainDraftScreen
          key={`${contractInput.roomId}:${contractInput.representativeResidentId}:${contractInput.residentIds.join(',')}:${householdVersion}`}
          {...contractInput}
          initialId={mainDraftId || undefined}
          onSaved={setMainDraftId}
          visible={contractOpen}
          persistRoute={false}
          onPrevious={() => {
            setContractOpen(false);
            move(2);
          }}
          onCancel={() => {
            setContractOpen(false);
            resetScroll();
          }}
          onList={() => {
            dirtyRef.current = false;
            setFinished(true);
            go('signing');
          }}
          onReleased={(id) => {
            dirtyRef.current = false;
            setFinished(true);
            go('signing', { contractId: id });
          }}
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
  hidden: { display: 'none' },
});
