// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  session: { api: {}, baseUrl: 'https://api.test', session: { roles: ['Owner'] } },
  go: vi.fn(),
}));
vi.mock('react-native', () => ({
  StyleSheet: { create: (s: unknown) => s },
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('react-native-paper', () => ({
  MD3LightTheme: { colors: {} },
  configureFonts: () => ({}),
  Icon: () => null,
  ProgressBar: () => null,
  useTheme: () => ({ colors: { surface: '#fff', onSurfaceVariant: '#64748b' } }),
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  TouchableRipple: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    onPress: () => void;
    accessibilityLabel?: string;
  }) => (
    <button onClick={onPress} aria-label={accessibilityLabel}>
      {children}
    </button>
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
    <span>{accessibilityLabel}</span>
  ),
}));
vi.mock('../../../src/mobile/src/components/WorkspaceKit', () => ({
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
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title }: { title: string }) => <h1>{title}</h1>,
  Metric: ({ label, value }: { label: string; value: string }) => (
    <span>
      {label}: {value}
    </span>
  ),
  QuickActions: ({ items }: { items: { label: string; onPress: () => void }[] }) => (
    <div>
      {items.map((item) => (
        <button key={item.label} onClick={item.onPress}>
          {item.label}
        </button>
      ))}
    </div>
  ),
  ui: {},
}));
vi.mock('../../../src/mobile/src/lib/SessionProvider', () => ({ useSession: () => mocks.session }));
vi.mock('../../../src/mobile/src/features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ go: mocks.go }),
}));
vi.mock('../../../src/mobile/src/services/ownerOverview', () => ({
  loadOwnerOverview: mocks.load,
}));
import { OwnerOverviewScreen } from '../../../src/mobile/src/screens/OwnerOverviewScreen';
import { MobileApiError } from '../../../src/mobile/src/lib/api';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('shows loading, an explicit failure, and a retry that really reloads the Owner API', async () => {
  let reject!: (error: Error) => void;
  mocks.load
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValueOnce({ locations: 0, rooms: 0, occupiedRooms: 0, contracts: 0 });
  render(<OwnerOverviewScreen />);
  expect(screen.getByText('Đang tải tổng quan')).toBeTruthy();
  reject(new MobileApiError(500, undefined, '/api/v1/rooms'));
  await screen.findByText(/Máy chủ gặp lỗi xử lý/);
  expect(screen.queryByText(/HTTP 500|GET \/api\/v1\//)).toBeNull();
  expect(screen.queryByText('Phòng')).toBeNull();
  fireEvent.click(screen.getByText('Tải lại dữ liệu'));
  await screen.findByText('Phòng');
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/HTTP 500/)).toBeNull();
  fireEvent.click(screen.getByText('Hợp đồng & Vòng đời'));
  expect(mocks.go).toHaveBeenCalledWith('signing');
});
it('aborts obsolete dashboard reads on unmount', async () => {
  mocks.load.mockImplementationOnce(() => new Promise(() => {}));
  const view = render(<OwnerOverviewScreen />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
  const signal = mocks.load.mock.calls[0]![1] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});
