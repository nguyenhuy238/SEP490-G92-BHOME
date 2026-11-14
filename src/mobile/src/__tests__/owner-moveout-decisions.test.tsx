// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  contractClient,
  type FinalInspection,
  type MoveOut,
  type SettlementSummary,
} from '../../../../packages/client-core/src/contracts';
const state = vi.hoisted(() => ({ role: 'Owner', request: vi.fn(), changed: vi.fn() }));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ session: { roles: [state.role] } }),
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Checkbox: {
    Item: ({ label, status, onPress }: { label: string; status: string; onPress: () => void }) => (
      <input aria-label={label} type="checkbox" checked={status === 'checked'} onChange={onPress} />
    ),
  },
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
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
}));
import { OwnerMoveOutDecisions } from '../features/owner/OwnerMoveOutDecisions';
const api = contractClient(state.request),
  id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mount = (
  summary = { reference: 'server-current-reference', resolved: false } as SettlementSummary,
) =>
  render(
    <OwnerMoveOutDecisions
      api={api}
      id={id}
      moveOut={{ status: 'Inspected', version: 5 } as MoveOut}
      inspection={{ version: 3, ownerDecision: null } as unknown as FinalInspection}
      summary={summary}
      onChanged={state.changed}
    />,
  );
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  state.role = 'Owner';
});
function confirm() {
  fireEvent.change(screen.getByLabelText('Căn cứ quyết định'), {
    target: { value: 'Đối chiếu biên bản' },
  });
  fireEvent.click(screen.getByLabelText('Tôi đã kiểm tra biên bản và các nghĩa vụ hiện tại'));
}
it('uses the inspected version, explicit no-charge decision, idempotency and a synchronous submission lock', async () => {
  mount();
  confirm();
  let finish!: () => void;
  state.request.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const button = screen.getByText('Xác nhận biên bản kiểm tra');
  fireEvent.click(button);
  fireEvent.click(button);
  expect(state.request).toHaveBeenCalledOnce();
  const [path, init] = state.request.mock.calls[0]!;
  expect(path).toBe(`/api/v1/contracts/${id}/move-out/inspection-review`);
  expect(JSON.parse(init.body)).toEqual({
    version: 3,
    confirmed: true,
    reason: 'Đối chiếu biên bản',
    noAdditionalCharges: false,
  });
  expect(init.headers['Idempotency-Key']).toBeTruthy();
  finish();
  await waitFor(() => expect(state.changed).toHaveBeenCalledOnce());
});
it('records settlement review against the backend reference without treating unresolved balances as settled', async () => {
  state.request.mockResolvedValue({});
  mount();
  confirm();
  fireEvent.click(screen.getByText('Lưu xem xét quyết toán'));
  await waitFor(() => expect(state.changed).toHaveBeenCalledOnce());
  expect(JSON.parse(state.request.mock.calls[0]![1].body)).toEqual({
    decision: 'Đối chiếu biên bản',
    expectedReference: 'server-current-reference',
  });
  expect(screen.queryByText('Đã quyết toán')).toBeNull();
});
it('keeps failures visible and requires reconfirmation, retaining the key for an unchanged retry', async () => {
  state.request.mockRejectedValue({ status: 409 });
  mount();
  confirm();
  fireEvent.click(screen.getByText('Yêu cầu kiểm tra lại'));
  await waitFor(() => expect(state.request).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect((screen.getByText('Yêu cầu kiểm tra lại') as HTMLButtonElement).disabled).toBe(true),
  );
  expect(state.changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Tôi đã kiểm tra biên bản và các nghĩa vụ hiện tại'));
  fireEvent.click(screen.getByText('Yêu cầu kiểm tra lại'));
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
  expect(state.request.mock.calls[1]![1].headers).toEqual(state.request.mock.calls[0]![1].headers);
});
it('does not expose Owner decisions to Staff or Tenant', () => {
  state.role = 'Staff';
  mount();
  expect(screen.queryByRole('button')).toBeNull();
  expect(state.request).not.toHaveBeenCalled();
});
