// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canOpenScreen } from '../features/workspace/navigation';

const state = vi.hoisted(() => ({
  role: 'Staff',
  roles: ['Staff'],
  preview: false,
  request: vi.fn(),
  go: vi.fn(),
  toast: vi.fn(),
}));
const api = { request: state.request };
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api, session: { roles: state.roles } }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ role: state.role, preview: state.preview, go: state.go }),
}));
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
}));
vi.mock('../lib/toast', () => ({
  conciseMessage: (value: string) => value,
  showError: state.toast,
}));
vi.mock('../theme/theme', () => ({ colors: {} }));
type Children = { children?: React.ReactNode };
vi.mock('react-native', () => ({
  StyleSheet: { create: (value: unknown) => value },
  View: ({ children }: Children) => <div>{children}</div>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: Children) => <section>{children}</section>,
  ui: {},
}));
vi.mock('../components/WorkflowControls', () => ({
  ChoiceField: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: { id: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((item) => (
        <option key={item.id} value={item.id}>
          {item.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('react-native-paper', () => {
  const Control = ({
    children,
    accessibilityLabel,
    onPress,
    disabled,
  }: Children & { accessibilityLabel?: string; onPress: () => void; disabled?: boolean }) => (
    <button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>
      {children}
    </button>
  );
  return {
    Text: ({ children, accessibilityRole }: Children & { accessibilityRole?: string }) => (
      <span role={accessibilityRole}>{children}</span>
    ),
    Icon: () => null,
    Button: Control,
    IconButton: Control,
    TouchableRipple: Control,
    ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
      <span role="progressbar" aria-label={accessibilityLabel} />
    ),
  };
});
import { StaffScheduleScreen } from '../screens/StaffScheduleScreen';

beforeEach(() => {
  vi.clearAllMocks();
  state.role = 'Staff';
  state.roles = ['Staff'];
  state.preview = false;
  state.request.mockResolvedValue([]);
});
afterEach(cleanup);

it('shows an honest unavailable state and only requests the authorized location API', async () => {
  render(<StaffScheduleScreen />);
  await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  expect(screen.getByText('Chưa có dữ liệu lịch làm việc')).toBeTruthy();
  expect(screen.getByText('Lịch ca trực hiện chưa có dữ liệu để hiển thị.')).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(state.request.mock.calls.every(([path]) => path === '/api/v1/capture/locations')).toBe(
    true,
  );
  expect(screen.queryByText(/07:30|Đã điều chỉnh|Hôm nay|Dữ liệu mẫu/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Mở công việc được giao' }));
  expect(state.go).toHaveBeenCalledWith('work-orders');
});

it('displays one authorized location without a dropdown', async () => {
  state.request.mockResolvedValue([{ id: 'a', label: 'Cơ sở A' }]);
  render(<StaffScheduleScreen />);
  expect(await screen.findByText('Cơ sở A')).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
});

it('selects only returned locations and clears revoked selections on refresh', async () => {
  state.request.mockResolvedValue([
    { id: 'a', label: 'Cơ sở A' },
    { id: 'b', label: 'Cơ sở B' },
  ]);
  render(<StaffScheduleScreen />);
  const filter = await screen.findByRole('combobox');
  fireEvent.change(filter, { target: { value: 'b' } });
  expect((filter as HTMLSelectElement).value).toBe('b');
  state.request.mockResolvedValue([
    { id: 'a', label: 'Cơ sở A' },
    { id: 'c', label: 'Cơ sở C' },
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại cơ sở được phân công' }));
  await waitFor(() => expect(screen.queryByText('Cơ sở B')).toBeNull());
  expect(((await screen.findByRole('combobox')) as HTMLSelectElement).value).toBe('');
});

it('handles loading, errors, and retry without hiding the task shortcut', async () => {
  state.request.mockReturnValue(new Promise(() => {}));
  render(<StaffScheduleScreen />);
  expect(screen.getByRole('progressbar')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Tải lại cơ sở được phân công' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  cleanup();
  state.request.mockRejectedValue(new Error('Mất kết nối'));
  render(<StaffScheduleScreen />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Mở công việc được giao' })).toBeTruthy();
  state.request.mockResolvedValue([{ id: 'a', label: 'Cơ sở A' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText('Cơ sở A')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('does not request live data or show fabricated shifts in preview', () => {
  state.preview = true;
  render(<StaffScheduleScreen />);
  expect(state.request).not.toHaveBeenCalled();
  expect(screen.getByText('Chưa có dữ liệu lịch làm việc')).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
});

it.each(['Owner', 'Tenant'])('blocks %s at the route and screen boundaries', (role) => {
  expect(canOpenScreen(role as 'Owner' | 'Tenant', 'shifts')).toBe(false);
  state.role = role;
  state.roles = [role];
  render(<StaffScheduleScreen />);
  expect(state.request).not.toHaveBeenCalled();
  expect(screen.queryByText('Công việc được giao')).toBeNull();
});

it('requires an authenticated Staff role outside preview', () => {
  state.roles = [];
  render(<StaffScheduleScreen />);
  expect(state.request).not.toHaveBeenCalled();
  expect(screen.getByText('Bạn không có quyền xem lịch làm việc của Staff.')).toBeTruthy();
});
