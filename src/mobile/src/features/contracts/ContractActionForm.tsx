import React, { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Text } from 'react-native-paper';
import {
  actionPayload,
  businessToday,
  canUseCertificate,
  certificateStatus,
  contractError,
  type ContractAction,
  type ContractClient,
  type ContractView,
  type FinalMeterTask,
  type mutationKeys,
} from '../../../../../packages/client-core/src/contracts';
import { useSigningCertificates } from '../../../../../packages/client-core/src/useSigningCertificates';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
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
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState(false);
  const directory = useSigningCertificates(api, action.operation === 'signing');
  const selectedCertificate = directory.certificates.find((c) => c.id === values.certificateId);
  const signingBlocked =
    action.operation === 'signing' &&
    (directory.loading ||
      !!directory.error ||
      !selectedCertificate ||
      !canUseCertificate(selectedCertificate));
  const [readings, setReadings] = useState<FinalMeterTask[]>([]);
  const lock = useRef(false);
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
    if (lock.current || !checked || signingBlocked) return;
    if (
      action.operation === 'signing' &&
      (!selectedCertificate || !canUseCertificate(selectedCertificate))
    )
      return;
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
            disabled={busy || directory.loading}
            options={directory.certificates.filter(canUseCertificate).map((c) => ({
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
          {directory.loading && <Text>Đang tải chứng thư…</Text>}
          {!!directory.error && <Text style={ui.red}>{directory.error}</Text>}
          {!directory.loading &&
            !directory.error &&
            !directory.certificates.some(canUseCertificate) && (
              <Text>
                Chưa có chứng thư dùng được. Khai báo hoặc mở khóa chứng thư của bạn ở phần chữ ký.
              </Text>
            )}
          <Text variant="bodySmall">
            Chỉ dùng chứng thư của bạn, còn hiệu lực và không khóa. Nếu chưa có, khai báo MySign ở
            phần chữ ký.
          </Text>
          <Button
            disabled={busy || directory.loading}
            onPress={() => {
              setError('');
              setValues({});
              setChecked(false);
              directory.reload();
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
      <Action disabled={busy || !checked || signingBlocked} onPress={() => void submit()}>
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
    [notice, setNotice] = useState('');
  const lock = useRef(false);
  const directory = useSigningCertificates(api, open);
  async function run(work: () => Promise<unknown>, message: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setSubscriber('');
      setSerial('');
      setNotice(message);
      directory.reload();
    } catch (e) {
      setError(contractError(e));
      directory.reload();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        disabled={busy}
        onPress={() => {
          setOpen((v) => !v);
          directory.reload();
        }}
      >
        {open ? 'Đóng quản lý chứng thư' : 'Khai báo chứng thư MySign của bạn'}
      </Button>
      {open && (
        <>
          <Text variant="titleSmall">Chứng thư MySign của bạn</Text>
          <Text>
            Khai báo chứng thư không đồng nghĩa đã ký hợp đồng. Xác nhận ký trên ứng dụng MySign khi
            có yêu cầu.
          </Text>
          {directory.loading && <Text>Đang tải chứng thư…</Text>}
          {!!directory.error && <Text style={ui.red}>{directory.error}</Text>}
          {!directory.loading && !directory.error && !directory.certificates.length && (
            <Text>Bạn chưa khai báo chứng thư MySign.</Text>
          )}
          {directory.certificates.map((c) => (
            <Box key={c.id}>
              <Text>
                {c.provider} · {c.serialNumber}
              </Text>
              <Text>
                Thuê bao: {c.providerUserIdHint} · {certificateStatus(c)}
              </Text>
              <Text>Hết hạn: {formatInstant(c.validTo)}</Text>
              <Button
                disabled={busy || directory.loading}
                onPress={() =>
                  void run(
                    () => api.lockCertificate(c.id, !c.locked),
                    c.locked
                      ? 'Đã mở khóa chứng thư. Máy chủ vẫn kiểm tra hiệu lực khi ký.'
                      : 'Đã khóa chứng thư cho các yêu cầu ký mới.',
                  )
                }
              >
                {c.locked ? 'Mở khóa chứng thư' : 'Khóa chứng thư'}
              </Button>
            </Box>
          ))}
          <Button disabled={busy || directory.loading} onPress={directory.reload}>
            Tải lại chứng thư
          </Button>
          <Input
            label="Mã thuê bao MySign của bạn"
            value={subscriber}
            onChange={setSubscriber}
            disabled={busy}
          />
          <Input label="Số serial (tùy chọn)" value={serial} onChange={setSerial} disabled={busy} />
          {!!error && <Text style={ui.red}>{error}</Text>}
          {!!notice && <Text>{notice}</Text>}
          <Action
            disabled={busy || !subscriber.trim() || subscriber.length > 100 || serial.length > 100}
            onPress={() =>
              void run(
                () => api.declareCertificate(subscriber.trim(), serial.trim()),
                'Đã truy vấn và lưu chứng thư từ nhà cung cấp.',
              )
            }
          >
            Tra cứu và lưu chứng thư
          </Action>
        </>
      )}
    </>
  );
}
