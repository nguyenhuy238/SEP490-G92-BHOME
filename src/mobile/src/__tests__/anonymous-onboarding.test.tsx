// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ baseUrl: 'https://api.example.invalid', session: null }),
}));
vi.mock('react-native', () => ({
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  View: ({
    children,
    accessibilityLabel,
    onResponderGrant,
    onResponderMove,
  }: {
    children?: React.ReactNode;
    accessibilityLabel?: string;
    onResponderGrant?: (e: unknown) => void;
    onResponderMove?: (e: unknown) => void;
  }) => (
    <div
      aria-label={accessibilityLabel}
      onPointerDown={() => onResponderGrant?.({ nativeEvent: { locationX: 0.1, locationY: 20 } })}
      onPointerMove={() => onResponderMove?.({ nativeEvent: { locationX: 0.7, locationY: 70 } })}
    >
      {children}
    </div>
  ),
  Image: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
    <div>{accessibilityLabel}</div>
  ),
  StyleSheet: { create: <T,>(styles: T) => styles },
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  HelperText: ({ children }: { children: React.ReactNode }) => <div role="alert">{children}</div>,
  TextInput: ({
    label,
    value,
    onChangeText,
    disabled,
    secureTextEntry,
  }: {
    label: string;
    value: string;
    onChangeText: (v: string) => void;
    disabled?: boolean;
    secureTextEntry?: boolean;
  }) => (
    <input
      aria-label={label}
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
      disabled={disabled}
      type={secureTextEntry ? 'password' : 'text'}
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
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  Checkbox: {
    Item: ({
      label,
      status,
      onPress,
      disabled,
    }: {
      label: string;
      status: string;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <button
        role="checkbox"
        aria-checked={status === 'checked'}
        onClick={onPress}
        disabled={disabled}
      >
        {label}
      </button>
    ),
  },
}));
import AcceptInvitationScreen from '../screens/AcceptInvitationScreen';
import AnonymousSigningScreen from '../screens/AnonymousSigningScreen';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const token = 'A'.repeat(64);
function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
}
it('sets a new password through the same anonymous backend endpoint and waits for confirmation', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  render(<AcceptInvitationScreen />);
  fireEvent.change(screen.getByLabelText('Email nhận lời mời'), {
    target: { value: 'synthetic@example.invalid' },
  });
  fireEvent.change(screen.getByLabelText('Mã lời mời trong email'), {
    target: { value: 'synthetic-account-token' },
  });
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), {
    target: { value: 'Synthetic!Password493' },
  });
  fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu'), {
    target: { value: 'Synthetic!Password493' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Thiết lập mật khẩu' }));
  expect(await screen.findByText(/Đã thiết lập mật khẩu/)).toBeTruthy();
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]![0]).toBe('https://api.example.invalid/api/v1/auth/accept-invitation');
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({
    userName: 'synthetic@example.invalid',
    token: 'synthetic-account-token',
    newPassword: 'Synthetic!Password493',
  });
  expect(new Headers(fetch.mock.calls[0]![1].headers).has('Authorization')).toBe(false);
});
it('reads the OTP-gated PDF then submits explicit consent and real drawn points without a login', async () => {
  const fetch = vi.fn().mockImplementation((path: string) => {
    if (path.endsWith('/info'))
      return Promise.resolve(json({ maskedEmail: 's***@example.invalid', accepted: false }));
    if (path.endsWith('/verify'))
      return Promise.resolve(
        json({
          session: 'B'.repeat(64),
          documentHash: 'HASH',
          consentVersion: 'internal-acceptance-v1',
        }),
      );
    if (path.endsWith('/layout'))
      return Promise.resolve(json({ pages: [{ width: 595, height: 842 }] }));
    if (path.endsWith('/pages/1'))
      return Promise.resolve(new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])));
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  vi.stubGlobal('fetch', fetch);
  render(<AnonymousSigningScreen />);
  fireEvent.change(screen.getByLabelText('Liên kết lời mời ký'), {
    target: { value: 'https://web.example.invalid/contract-signing#token=' + token },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Mở lời mời' }));
  await screen.findByText(/s\*\*\*@example.invalid/);
  expect(screen.queryByText('Trang hợp đồng 1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Gửi mã OTP' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Gửi mã OTP' })).not.toHaveProperty('disabled', true),
  );
  fireEvent.change(screen.getByLabelText('Mã OTP 6 chữ số'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Xác minh và xem hợp đồng' }));
  await screen.findByText('Trang hợp đồng 1');
  expect(
    (screen.getByRole('button', { name: 'Chấp thuận hợp đồng' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.pointerDown(screen.getByLabelText('Khung vẽ chữ ký'));
  fireEvent.pointerMove(screen.getByLabelText('Khung vẽ chữ ký'));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Chấp thuận hợp đồng' }));
  await screen.findByText(/Đã ghi nhận chấp thuận/);
  const acceptance = fetch.mock.calls.find((c) => c[0].endsWith('/accept'))!;
  expect(JSON.parse(acceptance[1].body)).toMatchObject({
    token,
    documentHash: 'HASH',
    consent: true,
    strokes: [
      [
        { x: 0.1, y: 20 / 180 },
        { x: 0.7, y: 70 / 180 },
      ],
    ],
  });
});
it('does not treat failed password setup as an activated account', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response('{}', { status: 400, headers: { 'Content-Type': 'application/json' } }),
      ),
  );
  render(<AcceptInvitationScreen />);
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), {
    target: { value: 'Synthetic!Password493' },
  });
  fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu'), {
    target: { value: 'Synthetic!Password493' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Thiết lập mật khẩu' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(/Đã thiết lập mật khẩu/)).toBeNull();
});
