// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Named } from '../lib/api';

const state = vi.hoisted(() => ({
  role: 'Staff',
  userId: 'staff-1',
  request: vi.fn(),
}));
const api = { request: state.request };
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    api,
    session: { userId: state.userId, roles: [state.role] },
  }),
}));
vi.mock('expo-router', () => ({
  router: { push: vi.fn(), navigate: vi.fn(), dismissTo: vi.fn(), replace: vi.fn() },
  useSegments: () => ['(tabs)'],
}));
vi.mock('react-native-paper', () => {
  const Content = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    Portal: Content,
    Text: Content,
    Button: Content,
    Dialog: Object.assign(
      ({ children, visible }: { children?: React.ReactNode; visible: boolean }) =>
        visible ? <div>{children}</div> : null,
      { Title: Content, Content, Actions: Content },
    ),
  };
});

import {
  StaffLocationProvider,
  useStaffLocation,
} from '../features/workspace/StaffLocationProvider';
import { WorkspaceProvider, useWorkspace } from '../features/workspace/WorkspaceProvider';

const first: Named = { id: 'assigned-a', label: 'Cơ sở A' };
const second: Named = { id: 'assigned-b', label: 'Cơ sở B' };

function SelectionProbe() {
  const scope = useStaffLocation();
  return (
    <>
      <div data-testid="selected-location">{scope.selectedLocationId}</div>
      <div data-testid="selected-name">{scope.selectedLocation?.label ?? ''}</div>
      <div data-testid="loading">{scope.loading ? 'Đang tải' : ''}</div>
      <div data-testid="error">{scope.error}</div>
      {scope.locations.map((item) => (
        <button key={item.id} onClick={() => scope.selectLocation(item.id)}>
          {item.label}
        </button>
      ))}
      <button onClick={() => scope.selectLocation('other-location')}>Cơ sở không được giao</button>
      <button onClick={scope.reload}>Tải lại phân công</button>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.stubGlobal('__DEV__', false);
  vi.clearAllMocks();
  state.role = 'Staff';
  state.userId = 'staff-1';
  state.request.mockResolvedValue([first, second]);
});

function WorkspaceProbe({ name }: { name: string }) {
  const { staffLocationId, staffLocations, selectStaffLocation } = useWorkspace();
  return (
    <>
      <div data-testid={`global-${name}`}>{staffLocationId}</div>
      <div data-testid={`count-${name}`}>{staffLocations.length}</div>
      {name === 'home' && (
        <button onClick={() => selectStaffLocation(second.id)}>Chọn cơ sở B từ trang chủ</button>
      )}
    </>
  );
}

it('shares the home-selected Location across sibling workspace pages in one signed-in session', async () => {
  render(
    <WorkspaceProvider>
      <WorkspaceProbe name="home" />
      <WorkspaceProbe name="task" />
    </WorkspaceProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('global-home').textContent).toBe(first.id));
  expect(screen.getByTestId('global-task').textContent).toBe(first.id);
  expect(screen.getByTestId('count-task').textContent).toBe('2');
  fireEvent.click(screen.getByRole('button', { name: 'Chọn cơ sở B từ trang chủ' }));
  expect(screen.getByTestId('global-home').textContent).toBe(second.id);
  expect(screen.getByTestId('global-task').textContent).toBe(second.id);
});

function NotificationLocationProbe({
  target,
  opened,
}: {
  target: string;
  opened: (id: string) => void;
}) {
  const { staffLocationId, navigateInStaffLocation } = useWorkspace();
  return (
    <>
      <div data-testid="notification-location">{staffLocationId}</div>
      <button
        onClick={() =>
          navigateInStaffLocation(target, () =>
            opened(screen.getByTestId('notification-location').textContent ?? ''),
          )
        }
      >
        Mở thông báo cơ sở khác
      </button>
    </>
  );
}

it('commits the other assigned location before navigating from a notification', async () => {
  const opened = vi.fn();
  render(
    <WorkspaceProvider>
      <NotificationLocationProbe target={second.id} opened={opened} />
    </WorkspaceProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId('notification-location').textContent).toBe(first.id),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mở thông báo cơ sở khác' }));
  await waitFor(() => expect(opened).toHaveBeenCalledExactlyOnceWith(second.id));
});

it('refreshes stale assignments when a notification points to a newly assigned location', async () => {
  state.request.mockResolvedValueOnce([first]).mockResolvedValueOnce([first, second]);
  const opened = vi.fn();
  render(
    <WorkspaceProvider>
      <NotificationLocationProbe target={second.id} opened={opened} />
    </WorkspaceProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId('notification-location').textContent).toBe(first.id),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mở thông báo cơ sở khác' }));
  await waitFor(() => expect(opened).toHaveBeenCalledExactlyOnceWith(second.id));
  expect(state.request).toHaveBeenCalledTimes(2);
});

it('does not navigate when the refreshed assignments do not contain the notification location', async () => {
  state.request.mockResolvedValue([first]);
  const opened = vi.fn();
  render(
    <WorkspaceProvider>
      <NotificationLocationProbe target={second.id} opened={opened} />
    </WorkspaceProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId('notification-location').textContent).toBe(first.id),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mở thông báo cơ sở khác' }));
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByTestId('notification-location').textContent).toBe(first.id),
  );
  expect(opened).not.toHaveBeenCalled();
});

it('loads all current Staff assignments and shares only a validated selected location', async () => {
  render(
    <StaffLocationProvider>
      <SelectionProbe />
    </StaffLocationProvider>,
  );
  expect(screen.getByTestId('selected-location').textContent).toBe('');
  expect(screen.getByTestId('loading').textContent).toBe('Đang tải');
  await screen.findByRole('button', { name: 'Cơ sở B' });
  expect(state.request).toHaveBeenCalledWith('/api/v1/capture/locations', {
    signal: expect.any(AbortSignal),
  });
  expect(screen.getByTestId('selected-location').textContent).toBe(first.id);
  fireEvent.click(screen.getByRole('button', { name: 'Cơ sở B' }));
  expect(screen.getByTestId('selected-location').textContent).toBe(second.id);
  expect(screen.getByTestId('selected-name').textContent).toBe(second.label);
  fireEvent.click(screen.getByRole('button', { name: 'Cơ sở không được giao' }));
  expect(screen.getByTestId('selected-location').textContent).toBe(second.id);
});

it('removes revoked selection immediately during reload and falls back only to newly assigned locations', async () => {
  let finish!: (value: Named[]) => void;
  state.request.mockResolvedValueOnce([first, second]).mockImplementationOnce(
    () =>
      new Promise<Named[]>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <StaffLocationProvider>
      <SelectionProbe />
    </StaffLocationProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Cơ sở B' }));
  expect(screen.getByTestId('selected-location').textContent).toBe(second.id);
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại phân công' }));
  expect(screen.getByTestId('selected-location').textContent).toBe('');
  expect(screen.getByTestId('loading').textContent).toBe('Đang tải');
  finish([first]);
  await waitFor(() => expect(screen.getByTestId('selected-location').textContent).toBe(first.id));
  expect(screen.queryByRole('button', { name: 'Cơ sở B' })).toBeNull();
});

it('has no unscoped Staff fallback when assignment loading fails or list is empty', async () => {
  state.request.mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce([]);
  render(
    <StaffLocationProvider>
      <SelectionProbe />
    </StaffLocationProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('error').textContent).toBeTruthy());
  expect(screen.getByTestId('selected-location').textContent).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại phân công' }));
  await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe(''));
  expect(screen.getByTestId('selected-location').textContent).toBe('');
  expect(screen.getByTestId('error').textContent).toBe('');
});

it('does not fetch Staff assignments for another role', () => {
  state.role = 'Tenant';
  render(
    <StaffLocationProvider>
      <SelectionProbe />
    </StaffLocationProvider>,
  );
  expect(state.request).not.toHaveBeenCalled();
  expect(screen.getByTestId('selected-location').textContent).toBe('');
  expect(screen.getByTestId('loading').textContent).toBe('');
});

it('starts with no retained selection for a newly authenticated Staff account', async () => {
  const view = render(
    <StaffLocationProvider key={state.userId}>
      <SelectionProbe />
    </StaffLocationProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Cơ sở B' }));
  expect(screen.getByTestId('selected-location').textContent).toBe(second.id);
  state.userId = 'staff-2';
  state.request.mockResolvedValueOnce([{ id: 'assigned-c', label: 'Cơ sở C' }]);
  view.rerender(
    <StaffLocationProvider key={state.userId}>
      <SelectionProbe />
    </StaffLocationProvider>,
  );
  expect(screen.getByTestId('selected-location').textContent).toBe('');
  await screen.findByRole('button', { name: 'Cơ sở C' });
  expect(screen.getByTestId('selected-location').textContent).toBe('assigned-c');
  expect(screen.queryByRole('button', { name: 'Cơ sở B' })).toBeNull();
});

it('rejects malformed assignments rather than trusting a Location not proven by the API', async () => {
  state.request.mockResolvedValue([{ id: '../foreign', label: 42 }]);
  render(
    <StaffLocationProvider>
      <SelectionProbe />
    </StaffLocationProvider>,
  );
  await waitFor(() =>
    expect(screen.getByTestId('error').textContent).toBe('Phản hồi cơ sở không hợp lệ.'),
  );
  expect(screen.getByTestId('selected-location').textContent).toBe('');
  expect(screen.queryByRole('button', { name: 'Cơ sở A' })).toBeNull();
});
