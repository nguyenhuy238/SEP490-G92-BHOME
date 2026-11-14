// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  role: 'Owner',
  go: vi.fn(),
  reload: vi.fn(),
  paths: [] as (string | null)[],
  error: '',
  empty: false,
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api: {}, session: { roles: [state.role] } }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ go: state.go }),
}));
type C = { children?: React.ReactNode };
const Button = ({
  children,
  onPress,
  disabled,
}: C & { onPress: () => void; disabled?: boolean }) => (
  <button disabled={disabled} onClick={onPress}>
    {children}
  </button>
);
vi.mock('react-native-paper', () => ({
  Text: ({ children }: C) => <span>{children}</span>,
  Button: (props: React.ComponentProps<typeof Button>) => <Button {...props} />,
}));
vi.mock('react-native', () => ({ View: ({ children }: C) => <div>{children}</div> }));
vi.mock('../components/DashboardKit', () => ({
  DashboardSummary: ({ title, detail }: { title: string; detail: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{detail}</p>
    </header>
  ),
}));
vi.mock('../features/owner/OwnerPlaceLabel', () => ({
  OwnerPlaceLabel: () => <span>Cơ sở mẫu · Phòng 101</span>,
}));
vi.mock('../components/OwnerMobileKit', () => ({
  OwnerRecordRow: ({
    title,
    status,
    action,
    onPress,
    children,
  }: C & { title: string; status: string; action: string; onPress: () => void }) => (
    <button onClick={onPress}>
      <span>{title}</span>
      <span>{status}</span>
      <span>{action}</span>
      {children}
    </button>
  ),
  OwnerEmpty: ({ title }: { title: string }) => <p>{title}</p>,
  OwnerFailure: ({ retry }: { retry: () => void }) => <Button onPress={retry}>Thử lại</Button>,
  OwnerLoading: () => <p>Đang tải</p>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  Row: ({ children }: C) => <div>{children}</div>,
  Filters: ({ options, onChange }: { options: string[]; onChange: (value: string) => void }) => (
    <div>
      {options.map((value) => (
        <Button key={value} onPress={() => onChange(value)}>
          {value}
        </Button>
      ))}
    </div>
  ),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (path: string | null) => {
    state.paths.push(path);
    return {
      data:
        state.error || !path
          ? null
          : {
              totalCount: state.empty ? 0 : 17,
              items: state.empty
                ? []
                : [
                    {
                      id: 'synthetic-id',
                      title: 'Kiểm tra phòng',
                      roomNumber: '101',
                      locationName: 'Cơ sở mẫu',
                    },
                  ],
            },
      error: state.error,
      loading: false,
      fetching: false,
      reload: state.reload,
    };
  },
}));
import { OwnerApprovalQueue } from '../features/owner/OwnerApprovalQueue';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.paths = [];
  state.role = 'Owner';
  state.error = '';
  state.empty = false;
});

it('merges actual records, uses server totals, prioritizes emergencies and keeps financial admin out', () => {
  render(<OwnerApprovalQueue />);
  expect(screen.getByText('136 mục cần theo dõi hoặc quyết định')).toBeTruthy();
  expect(state.paths.filter(Boolean)).toHaveLength(8);
  expect(
    state.paths.some((path) => /invoice-adjustments|payment-transactions/.test(path || '')),
  ).toBe(false);
  expect(screen.getAllByText('Xem cảnh báo')).toHaveLength(2);
  fireEvent.click(screen.getAllByText('Xem tiến độ ký')[0]);
  expect(state.go).toHaveBeenCalledWith('signing', {
    contractId: 'synthetic-id',
    section: 'signing',
  });
  fireEvent.click(screen.getByText('Sau'));
  expect(state.paths).toContain('/api/v1/contracts?status=PendingSigning&page=2&pageSize=6');
});
it('filters actionable maintenance without presenting emergency awareness as approval', () => {
  render(<OwnerApprovalQueue />);
  fireEvent.click(screen.getByText('Bảo trì'));
  expect(screen.getAllByText('Kiểm tra phòng')).toHaveLength(2);
  expect(screen.queryByText('Xem cảnh báo')).toBeNull();
  fireEvent.click(screen.getByText('Xem phương án'));
  expect(state.go).toHaveBeenCalledWith('maintenance-detail', { workOrderId: 'synthetic-id' });
});
it.each(['Staff', 'Tenant'])('does not query Owner records for %s', (role) => {
  state.role = role;
  render(<OwnerApprovalQueue />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(state.paths.every((path) => path === null)).toBe(true);
});
it('hides empty categories and distinguishes failures from an empty queue', () => {
  state.empty = true;
  const view = render(<OwnerApprovalQueue />);
  expect(screen.getByText('Không còn mục cần xử lý')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
  view.unmount();
  state.error = 'unknown_backend_code';
  render(<OwnerApprovalQueue />);
  expect(screen.queryByText('Không còn mục cần xử lý')).toBeNull();
  expect(screen.queryByText('unknown_backend_code')).toBeNull();
  fireEvent.click(screen.getByText('Thử lại'));
  expect(state.reload).toHaveBeenCalledTimes(8);
});

it('includes saved drafts and opens Owner review without changing contract state', () => {
  render(<OwnerApprovalQueue />);
  expect(state.paths).toContain('/api/v1/contracts?status=Draft&page=1&pageSize=6');
  expect(screen.getByText('Chờ duyệt để ký')).toBeTruthy();
  fireEvent.click(screen.getByText('Xem và duyệt hợp đồng'));
  expect(state.go).toHaveBeenCalledWith('signing', {
    contractId: 'synthetic-id',
    section: 'signing',
  });
});
