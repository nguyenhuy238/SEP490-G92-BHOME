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
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Action: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (path: string | null) => {
    state.paths.push(path);
    return {
      data: state.error
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
                    submittedAt: '2026-11-13T00:00:00Z',
                  },
                ],
          },
      error: state.error,
      loading: false,
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
it('shows server totals rather than page length and opens the specific contract signing section', () => {
  render(<OwnerApprovalQueue />);
  expect(screen.getAllByText('17 hồ sơ')).toHaveLength(8);
  fireEvent.click(screen.getAllByRole('button', { name: 'Xem hồ sơ' })[1]!);
  expect(state.go).toHaveBeenCalledWith('signing', {
    contractId: 'synthetic-id',
    section: 'signing',
  });
  fireEvent.click(screen.getAllByRole('button', { name: 'Xem hồ sơ' })[6]!);
  expect(state.go).toHaveBeenLastCalledWith('owner-adjustment-detail', {
    adjustmentId: 'synthetic-id',
  });
  fireEvent.click(screen.getAllByRole('button', { name: 'Cập nhật' })[0]!);
  expect(state.reload).toHaveBeenCalledOnce();
  fireEvent.click(screen.getAllByRole('button', { name: 'Sau' })[0]!);
  expect(state.paths).toContain('/api/v1/contracts?status=Draft&page=2&pageSize=3');
});
it('does not query Owner records for Staff or Tenant', () => {
  for (const role of ['Staff', 'Tenant']) {
    state.role = role;
    const view = render(<OwnerApprovalQueue />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(state.paths.every((path) => path === null)).toBe(true);
    view.unmount();
  }
});
it('shows empty and error states without treating failed data as zero', () => {
  state.empty = true;
  const view = render(<OwnerApprovalQueue />);
  expect(screen.getAllByText('Không có hồ sơ chờ xử lý.')).toHaveLength(8);
  view.unmount();
  state.error = 'Không có quyền';
  render(<OwnerApprovalQueue />);
  expect(screen.getAllByText('Không có quyền')).toHaveLength(8);
  expect(screen.queryByText('0 hồ sơ')).toBeNull();
});
