// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ preview: false }),
}));
vi.mock('../components/CameraCapture', () => ({ CameraCapture: () => null }));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Action: () => null,
  Box: () => null,
  Heading: () => null,
  Pill: () => null,
  Row: () => null,
}));
vi.mock('../theme/theme', () => ({ colors: { border: 'gray', red: 'red', white: 'white' } }));
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => {
  const TextInput = ({
    ref,
    label,
    value,
    onChangeText,
    error,
    disabled,
  }: {
    ref?: React.Ref<HTMLInputElement>;
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    error?: boolean;
    disabled?: boolean;
  }) => (
    <input
      ref={ref}
      aria-label={label}
      aria-invalid={error}
      disabled={disabled}
      value={value}
      onChange={(event) => onChangeText(event.target.value)}
    />
  );
  const Text = ({ children }: { children: React.ReactNode }) => <span>{children}</span>;
  const Dialog = Object.assign(
    ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
    { Title: Text, ScrollArea: Text, Actions: Text },
  );
  return {
    TextInput,
    Text,
    Dialog,
    Icon: () => null,
    Portal: Text,
    HelperText: ({ children }: { children: React.ReactNode }) => (
      <span role="alert">{children}</span>
    ),
    Button: ({
      children,
      onPress,
      accessibilityLabel,
      accessibilityHint,
    }: {
      children: React.ReactNode;
      onPress: () => void;
      accessibilityLabel: string;
      accessibilityHint?: string;
    }) => (
      <button aria-label={accessibilityLabel} title={accessibilityHint} onClick={onPress}>
        {children}
      </button>
    ),
    RadioButton: {
      Item: ({ label, onPress }: { label: string; onPress: () => void }) => (
        <button onClick={onPress}>{label}</button>
      ),
    },
  };
});
import { ChoiceField, Input } from '../components/WorkflowControls';
afterEach(cleanup);

it('focuses only the first invalid text field and keeps the draft visible', () => {
  render(
    <>
      <Input
        label="Họ và tên"
        value="Bản nháp"
        onChange={vi.fn()}
        error="Kiểm tra họ tên."
        focusOnError
      />
      <Input
        label="Email"
        value="draft@example.invalid"
        onChange={vi.fn()}
        error="Kiểm tra email."
      />
    </>,
  );
  expect(document.activeElement).toBe(screen.getByLabelText('Họ và tên'));
  expect((screen.getByLabelText('Họ và tên') as HTMLInputElement).value).toBe('Bản nháp');
  expect(screen.getAllByRole('alert')).toHaveLength(2);
});

it('exposes a selector error inline, retains selection and allows choosing a correction', () => {
  const change = vi.fn();
  render(
    <ChoiceField
      label="Chỉ số điện"
      value="old"
      options={[
        { id: 'old', label: 'Chỉ số cũ' },
        { id: 'new', label: 'Chỉ số mới' },
      ]}
      error="Chỉ số đã thay đổi. Hãy chọn lại."
      onChange={change}
    />,
  );
  expect(screen.getByRole('alert').textContent).toContain('Hãy chọn lại');
  expect(screen.getByRole('button', { name: 'Chỉ số điện' }).textContent).toBe('Chỉ số cũ');
  fireEvent.click(screen.getByRole('button', { name: 'Chỉ số điện' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chỉ số mới' }));
  expect(change).toHaveBeenCalledWith('new');
  expect(screen.queryByRole('dialog')).toBeNull();
});
