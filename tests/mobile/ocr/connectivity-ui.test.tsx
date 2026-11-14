// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { QueryCache } from '../../../src/mobile/src/lib/queryCache';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  session: {
    api: { queryCache: null as QueryCache | null, request: vi.fn() },
    baseUrl: 'https://api.test',
    session: { roles: ['Owner'] },
  },
  go: vi.fn(),
}));
vi.mock('react-native', () => ({
  StyleSheet: { create: (s: unknown) => s },
  View: ({
    children,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    accessibilityLabel?: string;
  }) => <div aria-label={accessibilityLabel}>{children}</div>,
}));
vi.mock('expo-router', () => ({
  router: { push: vi.fn() },
  useFocusEffect: (callback: () => (() => void) | undefined) => useEffect(callback, [callback]),
}));
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
vi.mock('../../../src/mobile/src/features/owner/OwnerAttentionSummary', () => ({
  OwnerAttentionSummary: () => null,
}));
vi.mock('../../../src/mobile/src/features/owner/OwnerApprovalQueue', async (original) => ({
  ...(await original<object>()),
  OwnerApprovalQueue: () => null,
}));
import { beforeEach } from 'vitest';
beforeEach(() => {
  mocks.session.api.queryCache = new QueryCache();
  mocks.session.api.request.mockImplementation(async (path: string) =>
    path.includes('/debts/summary')
      ? { outstandingAmount: '90000', overdueInvoiceCount: 2 }
      : { items: [], totalCount: 0 },
  );
});
import { MobileApiError } from '../../../src/mobile/src/lib/api';

afterEach(() => {
  cleanup();
  mocks.session.api.queryCache?.dispose();
  vi.clearAllMocks();
  mocks.load.mockReset();
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
    .mockResolvedValueOnce({
      locations: 0,
      rooms: 0,
      occupiedRooms: 0,
      availableRooms: 0,
      operationalOccupancyRate: 0,
      contracts: 0,
    });
  render(<OwnerOverviewScreen />);
  expect(screen.getAllByLabelText('Đang tải dữ liệu').length).toBeGreaterThan(0);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
  reject(new MobileApiError(500, undefined, '/api/v1/rooms'));
  await screen.findByText(/Chưa cập nhật được dữ liệu/);
  expect(screen.queryByText(/HTTP 500|GET \/api\/v1\//)).toBeNull();
  expect(screen.getAllByText('Chưa có dữ liệu')).toHaveLength(2);
  fireEvent.click(screen.getByText('Thử lại'));
  await screen.findByText('0 cơ sở');
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/HTTP 500/)).toBeNull();
  fireEvent.click(screen.getByText('Xem tất cả'));
  expect(mocks.go).toHaveBeenCalledWith('approvals');
});
it('shares the in-flight dashboard read on return and aborts when the session cache closes', async () => {
  mocks.load.mockImplementationOnce(() => new Promise(() => {}));
  const view = render(<OwnerOverviewScreen />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
  const signal = mocks.load.mock.calls[0]![1] as AbortSignal;
  view.unmount();
  render(<OwnerOverviewScreen />);
  expect(mocks.load).toHaveBeenCalledTimes(1);
  mocks.session.api.queryCache!.dispose();
  expect(signal.aborted).toBe(true);
});
