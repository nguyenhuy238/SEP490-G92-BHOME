// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  session: null as null | { userId: string; roles: string[] },
}));
vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <a data-testid="redirect" href={href} />,
  useLocalSearchParams: () => s.params,
}));
vi.mock('react-native-paper', () => ({
  ActivityIndicator: () => null,
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  Text: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
vi.mock('../components/Controls', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../screens/LoginScreen', () => ({ LoginScreen: () => <p>Đăng nhập BHOME</p> }));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    session: s.session,
    ready: true,
    reconnecting: false,
    restoreError: '',
    retryRestore: vi.fn(),
  }),
}));
import SignContractLink from '../app/sign-contract';
import Index from '../app/index';
import { clearPendingLink } from '../lib/pendingLink';

const id = 'f12af792-5b8b-4c1b-8bcd-f2ea9a7c8bb7';
const signing = `/workspace/signing?contractId=${id}&section=signing`;
const href = () => screen.getByTestId('redirect').getAttribute('href');
beforeEach(() => {
  clearPendingLink();
  s.params = { contractId: id };
  s.session = null;
});
afterEach(cleanup);

it('signed out: the email link asks to sign in, then continues straight to the contract signing page once', () => {
  render(<SignContractLink />);
  expect(href()).toBe('/');
  cleanup();

  render(<Index />);
  expect(screen.getByText('Đăng nhập BHOME')).toBeTruthy();
  cleanup();

  s.session = { userId: 'tenant', roles: ['Tenant'] };
  render(<Index />);
  expect(href()).toBe(signing);
  cleanup();

  // Used once: later visits to home go to the normal home tab.
  render(<Index />);
  expect(href()).toBe('/(tabs)/tenant-home');
});

it('signed in: the email link opens the signing page directly', () => {
  s.session = { userId: 'tenant', roles: ['Tenant'] };
  render(<SignContractLink />);
  expect(href()).toBe(signing);
});

it('rejects a link without a valid contract id', () => {
  s.params = { contractId: '../../api/v1/contracts' };
  render(<SignContractLink />);
  expect(screen.queryByTestId('redirect')).toBeNull();
  expect(screen.getByText(/Liên kết ký hợp đồng không hợp lệ/)).toBeTruthy();
});
