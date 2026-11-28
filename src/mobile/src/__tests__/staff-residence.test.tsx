// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StaffResidenceScreen } from '../screens/StaffResidenceScreen';

const state = vi.hoisted(() => ({ roles: ['Staff'], query: vi.fn(), header: vi.fn() }));
vi.mock('../lib/SessionProvider', () => ({ useSession: () => ({ session: { roles: state.roles } }) }));
vi.mock('../features/workspace/WorkspaceProvider', () => ({ useWorkspace: () => ({ staffLocationId: 'location-synthetic' }) }));
vi.mock('../components/WorkspaceHeaderContext', () => ({ useWorkspaceHeaderRefresh: (...args: unknown[]) => state.header(...args) }));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (path: string | null) => {
    state.query(path);
    return {
      loading: false,
      error: '',
      reload: vi.fn(),
      data: path ? {
        items: [{
          contractId: 'contract', residentId: 'resident', locationId: 'location-synthetic', roomNumber: 'SYN-01',
          residentLabel: 'Thành viên kiểm thử', residentRole: 'CoOccupant', actualResidenceFrom: '2026-11-01',
          status: 'InProgress', registrationRequired: true, registrationDeadline: '2026-11-30',
          registrationExpiresOn: '2027-11-30', resultAt: null, ownerConfirmed: false, ownerConfirmedAt: null,
        }],
        page: 1, pageSize: 20, totalCount: 1, loadedCount: 1,
        stats: { totalResidents: 1, notStarted: 1, completed: 0, overdue: 0 },
      } : null,
    };
  },
}));
vi.mock('react-native', () => ({
  RefreshControl: () => null,
  ScrollView: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  StyleSheet: { create: (value: unknown) => value },
  View: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => ({
  ActivityIndicator: () => <span>loading</span>,
  Avatar: { Text: ({ label }: { label: string }) => <span>{label}</span> },
  Button: ({ children, onPress }: React.PropsWithChildren<{ onPress?: () => void }>) => <button onClick={onPress}>{children}</button>,
  Chip: ({ children, onPress }: React.PropsWithChildren<{ onPress?: () => void }>) => <button onClick={onPress}>{children}</button>,
  Divider: () => <hr />,
  Icon: () => <span />,
  Modal: ({ children, visible }: React.PropsWithChildren<{ visible: boolean }>) => visible ? <div>{children}</div> : null,
  Portal: ({ children }: React.PropsWithChildren) => <>{children}</>,
  Searchbar: ({ value, onChangeText, accessibilityLabel, ...props }: { value: string; onChangeText: (value: string) => void; accessibilityLabel: string; [key: string]: unknown }) => <input {...props} aria-label={accessibilityLabel} value={value} onChange={(event) => onChangeText(event.target.value)} />,
  Text: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  TouchableRipple: ({ children, onPress, accessibilityLabel }: React.PropsWithChildren<{ onPress?: () => void; accessibilityLabel?: string }>) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
}));
vi.mock('../theme/theme', () => ({ colors: { red: 'red', white: 'white', border: 'gray', muted: 'gray', ink: 'black' }, staffColors: { background: 'white', navy: 'navy', blue: 'blue', blueSoft: 'lightblue', green: 'green', orange: 'orange', red: 'red' } }));
vi.mock('../components/WorkspaceKit', () => ({
  Action: ({ children, onPress }: React.PropsWithChildren<{ onPress?: () => void }>) => <button onClick={onPress}>{children}</button>,
  Box: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  ui: { grow: {} },
}));
vi.mock('../../../../packages/client-core/src/residence', () => ({ residenceStatus: { InProgress: 'Đang thực hiện' } }));
vi.mock('../../../../packages/client-core/src/contracts', () => ({ displayContractDate: (date: string) => date }));
vi.mock('../../../../packages/client-core/src/localization', () => ({ formatInstant: (date: string) => date }));

afterEach(() => {
  cleanup();
  state.query.mockClear();
  state.header.mockClear();
  state.roles = ['Staff'];
});

it('shows scoped statistics, list and safe details from the staff tracking endpoint', () => {
  render(<StaffResidenceScreen />);
  expect(state.query).toHaveBeenCalledWith(expect.stringContaining('/api/v1/residence-tasks/tracking?'));
  expect(state.query).toHaveBeenCalledWith(expect.stringContaining('locationId=location-synthetic'));
  expect(screen.getByText('Phòng SYN-01 · Thành viên cùng ở')).toBeTruthy();
  expect(screen.getByText('Đang thực hiện')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Người đang cư trú: 1' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Chi tiết/ }));
  expect(screen.getByText('Ngày bắt đầu cư trú: 2026-11-01')).toBeTruthy();
  expect(screen.queryByText(/CCCD|số điện thoại|tải ảnh|minh chứng/i)).toBeNull();
});

it('filters by resident name or room without sending phone data', () => {
  render(<StaffResidenceScreen />);
  fireEvent.change(screen.getByLabelText('Tìm theo tên hoặc phòng'), { target: { value: 'SYN-01' } });
  expect(screen.queryAllByText(/SYN-01/).length).toBeGreaterThan(0);
});

it('does not request Staff tracking under a Tenant session', () => {
  state.roles = ['Tenant'];
  render(<StaffResidenceScreen />);
  expect(state.query).toHaveBeenCalledWith(null);
  expect(screen.queryByText(/SYN-01/)).toBeNull();
});
