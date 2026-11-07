import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, View } from 'react-native';
import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Button, Checkbox, Text } from 'react-native-paper';
import { CameraCapture } from '../components/CameraCapture';
import { Field, Page, styles } from '../components/Controls';
import { Box, Heading, Pill, ui } from '../components/WorkspaceKit';
import { WorkspaceShell } from '../components/WorkspaceShell';
import { useSession } from '../lib/SessionProvider';
import { useFeedbackState } from '../lib/useFeedbackState';
import { showSuccess } from '../lib/toast';
import { errorMessage, type MeterTask, type Proposal } from '../lib/api';
import type { ConfirmedReading } from '../../../../packages/client-core/src/meter';
import { meterService } from '../services/meterService';
import { MeterRoomOverview } from '../screens/MeterRoomOverview';
import { meterRoundLabel, roomMeterTasks } from '../features/workspace/roomMeterTasks';
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
  return <RoomMeterScreen key={`${session.userId}:${taskId}`} taskId={taskId} />;
}

function RoomMeterScreen({ taskId }: { taskId: string }) {
  const { api } = useSession();
  const [tasks, setTasks] = useState<MeterTask[]>([]);
  const [readings, setReadings] = useState<Record<string, ConfirmedReading>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useFeedbackState();
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const loadAbort = useRef<AbortController | null>(null);
  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    setRevision((value) => value + 1);
  }, [setError]);
  const returnToOverview = useCallback(() => {
    setSelected(null);
    reload();
  }, [reload]);
  useFocusEffect(
    useCallback(() => {
      reload();
      return () => loadAbort.current?.abort();
    }, [reload]),
  );
  useEffect(() => {
    if (!api || revision === 0) return;
    const controller = new AbortController();
    loadAbort.current = controller;
    void (async () => {
      try {
        const client = meterService(api);
        const current = await client.task(taskId, controller.signal);
        const candidates: MeterTask[] = [];
        if (current.roomId && current.locationId) {
          for (let page = 1; ; page++) {
            const batch = await api.request<MeterTask[]>(
              `/api/v1/capture/meter-tasks?roomId=${encodeURIComponent(current.roomId)}&locationId=${encodeURIComponent(current.locationId)}&page=${page}`,
              { signal: controller.signal },
            );
            if (controller.signal.aborted) return;
            candidates.push(...batch);
            if (batch.length < 100) break;
          }
        }
        const roomTasks = roomMeterTasks(current, candidates);
        const saved: Record<string, ConfirmedReading> = {};
        for (const task of roomTasks) {
          if (task.confirmedReadingId)
            saved[task.id] = await client.reading(task.confirmedReadingId, controller.signal);
          else if (task.status === 2) throw new Error('Missing confirmed meter reading.');
        }
        if (controller.signal.aborted) return;
        setTasks(roomTasks);
        setReadings(saved);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setTasks([]);
          setReadings({});
          setError(errorMessage(failure));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [api, taskId, revision, setError]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !selected) reload();
    });
    return () => listener.remove();
  }, [selected, reload]);
  if (selected)
    return <MeterTaskScreen key={selected} taskId={selected} onReturn={returnToOverview} />;
  return (
    <MeterRoomOverview
      tasks={tasks}
      readings={readings}
      loading={loading}
      error={error}
      onSelect={setSelected}
      onReload={reload}
      onBack={() => {
        if (router.canGoBack()) router.back();
        else
          router.replace({ pathname: '/workspace/[screen]', params: { screen: 'meter-reading' } });
      }}
    />
  );
}

function MeterTaskScreen({ taskId, onReturn }: { taskId: string; onReturn: () => void }) {
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
  const back = () => {
    if (!lock.current) onReturn();
  };
  useFocusEffect(useCallback(() => () => abort.current?.abort(), []));
  useFocusEffect(
    useCallback(() => {
      const listener = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!lock.current) onReturn();
        return true;
      });
      return () => listener.remove();
    }, [onReturn]),
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
    if (lock.current || !api || !task || !editable || !checked || !evidence || step !== 2) return;
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
      const client = meterService(api);
      const current = await client.task(taskId, controller.signal);
      const result = current.confirmedReadingId
        ? await client.reading(current.confirmedReadingId, controller.signal)
        : await client.confirm(taskId, normalizedReading(reading), evidence, controller.signal);
      if (!controller.signal.aborted) {
        setSaved(result);
        showSuccess('Đã lưu chỉ số.');
        onReturn();
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
      <Heading title="Ghi chỉ số điện nước" />
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
            {task.meterCode} · {meterRoundLabel(task)}
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
          <Button mode="contained" contentStyle={{ minHeight: 48 }} onPress={onReturn}>
            Về tổng quan phòng
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
              autoOpen={editable}
              disabled={busy || !editable}
              onPhotoCleared={clearPhoto}
              onCapture={recognize}
            />
            {busy && (
              <View style={{ gap: 8 }}>
                <ActivityIndicator />
                <Text>Đang xử lý…</Text>
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
                {!!proposal?.warnings.length && (
                  <Text style={ui.muted}>Kiểm tra lại mặt số và dấu thập phân.</Text>
                )}
                <Field
                  label={`Chỉ số xác nhận (${unit})`}
                  value={reading}
                  numeric
                  onChange={(v) => {
                    if (!lock.current) {
                      setReading(v);
                      setChecked(false);
                    }
                  }}
                />
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
                  Xác nhận chỉ số
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
