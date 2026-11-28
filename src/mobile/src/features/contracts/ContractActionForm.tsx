import { ContractNotice } from './ContractNotice';
import { getFieldErrors } from '../../../../../packages/client-core/src/api';
import { useFeedbackState } from '../../lib/useFeedbackState';
import React, { useRef, useState } from 'react';
import { Checkbox, HelperText, Text } from 'react-native-paper';
import {
  actionPayload,
  businessToday,
  contractError,
  earlyTerminationDate,
  type ContractAction,
  type ContractClient,
  type ContractView,
  type mutationKeys,
} from '../../../../../packages/client-core/src/contracts';
import { Action, Box, Heading } from '../../components/WorkspaceKit';
import { IdentityDateField } from '../../components/IdentityDateField';
import { ChoiceField, Input } from '../../components/WorkflowControls';

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
  const lock = useRef(false);
  async function submit() {
    if (lock.current || !checked || dateError) return;
    let body;
    try {
      body = actionPayload(
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
        earlyTermination && f.name === 'proposedDate' ? (
          <React.Fragment key={f.name}>
            <IdentityDateField
              label={f.label}
              accessibilityLabel={f.label}
              value={values[f.name] ?? ''}
              disabled={busy}
              hyphenated
              compactCalendar
              calendarDate={businessToday()}
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
      <Checkbox.Item
        label="Tôi đã kiểm tra nội dung và xác nhận thao tác"
        disabled={busy}
        status={checked ? 'checked' : 'unchecked'}
        onPress={() => setChecked((v) => !v)}
      />
      {!!error && <ContractNotice message={error} />}
      <Action disabled={busy || !checked || !!dateError} onPress={() => void submit()}>
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
