// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StaffResidenceScreen } from '../screens/StaffResidenceScreen';
const state = vi.hoisted(() => ({ roles: ['Staff'], query: vi.fn() }));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ session: { roles: state.roles } }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ staffLocationId: 'location-synthetic' }),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (path: string | null) => {
    state.query(path);
    return {
      loading: false,
      error: '',
      reload: vi.fn(),
      data: path
        ? {
            items: [
              {
                contractId: 'contract',
                residentId: 'resident',
                roomNumber: 'SYN-01',
                residentLabel: 'Thành viên kiểm thử',
                status: 'InProgress',
                registrationRequired: true,
                registrationDeadline: '2026-11-30',
                registrationExpiresOn: '2027-11-30',
              },
            ],
            totalCount: 1,
          }
        : null,
    };
  },
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));
vi.mock('../theme/theme', () => ({ colors: {}, staffColors: {} }));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Heading: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock('../components/WorkspaceQueryState', () => ({
  QueryState: () => null,
  Pagination: () => null,
}));
afterEach(() => {
  cleanup();
  state.query.mockClear();
  state.roles = ['Staff'];
});
it('shows only status and dates through the assigned-location tracking endpoint', () => {
  render(<StaffResidenceScreen />);
  expect(state.query).toHaveBeenCalledWith(
    '/api/v1/residence-tasks/tracking?page=1&pageSize=20&locationId=location-synthetic',
  );
  expect(screen.getByText(/SYN-01/)).toBeTruthy();
  expect(screen.getByText('Đang thực hiện')).toBeTruthy();
  expect(screen.queryByText(/Minh chứng|CCCD|Tải ảnh/)).toBeNull();
});
it('does not request Staff tracking under a Tenant session', () => {
  state.roles = ['Tenant'];
  render(<StaffResidenceScreen />);
  expect(state.query).toHaveBeenCalledWith(null);
  expect(screen.queryByText(/SYN-01/)).toBeNull();
});
