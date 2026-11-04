import React, { useEffect, useRef, useState } from 'react';
import { AppState, Image, Platform, View } from 'react-native';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import {
  usePreventScreenCapture,
  enableAppSwitcherProtectionAsync,
  disableAppSwitcherProtectionAsync,
} from 'expo-screen-capture';
import { CameraCapture } from '../components/CameraCapture';
import { Field, Page, Select, styles } from '../components/Controls';
import { useSession } from '../lib/SessionProvider';
import { errorMessage, MobileApiError } from '../lib/api';
import { displayDate } from '../lib/identity';
import {
  type DiagnosticResult,
  diagnosticFields,
  diagnosticEndpoint,
  ocrProfiles,
} from '../lib/ocrDiagnostics';
import {
  type AutomaticAnalysis,
  type AutomaticDiagnosticResult,
  automaticDiagnosticEndpoint,
  categoryLabel,
  reviewWarning,
  TemporaryOcrImage,
  ocrPreview,
} from '../lib/automaticOcr';

export default function OcrTest() {
  const { api, session } = useSession();
  const allowed = !!session?.roles.some((role) => role === 'Owner' || role === 'Staff');
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<AutomaticAnalysis | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState('');
  const [manualProfile, setManualProfile] = useState('');
  const [decimalPlaces, setDecimalPlaces] = useState('auto');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const lock = useRef(false);
  const mounted = useRef(true);
  const abort = useRef<AbortController | null>(null);
  const image = useRef(new TemporaryOcrImage());
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    generation.current++;
    abort.current?.abort();
    image.current.clear();
    if (expiry.current) clearTimeout(expiry.current);
    setAnalysis(null);
    setFields({});
    setPreview('');
    setManualProfile('');
    setDecimalPlaces('auto');
    setError('');
  };
  usePreventScreenCapture('ocr-test');
  useEffect(() => {
    mounted.current = true;
    const temporaryImage = image.current;
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') clear();
    });
    if (Platform.OS === 'ios') void enableAppSwitcherProtectionAsync().catch(() => {});
    const invalidate = () => {
      mounted.current = false;
      generation.current++;
      abort.current?.abort();
      temporaryImage.clear();
    };
    return () => {
      invalidate();
      if (expiry.current) clearTimeout(expiry.current);
      listener.remove();
      if (Platform.OS === 'ios') void disableAppSwitcherProtectionAsync().catch(() => {});
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let active = true;
    if (api && allowed)
      void api
        .request('/api/v1/ocr/diagnostics', { signal: controller.signal })
        .then(() => {
          if (active) setAvailable(true);
        })
        .catch((e) => {
          if (active)
            setError(
              e instanceof MobileApiError && e.status === 404
                ? 'Máy chủ chưa bật thử OCR. Hãy dùng cấu hình phát triển của BHOME.'
                : errorMessage(e),
            );
        })
        .finally(() => {
          if (active) setChecking(false);
        });
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
      clear();
    };
  }, [api, allowed, checkAttempt]);
  const apply = (result: AutomaticAnalysis) => {
    setAnalysis(result);
    const proposal = result.identityProposal ?? result.meterProposal;
    const keys = proposal
      ? [...Object.keys(proposal.proposedFields), ...proposal.missingFields]
      : [];
    if (proposal && keys.length === 0)
      keys.push(
        ...(result.meterProposal
          ? ['reading']
          : result.detectedCategory === 'cccd_front'
            ? ['citizenIdentityNumber', 'fullName', 'dateOfBirth']
            : ['dateOfIssue', 'placeOfIssue', 'residentialAddress']),
      );
    setFields(
      proposal
        ? Object.fromEntries(
            keys
              .filter((key) => diagnosticFields[key])
              .map((key) => [
                key,
                key.startsWith('dateOf')
                  ? displayDate(proposal.proposedFields[key] ?? '')
                  : (proposal.proposedFields[key] ?? ''),
              ]),
          )
        : {},
    );
    if (result.classificationStatus === 'classified' || result.classificationStatus === 'manual')
      image.current.clear();
  };
  const run = async (manual = false) => {
    if (!api || !image.current.bytes || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const epoch = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    const valid = () =>
      mounted.current && epoch === generation.current && !controller.signal.aborted;
    try {
      if (manual) {
        const result = await api.image<DiagnosticResult>(
          diagnosticEndpoint(manualProfile, decimalPlaces),
          image.current.bytes,
          controller.signal,
        );
        if (valid())
          apply({
            classificationStatus: 'manual',
            detectedCategory:
              manualProfile === 'identity-front'
                ? 'cccd_front'
                : manualProfile === 'identity-back'
                  ? 'cccd_back'
                  : manualProfile.replaceAll('-', '_'),
            classificationConfidence: null,
            classificationSource: 'manual',
            candidateCategories: [],
            warnings: [],
            identityProposal: manualProfile.startsWith('identity-') ? result.proposal : null,
            meterProposal: manualProfile.startsWith('identity-') ? null : result.proposal,
          });
      } else {
        const result = await api.image<AutomaticDiagnosticResult>(
          automaticDiagnosticEndpoint,
          image.current.bytes,
          controller.signal,
        );
        if (valid()) apply(result.analysis);
      }
    } catch (e) {
      if (mounted.current && epoch === generation.current) {
        if (e instanceof MobileApiError && (e.status === 401 || e.status === 403)) clear();
        else
          setAnalysis({
            classificationStatus: 'unavailable',
            detectedCategory: 'unknown',
            classificationConfidence: null,
            classificationSource: 'none',
            candidateCategories: [],
            warnings: ['classification_unavailable'],
            identityProposal: null,
            meterProposal: null,
          });
        setError(errorMessage(e));
      }
    } finally {
      clearTimeout(timer);
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  if (!api || !session || !allowed) return <Redirect href="/" />;
  const proposal = analysis?.identityProposal ?? analysis?.meterProposal;
  const needsType =
    !!preview && !!analysis && !['classified', 'manual'].includes(analysis.classificationStatus);
  const warnings = [
    ...new Set([...(analysis?.warnings ?? []), ...(proposal?.warnings ?? [])].map(reviewWarning)),
  ];
  return (
    <Page>
      <Text variant="headlineMedium">Thử OCR trực tiếp</Text>
      <Text>Chụp ảnh CCCD hoặc công tơ điện, nước. Hệ thống sẽ tự nhận diện và đọc thông tin.</Text>
      <Text style={styles.note}>
        Dùng CCCD giả lập khi kiểm thử. Kết quả chỉ để xem và chỉnh sửa tạm thời.
      </Text>
      {checking && <ActivityIndicator accessibilityLabel="Đang kiểm tra kết nối" />}
      {!checking && !available && (
        <Button
          mode="outlined"
          onPress={() => {
            setError('');
            setAvailable(false);
            setChecking(true);
            setCheckAttempt((v) => v + 1);
          }}
        >
          Kiểm tra lại máy chủ
        </Button>
      )}
      <CameraCapture
        label={preview ? 'Chụp lại' : 'Chụp ảnh OCR'}
        buttonMode="contained"
        disabled={!available || busy}
        onCapture={async (bytes) => {
          if (lock.current) return;
          clear();
          image.current.replace(bytes);
          setPreview(ocrPreview(bytes));
          expiry.current = setTimeout(() => {
            if (mounted.current) clear();
          }, 60000);
          await run();
        }}
      />
      {busy && <Text>Đang phân tích loại ảnh và đọc thông tin…</Text>}
      {busy && <Button onPress={clear}>Dừng xử lý</Button>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {!!preview && (
        <Image
          accessibilityLabel="Ảnh vừa chụp để đối chiếu"
          source={{ uri: preview }}
          resizeMode="contain"
          style={{ width: '100%', height: 200 }}
        />
      )}
      {needsType && (
        <View style={styles.card}>
          <Text>Chưa xác định được loại ảnh. Vui lòng kiểm tra và chọn loại phù hợp.</Text>
          <Select
            label="Loại ảnh sau khi kiểm tra"
            items={ocrProfiles}
            selected={manualProfile}
            onSelect={(id) => {
              if (!busy) setManualProfile(id);
            }}
          />
          {!!manualProfile && !manualProfile.startsWith('identity-') && (
            <Select
              label="Số chữ số thập phân thực tế"
              items={[
                { id: 'auto', label: 'Chưa xác định' },
                ...[0, 1, 2, 3, 4].map((v) => ({ id: String(v), label: `${v} chữ số thập phân` })),
              ]}
              selected={decimalPlaces}
              onSelect={(value) => {
                if (!busy) setDecimalPlaces(value);
              }}
            />
          )}
          <Button mode="contained" disabled={!manualProfile || busy} onPress={() => void run(true)}>
            Đọc theo loại đã chọn
          </Button>
        </View>
      )}
      {proposal && (
        <View style={styles.card}>
          <Text variant="titleLarge">
            {proposal.isFallback || proposal.missingFields.length
              ? 'Cần kiểm tra lại thông tin'
              : 'Đã đọc thông tin — cần đối chiếu'}
          </Text>
          <Text>
            {analysis?.classificationStatus === 'manual'
              ? 'Loại ảnh đã chọn'
              : 'Loại ảnh nhận diện'}
            : {categoryLabel(analysis?.detectedCategory ?? '')}
          </Text>
          {Object.entries(fields).map(([key, value]) => (
            <Field
              key={key}
              label={diagnosticFields[key]!}
              value={value}
              onChange={(text) => setFields((before) => ({ ...before, [key]: text }))}
            />
          ))}
          <Text style={styles.note}>
            Các chỉnh sửa chỉ ở màn thử, không xác nhận hồ sơ hay chỉ số nghiệp vụ.
          </Text>
        </View>
      )}
      {warnings.map((warning) => (
        <Text key={warning} style={styles.note}>
          {warning}
        </Text>
      ))}
      {!!preview && (
        <Button disabled={busy} onPress={clear}>
          Xóa kết quả tạm
        </Button>
      )}
    </Page>
  );
}
