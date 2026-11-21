// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('react-native-paper', () => ({
  TextInput: Object.assign(
    ({
      label,
      value,
      secureTextEntry,
      right,
    }: {
      label: string;
      value: string;
      secureTextEntry: boolean;
      right: React.ReactNode;
    }) => (
      <label>
        {label}
        <input
          aria-label={label}
          value={value}
          readOnly
          type={secureTextEntry ? 'password' : 'text'}
        />
        {right}
      </label>
    ),
    {
      Icon: ({
        accessibilityLabel,
        disabled,
        onPress,
      }: {
        accessibilityLabel: string;
        disabled?: boolean;
        onPress: () => void;
      }) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress} />,
    },
  ),
}));
import { PasswordField } from '../components/PasswordField';
afterEach(cleanup);
it('keeps native password fields masked and toggles each independently without changing values', () => {
  render(
    <>
      <PasswordField label="Mật khẩu mới" value="Synthetic!Password493" />
      <PasswordField label="Xác nhận mật khẩu" value="Synthetic!Password493" />
    </>,
  );
  const password = screen.getByLabelText('Mật khẩu mới') as HTMLInputElement;
  const confirmation = screen.getByLabelText('Xác nhận mật khẩu') as HTMLInputElement;
  expect(password.type).toBe('password');
  expect(confirmation.type).toBe('password');
  fireEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu mới' }));
  expect(password.type).toBe('text');
  expect(confirmation.type).toBe('password');
  fireEvent.click(screen.getByRole('button', { name: 'Hiện xác nhận mật khẩu' }));
  expect(confirmation.type).toBe('text');
  expect(confirmation.value).toBe('Synthetic!Password493');
  fireEvent.click(screen.getByRole('button', { name: 'Ẩn mật khẩu mới' }));
  expect(password.type).toBe('password');
});
it('disables the visibility control during submission', () => {
  render(<PasswordField label="Mật khẩu mới" value="Synthetic!Password493" disabled />);
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
});
