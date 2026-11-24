import { ContractNotice } from './ContractNotice';
import { getFieldErrors } from '../../../../../packages/client-core/src/api';
import { useFeedbackState } from '../../lib/useFeedbackState';
import React, { useMemo, useRef, useState } from 'react';
import { Button, Checkbox, HelperText, Text } from 'react-native-paper';
import {
  actionPayload,
  canUseCertificate,
  certificateStatus,
  contractError,
  earlyTerminationDate,
  type ContractAction,
  type ContractClient,
  type ContractView,
  type mutationKeys,
} from '../../../../../packages/client-core/src/contracts';
import { useSigningCertificates } from '../../../../../packages/client-core/src/useSigningCertificates';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { Action, Box, Heading } from '../../components/WorkspaceKit';
import { IdentityDateField } from '../../components/IdentityDateField';
import { ChoiceField, Input } from '../../components/WorkflowControls';
import {
  signingClient,
  signingError,
  signingPayload,
} from '../../../../../packages/client-core/src/signing';
import {
  SignatureImageSection,
  SignaturePlacementField,
  type PlacementChoice,
} from './SigningSetup';

export function ContractActionForm({
  api,
  action,
  contract,
  keys,
  onCancel,
  onSuccess,
}: {
  api: ContractClient;
  action: ContractAction;
  contract: ContractView;
  keys: ReturnType<typeof mutationKeys>;
  onCancel?: () => void;
  onSuccess: (id?: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const firstInvalidField = action.fields.find((field) => fieldErrors[field.name])?.name;
  const update = (name: string, value: string) => {
    setValues((before) => ({ ...before, [name]: value }));
    setFieldErrors((before) => ({ ...before, [name]: '' }));
    setChecked(false);
  };
  const [error, setError] = useFeedbackState('warning', false),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState(false);
  const directory = useSigningCertificates(
    api,
    action.operation === 'signing' && !contract.isDevelopmentDemo,
  );
  const selectedCertificate = directory.certificates.find((c) => c.id === values.certificateId);
  const signingBlocked =
    action.operation === 'signing' &&
    !contract.isDevelopmentDemo &&
    (directory.loading ||
      !!directory.error ||
      !selectedCertificate ||
      !canUseCertificate(selectedCertificate));
  const earlyTermination = action.operation === 'termination-requests';
  const [dateTouched, setDateTouched] = useState(false);
  const proposedDate = values.proposedDate ?? '';
  let dateError = '';
  if (earlyTermination) {
    try {
      earlyTerminationDate(proposedDate, contract);
    } catch (e) {
      dateError = (e as Error).message.replace('dd/MM/yyyy', 'dd-MM-yyyy');
    }
  }
  const showDateError = !!dateError && (dateTouched || proposedDate.length === 10);
  const remoteSigning = action.operation === 'signing' && !contract.isDevelopmentDemo;
  const signing = useMemo(() => signingClient(api.transport), [api]);
  const [choice, setChoice] = useState<PlacementChoice>({ placement: null, usePicture: true });
  const lock = useRef(false);
  async function submit() {
    if (lock.current || !checked || signingBlocked || dateError) return;
    if (
      action.operation === 'signing' &&
      !contract.isDevelopmentDemo &&
      (!selectedCertificate || !canUseCertificate(selectedCertificate))
    )
      return;
    let body;
    try {
      body = remoteSigning
        ? signingPayload(values.certificateId ?? '', choice.placement, choice.usePicture)
        : actionPayload(
            action,
            action.operation === 'holding-cancellation'
              ? { ...values, humanConfirmed: String(checked) }
              : values,
            contract,
          );
    } catch (e) {
      const message = (e as Error).message;
      setError(earlyTermination ? message.replace('dd/MM/yyyy', 'dd-MM-yyyy') : message);
      return;
    }
    lock.current = true;
    setFieldErrors({});
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
      onSuccess(
        ['renewals', 'holding-conversion'].includes(action.operation) ? result.id : undefined,
      );
    } catch (e) {
      setFieldErrors(getFieldErrors(e));
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Box>
      <Heading title={action.label} />
      {!!action.warning && <Text>{action.warning}</Text>}
      {action.operation === 'holding-cancellation' && (
        <ChoiceField
          label="Nguyên nhân hủy giữ chỗ"
          value={values.cause ?? ''}
          error={fieldErrors.cause}
          options={[
            { id: '0', label: 'Người thuê tự nguyện hủy' },
            { id: '1', label: 'Owner không cung cấp được phòng' },
          ]}
          disabled={busy}
          onChange={(cause) => {
            update('cause', cause);
          }}
        />
      )}
      {action.fields.map((f) =>
        f.type === 'certificate' ? (
          <ChoiceField
            key={f.name}
            label={f.label}
            value={values[f.name] ?? ''}
            error={fieldErrors[f.name]}
            disabled={busy || directory.loading}
            options={directory.certificates.filter(canUseCertificate).map((c) => ({
              id: c.id,
              label: `${c.provider} · ${c.serialNumber} · ${c.providerUserIdHint}`,
            }))}
            onChange={(v) => {
              update(f.name, v);
            }}
          />
        ) : earlyTermination && f.name === 'proposedDate' ? (
          <React.Fragment key={f.name}>
            <IdentityDateField
              label={f.label}
              accessibilityLabel={f.label}
              value={values[f.name] ?? ''}
              disabled={busy}
              hyphenated
              compactCalendar
              error={showDateError || !!fieldErrors[f.name]}
              onBlur={() => setDateTouched(true)}
              onChange={(v) => {
                update(f.name, v);
              }}
            />
            {(showDateError || !!fieldErrors[f.name]) && (
              <HelperText type="error" accessibilityRole="alert">
                {showDateError ? dateError : fieldErrors[f.name]}
              </HelperText>
            )}
          </React.Fragment>
        ) : (
          <Input
            key={f.name}
            error={fieldErrors[f.name]}
            focusOnError={firstInvalidField === f.name}
            label={
              f.label +
              (f.type === 'date'
                ? ' (dd/MM/yyyy)'
                : f.type === 'schedule'
                  ? ' (yyyy-MM-ddTHH:mm, giờ Việt Nam)'
                  : '')
            }
            value={values[f.name] ?? ''}
            money={f.type === 'money'}
            multiline={f.type === 'multiline'}
            disabled={busy}
            onChange={(v) => {
              update(f.name, v);
            }}
          />
        ),
      )}
      {action.operation === 'signing' && !contract.isDevelopmentDemo && (
        <>
          {directory.loading && <Text>Đang tải chứng thư…</Text>}
          {!!directory.error && <ContractNotice message={directory.error} />}
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
          <SignaturePlacementField
            signing={signing}
            contractId={contract.id}
            value={choice}
            onChange={(next) => {
              setChoice(next);
              setChecked(false);
            }}
            disabled={busy}
          />
        </>
      )}
      <Checkbox.Item
        label="Tôi đã kiểm tra nội dung và xác nhận thao tác"
        disabled={busy}
        status={checked ? 'checked' : 'unchecked'}
        onPress={() => setChecked((v) => !v)}
      />
      {!!error && <ContractNotice message={error} />}
      <Action
        disabled={busy || !checked || signingBlocked || !!dateError}
        onPress={() => void submit()}
      >
        {busy
          ? 'Đang xử lý…'
          : action.operation === 'termination-requests'
            ? 'Gửi yêu cầu'
            : 'Xác nhận'}
      </Action>
      {onCancel && (
        <Action secondary disabled={busy} onPress={onCancel}>
          Đóng và tải lại
        </Action>
      )}
    </Box>
  );
}
export function SigningCertificates({ api }: { api: ContractClient }) {
  const [open, setOpen] = useState(false),
    [subscriber, setSubscriber] = useState(''),
    [serial, setSerial] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useFeedbackState('warning', false),
    [notice, setNotice] = useFeedbackState('success');
  const lock = useRef(false);
  const directory = useSigningCertificates(api, open);
  const signing = useMemo(() => signingClient(api.transport), [api]);
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
      setError(signingError(e));
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
          {!!directory.error && <ContractNotice message={directory.error} />}
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
              <Button
                disabled={busy || directory.loading}
                onPress={() =>
                  void run(() => signing.removeCertificate(c.id), 'Đã gỡ chứng thư khỏi BHOME.')
                }
              >
                Gỡ chứng thư
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
          {!!error && <ContractNotice message={error} />}
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
          <SignatureImageSection signing={signing} />
        </>
      )}
    </>
  );
}
