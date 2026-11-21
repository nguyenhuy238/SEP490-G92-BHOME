// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SmsPasswordRecoveryScreen from '../screens/SmsPasswordRecoveryScreen';
import DemoSmsInboxScreen from '../screens/DemoSmsInboxScreen';

const state = vi.hoisted(() => ({ request: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    baseUrl: 'https://synthetic-api.invalid',
    session: { userId: 'synthetic-user' },
    api: { request: state.request },
  }),
}));
vi.mock('expo-router', () => ({
  router: { replace: state.replace, push: state.push },
  Redirect: () => <span>Redirect to login</span>,
}));
vi.mock('react-native', () => ({
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  HelperText: ({ children }: { children: React.ReactNode }) => <span role="alert">{children}</span>,
  TextInput: Object.assign(
    ({
      label,
      value,
      onChangeText,
      secureTextEntry,
      right,
      disabled,
    }: {
      label: string;
      value: string;
      onChangeText: (v: string) => void;
      secureTextEntry?: boolean;
      right?: React.ReactNode;
      disabled?: boolean;
    }) => (
      <label>
        {label}
        <input
          aria-label={label}
          value={value}
          onChange={(e) => onChangeText(e.target.value)}
          type={secureTextEntry ? 'password' : 'text'}
          disabled={disabled}
        />
        {right}
      </label>
    ),
    {
      Icon: ({
        accessibilityLabel,
        onPress,
      }: {
        accessibilityLabel: string;
        onPress: () => void;
      }) => <button aria-label={accessibilityLabel} onClick={onPress} />,
    },
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
  Card: Object.assign(({ children }: { children: React.ReactNode }) => <div>{children}</div>, {
    Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  }),
  Chip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
beforeEach(() => {
  vi.stubGlobal('__DEV__', true);
  state.request.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('completes SMS recovery on Mobile with the actual anonymous API contract', async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/request')
      ? Response.json(
          { challengeId: 'synthetic-challenge', retryAfterSeconds: 60, expiresInSeconds: 300 },
          { status: 202 },
        )
      : url.endsWith('/verify')
        ? Response.json({ authorization: 'synthetic-authorization', expiresInSeconds: 300 })
        : new Response(null, { status: 204 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(<SmsPasswordRecoveryScreen />);
  fireEvent.change(screen.getByLabelText('Tài khoản hoặc số điện thoại'), {
    target: { value: 'tenant.sms-demo' },
  });
  fireEvent.click(screen.getByText('Gửi mã xác minh'));
  await screen.findByLabelText('Mã xác minh');
  expect((screen.getByText(/Gửi lại sau/) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Mã xác minh'), { target: { value: '123456' } });
  fireEvent.click(screen.getByText('Xác minh'));
  await screen.findByLabelText('Mật khẩu mới');
  fireEvent.click(screen.getByLabelText('Hiện mật khẩu'));
  expect((screen.getByLabelText('Mật khẩu mới') as HTMLInputElement).type).toBe('text');
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), {
    target: { value: 'Next!Password-927' },
  });
  fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu'), {
    target: { value: 'Next!Password-927' },
  });
  fireEvent.click(screen.getByText('Đặt lại mật khẩu'));
  await screen.findByText('Đã đặt lại mật khẩu');
  expect(fetchMock).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByText('Quay lại đăng nhập'));
  expect(state.replace).toHaveBeenCalledWith('/');
});
it('renders protected simulated messages in the Mobile demo inbox', async () => {
  vi.stubEnv('EXPO_PUBLIC_SMS_DEMO_ENABLED', 'true');
  state.request.mockResolvedValue([
    {
      id: 'synthetic',
      maskedPhone: '***0003',
      templateId: 'SMS-01',
      content: 'Synthetic simulated SMS',
      createdAt: '2026-11-13T10:00:00Z',
    },
  ]);
  render(<DemoSmsInboxScreen />);
  await screen.findByText('Synthetic simulated SMS');
  expect(screen.getByText('***0003')).toBeTruthy();
  expect(screen.getByText(/không gửi qua mạng di động/)).toBeTruthy();
});
it('excludes Mobile demo access and network calls in Production', () => {
  vi.stubGlobal('__DEV__', false);
  vi.stubEnv('EXPO_PUBLIC_SMS_DEMO_ENABLED', 'true');
  render(<DemoSmsInboxScreen />);
  expect(screen.getByText('Redirect to login')).toBeTruthy();
  expect(state.request).not.toHaveBeenCalled();
});
