// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LoginScreen } from '../screens/LoginScreen';
import {
  loginIdentifierError,
  loginPayload,
  normalizeLoginPhone,
} from '../../../../packages/client-core/src/loginValidation';
import { MobileSessions } from '../lib/sessions';

const state = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ baseUrl: 'https://api.example.invalid', login: state.login }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ startPreview: vi.fn(), unavailable: vi.fn() }),
}));
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('../theme/theme', () => ({ colors: {} }));
vi.mock('../lib/useFeedbackState', () => ({ useFeedbackState: () => React.useState('') }));
vi.mock('../components/KeyboardFormScrollView', () => ({
  KeyboardFormScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Action: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  ui: {},
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (s: unknown) => s },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  KeyboardAvoidingView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => ({
  Text: ({
    children,
    accessibilityRole,
  }: {
    children: React.ReactNode;
    accessibilityRole?: string;
  }) => <span role={accessibilityRole}>{children}</span>,
  Icon: () => null,
  TextInput: Object.assign(
    ({
      accessibilityLabel,
      value,
      onChangeText,
      disabled,
    }: {
      accessibilityLabel: string;
      value: string;
      onChangeText: (s: string) => void;
      disabled?: boolean;
    }) => (
      <input
        aria-label={accessibilityLabel}
        value={value}
        disabled={disabled}
        onChange={(e) => onChangeText(e.target.value)}
      />
    ),
    { Icon: () => null },
  ),
  Button: ({
    children,
    disabled,
    onPress,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
beforeEach(() => {
  vi.stubGlobal('__DEV__', false);
  state.login.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows both missing-field errors and only clears the corrected error', () => {
  render(<LoginScreen />);
  fireEvent.click(screen.getByText('Đăng nhập', { selector: 'button' }));
  expect(screen.getByText('Vui lòng nhập email hoặc số điện thoại.')).toBeTruthy();
  expect(screen.getByText('Vui lòng nhập mật khẩu.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Email hoặc số điện thoại đăng nhập'), {
    target: { value: '0901234567' },
  });
  expect(screen.queryByText('Vui lòng nhập email hoặc số điện thoại.')).toBeNull();
  expect(screen.getByText('Vui lòng nhập mật khẩu.')).toBeTruthy();
  expect(state.login).not.toHaveBeenCalled();
});
it('accepts phone input for every supported role using the shared login screen', async () => {
  render(<LoginScreen />);
  fireEvent.change(screen.getByLabelText('Email hoặc số điện thoại đăng nhập'), {
    target: { value: '090-123 4567' },
  });
  fireEvent.change(screen.getByLabelText('Mật khẩu đăng nhập'), {
    target: { value: 'Synthetic!Login-795' },
  });
  fireEvent.click(screen.getByText('Đăng nhập', { selector: 'button' }));
  await waitFor(() =>
    expect(state.login).toHaveBeenCalledWith(
      'https://api.example.invalid',
      '090-123 4567',
      'Synthetic!Login-795',
    ),
  );
});
it.each(['0901234567', '+84 (90) 123-4567'])(
  'normalizes %s consistently and MobileSessions sends phone instead of email',
  async (phone) => {
    expect(normalizeLoginPhone(phone)).toBe('+84901234567');
    expect(loginIdentifierError(phone)).toBe('');
    const transport = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            userId: 'synthetic-user',
            roles: ['Tenant'],
            accessToken: 'synthetic-access',
            refreshToken: 'synthetic-refresh',
          }),
        ),
      );
    const manager = new MobileSessions(
      { read: async () => null, write: async () => {}, remove: async () => {} },
      'https://api.example.invalid',
      transport,
    );
    await manager.login('https://api.example.invalid', phone, 'Synthetic!Login-795');
    expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual({
      phone: '+84901234567',
      password: 'Synthetic!Login-795',
      device: 'BHOME Mobile',
    });
  },
);
it.each(['bad@@example.invalid', 'a b@example.invalid', '+84abc', '123'])(
  'rejects malformed identifier %s before sending credentials',
  (value) => {
    expect(loginIdentifierError(value)).not.toBe('');
  },
);
it('keeps email casing and trims identifiers without trimming passwords', () => {
  expect(loginPayload(' Owner@example.invalid ', ' secret ')).toEqual({
    email: 'Owner@example.invalid',
    password: ' secret ',
  });
});
