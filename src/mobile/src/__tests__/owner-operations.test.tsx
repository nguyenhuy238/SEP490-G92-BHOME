// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const s = vi.hoisted(() => ({
  role: 'Owner',
  paths: [] as (string | null)[],
  go: vi.fn(),
  error: '',
  empty: false,
}));
type C = { children?: React.ReactNode };
vi.mock('../theme/theme', () => ({ colors: {}, staffColors: {} }));
vi.mock('../lib/SessionProvider', () => ({ useSession: () => ({ session: { roles: [s.role] } }) }));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ role: s.role, go: s.go }),
}));
vi.mock('react-native-paper', () => ({ Text: ({ children }: C) => <span>{children}</span> }));
vi.mock('../components/DashboardKit', () => ({
  DashboardSummary: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock('../components/OwnerMobileKit', () => ({
  OwnerRecordRow: ({
    title,
    status,
    children,
    onPress,
  }: C & { title: string; status: string; onPress: () => void }) => (
    <button onClick={onPress}>
      {title}
      <span>{status}</span>
      {children}
    </button>
  ),
  OwnerEmpty: ({ title }: { title: string }) => <p>{title}</p>,
  OwnerFailure: () => <p>Chưa tải được</p>,
  OwnerLoading: () => <p>Đang tải</p>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  Filters: ({ options, onChange }: { options: string[]; onChange: (value: string) => void }) => (
    <div>
      {options.map((value) => (
        <button key={value} onClick={() => onChange(value)}>
          {value}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('../components/WorkspaceQueryState', () => ({
  Pagination: ({ onChange }: { onChange: (page: number) => void }) => (
    <button onClick={() => onChange(2)}>Trang tiếp</button>
  ),
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
    onChange: (id: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (path: string | null) => {
    s.paths.push(path);
    const lookup = path?.includes('/capture/');
    return {
      data:
        !path || s.error
          ? null
          : lookup
            ? [{ id: 'location', label: 'Cơ sở thử nghiệm' }]
            : {
                items: s.empty
                  ? []
                  : [
                      {
                        id: 'record',
                        locationId: 'location',
                        title: 'Kiểm tra hệ thống nước',
                        status: path.includes('work-orders') ? 'PendingVerification' : 'InProgress',
                      },
                    ],
                totalCount: s.empty ? 0 : 15,
              },
      error: s.error,
      loading: false,
      fetching: false,
      reload: vi.fn(),
    };
  },
}));
import { OwnerOperationsScreen } from '../screens/OwnerOperationsScreen';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  s.role = 'Owner';
  s.paths = [];
  s.error = '';
  s.empty = false;
});
it('filters on the server by Location/status, resets pagination and opens real monitoring detail', () => {
  render(<OwnerOperationsScreen />);
  expect(s.paths).toContain('/api/v1/incidents?page=1&pageSize=12');
  fireEvent.change(screen.getByLabelText('Cơ sở'), { target: { value: 'location' } });
  fireEvent.click(screen.getByText('Bảo trì'));
  fireEvent.change(screen.getByLabelText('Trạng thái'), {
    target: { value: 'PendingVerification' },
  });
  expect(s.paths).toContain(
    '/api/v1/work-orders?page=1&pageSize=12&workOrderStatus=PendingVerification&locationId=location',
  );
  fireEvent.click(screen.getByText('Trang tiếp'));
  expect(s.paths).toContain(
    '/api/v1/work-orders?page=2&pageSize=12&workOrderStatus=PendingVerification&locationId=location',
  );
  fireEvent.click(screen.getByText('Kiểm tra hệ thống nước'));
  expect(s.go).toHaveBeenCalledWith('maintenance-detail', { workOrderId: 'record' });
  fireEvent.click(screen.getByText('Công việc'));
  expect(s.paths).toContain('/api/v1/operational-tasks?page=1&pageSize=12&locationId=location');
  expect(screen.queryByText('Tạo công việc')).toBeNull();
  expect(screen.queryByText(/Thiết lập cơ sở/)).toBeNull();
});
it('separates emergencies and contract monitoring using the existing APIs', () => {
  render(<OwnerOperationsScreen initialSection="Khẩn cấp" />);
  expect(s.paths).toContain('/api/v1/incidents?page=1&pageSize=12&severity=Emergency');
  fireEvent.click(screen.getByText('Hợp đồng'));
  expect(s.paths).toContain('/api/v1/contracts?page=1&pageSize=12');
  fireEvent.click(screen.getByText('Kiểm tra hệ thống nước'));
  expect(s.go).toHaveBeenCalledWith('signing', { contractId: 'record' });
});
it.each(['Staff', 'Tenant'])('does not query Owner monitoring for %s', (role) => {
  s.role = role;
  render(<OwnerOperationsScreen />);
  expect(s.paths.every((path) => path === null)).toBe(true);
  expect(screen.queryByRole('button')).toBeNull();
});
it('offers meaningful empty/error states without exposing technical errors', () => {
  s.empty = true;
  const view = render(<OwnerOperationsScreen />);
  expect(screen.getByText('Chưa có mục phù hợp')).toBeTruthy();
  view.unmount();
  s.error = 'unknown_or_ambiguous_payment_code';
  render(<OwnerOperationsScreen />);
  expect(screen.getAllByText('Chưa tải được').length).toBeGreaterThan(0);
  expect(screen.queryByText(s.error)).toBeNull();
  expect(screen.queryByText('Chưa có mục phù hợp')).toBeNull();
});
