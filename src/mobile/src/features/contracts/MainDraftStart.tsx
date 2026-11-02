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

// Standalone entry for already-onboarded Residents. The onboarding handoff supplies these IDs directly.
export function MainDraftStart({
  api,
  onCancel,
  onList,
}: {
  api: ContractClient;
  onCancel: () => void;
  onList: () => void;
}) {
  const [location, setLocation] = useState(''),
    [room, setRoom] = useState(''),
    [representative, setRepresentative] = useState('');
  const [people, setPeople] = useState<string[]>([]),
    [open, setOpen] = useState(false);
  const [draftId, setDraftId] = useState('');
  const [data, setData] = useState<Preparation | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
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
  }, [api, location]);
  if (open)
    return (
      <MainDraftScreen
        initialId={draftId || undefined}
        persistRoute={false}
        onSaved={setDraftId}
        roomId={room}
        representativeResidentId={representative}
        residentIds={people}
        onCancel={() => setOpen(false)}
        onList={onList}
      />
    );
  const residents = data?.residents.filter((r) => r.roomId === room && r.verified) ?? [];
  return (
    <Box>
      <Heading
        title="Tạo hợp đồng thuê"
        detail="Chọn hồ sơ đã hoàn tất tiếp nhận. Không cần tài khoản Tenant để lưu nháp."
      />
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
      <ChoiceField
        label="Cơ sở được phân công"
        value={location}
        options={data?.locations ?? []}
        disabled={loading || !!draftId}
        onChange={(value) => {
          setLocation(value);
          setRoom('');
          setPeople([]);
          setRepresentative('');
        }}
      />
      <ChoiceField
        label="Phòng"
        value={room}
        options={data?.rooms ?? []}
        disabled={loading || !!draftId || !location}
        onChange={(value) => {
          setRoom(value);
          setPeople([]);
          setRepresentative('');
        }}
      />
      {!!room && !residents.length && (
        <Text>Phòng chưa có hồ sơ đã xác minh. Hoàn tất tiếp nhận trước khi lập hợp đồng.</Text>
      )}
      {residents.map((person) => (
        <Checkbox.Item
          key={person.id}
          label={person.label}
          status={people.includes(person.id) ? 'checked' : 'unchecked'}
          disabled={!!draftId}
          onPress={() => {
            setPeople((before) =>
              before.includes(person.id)
                ? before.filter((id) => id !== person.id)
                : [...before, person.id],
            );
            if (representative === person.id) setRepresentative('');
          }}
        />
      ))}
      <ChoiceField
        label="Người đại diện hợp đồng"
        value={representative}
        options={residents.filter((r) => people.includes(r.id) && r.residentType !== 'CoOccupant')}
        disabled={loading || !!draftId}
        onChange={setRepresentative}
      />
      <Button
        contentStyle={{ minHeight: 48 }}
        mode="contained"
        disabled={loading || !room || !people.length || !people.includes(representative)}
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
