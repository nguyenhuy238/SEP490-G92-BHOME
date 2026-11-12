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
import { Action, Box, Heading, Pill, Row, ui } from '../../components/WorkspaceKit';
import { useSession } from '../../lib/SessionProvider';
import { errorMessage, type Proposal } from '../../lib/api';
import {
  confirmedIdentity,
  emptyIdentity,
  identityFields,
  mergeIdentity,
  type IdentityFields,
} from '../../lib/identity';
import { diagnosticWarning } from '../../lib/ocrDiagnostics';
import {
  emptyCaptureProgress,
  type CaptureProgress,
  type IdentitySide,
  type IdentityStatus,
} from './onboarding';
import { IdentityFlowFrame } from './IdentityFlowFrame';
import { identityFieldErrors } from './identityFieldErrors';
import { showSuccess, showWarning } from '../../lib/toast';
import { colors as c } from '../../theme/theme';
import { useWorkspace } from '../workspace/WorkspaceProvider';

interface Props {
  residentId: string;
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
  onVerifiedSummary?: (summary: { fullName: string; dateOfBirth: string | null }) => void;
  onStatusChange?: (status: IdentityStatus) => void;
  onCaptureProgress?: (progress: CaptureProgress) => void;
  onCancel: () => void;
}
export function IdentityWizard({
  residentId,
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
  onVerifiedSummary,
  onStatusChange,
  onCaptureProgress,
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
  const [side, setSide] = useState<IdentitySide>('front');
  const captureProgress = useRef(emptyCaptureProgress());
  const progressCallback = useRef(onCaptureProgress);
  useEffect(() => {
    progressCallback.current = onCaptureProgress;
  }, [onCaptureProgress]);
  const reportProgress = (face: IdentitySide, status: CaptureProgress[IdentitySide]) => {
    captureProgress.current = { ...captureProgress.current, [face]: status };
    progressCallback.current?.(captureProgress.current);
  };
  const [fields, setFields] = useState(emptyIdentity);
  const [sources, setSources] = useState<Partial<Record<keyof IdentityFields, string>>>({});
  const current = useRef(fields);
  const fieldOrigin = useRef<Partial<Record<keyof IdentityFields, IdentitySide | 'manual'>>>({});
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
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
  const dismissCallback = useRef(onDismiss);
  useEffect(() => {
    statusCallback.current = onStatusChange;
  }, [onStatusChange]);
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
  usePreventScreenCapture(`identity-wizard-${residentId}`);
  useEffect(() => {
    if (Platform.OS === 'ios') void enableAppSwitcherProtectionAsync().catch(() => {});
    const clear = () => {
      if (confirmed.current) return;
      statusCallback.current?.('unscanned');
      setWarnings([]);
      sideWarnings.current = { front: [], back: [] };
      setPlaceOfIssue('');
      generation.current++;
      abort.current?.abort();
      lock.current = false;
      setBusy(false);
      setAttempted(false);
      setTouched({});
      current.current = emptyIdentity();
      fieldOrigin.current = {};
      setFields(emptyIdentity());
      setSources({});
      setChecked(false);
      setScanned(false);
      captureProgress.current = emptyCaptureProgress();
      progressCallback.current?.(captureProgress.current);
      setSide('front');
      setNotice(
        'Thông tin tạm đã xóa khi ứng dụng rời trạng thái hoạt động. Hãy chụp lại hoặc nhập thủ công.',
      );
      if (modal) dismissCallback.current?.();
    };
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') clear();
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
    // Replace only this side's earlier OCR suggestions. Never overwrite Staff edits or the other side.
    const before = { ...current.current };
    for (const [key] of identityFields) {
      if (fieldOrigin.current[key] === face) before[key] = '';
    }
    const merged = mergeIdentity(before, proposal);
    for (const [key] of identityFields) {
      if (!before[key] && proposal.proposedFields[key]) fieldOrigin.current[key] = face;
    }
    statusCallback.current?.('pending');
    sideWarnings.current[face] = [
      ...proposal.warnings.map(diagnosticWarning),
      ...proposal.missingFields.map((key) => {
        const label = identityFields.find(([name]) => name === key)?.[1];
        return label
          ? `Chưa đọc được ${label.toLowerCase()}. Bạn có thể nhập bổ sung.`
          : 'Một số thông tin chưa đọc được. Hãy đối chiếu giấy tờ.';
      }),
    ];
    setWarnings([...new Set([...sideWarnings.current.front, ...sideWarnings.current.back])]);
    if (proposal.proposedFields.placeOfIssue) setPlaceOfIssue(proposal.proposedFields.placeOfIssue);
    current.current = merged.fields;
    setFields(merged.fields);
    setChecked(false);
    setSources((before) => ({
      ...Object.fromEntries(
        identityFields
          .filter(([key]) => proposal.proposedFields[key])
          .map(([key]) => [key, `Đề xuất OCR mặt ${face === 'front' ? 'trước' : 'sau'}`]),
      ),
      ...before,
    }));
    setScanned(true);
    setAttempted(false);
    reportProgress(
      face,
      !proposal.isFallback && Object.values(proposal.proposedFields).some(Boolean)
        ? 'recognized'
        : 'captured',
    );
    if (face === 'front' && captureProgress.current.back === 'unscanned') {
      setSide('back');
      setStep('capture');
    } else setStep('verify');
    resetScroll();
    setNotice(
      proposal.isFallback
        ? 'OCR không đọc đủ dữ liệu. Chụp lại hoặc chuyển sang nhập thủ công.'
        : `Đã nhận đề xuất, chưa xác minh. ${merged.conflicts.length ? 'Có thông tin khác với lần nhập trước; hãy đối chiếu lại giấy tờ.' : ''} ${proposal.warnings.length || proposal.missingFields.length ? 'Có cảnh báo hoặc thiếu trường. Hãy kiểm tra toàn bộ.' : ''}`,
    );
    if (!preview && (proposal.isFallback || proposal.warnings.length > 0))
      showWarning('OCR cần được kiểm tra lại. Bạn có thể sửa thông tin hoặc nhập thủ công.');
  };
  const scan = async (bytes: Uint8Array<ArrayBuffer>) => {
    if (!api || lock.current || preview) return;
    lock.current = true;
    statusCallback.current?.('recognizing');
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
      if (epoch === generation.current) acceptProposal(proposal);
    } catch (e) {
      workflowFailure('identity', e);
      if (epoch === generation.current) {
        setError(errorMessage(e));
        setNotice('OCR chưa thành công; nhập thủ công vẫn khả dụng.');
        setStep('verify');
        resetScroll();
      }
    } finally {
      clearTimeout(timeout);
      if (epoch === generation.current) {
        lock.current = false;
        setBusy(false);
        statusCallback.current?.('pending');
      }
    }
  };
  const save = async () => {
    if (lock.current || confirmed.current || !checked) return;
    setAttempted(true);
    let input: ReturnType<typeof confirmedIdentity>;
    try {
      input = confirmedIdentity(current.current);
    } catch {
      setError('Vui lòng kiểm tra các trường được đánh dấu.');
      return;
    }
    if (!preview && (!api || !session?.roles.includes('Staff'))) {
      setError('Chỉ Staff được phân công mới được lưu thông tin.');
      return;
    }
    setBusy(true);
    lock.current = true;
    setError('');
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
      confirmed.current = true;
      if (!preview) showSuccess('Đã xác nhận và lưu thông tin CCCD.');
      statusCallback.current?.('confirmed');
      onVerifiedSummary?.({ fullName: input.fullName, dateOfBirth: input.dateOfBirth });
      current.current = emptyIdentity();
      setFields(emptyIdentity());
      setSources({});
      setChecked(false);
      setPlaceOfIssue('');
      setWarnings([]);
      setStep('done');
      resetScroll();
      onConfirmed?.();
    } catch (e) {
      workflowFailure('identity', e);
      if (epoch === generation.current) setError(errorMessage(e));
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
    >
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
          title={step === 'capture' ? 'Chụp mặt trước CCCD' : 'Kiểm tra & Xác nhận OCR'}
          detail="Chụp mặt trước hoặc nhập thủ công, sau đó đối chiếu và xác nhận thông tin."
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
            <Text variant="titleMedium">MẶT TRƯỚC CCCD</Text>
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
                label={`${scanned ? 'Chụp lại' : 'Chụp ảnh'} mặt trước`}
                documentSide="front"
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
          <Text variant="bodySmall" style={ui.muted}>
            Kiểm tra số CCCD, họ tên và ngày sinh. Bổ sung phần còn thiếu, tích ô đối chiếu rồi bấm
            Xác nhận thông tin để tiếp tục.
          </Text>
          {[
            ...identityFields.filter(([key]) => key !== 'dateOfIssue'),
            identityFields.find(([key]) => key === 'dateOfIssue')!,
          ].map(([key, label]) => (
            <View key={key} style={{ gap: 4 }}>
              {key === 'citizenIdentityNumber' && <Heading title="Thông tin định danh" />}
              {key === 'dateOfIssue' && (
                <Heading title="Thông tin mặt sau" detail="Đối chiếu Ngày cấp trên giấy tờ." />
              )}
              <TextInput
                mode="outlined"
                accessibilityLabel={label}
                style={{ minHeight: 50, backgroundColor: c.white }}
                label={`${key === 'dateOfIssue' ? 'Ngày cấp CCCD (dd/MM/yyyy)' : label}${['citizenIdentityNumber', 'fullName', 'dateOfBirth'].includes(key) ? ' *' : ''}`}
                value={fields[key]}
                disabled={busy}
                error={!!fieldErrors[key] && (scanned || attempted || !!touched[key])}
                onBlur={() => setTouched((before) => ({ ...before, [key]: true }))}
                keyboardType={key === 'citizenIdentityNumber' ? 'number-pad' : 'default'}
                onChangeText={(value) => {
                  const next = { ...current.current, [key]: value };
                  current.current = next;
                  fieldOrigin.current[key] = 'manual';
                  setFields(next);
                  statusCallback.current?.('pending');
                  setChecked(false);
                  setSources((before) => ({ ...before, [key]: 'Staff nhập / chỉnh sửa' }));
                }}
              />
              <Text
                accessibilityRole={
                  fieldErrors[key] && (scanned || attempted || touched[key]) ? 'alert' : undefined
                }
                variant="labelSmall"
                style={
                  fieldErrors[key] && (scanned || attempted || touched[key]) ? ui.red : ui.muted
                }
              >
                {fieldErrors[key] && (scanned || attempted || touched[key])
                  ? fieldErrors[key]
                  : key === 'dateOfIssue' && !fields.dateOfIssue
                    ? 'Chưa đọc được Ngày cấp. Vui lòng nhập theo giấy tờ.'
                    : (sources[key] ?? 'Chưa có dữ liệu • Có thể nhập thủ công')}
              </Text>
            </View>
          ))}
          {!!placeOfIssue && (
            <Text variant="bodySmall">
              Nơi cấp đọc từ ảnh: {placeOfIssue} (thông tin tham khảo, chưa lưu vào hồ sơ).
            </Text>
          )}
          <Checkbox.Item
            label="Tôi đã đối chiếu giấy tờ gốc và xác nhận toàn bộ thông tin"
            status={checked ? 'checked' : 'unchecked'}
            onPress={() => setChecked(!checked)}
            disabled={busy}
          />
          <Action
            icon="shield-check-outline"
            disabled={!checked || busy}
            onPress={() => void save()}
          >
            {preview ? 'Xác nhận bản mẫu (không lưu máy chủ)' : 'Xác nhận thông tin'}
          </Action>
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
      {!!error && (
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
