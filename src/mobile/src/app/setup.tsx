import { useFeedbackState } from '../lib/useFeedbackState';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect } from 'expo-router';
import { Button, SegmentedButtons, Text } from 'react-native-paper';
import { Field, Page, Select, styles } from '../components/Controls';
import { useSession } from '../lib/SessionProvider';
import { errorMessage, type Named } from '../lib/api';
import { inputDate } from '../lib/identity';

export default function Setup() {
  const { api, session } = useSession();
  const [error, setError] = useFeedbackState();
  const [notice, setNotice] = useFeedbackState('success');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [chains, setChains] = useState<Named[]>([]);
  const [chain, setChain] = useState('');
  const [locations, setLocations] = useState<Named[]>([]);
  const [location, setLocation] = useState('');
  const [rooms, setRooms] = useState<Named[]>([]);
  const [room, setRoom] = useState('');
  const [staff, setStaff] = useState<Named[]>([]);
  const [staffId, setStaffId] = useState('');
  const [meters, setMeters] = useState<Named[]>([]);
  const [meter, setMeter] = useState('');
  const [chainName, setChainName] = useState('');
  const [locationName, setLocationName] = useState('');
  const [address, setAddress] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [roomTypes, setRoomTypes] = useState<
    { id: string; name: string; defaultCapacity: number }[]
  >([]);
  const [roomType, setRoomType] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [code, setCode] = useState('');
  const [utility, setUtility] = useState('0');
  const [display, setDisplay] = useState('0');
  const [precision, setPrecision] = useState('');
  const [installed, setInstalled] = useState('');
  const [purpose, setPurpose] = useState('0');
  const [date, setDate] = useState('');
  const [period, setPeriod] = useState('');
  const load = useCallback(async () => {
    if (!api) return;
    const [c, l, s] = await Promise.all([
      api.request<Named[]>('/api/v1/capture/chains'),
      api.request<Named[]>('/api/v1/capture/locations'),
      api.request<Named[]>('/api/v1/capture/staff'),
    ]);
    setChains(c);
    setLocations(l);
    setStaff(s);
  }, [api]);
  useEffect(() => {
    if (!api) return;
    let current = true;
    void Promise.all([
      api.request<Named[]>('/api/v1/capture/chains'),
      api.request<Named[]>('/api/v1/capture/locations'),
      api.request<Named[]>('/api/v1/capture/staff'),
    ])
      .then(([c, l, s]) => {
        if (current) {
          setChains(c);
          setLocations(l);
          setStaff(s);
        }
      })
      .catch((e) => {
        if (current) setError(errorMessage(e));
      });
    return () => {
      current = false;
    };
  }, [api, setError]);
  useEffect(() => {
    if (!api || !location) return;
    let current = true;
    void Promise.all([
      api.request<Named[]>(`/api/v1/capture/locations/${location}/rooms`),
      api.request<Named[]>(`/api/v1/capture/locations/${location}/meters`),
      api.request<{ items: { id: string; name: string; defaultCapacity: number }[] }>(
        `/api/v1/room-types?locationId=${encodeURIComponent(location)}&isActive=true&pageSize=100`,
      ),
    ])
      .then(([r, m, types]) => {
        if (current) {
          setRooms(r);
          setMeters(m);
          setRoomTypes(types.items);
        }
      })
      .catch((e) => setError(errorMessage(e)));
    return () => {
      current = false;
    };
  }, [api, location, setError]);
  if (!api || !session) return <Redirect href="/" />;
  if (!session.roles.includes('Owner'))
    return (
      <Page>
        <Text>Chỉ Owner quản lý cấu hình và phân công.</Text>
      </Page>
    );
  const create = async (path: string, data: () => object, after?: () => void) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.json('/api/v1/capture/' + path, data());
      await load();
      if (location) {
        setRooms(await api.request<Named[]>(`/api/v1/capture/locations/${location}/rooms`));
        setMeters(await api.request<Named[]>(`/api/v1/capture/locations/${location}/meters`));
      }
      after?.();
      setNotice('Máy chủ đã lưu thành công.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const renameChain = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const current = await api.request<{ id: string; name: string; version: number }>(
        '/api/v1/chain',
      );
      await api.request('/api/v1/chain', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: chainName.trim(),
          version: current.version,
          reason: 'Cập nhật tên chuỗi từ Mobile',
        }),
      });
      await load();
      setChainName('');
      setNotice('Máy chủ đã cập nhật tên chuỗi.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Page>
      <Text variant="headlineSmall">Thiết lập thu thập dữ liệu</Text>
      <Text>Thực hiện từ trên xuống. Không tạo hợp đồng, kích hoạt phòng thuê hoặc hóa đơn.</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {!!notice && <Text>{notice}</Text>}
      <Text variant="titleLarge">1. Chuỗi và cơ sở</Text>
      <Field label="Tên chuỗi" value={chainName} onChange={setChainName} />
      <Button
        disabled={busy || !chains.length || !chainName.trim()}
        onPress={() => void renameChain()}
      >
        Đổi tên chuỗi
      </Button>
      <Select label="Chuỗi sở hữu" items={chains} selected={chain} onSelect={setChain} />
      <Field label="Tên cơ sở" value={locationName} onChange={setLocationName} />
      <Field label="Địa chỉ cơ sở" value={address} onChange={setAddress} />
      <Button
        disabled={busy || !chain || !locationName.trim() || !address.trim()}
        onPress={() =>
          void create(
            'locations',
            () => ({ chainId: chain, name: locationName, address }),
            () => {
              setLocationName('');
              setAddress('');
            },
          )
        }
      >
        Tạo cơ sở
      </Button>
      <Select
        label="Cơ sở thao tác"
        items={locations}
        selected={location}
        onSelect={(id) => {
          setLocation(id);
          setRoom('');
          setRoomType('');
          setRoomTypes([]);
          setMeter('');
          setRooms([]);
          setMeters([]);
        }}
      />
      <Text variant="titleLarge">2. Phòng</Text>
      <Select
        label="Loại phòng"
        items={roomTypes.map((item) => ({ id: item.id, label: item.name }))}
        selected={roomType}
        onSelect={setRoomType}
      />
      {!roomTypes.length && (
        <Text>Owner cần cấu hình loại phòng tại cơ sở trước khi tạo phòng.</Text>
      )}
      <Field label="Số phòng" value={roomNumber} onChange={setRoomNumber} />
      <Button
        disabled={busy || !location || !roomType || !roomNumber.trim()}
        onPress={() =>
          void create(
            'rooms',
            () => ({
              locationId: location,
              roomTypeId: roomType,
              roomNumber,
              capacity: roomTypes.find((item) => item.id === roomType)!.defaultCapacity,
            }),
            () => setRoomNumber(''),
          )
        }
      >
        Tạo phòng
      </Button>
      <Select label="Phòng thao tác" items={rooms} selected={room} onSelect={setRoom} />
      <Text variant="titleLarge">3. Staff và phân công</Text>
      <Field label="Tên đăng nhập Staff mới" value={staffName} onChange={setStaffName} />
      <Field label="Email Staff mới" value={staffEmail} onChange={setStaffEmail} />
      <Field
        label="Mật khẩu Staff (ít nhất 12 ký tự)"
        value={staffPassword}
        onChange={setStaffPassword}
        secure
      />
      <Button
        disabled={busy || !staffName || !staffEmail || staffPassword.length < 12}
        onPress={() =>
          void create(
            'staff',
            () => ({ userName: staffName, email: staffEmail, password: staffPassword }),
            () => {
              setStaffPassword('');
              setStaffName('');
              setStaffEmail('');
            },
          )
        }
      >
        Tạo tài khoản Staff thuộc Owner
      </Button>
      <Select label="Staff thuộc Owner" items={staff} selected={staffId} onSelect={setStaffId} />
      <Field label="Phân công từ ngày (dd/MM/yyyy)" value={from} onChange={setFrom} />
      <Field label="Đến ngày (để trống nếu không hạn)" value={to} onChange={setTo} />
      <Button
        disabled={busy || !location || !staffId || !from}
        onPress={() =>
          void create('assignments', () => ({
            locationId: location,
            staffUserId: staffId,
            effectiveFrom: inputDate(from),
            effectiveTo: to ? inputDate(to) : null,
          }))
        }
      >
        Phân công Staff vào cơ sở
      </Button>
      <Text variant="titleLarge">4. Đồng hồ</Text>
      <Field label="Mã đồng hồ" value={code} onChange={setCode} />
      <SegmentedButtons
        value={utility}
        onValueChange={setUtility}
        buttons={[
          { value: '0', label: 'Điện' },
          { value: '1', label: 'Nước' },
        ]}
      />
      <SegmentedButtons
        value={display}
        onValueChange={setDisplay}
        buttons={[
          { value: '0', label: 'Cơ khí' },
          { value: '1', label: 'Điện tử' },
        ]}
      />
      <Field
        label="Số chữ số thập phân thực tế (0–4)"
        value={precision}
        onChange={setPrecision}
        numeric
      />
      <Field label="Ngày lắp (dd/MM/yyyy)" value={installed} onChange={setInstalled} />
      <Button
        disabled={busy || !room || !code || !/^[0-4]$/.test(precision) || !installed}
        onPress={() =>
          void create(
            'meters',
            () => ({
              roomId: room,
              code,
              utilityType: +utility,
              display: +display,
              decimalPlaces: +precision,
              installedOn: inputDate(installed),
            }),
            () => setCode(''),
          )
        }
      >
        Tạo đồng hồ
      </Button>
      <Text variant="titleLarge">5. Giao tác vụ ghi chỉ số</Text>
      <Select label="Đồng hồ" items={meters} selected={meter} onSelect={setMeter} />
      <SegmentedButtons
        value={purpose}
        onValueChange={setPurpose}
        buttons={[
          { value: '0', label: 'Ban đầu' },
          { value: '1', label: 'Định kỳ' },
        ]}
      />
      <Field label="Ngày ghi (dd/MM/yyyy)" value={date} onChange={setDate} />
      {purpose === '1' && (
        <Field label="Kỳ hóa đơn (MM/yyyy)" value={period} onChange={setPeriod} />
      )}
      <Button
        disabled={busy || !meter || !staffId || !date || (purpose === '1' && !period)}
        onPress={() =>
          void create('meter-tasks', () => ({
            meterId: meter,
            staffUserId: staffId,
            purpose: +purpose,
            readingDate: inputDate(date),
            billingPeriod: purpose === '1' ? inputDate('01/' + period) : null,
          }))
        }
      >
        Giao tác vụ cho Staff đã chọn
      </Button>
      <Text>
        Staff đăng nhập tài khoản được giao để chụp và xác nhận. Chỉ số ban đầu cần được Staff xác
        nhận trước tác vụ định kỳ.
      </Text>
    </Page>
  );
}
