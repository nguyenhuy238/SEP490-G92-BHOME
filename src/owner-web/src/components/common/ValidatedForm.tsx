import {
  Alert,
  FormHelperText,
  TextField as MuiTextField,
  type TextFieldProps,
} from '@mui/material';
import { createContext, useContext, useId, useState, type ComponentPropsWithRef } from 'react';

const ValidationContext = createContext<Record<string, string>>({});
type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function constraintValue(control: Control, name: 'min' | 'max') {
  const value = control.getAttribute(name) ?? '';
  return control.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.split('-').reverse().join('/')
    : value;
}

function fieldKey(control: Control) {
  return (
    control.closest<HTMLElement>('[data-validation-field]')?.dataset.validationField ||
    control.id ||
    control.name
  );
}

/** Translate existing HTML constraints; business rules remain in the form/service. */
function constraintMessage(control: Control): string {
  if (control.disabled || ('readOnly' in control && control.readOnly) || control.type === 'hidden')
    return '';
  const validity = control.validity;
  if (control instanceof HTMLInputElement && control.type === 'file') {
    if (control.required && !control.files?.length) return 'Vui lòng chọn tệp.';
    return '';
  }
  if (validity.valueMissing || (control.required && !control.value.trim()))
    return 'Vui lòng nhập thông tin này.';
  if (validity.typeMismatch)
    return control.type === 'email'
      ? 'Vui lòng nhập địa chỉ email hợp lệ.'
      : 'Thông tin chưa đúng định dạng.';
  if (validity.badInput) return 'Vui lòng nhập một số hợp lệ.';
  if (validity.rangeUnderflow) return `Giá trị phải từ ${constraintValue(control, 'min')} trở lên.`;
  if (validity.rangeOverflow)
    return `Giá trị không được vượt quá ${constraintValue(control, 'max')}.`;
  const minLength = Number(control.getAttribute('minlength'));
  const maxLength = Number(control.getAttribute('maxlength'));
  if (control.value && minLength > 0 && control.value.length < minLength)
    return `Vui lòng nhập ít nhất ${minLength} ký tự.`;
  if (maxLength > 0 && control.value.length > maxLength)
    return `Vui lòng nhập không quá ${maxLength} ký tự.`;
  if (validity.patternMismatch) return 'Thông tin chưa đúng định dạng yêu cầu.';
  if (validity.stepMismatch) return 'Giá trị chưa đúng bước tăng được yêu cầu.';
  if (!validity.valid) return 'Vui lòng kiểm tra thông tin này.';
  return '';
}

/** Native constraints are retained for semantics, but browser-language popups are disabled. */
export function ValidatedForm({
  children,
  onSubmit,
  onInputCapture,
  ...props
}: ComponentPropsWithRef<'form'>) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState(false);
  return (
    <form
      {...props}
      noValidate
      onInputCapture={(event) => {
        onInputCapture?.(event);
        const control = event.target;
        if (!(
          control instanceof HTMLInputElement ||
          control instanceof HTMLTextAreaElement ||
          control instanceof HTMLSelectElement
        ))
          return;
        const key = fieldKey(control);
        setErrors((current) => {
          if (!(key in current)) return current;
          const next = { ...current };
          const message = constraintMessage(control);
          if (message) next[key] = message;
          else delete next[key];
          return next;
        });
      }}
      onSubmit={(event) => {
        const next: Record<string, string> = {};
        let first: Control | undefined;
        for (const element of Array.from(event.currentTarget.elements)) {
          if (!(
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement
          ))
            continue;
          const message = constraintMessage(element);
          if (!message) continue;
          first ??= element;
          next[fieldKey(element)] = message;
        }
        setErrors(next);
        setSummary(Boolean(first));
        if (first) {
          event.preventDefault();
          const target =
            first
              .closest('[data-validation-field]')
              ?.querySelector<HTMLElement>('[role="combobox"]') ?? first;
          target.focus();
          target.scrollIntoView?.({ block: 'nearest' });
          return;
        }
        onSubmit?.(event);
      }}
    >
      <ValidationContext.Provider value={errors}>
        {summary && Object.keys(errors).length > 0 && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Vui lòng kiểm tra các trường được đánh dấu trước khi tiếp tục.
          </Alert>
        )}
        {children}
      </ValidationContext.Provider>
    </form>
  );
}

/** Preserve existing server/business errors while associating constraint feedback with its input. */
export function TextField(props: TextFieldProps) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const errors = useContext(ValidationContext);
  const message = errors[id];
  return (
    <MuiTextField
      {...props}
      id={id}
      data-validation-field={id}
      error={props.error || Boolean(message)}
      helperText={
        props.error && props.helperText ? props.helperText : (message ?? props.helperText)
      }
    />
  );
}

/** File and other plain HTML controls receive the same accessible inline feedback. */
export function ValidatedInput(props: ComponentPropsWithRef<'input'>) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const message = useContext(ValidationContext)[id];
  return (
    <>
      <input
        {...props}
        id={id}
        aria-invalid={message ? true : props['aria-invalid']}
        aria-describedby={
          [props['aria-describedby'], message ? `${id}-error` : ''].filter(Boolean).join(' ') ||
          undefined
        }
      />
      {message && (
        <FormHelperText component="span" error id={`${id}-error`}>
          {message}
        </FormHelperText>
      )}
    </>
  );
}
