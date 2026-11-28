import { useFeedbackState } from '../../lib/useFeedbackState';
import { ContractNotice } from './ContractNotice';
import React, { useEffect, useState } from 'react';
import { Button, Checkbox, Text } from 'react-native-paper';
import {
  type ContractClient,
  type Preparation,
  contractError,
} from '../../../../../packages/client-core/src/contracts';
import { Box, Heading } from '../../components/WorkspaceKit';
import { ChoiceField } from '../../components/WorkflowControls';
import { MainDraftScreen } from './MainDraftScreen';
import { router } from 'expo-router';
import { HoldingMainStart } from './HoldingMainStart';
import { RoomCapacityFilter } from './RoomCapacityFilter';

// Standalone entry for already-onboarded Residents. The onboarding handoff supplies these IDs directly.
export function MainDraftStart({
  api,
  onCancel,
  onList,
  onReleased,
  owner = false,
  onSaved,
}: {
  api: ContractClient;
  onCancel: () => void;
  onList: () => void;
  onReleased?: (id: string) => void;
  owner?: boolean;
  onSaved?: (id: string) => void;
}) {
  const [location, setLocation] = useState(''),
    [room, setRoom] = useState(''),
    [representative, setRepresentative] = useState('');
  const [people, setPeople] = useState<string[]>([]),
    [open, setOpen] = useState(false);
  const [draftId, setDraftId] = useState('');
  const [mode, setMode] = useState<'individual' | 'family'>('individual');
  const [data, setData] = useState<Preparation | null>(null),
    [error, setError] = useFeedbackState('warning', false),
    [loading, setLoading] = useState(true);
  const [minimumCapacity, setMinimumCapacity] = useState('');
  const [capacityResult, setCapacityResult] = useState<{
    location: string;
    values: Map<string, number>;
    failed?: boolean;
  }>();
  useEffect(() => {
    if (!location) return;
    const controller = new AbortController();
    void api.rooms(location, controller.signal).then(
      (rooms) => {
        if (!controller.signal.aborted)
          setCapacityResult({
            location,
            values: new Map(rooms.map((item) => [item.id, item.capacity ?? 0])),
          });
      },
      () => {
        if (!controller.signal.aborted)
          setCapacityResult({ location, values: new Map(), failed: true });
      },
    );
    return () => controller.abort();
  }, [api, location]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        const result = await api.preparation(location, controller.signal);
        if (controller.signal.aborted) return;
        setData(result);
        if (!location && result.locations.length === 1) setLocation(result.locations[0].id);
      } catch (e) {
        if (!controller.signal.aborted) setError(contractError(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [api, location, setError]);
  if (open)
    return (
      <MainDraftScreen
        onReleased={onReleased}
        initialId={draftId || undefined}
        persistRoute={false}
        onSaved={(next) => {
          setDraftId(next);
          if (owner) {
            onSaved?.(next);
            router.setParams({ contractId: next, mainDraftId: '', roomId: '' });
          }
        }}
        roomId={room}
        representativeResidentId={representative}
        residentIds={people}
        onCancel={() => setOpen(false)}
        onList={onList}
      />
    );
  const residents = data?.residents.filter((r) => r.roomId === room && r.verified) ?? [];
  const capacity = capacityResult?.location === location ? capacityResult : undefined;
  const roomOptions = (data?.rooms ?? [])
    .filter(
      (item) =>
        !Number(minimumCapacity) || (capacity?.values.get(item.id) ?? 0) >= Number(minimumCapacity),
    )
    .map((item) => {
      const size = capacity?.values.get(item.id);
      return { ...item, label: size ? `${item.label} · ${size} người` : item.label };
    });
  function chooseRoom(value: string) {
    setRoom(value);
    setPeople([]);
    setRepresentative('');
  }
  const capacityFilter = (
    <RoomCapacityFilter
      value={minimumCapacity}
      disabled={loading || !!draftId || !capacity || !!capacity.failed}
      onChange={(value) => {
        setMinimumCapacity(value);
        if (room && Number(value) > (capacity?.values.get(room) ?? 0)) chooseRoom('');
      }}
    />
  );
  const roomFields = (
    <>
      <ChoiceField
        label="Cơ sở được phân công"
        value={location}
        options={data?.locations ?? []}
        disabled={loading || !!draftId}
        onChange={(value) => {
          setLocation(value);
          setMinimumCapacity('');
          chooseRoom('');
        }}
      />
      {capacityFilter}
      {capacity?.failed && <Text>Chưa tải được sức chứa. Bạn vẫn có thể chọn phòng.</Text>}
      {!!Number(minimumCapacity) && !roomOptions.length && (
        <Text>Không có phòng phù hợp sức chứa đã nhập.</Text>
      )}
      <ChoiceField
        label="Phòng"
        value={room}
        options={roomOptions}
        disabled={loading || !!draftId || !location}
        onChange={chooseRoom}
      />
    </>
  );
  if (data?.rooms.find((r) => r.id === room)?.status === 'OnHold')
    return (
      <Box>
        <Heading title="Tạo hợp đồng từ phòng đang giữ chỗ" />
        {roomFields}
        <HoldingMainStart
          api={api}
          locationId={location}
          roomId={room}
          onConverted={(id) => onReleased?.(id)}
        />
        <Button onPress={onCancel}>Quay lại danh sách</Button>
      </Box>
    );
  return (
    <Box>
      <Heading
        title="Tạo hợp đồng thuê"
        detail="Chọn hồ sơ đã hoàn tất tiếp nhận. Không cần tài khoản Tenant để lưu nháp."
      />
      {!!error && <ContractNotice message={error} />}
      {roomFields}
      {!!room && !residents.length && (
        <Text>Phòng chưa có hồ sơ đã xác minh. Hoàn tất tiếp nhận trước khi lập hợp đồng.</Text>
      )}
      {owner && (
        <ChoiceField
          label="Bên thuê / đại diện đã xác minh"
          value={representative}
          options={residents.filter((person) => person.residentType === 'Representative')}
          disabled={loading || !!draftId}
          onChange={(next) => {
            setRepresentative(next);
            setPeople(next ? [next] : []);
          }}
        />
      )}
      <ChoiceField
        label="Hình thức thuê"
        value={mode}
        disabled={!!draftId}
        options={[
          { id: 'individual', label: 'Cá nhân' },
          { id: 'family', label: 'Hộ gia đình' },
        ]}
        onChange={(next) => {
          if (next === 'individual' && people.length > 1) {
            setError('Bỏ chọn thành viên trước khi chuyển sang Cá nhân.');
            return;
          }
          setMode(next as 'individual' | 'family');
        }}
      />
      {owner && (
        <Text>
          Mỗi người thuê đại diện lập hợp đồng riêng. Chỉ thêm thành viên cùng ở đã xác nhận vào hợp
          đồng của đại diện này.
        </Text>
      )}
      {(owner ? residents.filter((person) => person.residentType === 'CoOccupant') : residents).map(
        (person) => (
          <Checkbox.Item
            key={person.id}
            label={person.label}
            status={people.includes(person.id) ? 'checked' : 'unchecked'}
            disabled={
              !!draftId ||
              (owner && !representative) ||
              (mode === 'individual' &&
                !people.includes(person.id) &&
                (owner || people.length >= 1))
            }
            onPress={() => {
              setPeople((before) =>
                before.includes(person.id)
                  ? before.filter((id) => id !== person.id)
                  : [...before, person.id],
              );
              if (representative === person.id) setRepresentative('');
            }}
          />
        ),
      )}
      {!owner && (
        <ChoiceField
          label="Người đại diện hợp đồng"
          value={representative}
          options={residents.filter(
            (r) => people.includes(r.id) && r.residentType !== 'CoOccupant',
          )}
          disabled={loading || !!draftId}
          onChange={setRepresentative}
        />
      )}
      <Button
        contentStyle={{ minHeight: 48 }}
        mode="contained"
        disabled={
          loading || !room || !representative || !people.length || !people.includes(representative)
        }
        onPress={() => setOpen(true)}
      >
        {draftId ? 'Mở lại hợp đồng nháp' : 'Tiếp tục tạo hợp đồng nháp'}
      </Button>
      <Button contentStyle={{ minHeight: 48 }} onPress={onCancel}>
        Quay lại danh sách
      </Button>
    </Box>
  );
}
