// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountSecurityScreen } from '../screens/AccountSecurityScreen';
import { MobileApiError } from '../lib/api';

const s = vi.hoisted(() => ({
  json: vi.fn(),
  logout: vi.fn(),
  replace: vi.fn(),
  apiAvailable: true,
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api: s.apiAvailable ? { json: s.json } : null, logout: s.logout }),
}));
vi.mock('expo-router', () => ({ router: { replace: s.replace } }));
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove: vi.fn() }) } }));
vi.mock('../components/WorkspaceKit', () => ({
  Heading: () => <span>Security</span>,
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Action: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  ui: { red: {} },
}));
vi.mock('react-native-paper', () => ({
  Text: ({
    children,
    accessibilityRole,
  }: {
    children: React.ReactNode;
    accessibilityRole?: string;
  }) => <span role={accessibilityRole}>{children}</span>,
  TextInput: ({
    ref,
    accessibilityLabel,
    value,
    onChangeText,
    error,
    disabled,
  }: {
    ref?: React.Ref<HTMLInputElement>;
    accessibilityLabel: string;
    value: string;
    onChangeText: (v: string) => void;
    error?: boolean;
    disabled?: boolean;
  }) => (
    <input
      ref={ref}
      aria-label={accessibilityLabel}
      aria-invalid={error}
      disabled={disabled}
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));
beforeEach(() => {
  vi.clearAllMocks();
  s.apiAvailable = true;
  s.json.mockResolvedValue(undefined);
  s.logout.mockResolvedValue(undefined);
});
afterEach(cleanup);
function fill(current: string, next: string, confirmation = next) {
  fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu mới'), {
    target: { value: confirmation },
  });
  fireEvent.click(screen.getByRole('button'));
}
it.each([
  ['Synthetic!Current-725', 'Synthetic!Current-725', 'Mật khẩu mới phải khác mật khẩu hiện tại.'],
  ['Synthetic!Current-725', 'short', 'Mật khẩu mới phải từ 12 đến 1024 ký tự.'],
  ['', 'Synthetic!Next-725', 'Vui lòng nhập mật khẩu hiện tại.'],
  ['Synthetic!Current-725', '', 'Vui lòng nhập mật khẩu mới.'],
  ['Synthetic!Current-725', 'synthetic!next-725', 'Mật khẩu mới phải gồm chữ hoa'],
  ['Synthetic!Current-725', 'SyntheticNext725', 'Mật khẩu mới phải gồm chữ hoa'],
])('rejects invalid or unchanged password input without mutation', (current, next, message) => {
  render(<AccountSecurityScreen />);
  fill(current, next);
  expect(screen.getByRole('alert').textContent).toContain(message);
  expect(s.json).not.toHaveBeenCalled();
  expect(s.logout).not.toHaveBeenCalled();
});
it('requires confirmation matching before contacting the server', () => {
  render(<AccountSecurityScreen />);
  fill('Synthetic!Current-725', 'Synthetic!Next-725', 'Different!Next-725');
  expect(screen.getByRole('alert').textContent).toContain('Xác nhận mật khẩu mới không khớp.');
  expect(s.json).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByLabelText('Xác nhận mật khẩu mới'));
  expect(screen.getByLabelText('Xác nhận mật khẩu mới').getAttribute('aria-invalid')).toBe('true');
});

it('maps backend password validation inline, focuses it and preserves the draft for correction', async () => {
  s.json.mockRejectedValueOnce(
    new MobileApiError(400, 'validation_error', undefined, undefined, 'POST', {
      errors: { NewPassword: ['Mật khẩu mới chưa đáp ứng yêu cầu.'] },
    }),
  );
  render(<AccountSecurityScreen />);
  fill('Synthetic!Current-725', 'Synthetic!Next-725');
  expect((await screen.findByRole('alert')).textContent).toContain('Mật khẩu mới chưa đáp ứng');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Mật khẩu mới')));
  expect(screen.getByLabelText('Mật khẩu mới')).toHaveProperty('value', 'Synthetic!Next-725');
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), {
    target: { value: 'Synthetic!Corrected-725' },
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(s.logout).not.toHaveBeenCalled();
});
it('informs the user if the authenticated API is unavailable', () => {
  s.apiAvailable = false;
  render(<AccountSecurityScreen />);
  fill('Synthetic!Current-725', 'Synthetic!Next-725');
  expect(screen.getByRole('alert').textContent).toContain('Phiên đăng nhập đã hết hạn');
  expect(s.logout).not.toHaveBeenCalled();
});
it('clears local credentials and requires login after a successful server change', async () => {
  render(<AccountSecurityScreen />);
  fill('Synthetic!Current-725', 'Synthetic!Next-725');
  await waitFor(() => expect(s.replace).toHaveBeenCalledWith('/'));
  expect(s.json).toHaveBeenCalledWith('/api/v1/auth/change-password', {
    currentPassword: 'Synthetic!Current-725',
    newPassword: 'Synthetic!Next-725',
  });
  expect(s.logout).toHaveBeenCalledOnce();
});
it('keeps the session when the backend rejects the current password', async () => {
  s.json.mockRejectedValue(new MobileApiError(400));
  render(<AccountSecurityScreen />);
  fill('Wrong!Current-725', 'Synthetic!Next-725');
  expect((await screen.findByRole('alert')).textContent).toContain('Mật khẩu hiện tại không đúng');
  expect(s.logout).not.toHaveBeenCalled();
  expect(s.replace).not.toHaveBeenCalled();
});
it('does not submit twice while awaiting the API and only signs out on success', async () => {
  let finish!: () => void;
  s.json.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<AccountSecurityScreen />);
  fill('Synthetic!Current-725', 'Synthetic!Next-725');
  expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button'));
  expect(s.json).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() => expect(s.logout).toHaveBeenCalledOnce());
  expect(s.replace).toHaveBeenCalledWith('/');
});
it('preserves the fields and session on a connection failure for user review', async () => {
  s.json.mockRejectedValueOnce(new Error('Network unavailable'));
  render(<AccountSecurityScreen />);
  fill('Synthetic!Current-725', 'Synthetic!Next-725');
  expect((await screen.findByRole('alert')).textContent).toContain('Kiểm tra kết nối');
  expect(screen.getByLabelText('Mật khẩu hiện tại')).toHaveProperty(
    'value',
    'Synthetic!Current-725',
  );
  expect(s.logout).not.toHaveBeenCalled();
  expect(s.replace).not.toHaveBeenCalled();
});
it('clears credentials and navigates even if remote logout rejects the revoked session', async () => {
  s.logout.mockRejectedValueOnce(new MobileApiError(401));
  render(<AccountSecurityScreen />);
  fill('Synthetic!Current-725', 'Synthetic!Next-725');
  await waitFor(() => expect(s.replace).toHaveBeenCalledWith('/'));
  expect(s.json).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Mật khẩu hiện tại')).toHaveProperty('value', '');
});
