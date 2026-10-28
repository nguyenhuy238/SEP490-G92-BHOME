import React, { useEffect, useRef, useState } from 'react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Button, SegmentedButtons, Text } from 'react-native-paper';
import { Field, Page, Select, styles } from '../components/Controls';
import { useSession } from '../lib/SessionProvider';
import { errorMessage, type Named } from '../lib/api';
export default function ResidentScreen() {
  const { locationId } = useLocalSearchParams<{ locationId: string }>();
  const { api, session } = useSession();
  const [rooms, setRooms] = useState<Named[]>([]);
  const [room, setRoom] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState('1');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    if (api && locationId)
      void api
        .request<Named[]>(`/api/v1/capture/locations/${locationId}/rooms`)
        .then(setRooms)
        .catch((e) => setError(errorMessage(e)));
  }, [api, locationId]);
  if (!api || !session) return <Redirect href="/" />;
  return (
    <Page>
      <Text variant="headlineSmall">Thêm hồ sơ cư dân</Text>
      <Select label="Phòng" items={rooms} selected={room} onSelect={setRoom} />
      <Field label="Nhãn hồ sơ (không dùng số CCCD)" value={label} onChange={setLabel} />
      <SegmentedButtons
        value={kind}
        onValueChange={setKind}
        buttons={[
          { value: '0', label: 'Đại diện' },
          { value: '1', label: 'Cùng ở' },
        ]}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Button
        mode="contained"
        disabled={busy || !room || !label.trim()}
        loading={busy}
        onPress={async () => {
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          try {
            const result = await api.json<{ id: string }>('/api/v1/capture/residents', {
              roomId: room,
              displayLabel: label,
              residentType: +kind,
            });
            if (session.roles.includes('Staff'))
              router.replace({ pathname: '/identity', params: { residentId: result.id } });
            else router.back();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        Tạo hồ sơ chờ xác nhận
      </Button>
      <Text>Tạo hồ sơ không kích hoạt hợp đồng hoặc thay đổi trạng thái thuê phòng.</Text>
    </Page>
  );
}
