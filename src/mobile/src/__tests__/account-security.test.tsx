// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountSecurityScreen } from '../screens/AccountSecurityScreen';

const s = vi.hoisted(() => ({ json: vi.fn(), logout: vi.fn(), replace: vi.fn() }));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api: { json: s.json }, logout: s.logout }),
}));
vi.mock('expo-router', () => ({ router: { replace: s.replace } }));
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove: vi.fn() }) } }));
vi.mock('../components/WorkspaceKit', () => ({
  Heading: () => <span>Security</span>,
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Action: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
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
    accessibilityLabel,
    value,
    onChangeText,
  }: {
    accessibilityLabel: string;
    value: string;
    onChangeText: (v: string) => void;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));
beforeEach(() => {
  vi.clearAllMocks();
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
  ['Synthetic!Current-725', 'Synthetic!Current-725'],
  ['Synthetic!Current-725', 'short'],
  ['', 'Synthetic!Next-725'],
])('rejects invalid or unchanged password input without mutation', (current, next) => {
  render(<AccountSecurityScreen />);
  fill(current, next);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(s.json).not.toHaveBeenCalled();
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
  s.json.mockRejectedValue(new Error('Rejected'));
  render(<AccountSecurityScreen />);
  fill('Wrong!Current-725', 'Synthetic!Next-725');
  await screen.findByRole('alert');
  expect(s.logout).not.toHaveBeenCalled();
  expect(s.replace).not.toHaveBeenCalled();
});
