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
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => ({
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
  await screen.findByText(/HTTP 500/);
  expect(screen.queryByText('Phòng: 0')).toBeNull();
  fireEvent.click(screen.getByText('Tải lại dữ liệu'));
  await screen.findByText('Phòng: 0');
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
