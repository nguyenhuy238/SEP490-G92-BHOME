// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TenantProfileGate } from '../features/profile/TenantProfileGate';

const state = vi.hoisted(() => ({
  role: 'Tenant',
  preview: false,
  data: undefined as { fullName: string; phone: string | null } | undefined,
  rawError: null as unknown,
  logout: vi.fn(),
  reload: vi.fn(),
  useProfile: vi.fn(),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ role: state.role, preview: state.preview }),
}));
vi.mock('../lib/SessionProvider', () => ({ useSession: () => ({ logout: state.logout }) }));
vi.mock('../features/profile/useProfile', () => ({
  useProfile: () => {
    state.useProfile();
    return { data: state.data, rawError: state.rawError, reload: state.reload };
  },
}));
vi.mock('../components/Controls', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../features/profile/ProfileComponents', () => ({
  ProfileFailure: ({ message }: { message: string }) => <span role="alert">{message}</span>,
}));
vi.mock('../screens/ProfileEditScreen', () => ({
  ProfileEditScreen: ({ completion }: { completion: boolean }) => (
    <span>{completion ? 'Complete existing profile form' : 'Edit profile'}</span>
  ),
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
    <span>{accessibilityLabel}</span>
  ),
  Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
beforeEach(() => {
  state.role = 'Tenant';
  state.preview = false;
  state.data = undefined;
  state.rawError = null;
  state.useProfile.mockClear();
});
afterEach(cleanup);
it('does not mount Tenant Home when the own profile request fails', () => {
  state.rawError = new Error('Network unavailable');
  render(
    <TenantProfileGate>
      <span>Private Tenant Home</span>
    </TenantProfileGate>,
  );
  expect(screen.queryByText('Private Tenant Home')).toBeNull();
  expect(screen.getByRole('alert')).toBeTruthy();
});
it('waits for the own profile then requires name and phone before mounting Tenant Home', () => {
  const view = render(
    <TenantProfileGate>
      <span>Private Tenant Home</span>
    </TenantProfileGate>,
  );
  expect(screen.queryByText('Private Tenant Home')).toBeNull();
  state.data = { fullName: '', phone: null };
  view.rerender(
    <TenantProfileGate>
      <span>Private Tenant Home</span>
    </TenantProfileGate>,
  );
  expect(screen.getByText('Complete existing profile form')).toBeTruthy();
  expect(screen.queryByText('Private Tenant Home')).toBeNull();
  state.data = { fullName: 'Synthetic Tenant', phone: '+84901234567' };
  view.rerender(
    <TenantProfileGate>
      <span>Private Tenant Home</span>
    </TenantProfileGate>,
  );
  expect(screen.getByText('Private Tenant Home')).toBeTruthy();
});
it.each(['Owner', 'Staff'])('does not impose Tenant completion on %s', (role) => {
  state.role = role;
  render(
    <TenantProfileGate>
      <span>Own workspace</span>
    </TenantProfileGate>,
  );
  expect(screen.getByText('Own workspace')).toBeTruthy();
  expect(state.useProfile).not.toHaveBeenCalled();
});
