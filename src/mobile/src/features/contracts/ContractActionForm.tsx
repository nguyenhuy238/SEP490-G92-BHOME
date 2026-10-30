import React, { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Text } from 'react-native-paper';
import {
  actionPayload,
  businessToday,
  contractError,
  type Certificate,
  type ContractAction,
  type ContractClient,
  type ContractView,
  type FinalMeterTask,
  type mutationKeys,
} from '../../../../../packages/client-core/src/contracts';
import { Action, Box, Heading, ui } from '../../components/WorkspaceKit';
import { ChoiceField, Input } from '../../components/WorkflowControls';

export function ContractActionForm({
  api,
  action,
  contract,
  keys,
  evidenceIds,
  onCancel,
  onSuccess,
}: {
  api: ContractClient;
  action: ContractAction;
  contract: ContractView;
  keys: ReturnType<typeof mutationKeys>;
  evidenceIds: string[];
  onCancel: () => void;
  onSuccess: (id?: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [certs, setCerts] = useState<Certificate[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState(false);
  const [certRevision, setCertRevision] = useState(0);
  const [readings, setReadings] = useState<FinalMeterTask[]>([]);
  const lock = useRef(false);
  useEffect(() => {
    if (action.operation !== 'signing') return;
    const controller = new AbortController();
    void api
      .certificates(controller.signal)
      .then(setCerts)
      .catch((e) => {
        if (!controller.signal.aborted) setError(contractError(e));
      });
    return () => controller.abort();
  }, [api, action.operation, certRevision]);
  useEffect(() => {
    if (action.operation !== 'move-out/inspection') return;
    const c = new AbortController();
    void api
      .meterTasks(c.signal)
      .then((tasks) => {
        if (!c.signal.aborted)
          setReadings(
            tasks.filter(
              (t) =>
                t.contractId === contract.id &&
                t.purpose === 2 &&
                t.status === 2 &&
                t.readingDate === businessToday() &&
                t.confirmedReadingId,
            ),
          );
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(contractError(e));
      });
    return () => c.abort();
  }, [api, action.operation, contract.id]);
  async function submit() {
    if (lock.current || !checked) return;
    let body;
    try {
      body = actionPayload(action, values, contract, evidenceIds);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    const scope = contract.id + '/' + action.operation;
    try {
      const result = await api.mutate<{ id?: string }>(
        contract.id,
        action.operation,
        body,
        keys.get(scope, body),
      );
      keys.confirmed(scope, body);
      onSuccess(action.operation === 'renewals' ? result.id : undefined);
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Box>
      <Heading title={action.label} />
      <Text>{action.warning}</Text>
      {action.fields.map((f) =>
        f.type === 'certificate' ? (
          <ChoiceField
            key={f.name}
            label={f.label}
            value={values[f.name] ?? ''}
            disabled={busy}
            options={certs
              .filter((c) => c.usable && !c.locked)
              .map((c) => ({
                id: c.id,
                label: `${c.provider} · ${c.serialNumber} · ${c.providerUserIdHint}`,
              }))}
            onChange={(v) => {
              setValues((before) => ({ ...before, [f.name]: v }));
              setChecked(false);
            }}
          />
        ) : f.name === 'electricityReadingId' || f.name === 'waterReadingId' ? (
          <ChoiceField
            key={f.name}
            label={f.label}
            value={values[f.name] ?? ''}
            disabled={busy}
            options={readings
              .filter((r) => r.utilityType === (f.name === 'electricityReadingId' ? 0 : 1))
              .map((r) => ({
                id: r.confirmedReadingId!,
                label: `${r.meterCode} · ${r.readingDate} · ${r.confirmedReadingId}`,
              }))}
            onChange={(v) => {
              setValues((before) => ({ ...before, [f.name]: v }));
              setChecked(false);
            }}
          />
        ) : (
          <Input
            key={f.name}
            label={
              f.label +
              (f.type === 'date'
                ? ' (dd/MM/yyyy)'
                : f.type === 'schedule'
                  ? ' (yyyy-MM-ddTHH:mm, giờ Việt Nam)'
                  : '')
            }
            value={values[f.name] ?? ''}
            numeric={f.type === 'money'}
            multiline={f.type === 'multiline'}
            disabled={busy}
            onChange={(v) => {
              setValues((before) => ({ ...before, [f.name]: v }));
              setChecked(false);
            }}
          />
        ),
      )}
      {action.operation === 'signing' && (
        <>
          <Text variant="bodySmall">
            Chỉ dùng chứng thư của bạn, còn hiệu lực và không khóa. Nếu chưa có, khai báo MySign ở
            phần chữ ký.
          </Text>
          <Button
            disabled={busy}
            onPress={() => {
              setError('');
              setCertRevision((v) => v + 1);
            }}
          >
            Tải lại chứng thư
          </Button>
        </>
      )}
      {action.operation === 'move-out/inspection' && (
        <>
          <Text>{evidenceIds.length} ảnh đã tải sẽ được gắn với biên bản.</Text>
          <Text>
            Chọn chỉ số chốt đúng hợp đồng, đã được xác nhận trong ngày kiểm tra. Nếu chưa có, hoàn
            tất tác vụ điện/nước rồi mở lại biên bản.
          </Text>
        </>
      )}
      <Checkbox.Item
        label="Tôi đã kiểm tra nội dung và xác nhận thao tác"
        disabled={busy}
        status={checked ? 'checked' : 'unchecked'}
        onPress={() => setChecked((v) => !v)}
      />
      {!!error && <Text style={ui.red}>{error}</Text>}
      <Action disabled={busy || !checked} onPress={() => void submit()}>
        {busy ? 'Đang xử lý…' : 'Xác nhận'}
      </Action>
      <Action secondary disabled={busy} onPress={onCancel}>
        Đóng và tải lại
      </Action>
    </Box>
  );
}
export function SigningCertificates({ api }: { api: ContractClient }) {
  const [open, setOpen] = useState(false),
    [subscriber, setSubscriber] = useState(''),
    [serial, setSerial] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const lock = useRef(false);
  return (
    <>
      <Button onPress={() => setOpen((v) => !v)}>Khai báo chứng thư MySign của bạn</Button>
      {open && (
        <>
          <Input
            label="Mã thuê bao MySign của bạn"
            value={subscriber}
            onChange={setSubscriber}
            disabled={busy}
          />
          <Input label="Số serial (tùy chọn)" value={serial} onChange={setSerial} disabled={busy} />
          {!!error && <Text style={ui.red}>{error}</Text>}
          {saved && <Text>Đã truy vấn và lưu chứng thư từ nhà cung cấp.</Text>}
          <Action
            disabled={busy || !subscriber.trim() || subscriber.length > 100 || serial.length > 100}
            onPress={async () => {
              if (lock.current) return;
              lock.current = true;
              setBusy(true);
              setError('');
              setSaved(false);
              try {
                await api.declareCertificate(subscriber.trim(), serial.trim());
                setSaved(true);
              } catch (e) {
                setError(contractError(e));
              } finally {
                lock.current = false;
                setBusy(false);
              }
            }}
          >
            Tra cứu và lưu chứng thư
          </Action>
        </>
      )}
    </>
  );
}
