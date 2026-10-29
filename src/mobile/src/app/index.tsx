import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { Field, Page, Select, styles } from '../components/Controls';
import { errorMessage, type MeterTask, type Named, type Resident } from '../lib/api';
import { useSession } from '../lib/SessionProvider';
export default function Home() {
  const { api, session, ready, baseUrl, login, logout } = useSession();
  const [base, setBase] = useState(baseUrl);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [locations, setLocations] = useState<Named[]>([]);
  const [location, setLocation] = useState('');
  const [residents, setResidents] = useState<Resident[]>([]);
  const [tasks, setTasks] = useState<MeterTask[]>([]);
  const load = useCallback(async () => {
    if (!api) return;
    setError('');
    try {
      const [list, work] = await Promise.all([
        api.request<Named[]>('/api/v1/capture/locations'),
        api.request<MeterTask[]>('/api/v1/capture/meter-tasks'),
      ]);
      setLocations(list);
      setTasks(work);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    if (!api || !location) return;
    let active = true;
    void api
      .request<Resident[]>(`/api/v1/capture/locations/${location}/residents`)
      .then((x) => {
        if (active) setResidents(x);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [api, location]);
  if (!ready)
    return (
      <Page>
        <ActivityIndicator />
      </Page>
    );
  if (!session)
    return (
      <Page>
        <Text variant="headlineMedium">Đăng nhập BHOME</Text>
        <Text>
          Đăng nhập bằng tài khoản Owner hoặc Staff. API phải dùng HTTPS và iPhone đã tin cậy chứng
          chỉ.
        </Text>
        <Field label="Địa chỉ API HTTPS" value={base} onChange={setBase} />
        <Field label="Tên đăng nhập" value={name} onChange={setName} />
        <Field label="Mật khẩu" value={password} onChange={setPassword} secure />
        <Button
          mode="contained"
          loading={busy}
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            setError('');
            try {
              await login(base, name, password);
              setPassword('');
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Đăng nhập
        </Button>
        {!!error && <Text style={styles.error}>{error}</Text>}
      </Page>
    );
  return (
    <Page>
      <Text variant="headlineMedium">BHOME · {session.roles.join(', ')}</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {session.roles.some((r) => r === 'Owner' || r === 'Staff') && (
        <View style={styles.card}>
          <Text variant="titleLarge">Kiểm tra nhận dạng OCR</Text>
          <Text>Chụp CCCD mẫu hoặc đồng hồ và xem kết quả ngay. Không cần thiết lập cơ sở.</Text>
          <Button mode="contained" icon="camera" onPress={() => router.push('/ocr-test')}>
            Thử OCR ngay
          </Button>
        </View>
      )}
      <Button onPress={() => void load()}>Tải lại dữ liệu</Button>
      {session.roles.includes('Owner') && (
        <Button mode="contained" onPress={() => router.push('/setup')}>
          Thiết lập cơ sở và phân công
        </Button>
      )}
      {session.roles.some((r) => r === 'Owner' || r === 'Staff') && (
        <>
          <Select
            label="Cơ sở được phép truy cập"
            items={locations}
            selected={location}
            onSelect={(id) => {
              setResidents([]);
              setLocation(id);
            }}
          />
          {!!location && (
            <Button
              mode="outlined"
              onPress={() =>
                router.push({ pathname: '/resident', params: { locationId: location } })
              }
            >
              Thêm hồ sơ cư dân
            </Button>
          )}
          {residents.map((r) => (
            <View key={r.id} style={styles.card}>
              <Text variant="titleMedium">{r.displayLabel}</Text>
              <Text>{r.verificationStatus === 1 ? 'Đã xác nhận thông tin' : 'Chờ xác nhận'}</Text>
              {r.verificationStatus === 0 && session.roles.includes('Staff') && (
                <Button
                  onPress={() =>
                    router.push({ pathname: '/identity', params: { residentId: r.id } })
                  }
                >
                  Chụp CCCD hoặc nhập thủ công
                </Button>
              )}
            </View>
          ))}
          <Text variant="titleLarge">Tác vụ ghi chỉ số</Text>
          {tasks.length === 0 && <Text>Chưa có tác vụ trong phạm vi của bạn.</Text>}
          {tasks.map((t) => (
            <View key={t.id} style={styles.card}>
              <Text variant="titleMedium">
                {t.location} · Phòng {t.room}
              </Text>
              <Text>
                {t.utilityType === 0 ? 'Điện' : 'Nước'} · {t.meterCode} ·{' '}
                {t.purpose === 0 ? 'Chỉ số ban đầu' : t.billingPeriod}
              </Text>
              <Text>
                {t.status === 2 ? 'Đã hoàn thành' : t.status === 3 ? 'Đã hủy' : 'Chờ ghi chỉ số'}
              </Text>
              {session.roles.includes('Staff') && t.status < 2 && (
                <Button
                  mode="contained-tonal"
                  onPress={() => router.push({ pathname: '/meter', params: { taskId: t.id } })}
                >
                  Mở tác vụ
                </Button>
              )}
            </View>
          ))}
        </>
      )}
      <Button
        onPress={async () => {
          try {
            await logout();
            setResidents([]);
            setTasks([]);
            setLocations([]);
            setLocation('');
          } catch {
            setError('Đã xóa phiên trên thiết bị; không kết nối được máy chủ để thu hồi phiên.');
          }
        }}
      >
        Đăng xuất
      </Button>
    </Page>
  );
}
