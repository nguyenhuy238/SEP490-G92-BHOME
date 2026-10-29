import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { Button, Checkbox, Text } from 'react-native-paper';
import {
  usePreventScreenCapture,
  enableAppSwitcherProtectionAsync,
  disableAppSwitcherProtectionAsync,
} from 'expo-screen-capture';
import { CameraCapture } from '../components/CameraCapture';
import { Field, Page, styles } from '../components/Controls';
import { useSession } from '../lib/SessionProvider';
import { errorMessage, type Proposal } from '../lib/api';
import { confirmedIdentity, emptyIdentity, identityFields, mergeIdentity } from '../lib/identity';

export default function IdentityScreen() {
  const { residentId } = useLocalSearchParams<{ residentId: string }>();
  const { api, session } = useSession();
  const [fields, setFields] = useState(emptyIdentity);
  const fieldsRef = useRef(fields);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [checked, setChecked] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  usePreventScreenCapture('identity');
  useEffect(() => {
    if (Platform.OS === 'ios') void enableAppSwitcherProtectionAsync().catch(() => {});
    const clear = () => {
      generation.current++;
      abort.current?.abort();
      const blank = emptyIdentity();
      fieldsRef.current = blank;
      setFields(blank);
      setChecked(false);
      setNotice('Đã xóa thông tin tạm. Hãy chụp lại hoặc nhập thủ công.');
    };
    const listener = AppState.addEventListener('change', (s) => {
      if (s !== 'active') clear();
    });
    const invalidate = () => {
      generation.current++;
      abort.current?.abort();
      fieldsRef.current = emptyIdentity();
    };
    return () => {
      invalidate();
      listener.remove();
      if (Platform.OS === 'ios') void disableAppSwitcherProtectionAsync().catch(() => {});
    };
  }, []);
  if (!session || !api) return <Redirect href="/" />;
  if (!session.roles.includes('Staff'))
    return (
      <Page>
        <Text>Chỉ Staff được phân công thực hiện xác nhận thông tin.</Text>
      </Page>
    );
  const scan = async (side: 'front' | 'back', bytes: Uint8Array<ArrayBuffer>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setChecked(false);
    const epoch = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const proposal = await api.image<Proposal>(
        `/api/v1/ocr/identity/${residentId}/${side}`,
        bytes,
        controller.signal,
      );
      if (epoch !== generation.current) return;
      const merged = mergeIdentity(fieldsRef.current, proposal);
      fieldsRef.current = merged.fields;
      setFields(merged.fields);
      setNotice(
        proposal.isFallback
          ? 'Không đọc được đủ thông tin. Hãy nhập thủ công.'
          : `Đây là dữ liệu OCR đề xuất. Hãy kiểm tra từng trường.${merged.conflicts.length ? ' Có thông tin khác với mặt đã chụp; hệ thống giữ giá trị cũ để bạn kiểm tra.' : ''}${proposal.missingFields.length || proposal.warnings.length ? ' Ảnh hoặc dữ liệu có cảnh báo; hãy đối chiếu giấy tờ.' : ''}`,
      );
    } catch (e) {
      if (epoch === generation.current) setError(errorMessage(e));
    } finally {
      clearTimeout(timeout);
      lock.current = false;
      setBusy(false);
    }
  };
  if (saved)
    return (
      <Page>
        <Text variant="headlineSmall">Đã lưu thông tin được Staff xác nhận</Text>
        <Text>
          Ảnh CCCD tạm đã được xóa. Đây không phải xác thực chip hoặc xác minh của cơ quan nhà nước.
        </Text>
      </Page>
    );
  return (
    <Page>
      <Text variant="headlineSmall">Thông tin cư dân</Text>
      <Text>Chụp từng mặt hoặc nhập thủ công. OCR chưa phải dữ liệu được xác nhận.</Text>
      <CameraCapture
        label="Chụp lại / OCR mặt trước"
        disabled={busy}
        onCapture={(bytes) => scan('front', bytes)}
      />
      <CameraCapture
        label="Chụp lại / OCR mặt sau"
        disabled={busy}
        onCapture={(bytes) => scan('back', bytes)}
      />
      {!!notice && <Text style={styles.note}>{notice}</Text>}
      {identityFields.map(([key, label]) => (
        <Field
          key={key}
          label={
            label +
            (['citizenIdentityNumber', 'fullName', 'dateOfBirth'].includes(key) && !fields[key]
              ? ' * Cần nhập'
              : '')
          }
          value={fields[key]}
          onChange={(v) => {
            const next = { ...fieldsRef.current, [key]: v };
            fieldsRef.current = next;
            setFields(next);
            setChecked(false);
          }}
        />
      ))}
      <Checkbox.Item
        label="Tôi đã đối chiếu giấy tờ và xác nhận thông tin"
        status={checked ? 'checked' : 'unchecked'}
        disabled={busy}
        onPress={() => setChecked(!checked)}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Button
        mode="contained"
        disabled={busy || !checked}
        loading={busy}
        onPress={async () => {
          if (lock.current) return;
          let input;
          try {
            input = confirmedIdentity(fieldsRef.current);
          } catch {
            setError('Kiểm tra số CCCD, họ tên và ngày tháng theo dd/MM/yyyy.');
            return;
          }
          lock.current = true;
          setBusy(true);
          setError('');
          const controller = new AbortController();
          abort.current = controller;
          try {
            await api.json(
              `/api/v1/capture/residents/${residentId}/confirm`,
              input,
              controller.signal,
            );
            fieldsRef.current = emptyIdentity();
            setFields(emptyIdentity());
            setChecked(false);
            setSaved(true);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        Xác nhận và lưu thông tin
      </Button>
      <Button disabled={!busy} onPress={() => abort.current?.abort()}>
        Hủy yêu cầu
      </Button>
      <Text>Nhập thủ công luôn khả dụng khi OCR lỗi.</Text>
    </Page>
  );
}
