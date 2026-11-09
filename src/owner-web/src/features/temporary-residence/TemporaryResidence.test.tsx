import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  residenceClient,
  type ResidenceTask,
} from '../../../../../packages/client-core/src/residence';
import TemporaryResidencePage, { OwnerResidenceRecord } from './pages/TemporaryResidencePage';
import { useResidenceList } from '../../../../../packages/client-core/src/useResidenceList';

const state = vi.hoisted(() => ({ roles: ['Owner'], transport: vi.fn() }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: state.roles } }),
}));
vi.mock('../contracts/useContractsApi', () => ({
  useContractsApi: () => ({ transport: state.transport }),
}));
vi.mock('../../components/common/ResourcePage', () => ({
  ResourcePage: () => <div>Mock mode</div>,
}));
vi.mock('../../services/config', () => ({ isMockMode: false }));
let task: ResidenceTask;
beforeEach(() => {
  vi.clearAllMocks();
  state.roles = ['Owner'];
  task = {
    contractId: '10000000-0000-4000-8000-000000000001',
    residentId: '10000000-0000-4000-8000-000000000002',
    locationId: '10000000-0000-4000-8000-000000000003',
    roomId: '10000000-0000-4000-8000-000000000004',
    roomNumber: 'M101',
    residentLabel: 'Người thử',
    residentRole: 'Representative',
    tenantUserId: 'tenant',
    residenceFrom: '2026-01-01',
    actualResidenceFrom: '2026-01-02',
    status: 'Completed',
    hasEvidence: true,
    resultAt: '2026-01-03T03:00:00Z',
    ownerConfirmed: false,
    ownerConfirmedAt: null,
    history: [],
  };
  state.transport.mockImplementation(async (path: string) => {
    if (path.endsWith('/evidence')) return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    if (path.endsWith('/owner-confirmation')) {
      task = { ...task, ownerConfirmed: true, ownerConfirmedAt: '2026-01-04T03:00:00Z' };
      return task;
    }
    if (path.includes('?')) return { items: [task], page: 1, pageSize: 20, totalCount: 1 };
    return task;
  });
});
afterEach(cleanup);
it('marks a list refresh as loading, keeps same-page data and ignores an aborted page response', async () => {
  const api = residenceClient(state.transport);
  const { result } = renderHook(() => useResidenceList(api));
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.data?.items).toEqual([task]));
  let finishRefresh!: (value: unknown) => void;
  state.transport.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRefresh = resolve;
      }),
  );
  act(() => result.current.reload());
  expect(result.current.loading).toBe(true);
  expect(result.current.data?.items).toEqual([task]);
  const signal = state.transport.mock.calls.at(-1)?.[1].signal as AbortSignal;
  act(() => result.current.setPage(2));
  expect(result.current.loading).toBe(true);
  expect(result.current.data).toBeNull();
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finishRefresh({ items: [], page: 1, pageSize: 20, totalCount: 0 });
  });
  expect(result.current.page).toBe(2);
  expect(result.current.data?.items).toEqual([task]);
});
it('loads authenticated evidence and confirms only after entering a note, then reads latest record', async () => {
  const api = residenceClient(state.transport);
  render(
    <OwnerResidenceRecord api={api} contractId={task.contractId} residentId={task.residentId} />,
  );
  await screen.findByAltText('Ảnh minh chứng tạm trú');
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận kết quả trong BHOME' }));
  await screen.findByText('Nhập ghi chú xác nhận từ 1 đến 1.000 ký tự.');
  fireEvent.change(screen.getByLabelText('Ghi chú xác nhận'), {
    target: { value: 'Đã đối chiếu ảnh kết quả.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận kết quả trong BHOME' }));
  await screen.findByText('Owner đã xác nhận');
  const write = state.transport.mock.calls.find(([path]) => path.endsWith('/owner-confirmation'));
  expect(write?.[1].method).toBe('POST');
  expect(JSON.parse(write?.[1].body)).toEqual({ note: 'Đã đối chiếu ảnh kết quả.' });
  expect(
    state.transport.mock.calls.filter(([path]) => path.endsWith(task.residentId)).length,
  ).toBeGreaterThanOrEqual(2);
});
it.each(['Pending', 'InProgress'] as const)(
  'never offers Owner confirmation for %s',
  async (status) => {
    task.status = status;
    render(
      <OwnerResidenceRecord
        api={residenceClient(state.transport)}
        contractId={task.contractId}
        residentId={task.residentId}
      />,
    );
    await screen.findByText(/Chưa có kết quả để xác nhận/);
    expect(screen.queryByRole('button', { name: 'Xác nhận kết quả trong BHOME' })).toBeNull();
  },
);
it('does not give Tenant access to the Owner page', () => {
  state.roles = ['Tenant'];
  render(<TemporaryResidencePage />);
  expect(screen.getByText(/Chỉ Chủ cơ sở/)).toBeTruthy();
  expect(state.transport).not.toHaveBeenCalled();
});
it('preserves the confirmation note and blocks a repeated write after conflict', async () => {
  state.transport.mockImplementation(async (path: string) => {
    if (path.endsWith('/evidence')) return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    if (path.endsWith('/owner-confirmation')) throw { status: 409 };
    return task;
  });
  render(
    <OwnerResidenceRecord
      api={residenceClient(state.transport)}
      contractId={task.contractId}
      residentId={task.residentId}
    />,
  );
  await screen.findByLabelText('Ghi chú xác nhận');
  fireEvent.change(screen.getByLabelText('Ghi chú xác nhận'), {
    target: { value: 'Giữ ghi chú.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận kết quả trong BHOME' }));
  await screen.findByText(/Hồ sơ đã thay đổi/);
  expect(screen.getByLabelText('Ghi chú xác nhận')).toHaveValue('Giữ ghi chú.');
  expect(screen.getByRole('button', { name: 'Xác nhận kết quả trong BHOME' })).toBeDisabled();
  await waitFor(() =>
    expect(
      state.transport.mock.calls.filter(([path]) => path.endsWith('/owner-confirmation')),
    ).toHaveLength(1),
  );
});
