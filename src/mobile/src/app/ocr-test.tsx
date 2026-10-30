import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import {
  usePreventScreenCapture,
  enableAppSwitcherProtectionAsync,
  disableAppSwitcherProtectionAsync,
} from 'expo-screen-capture';
import { CameraCapture } from '../components/CameraCapture';
import { Page, Select, styles } from '../components/Controls';
import { useSession } from '../lib/SessionProvider';
import { errorMessage, MobileApiError } from '../lib/api';
import { displayDate } from '../lib/identity';
import {
  type DiagnosticResult,
  diagnosticFields,
  diagnosticEndpoint,
  diagnosticStatus,
  diagnosticWarning,
  ocrProfiles,
} from '../lib/ocrDiagnostics';

export default function OcrTest() {
  const { api, session } = useSession();
  const [profile, setProfile] = useState('identity-front');
  const [decimalPlaces, setDecimalPlaces] = useState('auto');
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const lock = useRef(false);
  const mounted = useRef(true);
  const abort = useRef<AbortController | null>(null);
  usePreventScreenCapture('ocr-test');
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const check = new AbortController();
    const timer = setTimeout(() => check.abort(), 15000);
    if (Platform.OS === 'ios') void enableAppSwitcherProtectionAsync().catch(() => {});
    if (api)
      void api
        .request('/api/v1/ocr/diagnostics', { signal: check.signal })
        .then(() => {
          if (active) setAvailable(true);
        })
        .catch((e) => {
          if (active)
            setError(
              e instanceof MobileApiError && e.status === 404
                ? 'Máy chủ chưa bật màn thử OCR. Hãy khởi động lại API với cấu hình mobile Development.'
                : errorMessage(e),
            );
        })
        .finally(() => {
          if (active) setChecking(false);
        });
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        generation.current++;
        abort.current?.abort();
        setResult(null);
        setError('');
      }
    });
    const invalidate = () => {
      generation.current++;
      abort.current?.abort();
    };
    return () => {
      active = false;
      mounted.current = false;
      invalidate();
      clearTimeout(timer);
      check.abort();
      listener.remove();
      if (Platform.OS === 'ios') void disableAppSwitcherProtectionAsync().catch(() => {});
    };
  }, [api, checkAttempt]);
  if (!api || !session) return <Redirect href="/" />;
  if (!session.roles.some((role) => role === 'Owner' || role === 'Staff'))
    return <Redirect href="/" />;
  return (
    <Page>
      <Text variant="headlineMedium">Thử OCR trực tiếp</Text>
      <Text>
        Chọn loại ảnh, mở camera rồi chụp. Kết quả bên dưới đến từ engine OCR trên API BHOME.
      </Text>
      <Text style={styles.note}>
        Dùng CCCD giả lập khi kiểm thử. Màn này không lưu hồ sơ, ảnh hay chỉ số vào nghiệp vụ.
      </Text>
      {checking && <ActivityIndicator />}
      {available && <Text>Đã kết nối chế độ thử OCR trên máy chủ.</Text>}
      {!checking && !available && (
        <Button
          mode="outlined"
          onPress={() => {
            setChecking(true);
            setError('');
            setCheckAttempt((value) => value + 1);
          }}
        >
          Kiểm tra lại máy chủ
        </Button>
      )}
      <Select
        label="Loại ảnh cần đọc"
        items={ocrProfiles}
        selected={profile}
        onSelect={(id) => {
          if (lock.current) return;
          setProfile(id);
          setDecimalPlaces('auto');
          setResult(null);
          setError('');
        }}
      />
      {!profile.startsWith('identity-') && (
        <>
          <Select
            label="Số chữ số thập phân thực tế trên công tơ"
            items={[
              { id: 'auto', label: 'Chưa xác định' },
              ...[0, 1, 2, 3, 4].map((value) => ({
                id: String(value),
                label: `${value} chữ số thập phân`,
              })),
            ]}
            selected={decimalPlaces}
            onSelect={(value) => {
              if (lock.current) return;
              setDecimalPlaces(value);
              setResult(null);
              setError('');
            }}
          />
          <Text>
            Chọn theo mặt số công tơ. Ví dụ 03251.4 có 1 chữ số thập phân; OCR giữ cả phần lẻ.
          </Text>
        </>
      )}
      <CameraCapture
        key={profile}
        label="Mở camera để thử OCR"
        disabled={!available || busy}
        onCapture={async (bytes) => {
          if (lock.current) return;
          lock.current = true;
          const epoch = generation.current;
          const controller = new AbortController();
          abort.current = controller;
          const timer = setTimeout(() => controller.abort(), 20000);
          setBusy(true);
          setError('');
          setResult(null);
          try {
            const response = await api.image<DiagnosticResult>(
              diagnosticEndpoint(profile, decimalPlaces),
              bytes,
              controller.signal,
            );
            if (epoch === generation.current) setResult(response);
          } catch (e) {
            if (epoch === generation.current)
              setError(
                e instanceof Error && e.name === 'AbortError'
                  ? 'Đã dừng thử OCR. Bạn có thể chụp lại; màn thử không ghi dữ liệu nghiệp vụ.'
                  : errorMessage(e),
              );
          } finally {
            clearTimeout(timer);
            lock.current = false;
            if (mounted.current) setBusy(false);
          }
        }}
      />
      {busy && <Text>Đang nhận dạng ảnh…</Text>}
      {busy && <Button onPress={() => abort.current?.abort()}>Dừng thử</Button>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {result && (
        <View style={styles.card}>
          <Text variant="titleLarge">{diagnosticStatus(result.proposal)}</Text>
          <Text>Thời gian trên API: {result.elapsedMilliseconds} ms</Text>
          <Text>Engine: {result.proposal.engineVersion ?? 'Không có thông tin'}</Text>
          <Text>Đây là đề xuất chưa xác nhận. Có dữ liệu trả về chưa có nghĩa là đã đọc đúng.</Text>
          {Object.entries(result.proposal.proposedFields).map(([key, value]) => (
            <View key={key} style={styles.row}>
              <Text variant="titleSmall">{diagnosticFields[key] ?? key}</Text>
              <Text>{key.startsWith('dateOf') ? displayDate(value) : value}</Text>
              {result.proposal.confidence[key] !== undefined && (
                <Text>
                  Độ tin cậy model: {Math.round(result.proposal.confidence[key]! * 100)}% (không
                  phải độ chính xác đã kiểm định)
                </Text>
              )}
            </View>
          ))}
          {result.proposal.missingFields.length > 0 && (
            <Text>
              Còn thiếu:{' '}
              {result.proposal.missingFields.map((key) => diagnosticFields[key] ?? key).join(', ')}
            </Text>
          )}
          {result.proposal.warnings.map((warning, i) => (
            <Text key={i} style={styles.error}>
              {diagnosticWarning(warning)}
            </Text>
          ))}
          <Button onPress={() => setResult(null)}>Xóa kết quả tạm</Button>
        </View>
      )}
    </Page>
  );
}
