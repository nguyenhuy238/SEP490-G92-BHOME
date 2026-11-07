import { useFeedbackState } from '../lib/useFeedbackState';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';
import { Action, Box, Heading, Pill, Row, ui } from '../components/WorkspaceKit';
import { ChoiceField } from '../components/WorkflowControls';
import { OnboardingStepper } from '../components/OnboardingStepper';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useSession } from '../lib/SessionProvider';
import { captureService } from '../services/captureService';
import { errorMessage } from '../lib/api';
import { useCaptureScope } from '../features/onboarding/useCaptureScope';
import { IdentityPersonCard } from '../features/onboarding/IdentityPersonCard';
import { IdentityWizard } from '../features/onboarding/IdentityWizard';
import { OnboardingPeopleStep } from '../features/onboarding/OnboardingPeopleStep';
import {
  allIdentitiesConfirmed,
  identityStatusLabels,
  onboardingSteps,
  peopleReady,
  residentType,
  type HouseholdMode,
  type IdentityStatus,
  type OnboardingPerson,
} from '../features/onboarding/onboarding';
import { staffColors as s } from '../theme/theme';

const blankPerson = (key: string): OnboardingPerson => ({ key, label: '', status: 'unscanned' });
export function OnboardingScreen() {
  const { residentId } = useLocalSearchParams<{ residentId?: string }>();
  const { preview, go, resetScroll, registerExitGuard, requestNavigation } = useWorkspace();
  const { api } = useSession();
  const scope = useCaptureScope({ autoSelectAssignedLocation: true });
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<HouseholdMode>('family');
  const [people, setPeople] = useState<OnboardingPerson[]>([blankPerson('person-1')]);
  const [representative, setRepresentative] = useState('person-1');
  const [editing, setEditing] = useState('person-1');
  const [identityKey, setIdentityKey] = useState('person-1');
  const [identityOpen, setIdentityOpen] = useState(!!residentId);
  const [identityMode, setIdentityMode] = useState<'capture' | 'verify'>('capture');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFeedbackState();
  const [finished, setFinished] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const serial = useRef(1);
  const lock = useRef(false);
  const alive = useRef(true);
  const dirty =
    !finished &&
    !discarded &&
    (!!residentId ||
      !!scope.room ||
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
    }, [registerExitGuard, disablePrevention]),
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
      before.map((p) => (p.key === key && p.status !== status ? { ...p, status } : p)),
    );
  const move = (next: number) => {
    setError('');
    setStep(next);
    resetScroll();
  };
  const roomValid =
    !!scope.location &&
    !!scope.room &&
    !scope.loading &&
    !scope.error &&
    scope.locations.some((l) => l.id === scope.location) &&
    scope.rooms.some((r) => r.id === scope.room);
  const peopleValid = peopleReady(people, representative);
  const allConfirmed = allIdentitiesConfirmed(people);
  const created = people.some((p) => !!p.residentId);
  const confirmedCount = people.filter((p) => p.status === 'confirmed').length;
  const recognizing = people.some((p) => p.status === 'recognizing');
  const openIdentity = async (
    person: OnboardingPerson,
    entryMode: 'capture' | 'verify' = person.status === 'pending' ? 'verify' : 'capture',
  ) => {
    if (lock.current || recognizing) return;
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
      if (alive.current) setError(errorMessage(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  if (residentId)
    return (
      <>
        <Heading title="Xác minh CCCD người ở" />
        <Action onPress={() => setIdentityOpen(true)}>
          {finished ? 'Xem trạng thái' : 'Tiếp tục xác minh'}
        </Action>
        <IdentityWizard
          residentId={residentId}
          preview={preview}
          modal
          visible={identityOpen}
          personLabel="Hồ sơ người ở"
          mode={identityMode}
          onModeChange={setIdentityMode}
          onDismiss={() => setIdentityOpen(false)}
          onConfirmed={() => {
            dirtyRef.current = false;
            setFinished(true);
            setIdentityOpen(false);
          }}
          onCancel={() => go('rooms')}
          onComplete={() => go('rooms')}
        />
        <Button onPress={() => go('rooms')}>Về danh sách người ở</Button>
      </>
    );
  if (discarded)
    return (
      <Box>
        <Text>Đã rời phiên tiếp nhận. Những hồ sơ đã xác nhận vẫn được giữ lại.</Text>
        <Action onPress={() => go('rooms')}>Xem người ở</Action>
      </Box>
    );
  const completed = [
    ...(roomValid ? ['room'] : []),
    ...(step >= 2 && peopleValid ? ['people'] : []),
    ...(allConfirmed ? ['identity'] : []),
    ...(finished ? ['review'] : []),
  ];
  return (
    <>
      <Heading
        title={step === 1 ? 'Thông tin người ở' : 'Tiếp nhận khách thuê'}
        detail={
          step === 1
            ? 'Bước 2/4 – Thêm người thuê'
            : 'Chuẩn bị hồ sơ người ở, kiểm tra và xác nhận thông tin.'
        }
      />
      <OnboardingStepper
        steps={onboardingSteps}
        current={step}
        completed={completed}
        comfortable={step === 1}
        showCaption={step !== 1}
      />
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
            options={scope.rooms}
            disabled={created || !scope.location || scope.loading}
            onChange={scope.setRoom}
          />
          {scope.loading && <ActivityIndicator accessibilityLabel="Đang tải danh sách phòng" />}
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
          {!!scope.location && !scope.loading && !scope.error && !scope.rooms.length && (
            <Text>Chưa có phòng để lựa chọn tại cơ sở này.</Text>
          )}
          {roomValid && (
            <View style={styles.summary}>
              <Text variant="titleMedium">
                Phòng {scope.rooms.find((r) => r.id === scope.room)?.label}
              </Text>
              <Text style={ui.muted}>
                {scope.locations.find((l) => l.id === scope.location)?.label}
              </Text>
            </View>
          )}
          {created && (
            <Text style={ui.muted}>
              Phòng được giữ nguyên cho các hồ sơ đã tạo trong phiên này.
            </Text>
          )}
          <Action disabled={!roomValid} onPress={() => move(1)}>
            Tiếp tục
          </Action>
        </Box>
      )}
      {step === 1 && (
        <OnboardingPeopleStep
          mode={mode}
          people={people}
          representative={representative}
          editing={editing}
          created={created}
          canContinue={peopleValid}
          backDisabled={busy || recognizing}
          onModeChange={setMode}
          onEdit={setEditing}
          onRepresentative={setRepresentative}
          onAdd={() => {
            const key = `person-${++serial.current}`;
            setPeople((before) => [...before, blankPerson(key)]);
            setEditing(key);
          }}
          onDelete={(key) => {
            const next = people.filter((p) => p.key !== key);
            setPeople(next);
            setEditing(next[0].key);
            if (representative === key) setRepresentative(next[0].key);
          }}
          onLabelChange={(key, label) => patch(key, { label })}
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
        {people.map((person, index) => (
          <IdentityPersonCard
            key={person.key}
            person={person}
            label={person.label || `Người ở ${index + 1}`}
            role={person.key === representative ? 'Người đại diện' : 'Thành viên'}
            disabled={busy || recognizing}
            onScan={() => {
              const progress = person.captureProgress;
              const both = progress?.front === 'recognized' && progress?.back === 'recognized';
              const started =
                progress && (progress.front !== 'unscanned' || progress.back !== 'unscanned');
              void openIdentity(
                person,
                both || (!started && person.status === 'pending') ? 'verify' : 'capture',
              );
            }}
            onManual={() => void openIdentity(person, 'verify')}
          />
        ))}
        {busy && <ActivityIndicator accessibilityLabel="Đang tạo hồ sơ người ở" />}
        {people
          .filter((p) => !!p.residentId)
          .map((person) => (
            <IdentityWizard
              key={person.key}
              residentId={person.residentId!}
              preview={preview}
              active={step === 2 && identityKey === person.key}
              modal
              visible={identityOpen && identityKey === person.key && step === 2}
              personLabel={person.label}
              mode={identityMode}
              onModeChange={setIdentityMode}
              onDismiss={() => setIdentityOpen(false)}
              onStatusChange={(status) => changeStatus(person.key, status)}
              onCaptureProgress={(captureProgress) => patch(person.key, { captureProgress })}
              onConfirmed={() => {
                changeStatus(person.key, 'confirmed');
                setIdentityOpen(false);
                resetScroll();
              }}
              onComplete={() => {
                const next = people.find((p) => p.status !== 'confirmed' && p.key !== person.key);
                if (next) void openIdentity(next);
                else move(3);
              }}
              onCancel={() => move(1)}
            />
          ))}
        {!allConfirmed && (
          <Text variant="bodySmall" style={ui.muted}>
            Xác nhận thông tin của từng người ở trước khi hoàn tất tiếp nhận.
          </Text>
        )}
        <Action disabled={!allConfirmed || busy} onPress={() => move(3)}>
          Kiểm tra và hoàn tất
        </Action>
      </View>
      {step === 3 && (
        <>
          <Box style={styles.panel}>
            <Heading title={finished ? 'Đã hoàn tất thông tin người thuê' : 'Kiểm tra lần cuối'} />
            {finished && <Icon source="check-circle-outline" size={44} color={s.green} />}
            <Text>Cơ sở: {scope.locations.find((l) => l.id === scope.location)?.label}</Text>
            <Text>Phòng: {scope.rooms.find((r) => r.id === scope.room)?.label}</Text>
            <Text>Hình thức: {mode === 'family' ? 'Hộ gia đình' : 'Cá nhân / Nhóm bạn'}</Text>
            <Text>Người đại diện: {people.find((p) => p.key === representative)?.label}</Text>
            {people.map((p) => (
              <Row key={p.key} spread>
                <Text style={ui.grow}>{p.label}</Text>
                <Pill tone={p.status === 'confirmed' ? 'green' : 'amber'}>
                  {identityStatusLabels[p.status]}
                </Pill>
              </Row>
            ))}
            <Text variant="bodySmall" style={ui.muted}>
              {preview
                ? 'Đây là bản xem trước, không lưu hồ sơ.'
                : 'Thông tin CCCD được lưu riêng sau từng lần xác nhận. Hợp đồng được chuẩn bị ở bước tiếp theo.'}
            </Text>
            {!finished && (
              <Action
                disabled={!allConfirmed || busy}
                onPress={() => {
                  dirtyRef.current = false;
                  setFinished(true);
                }}
              >
                Hoàn tất tiếp nhận
              </Action>
            )}
            {finished && (
              <>
                <Text>
                  {preview
                    ? 'Đã hoàn tất bản xem trước.'
                    : 'Thông tin từng người đã được xác nhận và lưu.'}
                </Text>
                {!preview && (
                  <>
                    <Action
                      onPress={() =>
                        go('prepare-contract', {
                          roomId: scope.room,
                          representativeResidentId: people.find((p) => p.key === representative)!
                            .residentId!,
                          residentIds: JSON.stringify(
                            mode === 'individual'
                              ? [people.find((p) => p.key === representative)!.residentId!]
                              : people.map((p) => p.residentId!),
                          ),
                        })
                      }
                    >
                      Tiếp tục tạo hợp đồng
                    </Action>
                    {mode === 'individual' &&
                      people
                        .filter((p) => p.key !== representative)
                        .map((person) => (
                          <Action
                            key={person.key}
                            secondary
                            onPress={() =>
                              go('prepare-contract', {
                                roomId: scope.room,
                                representativeResidentId: person.residentId!,
                                residentIds: JSON.stringify([person.residentId!]),
                              })
                            }
                          >
                            Tạo hợp đồng riêng cho {person.label}
                          </Action>
                        ))}
                  </>
                )}
                <Button onPress={() => go('rooms')}>Xem danh sách người ở</Button>
              </>
            )}
          </Box>
          {!finished && <Button onPress={() => move(1)}>Quay lại chỉnh sửa người ở</Button>}
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      {step > 0 && step !== 1 && !finished && (
        <Button disabled={busy || recognizing} icon="arrow-left" onPress={() => move(step - 1)}>
          Quay lại
        </Button>
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
