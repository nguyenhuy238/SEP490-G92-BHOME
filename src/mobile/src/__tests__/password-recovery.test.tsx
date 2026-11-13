// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PasswordRecoveryScreen from '../screens/PasswordRecoveryScreen';
import AcceptInvitationScreen from '../screens/AcceptInvitationScreen';
import ConfirmEmailScreen from '../screens/ConfirmEmailScreen';

const state = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  replace: vi.fn(),
  push: vi.fn(),
}));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => state.params,
  router: { replace: state.replace, push: state.push },
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
  state.push.mockReset();
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

it('makes email verification reachable even after the generic recovery response', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
  vi.stubGlobal('fetch', fetch);
  render(<PasswordRecoveryScreen />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'tenant@example.invalid' } });
  fireEvent.click(screen.getByText('Gửi hướng dẫn'));
  await screen.findByText(/Nếu tài khoản đủ điều kiện/);
  fireEvent.click(screen.getByText(/Chưa xác nhận email/));
  expect(state.push).toHaveBeenCalledWith('/confirm-email');
});

it('requests a verification link and keeps the response generic', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
  vi.stubGlobal('fetch', fetch);
  render(<ConfirmEmailScreen />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'tenant@example.invalid' } });
  fireEvent.click(screen.getByText('Gửi liên kết xác nhận'));
  await screen.findByText(/Nếu tài khoản đủ điều kiện/);
  expect(fetch.mock.calls[0][0]).toBe(
    'https://api.example.invalid/api/v1/auth/request-email-verification',
  );
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ userName: 'tenant@example.invalid' });
});

it('confirms a native verification link only after the user confirms and offers recovery', async () => {
  state.params = { userName: 'tenant@example.invalid', token: 'synthetic-verification' };
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  render(<ConfirmEmailScreen />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Xác nhận email', { selector: 'button' }));
  await screen.findByText(/Email đã được xác nhận/);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    userName: 'tenant@example.invalid',
    token: 'synthetic-verification',
  });
  fireEvent.click(screen.getByText('Quên mật khẩu', { selector: 'button' }));
  expect(state.replace).toHaveBeenCalledWith('/forgot-password');
});

it('keeps an expired verification link on screen and allows a controlled resend', async () => {
  state.params = { userName: 'tenant@example.invalid', token: 'synthetic-expired' };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('{}', { status: 400 }))
    .mockResolvedValueOnce(new Response('{}', { status: 429 }));
  vi.stubGlobal('fetch', fetch);
  render(<ConfirmEmailScreen />);
  fireEvent.click(screen.getByText('Xác nhận email', { selector: 'button' }));
  await screen.findByText(/Liên kết không hợp lệ/);
  fireEvent.click(screen.getByText('Gửi lại liên kết'));
  await screen.findByText(/Bạn đã thử quá nhiều lần/);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ userName: 'tenant@example.invalid' });
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
