import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { Action, Box, Filters, Heading, InfoRow, Pill, ui } from '../components/WorkspaceKit';
import { ChoiceField, Input } from '../components/WorkflowControls';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useSession } from '../lib/SessionProvider';
import { captureService } from '../services/captureService';
import { errorMessage } from '../lib/api';
import { inputDate } from '../lib/identity';
import { useCaptureScope } from '../features/onboarding/useCaptureScope';
import { IdentityWizard } from '../features/onboarding/IdentityWizard';

interface Participant {
  key: string;
  label: string;
  type: 0 | 1;
  phone: string;
  email: string;
  start: string;
  residentId?: string;
  verified: boolean;
}
const blank = (key: string, type: 0 | 1): Participant => ({
  key,
  type,
  label: '',
  phone: '',
  email: '',
  start: '',
  verified: false,
});
export function OnboardingScreen() {
  const { residentId } = useLocalSearchParams<{ residentId?: string }>();
  const { preview, go, resetScroll } = useWorkspace();
  const { api } = useSession();
  const scope = useCaptureScope();
  const [model, setModel] = useState('Hộ gia đình / Nhóm');
  const [people, setPeople] = useState<Participant[]>([blank('person-1', 0)]);
  const [selected, setSelected] = useState('person-1');
  const [identityFor, setIdentityFor] = useState<string | null>(residentId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const serial = useRef(1);
  const alive = useRef(true);
  const person = people.find((item) => item.key === selected)!;
  useEffect(() => {
    alive.current = true;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active')
        setPeople((before) => before.map((item) => ({ ...item, phone: '', email: '', start: '' })));
    });
    return () => {
      alive.current = false;
      sub.remove();
    };
  }, []);
  const update = (key: keyof Participant, value: string) =>
    setPeople((before) =>
      before.map((item) => (item.key === selected ? { ...item, [key]: value } : item)),
    );
  const openIdentity = async () => {
    if (lock.current) return;
    if (!scope.location || !scope.room || !person.label.trim()) {
      setError('Chọn cơ sở, phòng và nhập nhãn hồ sơ không chứa số CCCD.');
      return;
    }
    if (person.label.trim().length > 150) {
      setError('Nhãn hồ sơ tối đa 150 ký tự.');
      return;
    }
    if (person.start) {
      try {
        inputDate(person.start);
      } catch {
        setError('Ngày bắt đầu ở phải hợp lệ theo dd/MM/yyyy.');
        return;
      }
    }
    if (
      (person.phone && !/^\+?\d[\d .-]{7,14}$/.test(person.phone)) ||
      (person.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email))
    ) {
      setError('Kiểm tra số điện thoại và email liên hệ.');
      return;
    }
    setError('');
    setBusy(true);
    lock.current = true;
    try {
      const id =
        person.residentId ??
        (preview
          ? `sample-${person.key}`
          : api
            ? (
                await captureService(api).createResident(
                  scope.room,
                  person.label.trim(),
                  person.type,
                )
              ).id
            : null);
      if (!id) throw new Error('No API');
      if (!alive.current) return;
      setPeople((before) =>
        before.map((item) => (item.key === selected ? { ...item, residentId: id } : item)),
      );
      setIdentityFor(id);
      resetScroll();
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  if (identityFor)
    return (
      <IdentityWizard
        key={identityFor}
        residentId={identityFor}
        preview={preview}
        onCancel={() => {
          setIdentityFor(null);
          resetScroll();
        }}
        onComplete={() => {
          setPeople((before) =>
            before.map((item) =>
              item.residentId === identityFor ? { ...item, verified: true } : item,
            ),
          );
          setIdentityFor(null);
          resetScroll();
          scope.reload();
        }}
      />
    );
  return (
    <>
      <Heading
        title="Tiếp nhận Tenant & Người cùng ở"
        detail="UC-13 • Chỉ trong cơ sở Staff được phân công"
      />
      <Pill>1. Chọn phòng → 2. CCCD → 3. Staff xác nhận</Pill>
      <Box>
        <ChoiceField
          label="Cơ sở được phân công *"
          value={scope.location}
          options={scope.locations}
          onChange={(id) => {
            if (people.some((item) => item.residentId))
              setError('Đã tạo hồ sơ; kết thúc nhóm này trước khi đổi cơ sở.');
            else scope.selectLocation(id);
          }}
        />
        <ChoiceField
          label="Phòng *"
          value={scope.room}
          options={scope.rooms}
          disabled={!scope.location || people.some((item) => item.residentId)}
          onChange={scope.setRoom}
        />
        {scope.loading && <ActivityIndicator />}
        {!!scope.error && (
          <>
            <Text style={ui.red}>{scope.error}</Text>
            <Button onPress={scope.reload}>Thử tải lại</Button>
          </>
        )}
        {!scope.loading && !scope.locations.length && (
          <Text>Chưa có cơ sở được phép truy cập. Liên hệ Owner phân công.</Text>
        )}
        <Text variant="bodySmall" style={ui.muted}>
          Danh sách API hiện chỉ xác nhận phạm vi phòng, chưa cung cấp trạng thái đủ điều kiện cho
          hợp đồng. Tạo hồ sơ không giữ chỗ hoặc kích hoạt thuê.
        </Text>
      </Box>
      <Filters
        options={['Hộ gia đình / Nhóm', 'Từng cá nhân']}
        selected={model}
        onChange={(value) => {
          if (people.length > 1) setError('Hoàn tất hoặc xóa người cùng ở trước khi đổi mô hình.');
          else setModel(value);
        }}
      />
      <Box>
        <Heading
          title="Danh sách người ở"
          detail={`${people.filter((item) => item.verified).length}/${people.length} đã xác nhận`}
        />
        {people.map((item) => (
          <InfoRow
            key={item.key}
            icon={item.verified ? 'account-check-outline' : 'account-outline'}
            title={`${item.type === 0 ? 'Đại diện' : 'Cùng ở'} • ${item.label || 'Chưa nhập nhãn'}`}
            detail={
              item.verified
                ? 'Thông tin đã được đối chiếu'
                : item.residentId
                  ? 'Hồ sơ đã tạo • Chờ xác nhận CCCD'
                  : 'Bản nháp chưa tạo hồ sơ'
            }
            onPress={() => setSelected(item.key)}
          />
        ))}
        {model === 'Hộ gia đình / Nhóm' && (
          <Button
            icon="account-plus-outline"
            onPress={() => {
              const key = `person-${++serial.current}`;
              setPeople((before) => [...before, blank(key, 1)]);
              setSelected(key);
            }}
          >
            Thêm người cùng ở
          </Button>
        )}
        {model === 'Từng cá nhân' && (
          <Button
            icon="account-plus-outline"
            onPress={() => {
              const key = `person-${++serial.current}`;
              setPeople((before) => [...before, blank(key, 0)]);
              setSelected(key);
            }}
          >
            Thêm người thuê cá nhân
          </Button>
        )}
      </Box>
      <Box>
        <Heading title={person.type === 0 ? 'Hồ sơ người đại diện' : 'Hồ sơ người cùng ở'} />
        <Input
          label="Nhãn hồ sơ không chứa thông tin CCCD *"
          value={person.label}
          onChange={(value) => update('label', value)}
          disabled={!!person.residentId}
        />
        <Input
          label="Điện thoại liên hệ (nháp)"
          value={person.phone}
          onChange={(value) => update('phone', value)}
        />
        <Input
          label="Email nếu có (nháp)"
          value={person.email}
          onChange={(value) => update('email', value)}
        />
        <Input
          label="Ngày bắt đầu ở dd/MM/yyyy (nháp)"
          value={person.start}
          onChange={(value) => update('start', value)}
        />
        <Text variant="bodySmall" style={ui.muted}>
          API hiện lưu nhãn hồ sơ, loại người ở và định danh được xác nhận. Điện thoại, email, ngày
          bắt đầu ở và liên kết hộ gia đình mới là dữ liệu form trong bộ nhớ, chưa có API lưu.
        </Text>
        {person.verified ? (
          <Pill tone="green">Đã hoàn tất xác nhận thông tin</Pill>
        ) : (
          <Action icon="card-account-details-outline" onPress={() => void openIdentity()}>
            {busy ? 'Đang tạo hồ sơ…' : 'Tiếp tục Chụp / Xác nhận CCCD'}
          </Action>
        )}
        {person.type === 1 && !person.residentId && (
          <Button
            textColor="#ba1a1a"
            onPress={() => {
              setPeople((before) => before.filter((item) => item.key !== person.key));
              setSelected(people[0].key);
            }}
          >
            Xóa bản nháp người cùng ở
          </Button>
        )}
      </Box>
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      <Action secondary onPress={() => go('rooms')}>
        Danh sách phòng & Người ở đã tạo
      </Action>
      <Button onPress={() => go('staff-home')}>Về ca trực</Button>
    </>
  );
}
