// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const state = vi.hoisted(() => ({
  request: vi.fn(),
  go: vi.fn(),
  back: vi.fn(),
  verified: 1,
  related: false,
}));
vi.mock('expo-router', () => ({ router: { canGoBack: () => true, back: state.back } }));
vi.mock('../lib/SessionProvider', () => {
  const api = { request: state.request };
  return { useSession: () => ({ api }) };
});
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ go: state.go, requestNavigation: (action: () => void) => action() }),
}));
vi.mock('react-native', () => ({
  View: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={style}>{children}</div>
  ),
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StyleSheet: {
    create: <T,>(styles: T) => styles,
  },
  Platform: {
    OS: 'web',
  },
}));
vi.mock('react-native-paper', () => ({
  MD3LightTheme: { colors: {} },
  configureFonts: () => ({}),
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  ActivityIndicator: () => <span>Loading</span>,
  Icon: ({ source }: { source: string }) => <i data-icon={source} />,
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
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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
  ui: {},
}));
vi.mock('../features/onboarding/IdentityWizard', () => ({
  IdentityWizard: () => <span>OCR wizard</span>,
}));
import { ResidentProfile } from '../features/onboarding/ResidentProfile';
const residentId = '10000000-0000-4000-8000-000000000001';
const roomId = '10000000-0000-4000-8000-000000000002';
const locationId = '10000000-0000-4000-8000-000000000003';
const contractId = '10000000-0000-4000-8000-000000000004';
beforeEach(() => {
  vi.clearAllMocks();
  state.verified = 1;
  state.related = false;
  state.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/capture/locations') return [{ id: locationId, label: 'Cơ sở kiểm thử' }];
    if (path.endsWith('/residents'))
      return [
        {
          id: residentId,
          roomId,
          displayLabel: 'Hồ sơ tổng hợp',
          residentType: 0,
          verificationStatus: state.verified,
          confirmedAt: '2026-11-09T00:00:00Z',
        },
      ];
    if (path.endsWith('/rooms')) return [{ id: roomId, label: '101' }];
    if (path.startsWith('/api/v1/contracts?'))
      return {
        items: state.related
          ? [
              {
                id: contractId,
                roomId,
                locationId,
                locationName: 'Cơ sở kiểm thử',
                roomNumber: '101',
                kind: 'Main',
                status: 'Active',
                startDate: '2026-01-01',
                endDate: '2027-01-01',
                monthlyRent: '3000000',
              },
            ]
          : [],
        page: 1,
        pageSize: 20,
        totalCount: state.related ? 1 : 0,
      };
    if (path === `/api/v1/contracts/${contractId}`) return { residentIds: [residentId] };
    throw new Error('Unexpected read');
  });
});
afterEach(cleanup);
it('returns to the existing room instead of stacking a fresh directory', async () => {
  render(<ResidentProfile residentId={residentId} locationId={locationId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Quay lại' }));
  expect(state.back).toHaveBeenCalled();
  expect(state.go).not.toHaveBeenCalled();
});
it('does not enable verification or contract actions for an unknown status', async () => {
  state.verified = 99;
  render(<ResidentProfile residentId={residentId} locationId={locationId} />);
  await screen.findByText('Chưa rõ trạng thái');
  expect(screen.queryByText('OCR wizard')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Xem / chuẩn bị hợp đồng' })).toBeNull();
});
it('reads authoritative Verified status and never opens an empty identity wizard', async () => {
  render(<ResidentProfile residentId={residentId} locationId={locationId} />);
  await screen.findByText('Đã xác minh');
  expect(screen.getByText('Hồ sơ tổng hợp')).toBeTruthy();
  expect(screen.getByText('Phòng: 101')).toBeTruthy();
  expect(screen.queryByText('OCR wizard')).toBeNull();
  expect(screen.queryByText(/Số CCCD/)).toBeNull();
});
it('opens identity capture only for a Pending Resident', async () => {
  state.verified = 0;
  render(<ResidentProfile residentId={residentId} locationId={locationId} />);
  await screen.findByText('OCR wizard');
  expect(screen.queryByText('Đã xác minh')).toBeNull();
  expect(screen.getByText('Chờ xác minh')).toBeTruthy();
  expect(screen.getByText('Chưa hoàn tất xác minh danh tính')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Quét CCCD (Camera)' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Nhập thông tin thủ công' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Tiếp tục xác minh' })).toBeNull();
});
it('keeps a Rejected Resident out of the unsupported OCR workflow', async () => {
  state.verified = 2;
  render(<ResidentProfile residentId={residentId} locationId={locationId} />);
  await screen.findByText(/Hồ sơ đã bị từ chối/);
  expect(screen.queryByText('OCR wizard')).toBeNull();
});
it('opens an existing related contract instead of offering a duplicate draft', async () => {
  state.related = true;
  render(<ResidentProfile residentId={residentId} locationId={locationId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Xem / chuẩn bị hợp đồng' }));
  await waitFor(() => expect(state.go).toHaveBeenCalledWith('signing', { contractId }));
  expect(state.request.mock.calls.every((call) => !call[1]?.method)).toBe(true);
});
it('passes only reference IDs to preparation when no related contract exists', async () => {
  render(<ResidentProfile residentId={residentId} locationId={locationId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Xem / chuẩn bị hợp đồng' }));
  await waitFor(() =>
    expect(state.go).toHaveBeenCalledWith('prepare-contract', {
      roomId,
      representativeResidentId: residentId,
      residentIds: JSON.stringify([residentId]),
    }),
  );
});
it('fails closed when the assigned summary API rejects access', async () => {
  state.request.mockRejectedValue(new Error('Unavailable'));
  render(<ResidentProfile residentId={residentId} locationId={locationId} />);
  await screen.findByRole('button', { name: 'Tải lại hồ sơ' });
  expect(screen.queryByText('OCR wizard')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Xem / chuẩn bị hợp đồng' })).toBeNull();
});
