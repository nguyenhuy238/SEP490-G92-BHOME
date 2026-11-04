import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, View } from 'react-native';
import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Button, Checkbox, Text } from 'react-native-paper';
import { CameraCapture } from '../components/CameraCapture';
import { Field, Page, styles } from '../components/Controls';
import { Box, Heading, Pill, ui } from '../components/WorkspaceKit';
import { MeterFlowHeader } from '../components/MeterFlowHeader';
import { WorkspaceShell } from '../components/WorkspaceShell';
import { useSession } from '../lib/SessionProvider';
import { useFeedbackState } from '../lib/useFeedbackState';
import { showSuccess } from '../lib/toast';
import { errorMessage, type MeterTask, type Proposal } from '../lib/api';
import type { ConfirmedReading } from '../../../../packages/client-core/src/meter';
import { displayContractDate } from '../../../../packages/client-core/src/contracts';
import { meterService } from '../services/meterService';
import {
  estimatedConsumption,
  normalizedReading,
  readingDecreased,
  readingError,
} from '../features/workspace/meterReading';

export default function MeterScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { api, session } = useSession();
  if (!api || !session) return <Redirect href="/" />;
  if (!session.roles.includes('Staff'))
    return (
      <Page>
        <Text>Chỉ Staff được giao cơ sở mới có thể ghi chỉ số.</Text>
      </Page>
    );
  if (!taskId)
    return (
      <WorkspaceShell screen="meter-reading">
        <Text>Không tìm thấy mã tác vụ.</Text>
      </WorkspaceShell>
    );
  return <MeterTaskScreen key={`${session.userId}:${taskId}`} taskId={taskId} />;
}

function MeterTaskScreen({ taskId }: { taskId: string }) {
  const { api } = useSession();
  const [task, setTask] = useState<MeterTask | null>(null);
  const [reading, setReading] = useState('');
  const [evidence, setEvidence] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [checked, setChecked] = useState(false);
  const [step, setStep] = useState(1);
  const [error, setError] = useFeedbackState();
  const [notice, setNotice] = useFeedbackState('info');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState<ConfirmedReading | null>(null);
  const lock = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const clearPhoto = () => {
    setEvidence('');
    setProposal(null);
    setReading('');
    setChecked(false);
    setStep(1);
    setNotice('');
  };
  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') abort.current?.abort();
    });
    return () => {
      mounted.current = false;
      sub.remove();
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (api)
      void (async () => {
        try {
          const current = await meterService(api).task(taskId, controller.signal);
          if (controller.signal.aborted) return;
          setTask(current);
          if (current.confirmedReadingId) {
            const result = await meterService(api).reading(
              current.confirmedReadingId,
              controller.signal,
            );
            if (!controller.signal.aborted) setSaved(result);
          }
        } catch (e) {
          if (!controller.signal.aborted) setError(errorMessage(e));
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
    return () => controller.abort();
  }, [api, taskId, revision, setError]);
  const list = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/workspace/[screen]', params: { screen: 'meter-reading' } });
  };
  const back = () => {
    if (busy) return;
    if (saved || step === 1) list();
    else {
      setStep(step - 1);
      setChecked(false);
      setError('');
    }
  };
  useFocusEffect(useCallback(() => () => abort.current?.abort(), []));
  useFocusEffect(
    useCallback(() => {
      const listener = BackHandler.addEventListener('hardwareBackPress', () => {
        if (busy) return true;
        if (step > 1 && !saved) {
          setStep(step - 1);
          setChecked(false);
          return true;
        }
        return false;
      });
      return () => listener.remove();
    }, [busy, step, saved]),
  );
  const unit = task?.utilityType === 0 ? 'kWh' : 'm³';
  const meterLabel = task?.utilityType === 0 ? 'Điện' : 'Nước';
  const captureLabel = task?.utilityType === 0 ? 'Chụp công tơ điện' : 'Chụp đồng hồ nước';
  const validation = task ? readingError(reading, task.decimalPlaces) : '';
  const decreased = readingDecreased(reading, task?.previousValue ?? null);
  const consumption = estimatedConsumption(reading, task?.previousValue ?? null);
  const editable = !!task && task.status < 2;

  async function recognize(bytes: Uint8Array<ArrayBuffer>) {
    if (lock.current || !api || !editable) return;
    // Back/forward through an unchanged photo preserves the Staff's correction.
    if (evidence && step === 1) {
      setStep(2);
      return;
    }
    lock.current = true;
    setStep(2);
    setBusy(true);
    setError('');
    setEvidence('');
    setProposal(null);
    setChecked(false);
    setReading('');
    const controller = new AbortController();
    abort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      try {
        const result = await api.image<Proposal>(
          `/api/v1/ocr/meter-tasks/${encodeURIComponent(taskId)}`,
          bytes,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setProposal(result);
        setReading(result.proposedFields.reading || '');
        setNotice(
          result.isFallback || !result.proposedFields.reading
            ? 'Không nhận diện được chỉ số. Hãy thử lại hoặc nhập tay.'
            : '',
        );
      } catch (e) {
        if (controller.signal.aborted) throw e;
        if (
          e &&
          typeof e === 'object' &&
          'status' in e &&
          [401, 403, 404].includes(Number(e.status))
        )
          throw e;
        setNotice('Không nhận diện được chỉ số. Hãy thử lại hoặc nhập tay.');
      }
      const file = await api.image<{ id: string }>(
        `/api/v1/capture/meter-tasks/${encodeURIComponent(taskId)}/evidence`,
        bytes,
        controller.signal,
        'PUT',
      );
      if (!controller.signal.aborted) setEvidence(file.id);
    } catch (e) {
      if (mounted.current)
        setError(controller.signal.aborted ? 'Đã dừng nhận diện. Hãy thử lại.' : errorMessage(e));
    } finally {
      clearTimeout(timeout);
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function confirm() {
    if (lock.current || !api || !task || !editable || !checked || !evidence || step !== 3) return;
    if (validation || decreased) {
      setError(validation || 'Chỉ số nhỏ hơn kỳ trước. Kiểm tra lại hoặc liên hệ Owner.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const result = await meterService(api).confirm(
        taskId,
        normalizedReading(reading),
        evidence,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setSaved(result);
        showSuccess('Đã lưu chỉ số.');
      }
    } catch (e) {
      if (mounted.current)
        setError(
          controller.signal.aborted
            ? 'Chưa rõ kết quả lưu. Thử lại với cùng ảnh và chỉ số.'
            : errorMessage(e),
        );
    } finally {
      clearTimeout(timeout);
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <WorkspaceShell screen="meter-reading" onBack={back} backDisabled={busy} contentRevision={step}>
      <MeterFlowHeader step={saved ? 3 : step} />
      {loading && <ActivityIndicator accessibilityLabel="Đang tải tác vụ" />}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!loading && !task && (
        <Button
          onPress={() => {
            setLoading(true);
            setError('');
            setRevision((v) => v + 1);
          }}
        >
          Thử tải lại tác vụ
        </Button>
      )}
      {task && (
        <Box style={{ padding: 14, gap: 8 }}>
          <Heading title={`${meterLabel} · Phòng ${task.room}`} detail={task.location} />
          <Text style={ui.muted}>
            {task.meterCode} ·{' '}
            {task.purpose === 0
              ? 'Chỉ số ban đầu'
              : task.purpose === 2
                ? 'Chốt trả phòng'
                : `Kỳ ${displayContractDate(task.billingPeriod ?? task.readingDate)}`}
          </Text>
          {step === 1 && (
            <Text>
              Chỉ số trước: {task.previousValue ?? 'Chưa có'}{' '}
              {task.previousValue !== null ? unit : ''}
            </Text>
          )}
        </Box>
      )}
      {saved ? (
        <Box style={{ padding: 14, gap: 10 }}>
          <Pill tone="green">Đã lưu chỉ số</Pill>
          <Text variant="headlineMedium">
            {saved.confirmedValue} {unit}
          </Text>
          <Text>Chỉ số trước: {saved.previousValue ?? 'Chưa có'}</Text>
          <Text>
            Tiêu thụ:{' '}
            {saved.consumption === null ? 'Chỉ số ban đầu' : `${saved.consumption} ${unit}`}
          </Text>
          <Button mode="contained" contentStyle={{ minHeight: 48 }} onPress={list}>
            Chọn tác vụ tiếp theo
          </Button>
        </Box>
      ) : (
        task && (
          <>
            {!editable && <Text>Tác vụ đã đóng.</Text>}
            <CameraCapture
              label={captureLabel}
              presentation="meter"
              meterStep={step}
              retainPreview
              reviewBeforeSubmit
              disabled={busy || !editable}
              onPhotoCleared={clearPhoto}
              onCapture={recognize}
            />
            {busy && (
              <View style={{ gap: 8 }}>
                <ActivityIndicator />
                <Text>{step === 3 ? 'Đang lưu…' : 'Đang nhận diện…'}</Text>
              </View>
            )}
            {step >= 2 && (
              <Box style={{ padding: 14, gap: 10 }}>
                {step === 2 && !!notice && <Text accessibilityLiveRegion="polite">{notice}</Text>}
                <Text>
                  Chỉ số trước: {task.previousValue ?? 'Chưa có'}{' '}
                  {task.previousValue !== null ? unit : ''}
                </Text>
                {!!proposal?.proposedFields.reading && (
                  <Text>
                    Chỉ số OCR: {proposal.proposedFields.reading} {unit}
                  </Text>
                )}
                {step === 2 ? (
                  <>
                    {typeof proposal?.confidence === 'number' && (
                      <Text style={ui.muted}>
                        Độ tin cậy OCR: {Math.round(proposal.confidence * 100)}%
                      </Text>
                    )}
                    {!!proposal?.warnings.length && (
                      <Text style={ui.muted}>Kiểm tra lại mặt số và dấu thập phân.</Text>
                    )}
                    <Field
                      label={`Chỉ số xác nhận (${unit})`}
                      value={reading}
                      numeric
                      onChange={(v) => {
                        if (!busy) {
                          setReading(v);
                          setChecked(false);
                        }
                      }}
                    />
                  </>
                ) : (
                  <Text variant="titleLarge">
                    Chỉ số xác nhận: {reading} {unit}
                  </Text>
                )}
                {!!validation && !busy && <Text style={ui.red}>{validation}</Text>}
                {decreased && (
                  <Text style={ui.red}>
                    Chỉ số nhỏ hơn kỳ trước. Kiểm tra lại hoặc liên hệ Owner.
                  </Text>
                )}
                {consumption !== null && (
                  <Text variant="titleMedium">
                    Tiêu thụ dự kiến: {consumption} {unit}
                  </Text>
                )}
                {step === 2 ? (
                  <Button
                    mode="contained"
                    contentStyle={{ minHeight: 48 }}
                    disabled={busy || !evidence || !!validation || decreased}
                    onPress={() => setStep(3)}
                  >
                    Tiếp tục
                  </Button>
                ) : (
                  <>
                    <Checkbox.Item
                      label="Tôi đã đối chiếu ảnh và chỉ số"
                      status={checked ? 'checked' : 'unchecked'}
                      onPress={() => setChecked(!checked)}
                      disabled={busy}
                    />
                    <Button
                      mode="contained"
                      contentStyle={{ minHeight: 48 }}
                      loading={busy}
                      disabled={busy || !evidence || !checked || !!validation || decreased}
                      onPress={() => void confirm()}
                    >
                      Xác nhận & lưu
                    </Button>
                  </>
                )}
                <Button disabled={busy} onPress={back}>
                  Quay lại
                </Button>
              </Box>
            )}
            {busy && <Button onPress={() => abort.current?.abort()}>Hủy yêu cầu</Button>}
          </>
        )
      )}
    </WorkspaceShell>
  );
}
