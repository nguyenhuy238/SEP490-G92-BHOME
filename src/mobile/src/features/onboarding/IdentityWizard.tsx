import { workflowFailure } from '../../lib/workflowFailure';
import { useFeedbackState } from '../../lib/useFeedbackState';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { ActivityIndicator, Button, Checkbox, Icon, Text, TextInput } from 'react-native-paper';
import {
  usePreventScreenCapture,
  enableAppSwitcherProtectionAsync,
  disableAppSwitcherProtectionAsync,
} from 'expo-screen-capture';
import { CameraCapture } from '../../components/CameraCapture';
import { IdentityDateField } from '../../components/IdentityDateField';
import { Action, Box, Heading, Pill, Row, ui } from '../../components/WorkspaceKit';
import { useSession } from '../../lib/SessionProvider';
import {
  errorMessage,
  identityOcrRequestTimeoutMilliseconds,
  MobileApiError,
  type Proposal,
} from '../../lib/api';
import { captureService } from '../../services/captureService';
import {
  confirmedIdentity,
  emptyIdentity,
  identityFields,
  mergeIdentity,
  foldIdentityName,
  type IdentityFields,
} from '../../lib/identity';
import { diagnosticWarning } from '../../lib/ocrDiagnostics';
import {
  emptyCaptureProgress,
  type CaptureProgress,
  type IdentitySide,
  type IdentityStatus,
  type IdentityCaptureRequest,
} from './onboarding';
import { IdentityFlowFrame } from './IdentityFlowFrame';
import { identityFieldErrors } from './identityFieldErrors';
import { conciseMessage, showSuccess, showWarning } from '../../lib/toast';
import { colors as c } from '../../theme/theme';
import { useWorkspace } from '../workspace/WorkspaceProvider';

interface Props {
  residentId: string;
  locationId?: string;
  roomId?: string;
  preview?: boolean;
  active?: boolean;
  modal?: boolean;
  visible?: boolean;
  personLabel?: string;
  mode?: 'capture' | 'verify';
  onModeChange?: (mode: 'capture' | 'verify') => void;
  onDismiss?: () => void;
  onComplete: () => void;
  onConfirmed?: () => void;
  onSaveError?: (message: string) => void;
  onVerifiedSummary?: (summary: { fullName: string; dateOfBirth: string | null }) => void;
  onStatusChange?: (status: IdentityStatus) => void;
  onUnsavedChanges?: (hasChanges: boolean) => void;
  onCaptureProgress?: (progress: CaptureProgress) => void;
  captureRequest?: IdentityCaptureRequest;
  onCancel: () => void;
}
function IdentityScreenCaptureProtection({ residentId }: { residentId: string }) {
  usePreventScreenCapture(`identity-wizard-${residentId}`);
  return null;
}
export function IdentityWizard({
  residentId,
  locationId,
  roomId,
  preview = false,
  active = true,
  modal = false,
  visible = true,
  personLabel = 'Người ở',
  mode = 'capture',
  onModeChange,
  onDismiss,
  onComplete,
  onCancel,
  onConfirmed,
  onSaveError,
  onVerifiedSummary,
  onStatusChange,
  onUnsavedChanges,
  onCaptureProgress,
  captureRequest,
}: Props) {
  const { resetScroll } = useWorkspace();
  const { api, session } = useSession();
  const [localStep, setLocalStep] = useState<'capture' | 'verify' | 'done'>('capture');
  const step = localStep === 'done' ? 'done' : modal ? mode : localStep;
  const setStep = (next: 'capture' | 'verify' | 'done') => {
    setLocalStep(next);
    if (next !== 'done') onModeChange?.(next);
  };
  const [scanned, setScanned] = useState(false);
  const [side, setSide] = useState<IdentitySide>(captureRequest?.side ?? 'front');
  const [lastCaptureRequest, setLastCaptureRequest] = useState(captureRequest);
  // Apply an explicit selection before mounting its camera, without remounting
  // the wizard or losing OCR suggestions and Staff edits.
  if (captureRequest && captureRequest !== lastCaptureRequest) {
    setLastCaptureRequest(captureRequest);
    setSide(captureRequest.side);
  }
  const captureProgress = useRef(emptyCaptureProgress());
  const cameraLensPreferenceRef = useRef('');
  const progressCallback = useRef(onCaptureProgress);
  useEffect(() => {
    progressCallback.current = onCaptureProgress;
  }, [onCaptureProgress]);
  const reportProgress = (face: IdentitySide, status: CaptureProgress[IdentitySide]) => {
    if (captureProgress.current[face] === 'recognized' && status === 'captured') return;
    captureProgress.current = { ...captureProgress.current, [face]: status };
    progressCallback.current?.(captureProgress.current);
  };
  const [fields, setFields] = useState(emptyIdentity);
  const [sources, setSources] = useState<Partial<Record<keyof IdentityFields, string>>>({});
  const [uncertain, setUncertain] = useState<Partial<Record<keyof IdentityFields, string>>>({});
  const current = useRef(fields);
  const unaccentedName = useRef(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alreadyConfirmed, setAlreadyConfirmed] = useState(false);
  const [error, setError] = useFeedbackState('error', false);
  const [notice, setNotice] = useFeedbackState('info', false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const sideWarnings = useRef<Record<IdentitySide, string[]>>({ front: [], back: [] });
  const [placeOfIssue, setPlaceOfIssue] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<keyof IdentityFields, boolean>>>({});
  const fieldErrors = identityFieldErrors(fields);
  const confirmed = useRef(false);
  const statusCallback = useRef(onStatusChange);
  const unsavedChangesCallback = useRef(onUnsavedChanges);
  const dismissCallback = useRef(onDismiss);
  useEffect(() => {
    statusCallback.current = onStatusChange;
  }, [onStatusChange]);
  useEffect(() => {
    unsavedChangesCallback.current = onUnsavedChanges;
  }, [onUnsavedChanges]);
  const hasUnsavedChanges =
    step !== 'done' &&
    (Object.values(fields).some((value) => value.trim()) || !!placeOfIssue.trim());
  useEffect(() => {
    unsavedChangesCallback.current?.(hasUnsavedChanges);
  }, [hasUnsavedChanges]);
  useEffect(() => {
    dismissCallback.current = onDismiss;
  }, [onDismiss]);
  const lock = useRef(false);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const wasVisible = useRef(visible && active);
  useEffect(() => {
    const shown = visible && active;
    if (modal && wasVisible.current && !shown && !confirmed.current) {
      generation.current++;
      abort.current?.abort();
      lock.current = false;
      setBusy(false);
      setChecked(false);
      statusCallback.current?.(
        Object.values(current.current).some(Boolean) ? 'pending' : 'unscanned',
      );
    }
    wasVisible.current = shown;
  }, [modal, visible, active]);
  useEffect(() => {
    if (Platform.OS === 'ios') void enableAppSwitcherProtectionAsync().catch(() => {});
    const suspend = () => {
      if (confirmed.current) return;
      generation.current++;
      abort.current?.abort();
      lock.current = false;
      setBusy(false);
      setChecked(false);
      statusCallback.current?.(
        Object.values(current.current).some(Boolean) ? 'pending' : 'unscanned',
      );
      setNotice(
        'Ảnh tạm đã xóa. Thông tin đã nhập được giữ trong phiên này, hãy kiểm tra lại trước khi xác nhận.',
      );
      if (modal) dismissCallback.current?.();
    };
    const sub = AppState.addEventListener('change', (state) => {
      // A native camera permission prompt can temporarily make iOS inactive.
      if (state === 'background') suspend();
    });
    const invalidate = () => {
      generation.current++;
      abort.current?.abort();
      current.current = emptyIdentity();
    };
    return () => {
      invalidate();
      sub.remove();
      if (Platform.OS === 'ios') void disableAppSwitcherProtectionAsync().catch(() => {});
    };
  }, [modal, setNotice]);
  const acceptProposal = (proposal: Proposal, face: IdentitySide = side) => {
    // A retake fills gaps. An observed disagreement must not erase a successful
    // earlier read or a Staff edit; keep that value and ask for comparison.
    const before = { ...current.current };
    const merged = mergeIdentity(before, proposal, { unaccentedName: unaccentedName.current });
    const nameUpgraded = !!before.fullName && before.fullName !== merged.fields.fullName;
    const mrzNameAgrees =
      proposal.warnings.includes('mrz_name_unaccented') &&
      !!before.fullName &&
      foldIdentityName(before.fullName) ===
        foldIdentityName(proposal.proposedFields.fullName ?? '');
    if (!before.fullName && proposal.proposedFields.fullName)
      unaccentedName.current = proposal.warnings.includes('mrz_name_unaccented');
    else if (nameUpgraded) unaccentedName.current = false;
    statusCallback.current?.('pending');
    const hasFields =
      identityFields.some(([key]) => proposal.proposedFields[key]?.trim()) ||
      !!proposal.proposedFields.placeOfIssue?.trim();
    const complete =
      face === 'back'
        ? !!proposal.proposedFields.dateOfIssue?.trim()
        : identityFields
            .filter(([key]) => key !== 'dateOfIssue')
            .every(([key]) => proposal.proposedFields[key]?.trim());
    const resultStatus = !hasFields
      ? 'failed'
      : !complete || proposal.warnings.includes('ocr_partial')
        ? 'partial'
        : 'recognized';
    const faceLabel = `Mặt ${face === 'front' ? 'trước' : 'sau'}`;
    const failureCode = [
      'ocr_unavailable',
      'ocr_busy',
      'ocr_timeout',
      'no_text',
      'unsupported_or_unreadable_layout',
    ].find((code) => proposal.warnings.includes(code));
    const qualityWarnings = proposal.warnings.filter((code) =>
      [
        'identity_small_card',
        'identity_card_not_found',
        'identity_low_light',
        'blur_or_low_detail',
        'possible_glare',
        'orientation_uncertain',
      ].includes(code),
    );
    sideWarnings.current[face] =
      resultStatus === 'failed'
        ? [
            `${faceLabel}: ${failureCode ? diagnosticWarning(failureCode, false) : 'Chưa đọc được thông tin. Hãy quét lại mặt này hoặc nhập thủ công.'}`,
            ...new Set(
              qualityWarnings.map((code) => `${faceLabel}: ${diagnosticWarning(code, false)}`),
            ),
          ]
        : [
            ...new Set(
              proposal.warnings
                .filter(
                  (code) =>
                    !['unsupported_or_unreadable_layout', 'orientation_corrected'].includes(code),
                )
                .map((code) => `${faceLabel}: ${diagnosticWarning(code, false)}`),
            ),
          ];
    if (resultStatus === 'partial' && !proposal.warnings.includes('ocr_partial'))
      sideWarnings.current[face].unshift(
        `${faceLabel}: Đã đọc được một phần. Hãy bổ sung các ô còn thiếu hoặc quét lại mặt này.`,
      );
    const grouped = new Map<string, string[]>();
    for (const face of ['front', 'back'] as const) {
      const label = `Mặt ${face === 'front' ? 'trước' : 'sau'}`;
      for (const warning of sideWarnings.current[face]) {
        const message = warning.slice(label.length + 2);
        grouped.set(message, [...(grouped.get(message) ?? []), label.toLowerCase()]);
      }
    }
    setWarnings(
      [...grouped].map(([message, faces]) => {
        const label = faces.join(' và ');
        return `${label[0]!.toUpperCase()}${label.slice(1)}: ${message}`;
      }),
    );
    if (proposal.proposedFields.placeOfIssue && !merged.conflicts.includes('citizenIdentityNumber'))
      setPlaceOfIssue((previous) => previous || proposal.proposedFields.placeOfIssue!);
    current.current = merged.fields;
    setFields(merged.fields);
    setUncertain((previous) => {
      const next = { ...previous };
      for (const [key] of identityFields) {
        if (
          key === 'fullName' &&
          nameUpgraded &&
          !proposal.warnings.includes('conflicting_fullName')
        )
          delete next.fullName;
        if (merged.conflicts.includes(key) || proposal.warnings.includes(`conflicting_${key}`))
          next[key] = 'Các lần đọc không khớp. Đang giữ dữ liệu trước; hãy đối chiếu CCCD.';
        else if (
          !(key === 'fullName' && mrzNameAgrees) &&
          proposal.proposedFields[key] &&
          Number.isFinite(proposal.confidence[key]) &&
          proposal.confidence[key]! < 0.9
        )
          next[key] = 'OCR chưa chắc chắn. Hãy đối chiếu trực tiếp trên CCCD.';
      }
      return next;
    });
    setChecked(false);
    setSources((previous) => ({
      ...previous,
      ...Object.fromEntries(
        identityFields
          .filter(
            ([key]) =>
              proposal.proposedFields[key] &&
              merged.fields[key] &&
              (!before[key] || (key === 'fullName' && nameUpgraded)),
          )
          .map(([key]) => [key, `Đề xuất OCR mặt ${face === 'front' ? 'trước' : 'sau'}`]),
      ),
    }));
    setScanned(true);
    setAttempted(false);
    reportProgress(face, resultStatus);
    if (
      face === 'front' &&
      resultStatus !== 'failed' &&
      captureProgress.current.back === 'unscanned'
    ) {
      setSide('back');
      setStep('capture');
    } else setStep('verify');
    resetScroll();
    setNotice(
      merged.conflicts.length
        ? 'Có thông tin khác với lần nhập trước. Dữ liệu bạn chỉnh sửa được giữ lại; hãy đối chiếu giấy tờ.'
        : '',
    );
    if (!preview && resultStatus === 'failed') showWarning(sideWarnings.current[face][0]!);
  };
  const scan = async (bytes: Uint8Array<ArrayBuffer>) => {
    if (!api || lock.current || preview) return;
    lock.current = true;
    statusCallback.current?.('recognizing');
    setBusy(true);
    setError('');
    setChecked(false);
    const epoch = generation.current;
    const face = side;
    const controller = new AbortController();
    abort.current = controller;
    let timedOut = false;
    // Also bound authentication refresh/retry, independently of the HTTP timeout.
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, identityOcrRequestTimeoutMilliseconds + 5000);
    try {
      const proposal = await api.image<Proposal>(
        `/api/v1/ocr/identity/${residentId}/${face}`,
        bytes,
        controller.signal,
      );
      if (controller.signal.aborted) throw new Error('Identity OCR request aborted.');
      if (epoch === generation.current) acceptProposal(proposal, face);
    } catch (e) {
      workflowFailure('identity', e);
      if (epoch === generation.current) {
        reportProgress(face, 'failed');
        setError(
          timedOut || (e instanceof MobileApiError && e.code === 'request_timeout')
            ? 'Gửi ảnh hoặc nhận kết quả OCR quá thời gian chờ. Kiểm tra kết nối rồi quét lại.'
            : controller.signal.aborted
              ? 'Đã hủy yêu cầu OCR.'
              : errorMessage(e),
        );
        setNotice(
          'Thông tin đã đọc hoặc nhập trước đó được giữ lại. Bạn có thể quét lại hoặc nhập thủ công.',
        );
        setStep('verify');
        resetScroll();
      }
    } finally {
      clearTimeout(timeout);
      if (abort.current === controller) abort.current = null;
      if (epoch === generation.current) {
        lock.current = false;
        setBusy(false);
        statusCallback.current?.('pending');
      }
    }
  };
  const finishVerification = (summary?: { fullName: string; dateOfBirth: string | null }) => {
    confirmed.current = true;
    onSaveError?.('');
    statusCallback.current?.('confirmed');
    if (summary) onVerifiedSummary?.(summary);
    current.current = emptyIdentity();
    setFields(emptyIdentity());
    setSources({});
    setChecked(false);
    setPlaceOfIssue('');
    setWarnings([]);
    setStep('done');
    resetScroll();
    onConfirmed?.();
  };
  const restoreVerifiedIdentity = async () => {
    if (!api || !locationId || !roomId || lock.current) return;
    lock.current = true;
    setBusy(true);
    const epoch = generation.current;
    try {
      const residents = await captureService(api).residents(locationId);
      if (epoch !== generation.current) return;
      if (
        !residents.some(
          (r) => r.id === residentId && r.roomId === roomId && r.verificationStatus === 1,
        )
      )
        throw new MobileApiError(404);
      finishVerification();
      showSuccess(
        'Đã dùng hồ sơ được máy chủ xác nhận trước đó. Dữ liệu nhập lại không được ghi đè.',
      );
    } catch (e) {
      if (epoch === generation.current) {
        const message = errorMessage(e);
        setError(message);
        onSaveError?.(message);
      }
    } finally {
      if (epoch === generation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  const save = async () => {
    if (lock.current || confirmed.current || alreadyConfirmed || !checked) return;
    setAttempted(true);
    let input: ReturnType<typeof confirmedIdentity>;
    try {
      input = confirmedIdentity(current.current);
    } catch {
      const message = 'Vui lòng kiểm tra các trường được đánh dấu.';
      setError(message);
      onSaveError?.(message);
      return;
    }
    if (!preview && (!api || !session?.roles.includes('Staff'))) {
      setError('Chỉ Staff được phân công mới được lưu thông tin.');
      return;
    }
    setBusy(true);
    lock.current = true;
    setError('');
    onSaveError?.('');
    const epoch = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      if (!preview) {
        const result = await api!.json<{ id: string; verificationStatus: number }>(
          `/api/v1/capture/residents/${residentId}/confirm`,
          input,
          controller.signal,
        );
        if (result.id !== residentId || result.verificationStatus !== 1)
          throw new Error('Chưa nhận được xác nhận lưu hồ sơ. Vui lòng kiểm tra lại.');
      }
      if (epoch !== generation.current) return;
      if (!preview) showSuccess('Đã xác nhận và lưu thông tin CCCD.');
      finishVerification({ fullName: input.fullName, dateOfBirth: input.dateOfBirth });
    } catch (e) {
      workflowFailure('identity', e);
      if (epoch === generation.current) {
        const message = errorMessage(e);
        if (
          e instanceof MobileApiError &&
          e.status === 409 &&
          e.code === 'identity_already_confirmed' &&
          locationId &&
          roomId
        )
          setAlreadyConfirmed(true);
        setError(message);
        onSaveError?.(message);
      }
    } finally {
      clearTimeout(timeout);
      if (epoch === generation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  const closeFlow = () => {
    generation.current++;
    abort.current?.abort();
    lock.current = false;
    setBusy(false);
    setChecked(false);
    if (!confirmed.current)
      statusCallback.current?.(
        Object.values(current.current).some(Boolean) ? 'pending' : 'unscanned',
      );
    if (onDismiss) onDismiss();
    else onCancel();
  };
  const confirmationActions = (
    <>
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {conciseMessage(error)}
        </Text>
      )}
      <Checkbox.Item
        label="Tôi đã đối chiếu giấy tờ gốc và xác nhận toàn bộ thông tin"
        status={checked ? 'checked' : 'unchecked'}
        onPress={() => setChecked(!checked)}
        disabled={busy || alreadyConfirmed}
      />
      <Action
        icon="shield-check-outline"
        disabled={!checked || busy || alreadyConfirmed}
        onPress={() => void save()}
      >
        {busy
          ? 'Đang lưu thông tin…'
          : preview
            ? 'Xác nhận bản mẫu (không lưu máy chủ)'
            : 'Xác nhận thông tin'}
      </Action>
      {alreadyConfirmed && !!locationId && !!roomId && (
        <Button mode="contained" disabled={busy} onPress={() => void restoreVerifiedIdentity()}>
          Dùng hồ sơ đã xác nhận
        </Button>
      )}
    </>
  );
  const wrap = (children: React.ReactNode) => (
    <IdentityFlowFrame
      modal={modal}
      visible={visible && active}
      dark={step === 'capture' && (preview || !!session?.roles.includes('Staff'))}
      title={
        step === 'capture'
          ? `Quét mặt ${side === 'front' ? 'trước' : 'sau'} CCCD · ${side === 'front' ? '1/2' : '2/2'}`
          : step === 'verify'
            ? 'Kiểm tra thông tin'
            : 'Đã xác nhận'
      }
      personLabel={personLabel}
      onClose={closeFlow}
      footer={
        modal &&
        Platform.OS === 'web' &&
        step === 'verify' &&
        (preview || session?.roles.includes('Staff'))
          ? confirmationActions
          : undefined
      }
    >
      {Platform.OS !== 'web' && <IdentityScreenCaptureProtection residentId={residentId} />}
      {children}
    </IdentityFlowFrame>
  );
  if (!preview && !session?.roles.includes('Staff'))
    return wrap(
      <Box>
        <Heading title="Không có quyền xác nhận CCCD" />
        <Text>Chỉ Staff thuộc cơ sở được phân công được thực hiện thao tác này.</Text>
        <Action onPress={modal ? closeFlow : onCancel}>Quay lại</Action>
      </Box>,
    );
  if (step === 'done')
    return wrap(
      <Box>
        <Icon source="check-decagram-outline" color={c.green} size={48} />
        <Heading title={preview ? 'Hoàn tất bản xem trước' : 'Đã xác nhận thông tin'} />
        <Text>
          {preview
            ? 'Mô phỏng thành công; chưa gửi hồ sơ hoặc thay đổi dữ liệu tại máy chủ.'
            : 'Thông tin đã được lưu vào hồ sơ người ở.'}
        </Text>
        <Text>
          Ảnh tạm đã được xóa khỏi thiết bị sau OCR. Đây không phải xác thực chip hoặc xác minh của
          cơ quan nhà nước.
        </Text>
        <Action icon="arrow-right" onPress={onComplete}>
          Tiếp tục
        </Action>
      </Box>,
    );
  if (modal && step === 'capture')
    return wrap(
      preview ? (
        <Box>
          <Heading title="Bản xem trước" />
          <Text>Không chụp hoặc gửi ảnh trong bản xem trước này.</Text>
          <Action onPress={() => setStep('verify')}>Nhập dữ liệu mẫu</Action>
        </Box>
      ) : visible && active ? (
        <CameraCapture
          key={side}
          lensPreferenceRef={cameraLensPreferenceRef}
          label="Quét CCCD"
          presentation="document"
          documentSide={side}
          disabled={busy}
          reviewBeforeSubmit
          onCapture={scan}
          onPhotoCaptured={() => reportProgress(side, 'captured')}
          onManual={() => {
            setStep('verify');
            setChecked(false);
            statusCallback.current?.('pending');
          }}
        />
      ) : null,
    );
  return wrap(
    <>
      {!modal && (
        <Heading
          title={
            step === 'capture'
              ? `Chụp mặt ${side === 'front' ? 'trước' : 'sau'} CCCD`
              : 'Kiểm tra & Xác nhận OCR'
          }
          detail="Chụp CCCD hoặc nhập thủ công, sau đó đối chiếu và xác nhận thông tin."
        />
      )}
      {!modal && (
        <Row>
          <Pill tone={step === 'capture' ? 'blue' : 'neutral'}>1. Chụp giấy tờ</Pill>
          <Pill tone={step === 'verify' ? 'blue' : 'neutral'}>2. Kiểm tra & Lưu</Pill>
        </Row>
      )}
      <Box style={{ backgroundColor: c.tint }}>
        <Row>
          <Icon source="shield-lock-outline" size={26} color={c.blue} />
          <Text variant="bodySmall" style={ui.grow}>
            Ảnh CCCD chỉ phục vụ OCR tạm thời. Không tải vào kho ảnh, không giữ ảnh làm hồ sơ. Khi
            rời ứng dụng, dữ liệu chưa lưu được xóa.
          </Text>
        </Row>
      </Box>
      {step === 'capture' ? (
        <Box>
          <View
            style={{
              padding: 24,
              backgroundColor: c.soft,
              borderRadius: 12,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: c.blue,
              alignItems: 'center',
              gap: 12,
            }}
          >
            <Icon source="card-account-details-outline" size={64} color={c.primary} />
            <Text variant="titleMedium">MẶT {side === 'front' ? 'TRƯỚC' : 'SAU'} CCCD</Text>
            <Text variant="bodySmall" style={ui.muted}>
              Đặt đủ 4 góc trong khung, đủ sáng, không lóa. Giữ khoảng cách để chữ rõ.
            </Text>
            <Pill tone={scanned ? 'blue' : 'neutral'}>
              {scanned ? 'Đã nhận đề xuất OCR' : 'Chưa xử lý ảnh'}
            </Pill>
          </View>
          {preview ? (
            <>
              <Action
                icon="text-recognition"
                onPress={() =>
                  acceptProposal({
                    proposedFields: {
                      citizenIdentityNumber: '000000000001',
                      fullName: 'CƯ DÂN MẪU',
                      dateOfBirth: '2000-01-01',
                      gender: 'Nam',
                      nationality: 'Việt Nam',
                    },
                    warnings: [],
                    missingFields: [],
                    confidence: {},
                    isFallback: false,
                    requiresConfirmation: true,
                  })
                }
              >
                Nhận đề xuất OCR mẫu mặt trước
              </Action>
              <Button
                textColor={c.red}
                onPress={() => {
                  setError('Mô phỏng: OCR không đọc được ảnh.');
                  setNotice('Bạn có thể chụp lại hoặc nhập thủ công.');
                }}
              >
                Thử trạng thái OCR thất bại
              </Button>
            </>
          ) : (
            active && (
              <CameraCapture
                key={side}
                lensPreferenceRef={cameraLensPreferenceRef}
                label={`${scanned ? 'Chụp lại' : 'Chụp ảnh'} mặt ${side === 'front' ? 'trước' : 'sau'}`}
                documentSide={side}
                disabled={busy}
                reviewBeforeSubmit
                onCapture={scan}
              />
            )
          )}
          <Action
            secondary
            disabled={busy}
            icon="pencil-outline"
            onPress={() => {
              setStep('verify');
              statusCallback.current?.('pending');
              resetScroll();
              setChecked(false);
            }}
          >
            Nhập thủ công / Kiểm tra thông tin
          </Action>
        </Box>
      ) : (
        <Box>
          <Pill tone="amber">Chờ bạn kiểm tra và xác nhận</Pill>
          {typeof __DEV__ !== 'undefined' && __DEV__ && (
            <Button
              mode="outlined"
              icon="lightning-bolt-outline"
              disabled={busy}
              onPress={() => {
                const samples: IdentityFields = {
                  citizenIdentityNumber: `999${Date.now().toString().slice(-9)}`,
                  fullName: 'Nguoi Kiem Thu',
                  dateOfBirth: '01/01/2000',
                  gender: 'Nam',
                  nationality: 'Việt Nam',
                  placeOfOrigin: 'Hà Nội',
                  residentialAddress: 'Địa chỉ kiểm thử, Hà Nội',
                  dateOfIssue: '01/01/2024',
                  dateOfExpiry: '01/01/2034',
                };
                const next = { ...current.current };
                const nextSources = { ...sources };
                for (const [key] of identityFields) {
                  if (next[key].trim()) continue;
                  next[key] = samples[key];
                  nextSources[key] = 'Dữ liệu mẫu kiểm thử';
                }
                current.current = next;
                setFields(next);
                setSources(nextSources);
                setChecked(false);
                statusCallback.current?.('pending');
                setNotice(
                  'Đã điền mẫu vào các ô trống. Kiểm tra lại trước khi xác nhận lưu lên hệ thống.',
                );
              }}
            >
              Điền nhanh dữ liệu test
            </Button>
          )}
          <Text variant="bodySmall" style={ui.muted}>
            Kiểm tra số CCCD, họ tên và ngày sinh. Bổ sung phần còn thiếu, tích ô đối chiếu rồi bấm
            Xác nhận thông tin để tiếp tục.
          </Text>
          {[
            ...identityFields.filter(([key]) => key !== 'dateOfIssue'),
            identityFields.find(([key]) => key === 'dateOfIssue')!,
          ].map(([key, label]) => {
            const onChange = (value: string) => {
              const next = { ...current.current, [key]: value };
              current.current = next;
              setFields(next);
              if (key === 'fullName') unaccentedName.current = false;
              statusCallback.current?.('pending');
              setChecked(false);
              setUncertain((previous) => ({ ...previous, [key]: undefined }));
              setSources((before) => ({ ...before, [key]: 'Staff nhập / chỉnh sửa' }));
            };
            const onBlur = () => setTouched((before) => ({ ...before, [key]: true }));
            const error = !!fieldErrors[key] && (scanned || attempted || !!touched[key]);
            const fieldLabel = `${key === 'dateOfIssue' ? 'Ngày cấp CCCD (dd/MM/yyyy)' : label}${['citizenIdentityNumber', 'fullName', 'dateOfBirth'].includes(key) ? ' *' : ''}`;
            return (
              <View key={key} style={{ gap: 4 }}>
                {key === 'citizenIdentityNumber' && <Heading title="Thông tin định danh" />}
                {key === 'dateOfIssue' && (
                  <Heading title="Thông tin mặt sau" detail="Đối chiếu Ngày cấp trên giấy tờ." />
                )}
                {key.startsWith('dateOf') ? (
                  <IdentityDateField
                    label={fieldLabel}
                    accessibilityLabel={label}
                    value={fields[key]}
                    disabled={busy}
                    error={error}
                    onBlur={onBlur}
                    onChange={onChange}
                  />
                ) : (
                  <TextInput
                    mode="outlined"
                    accessibilityLabel={label}
                    style={{ minHeight: 50, backgroundColor: c.white }}
                    label={fieldLabel}
                    value={fields[key]}
                    disabled={busy}
                    error={error}
                    onBlur={onBlur}
                    keyboardType={key === 'citizenIdentityNumber' ? 'number-pad' : 'default'}
                    multiline={key === 'placeOfOrigin' || key === 'residentialAddress'}
                    onChangeText={onChange}
                  />
                )}
                <Text
                  accessibilityRole={
                    uncertain[key] || (fieldErrors[key] && (scanned || attempted || touched[key]))
                      ? 'alert'
                      : undefined
                  }
                  variant="labelSmall"
                  style={
                    fieldErrors[key] && (scanned || attempted || touched[key]) ? ui.red : ui.muted
                  }
                >
                  {fieldErrors[key] && (scanned || attempted || touched[key])
                    ? fieldErrors[key]
                    : uncertain[key]
                      ? `Cần đối chiếu: ${uncertain[key]}`
                      : key === 'dateOfIssue' && !fields.dateOfIssue
                        ? 'Chưa đọc được Ngày cấp. Vui lòng nhập theo giấy tờ.'
                        : (sources[key] ?? 'Chưa có dữ liệu • Có thể nhập thủ công')}
                </Text>
              </View>
            );
          })}
          {!!placeOfIssue && (
            <Text variant="bodySmall">
              Nơi cấp đọc từ ảnh: {placeOfIssue} (thông tin tham khảo, chưa lưu vào hồ sơ).
            </Text>
          )}
          {(!modal || Platform.OS !== 'web') && confirmationActions}
          {(['front', 'back'] as const).map((face) => (
            <Button
              key={face}
              disabled={busy}
              onPress={() => {
                setChecked(false);
                setSide(face);
                setStep('capture');
                resetScroll();
              }}
            >
              Chụp lại mặt {face === 'front' ? 'trước' : 'sau'}
            </Button>
          ))}
        </Box>
      )}
      {busy && (
        <Row>
          <ActivityIndicator />
          <Text>{step === 'capture' ? 'Đang nhận dạng chữ…' : 'Đang lưu thông tin…'}</Text>
          <Button onPress={() => abort.current?.abort()}>Hủy yêu cầu</Button>
        </Row>
      )}
      {warnings.map((warning, index) => (
        <Text key={`${index}:${warning}`} variant="bodySmall" style={{ color: c.amber }}>
          {warning}
        </Text>
      ))}
      {!!notice && (
        <Text variant="bodySmall" style={ui.blue}>
          {notice}
        </Text>
      )}
      {!!error && step !== 'verify' && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      <Button disabled={busy} onPress={modal ? closeFlow : onCancel}>
        {modal ? 'Về danh sách người ở' : 'Quay lại người ở'}
      </Button>
    </>,
  );
}
