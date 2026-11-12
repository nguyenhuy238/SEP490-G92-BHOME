// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PasswordRecoveryScreen from '../screens/PasswordRecoveryScreen';
import AcceptInvitationScreen from '../screens/AcceptInvitationScreen';

const state = vi.hoisted(() => ({ params: {} as Record<string, string>, replace: vi.fn() }));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => state.params,
  router: { replace: state.replace },
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ baseUrl: 'https://api.example.invalid' }),
}));
vi.mock('react-native', () => ({
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  HelperText: ({ children }: { children: React.ReactNode }) => <div role="alert">{children}</div>,
  TextInput: ({
    label,
    value,
    onChangeText,
    disabled,
  }: {
    label: string;
    value: string;
    onChangeText: (s: string) => void;
    disabled?: boolean;
  }) => (
    <input
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
beforeEach(() => {
  state.params = {};
  state.replace.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('opens a native invitation and submits its token only after password setup confirmation', async () => {
  state.params = { userName: 'staff@example.invalid', token: 'synthetic-invitation-link' };
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  render(<AcceptInvitationScreen />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), {
    target: { value: 'Synthetic!Invited-725' },
  });
  fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu'), {
    target: { value: 'Synthetic!Invited-725' },
  });
  fireEvent.click(screen.getByText('Thiết lập mật khẩu'));
  await screen.findByText(/Đã thiết lập mật khẩu/);
  expect(JSON.parse(fetch.mock.calls[0][1].body).token).toBe('synthetic-invitation-link');
});

it('requests recovery through the existing API and displays a generic response', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
  vi.stubGlobal('fetch', fetch);
  render(<PasswordRecoveryScreen />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'tenant@example.invalid' } });
  fireEvent.click(screen.getByText('Gửi hướng dẫn'));
  await screen.findByText(/Nếu tài khoản đủ điều kiện/);
  expect(fetch.mock.calls[0][0]).toBe('https://api.example.invalid/api/v1/auth/forgot-password');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ userName: 'tenant@example.invalid' });
});

it('uses the native reset link and returns to login only after backend success', async () => {
  state.params = { userName: 'tenant@example.invalid', token: 'synthetic-token' };
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  render(<PasswordRecoveryScreen reset />);
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), {
    target: { value: 'Synthetic!Recovered-725' },
  });
  fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu'), {
    target: { value: 'Synthetic!Recovered-725' },
  });
  fireEvent.click(screen.getByText('Đặt lại mật khẩu', { selector: 'button' }));
  await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/'));
  expect(JSON.parse(fetch.mock.calls[0][1].body).token).toBe('synthetic-token');
});

it('keeps the reset form open on expired tokens and rejects mismatched passwords', async () => {
  state.params = { userName: 'tenant@example.invalid', token: 'synthetic-expired' };
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 400 }));
  vi.stubGlobal('fetch', fetch);
  render(<PasswordRecoveryScreen reset />);
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), {
    target: { value: 'Synthetic!Recovered-725' },
  });
  fireEvent.click(screen.getByText('Đặt lại mật khẩu', { selector: 'button' }));
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu'), {
    target: { value: 'Synthetic!Recovered-725' },
  });
  fireEvent.click(screen.getByText('Đặt lại mật khẩu', { selector: 'button' }));
  await screen.findByText(/Mã không hợp lệ/);
  expect(state.replace).not.toHaveBeenCalled();
});
