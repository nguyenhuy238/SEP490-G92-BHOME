import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { Button, Checkbox, Text } from 'react-native-paper';
import { CameraCapture } from '../components/CameraCapture';
import { Field, Page, styles } from '../components/Controls';
import { useSession } from '../lib/SessionProvider';
import { errorMessage, type MeterTask, type Proposal } from '../lib/api';
import type { ConfirmedReading } from '../../../../packages/client-core/src/meter';
import { meterService } from '../services/meterService';
export default function MeterScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  return <MeterTaskScreen key={taskId} taskId={taskId} />;
}
function MeterTaskScreen({ taskId }: { taskId: string }) {
  const { api, session } = useSession();
  const [task, setTask] = useState<MeterTask | null>(null);
  const [reading, setReading] = useState('');
  const [evidence, setEvidence] = useState('');
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<ConfirmedReading | null>(null);
  const lock = useRef(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') {
        abort.current?.abort();
        setEvidence('');
        setChecked(false);
      }
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (api && taskId)
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
        }
      })();
    return () => {
      controller.abort();
      abort.current?.abort();
    };
  }, [api, taskId]);
  if (!api || !session) return <Redirect href="/" />;
  if (!session.roles.includes('Staff'))
    return (
      <Page>
        <Text>Chỉ Staff được giao cơ sở mới có thể ghi chỉ số.</Text>
      </Page>
    );
  if (saved)
    return (
      <Page>
        <Text variant="headlineSmall">Đã lưu chỉ số và ảnh minh chứng</Text>
        <Text>Tác vụ đã hoàn thành. Chỉ số đã xác nhận sẵn sàng cho bước lập hóa đơn.</Text>
        <Text>
          {task?.location} · Phòng {task?.room} · {task?.meterCode}
        </Text>
        <Text>Chỉ số trước: {saved.previousValue ?? 'Chưa có baseline xác nhận'}</Text>
        <Text>Chỉ số xác nhận: {saved.confirmedValue}</Text>
        <Text>
          Tiêu thụ: {saved.consumption ?? 'Chỉ số ban đầu'}{' '}
          {saved.consumption !== null ? (task?.utilityType === 0 ? 'kWh' : 'm³') : ''}
        </Text>
        <Text selectable>Mã chỉ số đã xác nhận: {saved.id}</Text>
        {task?.purpose === 2 && (
          <Text>Dùng mã chỉ số này để lập biên bản trả phòng cho đúng hợp đồng.</Text>
        )}
      </Page>
    );
  return (
    <Page>
      <Text variant="headlineSmall">Ghi chỉ số đồng hồ</Text>
      {task && (
        <>
          <Text>
            {task.location} · Phòng {task.room} · {task.meterCode}
          </Text>
          <Text>
            {task.utilityType === 0 ? 'Điện (kWh)' : 'Nước (m³)'} ·{' '}
            {task.purpose === 0
              ? 'Chỉ số ban đầu'
              : task.purpose === 2
                ? 'Chỉ số chốt trả phòng'
                : task.billingPeriod}
          </Text>
          <Text>
            Ngày ghi: {task.readingDate.split('-').reverse().join('/')} · Tối đa{' '}
            {task.decimalPlaces} chữ số thập phân
          </Text>
          <Text>Chỉ số trước: {task.previousValue ?? 'Chưa có baseline xác nhận'}</Text>
        </>
      )}
      <CameraCapture
        label="Chụp / chụp lại ảnh đồng hồ"
        retainPreview
        disabled={busy || !task || task.status >= 2}
        onCapture={async (bytes) => {
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setEvidence('');
          setChecked(false);
          setError('');
          const controller = new AbortController();
          abort.current = controller;
          const timeout = setTimeout(() => controller.abort(), 45000);
          try {
            try {
              const proposal = await api.image<Proposal>(
                `/api/v1/ocr/meter-tasks/${taskId}`,
                bytes,
                controller.signal,
              );
              setReading(proposal.proposedFields.reading || '');
              setNotice(
                proposal.isFallback
                  ? 'OCR chưa đọc được. Hãy nhập chỉ số thủ công.'
                  : 'Chỉ số OCR đề xuất: hãy đối chiếu ảnh và sửa nếu cần.',
              );
            } catch (e) {
              if (controller.signal.aborted) throw e;
              setNotice('OCR không khả dụng. Hãy nhập chỉ số thủ công.');
            }
            const file = await api.image<{ id: string }>(
              `/api/v1/capture/meter-tasks/${taskId}/evidence`,
              bytes,
              controller.signal,
              'PUT',
            );
            setEvidence(file.id);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            clearTimeout(timeout);
            lock.current = false;
            setBusy(false);
          }
        }}
      />
      {!!notice && <Text>{notice}</Text>}
      <Field
        label="Chỉ số cuối cùng sau kiểm tra"
        value={reading}
        numeric
        onChange={(v) => {
          setReading(v);
          setChecked(false);
        }}
      />
      <Checkbox.Item
        label="Tôi đã đối chiếu ảnh và xác nhận chỉ số"
        status={checked ? 'checked' : 'unchecked'}
        onPress={() => setChecked(!checked)}
        disabled={busy}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Button
        mode="contained"
        disabled={
          busy || !task || (task.status !== 0 && task.status !== 1) || !checked || !evidence
        }
        loading={busy}
        onPress={async () => {
          if (lock.current) return;
          const normalized = reading.replace(',', '.');
          if (!/^\d{1,14}(\.\d{1,4})?$/.test(normalized)) {
            setError(
              'Nhập chỉ số không âm, tối đa 14 chữ số nguyên và 4 chữ số thập phân, không có dấu phân cách hàng nghìn.',
            );
            return;
          }
          lock.current = true;
          setBusy(true);
          setError('');
          const controller = new AbortController();
          abort.current = controller;
          try {
            const result = await meterService(api).confirm(
              taskId,
              normalized,
              evidence,
              controller.signal,
            );
            setSaved(result);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        Xác nhận và lưu chỉ số
      </Button>
      <Button disabled={!busy} onPress={() => abort.current?.abort()}>
        Hủy yêu cầu
      </Button>
      <Text>
        Ảnh minh chứng là bắt buộc kể cả nhập chỉ số thủ công. Thay/reset hoặc quay vòng đồng hồ cần
        quy trình xử lý riêng.
      </Text>
    </Page>
  );
}
