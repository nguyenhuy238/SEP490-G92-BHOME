// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ResidenceTask } from '../../../../packages/client-core/src/residence';
const state = vi.hoisted(() => ({
  role: 'Owner',
  params: {} as Record<string, string>,
  request: vi.fn(),
  invalidate: vi.fn(),
  go: vi.fn(),
  task: {} as ResidenceTask,
  photo: true,
  paths: [] as string[],
}));
const contractId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  residentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const api = { request: state.request, queryCache: { invalidate: state.invalidate } };
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api, session: { roles: [state.role], userId: 'synthetic-owner' } }),
}));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => state.params,
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ go: state.go }),
}));
vi.mock('react-native', () => ({
  Image: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
    <div role="img" aria-label={accessibilityLabel} />
  ),
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Checkbox: {
    Item: ({
      label,
      status,
      onPress,
      disabled,
    }: {
      label: string;
      status: string;
      onPress: () => void;
      disabled: boolean;
    }) => (
      <input
        aria-label={label}
        type="checkbox"
        checked={status === 'checked'}
        disabled={disabled}
        onChange={onPress}
      />
    ),
  },
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
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
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock('../components/WorkflowControls', () => ({
  Input: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
  ChoiceField: () => null,
}));
vi.mock('../components/WorkspaceQueryState', () => ({
  Pagination: () => null,
  QueryState: ({ error, reload }: { error: string; reload: () => void }) => (
    <>
      <div>{error}</div>
      <button onClick={reload}>Tải lại</button>
    </>
  ),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: (path: string | null) => {
    if (path) state.paths.push(path);
    return {
      data: path?.includes('/residents/')
        ? { tenancies: [{ contractId, status: 'Active', residenceFrom: '2026-11-01' }] }
        : { items: [state.task], totalCount: 1 },
      loading: false,
      error: '',
      reload: vi.fn(),
    };
  },
}));
import { beforeEach } from 'vitest';
import { OwnerResidenceScreen } from '../screens/OwnerResidenceScreen';
beforeEach(() => {
  state.role = 'Owner';
  state.params = { contractId, residentId };
  state.paths = [];
  state.photo = true;
  state.task = {
    contractId,
    residentId,
    roomNumber: '101',
    residentLabel: 'Người ở tổng hợp',
    status: 'Completed',
    hasEvidence: true,
    ownerConfirmed: false,
    resultAt: '2026-11-13T00:00:00Z',
    history: [],
  } as unknown as ResidenceTask;
  state.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/evidence')) {
      if (!state.photo) throw { status: 404 };
      return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    }
    if (init?.method === 'POST') {
      state.task = { ...state.task, ownerConfirmed: true };
      return state.task;
    }
    return state.task;
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('requires a reviewed private result before confirmation and reloads authoritative status', async () => {
  render(<OwnerResidenceScreen />);
  await screen.findByRole('img', { name: 'Minh chứng kết quả tạm trú' });
  fireEvent.change(screen.getByLabelText('Ghi chú xác nhận'), {
    target: { value: 'Đã đối chiếu kết quả' },
  });
  fireEvent.click(screen.getByLabelText('Tôi đã kiểm tra kết quả và minh chứng'));
  const button = screen.getByText('Xác nhận kết quả trong BHOME');
  fireEvent.click(button);
  fireEvent.click(button);
  await screen.findByText('Owner đã xác nhận');
  const posts = state.request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0]![0]).toBe(
    `/api/v1/residence-tasks/${contractId}/${residentId}/owner-confirmation`,
  );
  expect(JSON.parse(posts[0]![1].body)).toEqual({ note: 'Đã đối chiếu kết quả' });
  expect(state.invalidate).toHaveBeenCalledWith(['contracts', 'notifications']);
  expect(
    state.request.mock.calls.filter(
      ([path]) => path === `/api/v1/residence-tasks/${contractId}/${residentId}`,
    ).length,
  ).toBeGreaterThanOrEqual(2);
});
it('resolves a Resident notification through scoped tenancy metadata instead of the first list page', async () => {
  state.params = { residentId };
  render(<OwnerResidenceScreen />);
  await screen.findByRole('img');
  expect(state.paths).toContain(`/api/v1/residents/${residentId}`);
  expect(state.paths.some((path) => path.includes('residence-tasks?'))).toBe(false);
});
it('blocks confirmation if evidence cannot be loaded and offers no government submission action', async () => {
  state.photo = false;
  render(<OwnerResidenceScreen />);
  await screen.findByText('Không tìm thấy hồ sơ hoặc ảnh trong phạm vi tài khoản của bạn.');
  expect((screen.getByText('Xác nhận kết quả trong BHOME') as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.queryByText('Nộp VNeID')).toBeNull();
});
it('does not read residence data as Staff and rejects malformed route references', async () => {
  state.role = 'Staff';
  const view = render(<OwnerResidenceScreen />);
  expect(state.request).not.toHaveBeenCalled();
  view.unmount();
  state.role = 'Owner';
  state.params = { residentId: '../private' };
  render(<OwnerResidenceScreen />);
  await waitFor(() => expect(screen.getByText('Tham chiếu hồ sơ không hợp lệ.')).toBeTruthy());
  expect(state.request).not.toHaveBeenCalled();
});
