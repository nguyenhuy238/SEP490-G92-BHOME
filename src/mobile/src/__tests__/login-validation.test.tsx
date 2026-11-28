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
  Image: ({ accessibilityLabel }: { accessibilityLabel?: string }) => (
    <img alt={accessibilityLabel ?? ''} />
  ),
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
      ref,
      accessibilityLabel,
      value,
      onChangeText,
      disabled,
    }: {
      ref?: React.Ref<HTMLInputElement>;
      accessibilityLabel: string;
      value: string;
      onChangeText: (s: string) => void;
      disabled?: boolean;
    }) => (
      <input
        ref={ref}
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

it('shows the production login controls without demo or invitation shortcuts', () => {
  render(<LoginScreen />);
  for (const label of [
    'M\u1edf l\u1eddi m\u1eddi k\u00fd h\u1ee3p \u0111\u1ed3ng',
    'Thi\u1ebft l\u1eadp t\u00e0i kho\u1ea3n t\u1eeb l\u1eddi m\u1eddi',
    'H\u1ed7 tr\u1ee3 k\u1ef9 thu\u1eadt BHome',
    'XEM GIAO DI\u1ec6N M\u1eaaU',
    'Kh\u00f4ng c\u1ea7n t\u00e0i kho\u1ea3n',
    'Nh\u00e2n vi\u00ean',
    'Kh\u00e1ch thu\u00ea',
    'D\u1eef li\u1ec7u minh h\u1ecda t\u00e1ch bi\u1ec7t v\u1edbi h\u1ec7 th\u1ed1ng th\u1eadt. Kh\u00f4ng thay \u0111\u1ed5i quy\u1ec1n t\u00e0i kho\u1ea3n.',
  ])
    expect(screen.queryByText(label)).toBeNull();
  expect(screen.getByRole('img', { name: 'Logo BHome' })).toBeTruthy();
  expect(screen.getByLabelText('Email ho\u1eb7c s\u1ed1 \u0111i\u1ec7n tho\u1ea1i \u0111\u0103ng nh\u1eadp')).toBeTruthy();
  expect(screen.getByLabelText('M\u1eadt kh\u1ea9u \u0111\u0103ng nh\u1eadp')).toBeTruthy();
  expect(screen.getByText('Qu\u00ean m\u1eadt kh\u1ea9u?')).toBeTruthy();
  expect(screen.getByText('\u0110\u0103ng nh\u1eadp')).toBeTruthy();
  expect(screen.getByText('C\u1ea5u h\u00ecnh k\u1ebft n\u1ed1i API')).toBeTruthy();
  expect(screen.getByText('BHome \u2022 Smart Boarding House Management')).toBeTruthy();
});

it('shows both missing-field errors and only clears the corrected error', () => {
  render(<LoginScreen />);
  fireEvent.click(screen.getByText('Đăng nhập', { selector: 'button' }));
  expect(screen.getByText('Vui lòng nhập email hoặc số điện thoại.')).toBeTruthy();
  expect(screen.getByText('Vui lòng nhập mật khẩu.')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText('Email hoặc số điện thoại đăng nhập'));
  fireEvent.change(screen.getByLabelText('Email hoặc số điện thoại đăng nhập'), {
    target: { value: '0901234567' },
  });
  expect(screen.queryByText('Vui lòng nhập email hoặc số điện thoại.')).toBeNull();
  expect(screen.getByText('Vui lòng nhập mật khẩu.')).toBeTruthy();
  expect(state.login).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Đăng nhập', { selector: 'button' }));
  expect(document.activeElement).toBe(screen.getByLabelText('Mật khẩu đăng nhập'));
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
    const transport = vi.fn().mockResolvedValue(
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
