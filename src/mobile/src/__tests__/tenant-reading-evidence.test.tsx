// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  actor: 'tenant-1',
  role: 'Tenant',
  request: vi.fn(),
}));
vi.mock('../lib/SessionProvider', () => {
  const api = { request: state.request };
  return {
    useSession: () => ({ api, session: { userId: state.actor, roles: [state.role] } }),
  };
});
vi.mock('../theme/theme', () => ({
  colors: { red: '#ba1a1a', muted: '#64748b', white: '#ffffff' },
  staffColors: { blue: '#2563eb' },
}));
vi.mock('../lib/automaticOcr', () => ({ ocrPreview: () => 'data:image/png;base64,FAKE' }));
vi.mock('../lib/api', () => ({ errorMessage: () => 'Không có quyền xem bằng chứng.' }));
vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(value: T) => value },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
    visible ? <div role="dialog">{children}</div> : null,
  Image: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
    <div role="img" aria-label={accessibilityLabel} />
  ),
}));
vi.mock('react-native-paper', () => ({
  ActivityIndicator: () => <span>Đang tải</span>,
  Icon: () => null,
  Text: ({
    children,
    accessibilityRole,
  }: {
    children: React.ReactNode;
    accessibilityRole?: string;
  }) => <span role={accessibilityRole}>{children}</span>,
  TouchableRipple: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    accessibilityLabel: string;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
}));

import { TenantMeterReadingEvidence } from '../components/TenantMeterReadingEvidence';

const reading = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
beforeEach(() => {
  state.actor = 'tenant-1';
  state.role = 'Tenant';
  state.request.mockReset();
});
afterEach(cleanup);

it('loads a private scoped photo on request and never leaks its cached image across Tenant accounts', async () => {
  state.request.mockResolvedValue(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  const view = render(<TenantMeterReadingEvidence id={reading} />);
  expect(state.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh chỉ số đồng hồ' }));
  expect(await screen.findByRole('img', { name: 'Ảnh chỉ số đồng hồ' })).toBeTruthy();
  expect(state.request).toHaveBeenCalledWith(
    `/api/v1/tenant/meter-readings/${reading}/evidence`,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
    'bytes',
  );
  state.actor = 'tenant-2';
  view.rerender(<TenantMeterReadingEvidence id={reading} />);
  expect(screen.queryByRole('img', { name: 'Ảnh chỉ số đồng hồ' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Xem ảnh chỉ số đồng hồ' })).toBeTruthy();
  state.role = 'Staff';
  view.rerender(<TenantMeterReadingEvidence id={reading} />);
  expect(screen.queryByRole('button', { name: 'Xem ảnh chỉ số đồng hồ' })).toBeNull();
  expect(state.request).toHaveBeenCalledTimes(1);
});

it('does not fetch evidence with a malformed identifier and exposes authorization failures', async () => {
  const invalid = render(<TenantMeterReadingEvidence id="not-a-guid" />);
  expect(screen.queryByRole('button')).toBeNull();
  invalid.rerender(<TenantMeterReadingEvidence id={reading} />);
  state.request.mockRejectedValue({ status: 403 });
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh chỉ số đồng hồ' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Không có quyền');
  expect(screen.queryByRole('img')).toBeNull();
});

it('opens a readable fullscreen photo from a compact mobile utility card', async () => {
  state.request.mockResolvedValue(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  render(<TenantMeterReadingEvidence id={reading} compact label="Ảnh điện" />);
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh điện' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Ảnh điện' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng ảnh bằng chứng' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
