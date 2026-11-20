// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../../packages/client-core/src/api';
import { LocationAssetHandoverPanel } from './LocationAssetHandoverPanel';
import type { OwnerTask } from '../taskContracts';

const state = vi.hoisted(() => ({
  request: vi.fn(),
  notify: vi.fn(),
  report: null as null | Record<string, unknown>,
}));
vi.mock('../../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
vi.mock('../../meters/useMeterApi', () => ({
  useMeterApi: () => ({ request: state.request }),
}));
vi.mock('../../../components/common/OwnerWorkspace', () => ({
  OwnerFeedback: () => null,
}));
vi.mock('../../../hooks/useOwnerWorkspace', () => ({
  useOwnerAction: () => ({
    busy: false,
    error: '',
    run: async (work: () => Promise<unknown>) => {
      await work();
      return true;
    },
    command: (path: string, method: string, body: unknown) =>
      state.request(path, { method, body: JSON.stringify(body) }),
  }),
}));
const task = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'LocationAssetHandover',
  status: 'PendingVerification',
  version: 9,
  title: 'Kiểm kê toàn cơ sở',
} as OwnerTask;

const approvedReport = {
  taskId: task.id,
  locationId: 'location',
  assignmentId: 'assignment',
  staffId: 'staff',
  taskVersion: 9,
  revision: 3,
  status: 'PendingOwnerSignature',
  totalItems: 3,
  directItems: 1,
  inheritedItems: 2,
  snapshotSha256: 'A'.repeat(64),
  pdfSha256: 'B'.repeat(64),
  approvedAt: '2026-11-19T06:00:00Z',
  approvedBy: 'owner',
  exceptionDecision: null,
  ownerSignature: null,
  staffSignature: null,
  canDownloadFinal: false,
};

const path = `/api/v1/operational-tasks/${task.id}/location-asset-handover`;

beforeEach(() => {
  state.request.mockReset();
  state.notify.mockReset();
  state.report = null;
  state.request.mockImplementation(async (route: string, init?: { method?: string; body?: string }) => {
    if (route === path && !init?.method) {
      if (!state.report) throw new ApiError(404);
      return state.report;
    }
    if (route === path + '/approve') {
      state.report = { ...approvedReport };
      return state.report;
    }
    if (route === path + '/sign') {
      state.report = {
        ...approvedReport,
        status: 'PendingStaffSignature',
        ownerSignature: {
          actorId: 'owner',
          signedAt: '2026-11-19T06:10:00Z',
          method: 'AuthenticatedSessionAcceptance',
          snapshotSha256: approvedReport.snapshotSha256,
        },
      };
      return state.report;
    }
    if (route === path + '/rework') {
      state.report = null;
      return { taskId: task.id, status: 'InProgress' };
    }
    throw new Error('Unexpected API request: ' + route);
  });
});
afterEach(cleanup);

it('requires review then approves a pending task, and signs the exact server digest only after explicit consent', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocationAssetHandoverPanel task={task} notify={state.notify} />
    </QueryClientProvider>,
  );
  const approve = await screen.findByRole('button', { name: 'Duyệt và lập biên bản' });
  expect(approve).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/Tôi đã đối chiếu đầy đủ tài sản/));
  expect(approve).toBeEnabled();
  fireEvent.click(approve);
  await waitFor(() => expect(state.request).toHaveBeenCalledWith(
    path + '/approve',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({
      taskVersion: 9, exceptionDecision: null,
    }) }),
  ));
  const sign = await screen.findByRole('button', { name: 'Owner ký xác nhận' });
  expect(sign).toBeDisabled();
  expect(screen.getByText('A'.repeat(64))).toBeTruthy();
  fireEvent.click(screen.getByLabelText(/Tôi đã xem biên bản phiên bản này/));
  expect(sign).toBeEnabled();
  fireEvent.click(sign);
  await waitFor(() => expect(state.request).toHaveBeenCalledWith(
    path + '/sign',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({
      revision: 3, snapshotSha256: 'A'.repeat(64), confirmed: true,
    }) }),
  ));
  expect(await screen.findByText(/Staff cần đọc và ký xác nhận/)).toBeTruthy();
  expect(state.notify).toHaveBeenCalledWith(
    'Owner đã ký. Đang chờ Staff xác nhận cùng phiên bản.',
  );
});

it('requests rework only for selected checklist items with a meaningful explanation', async () => {
  const onReworked = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocationAssetHandoverPanel
        task={task}
        notify={state.notify}
        reworkItemIds={['22222222-2222-4222-8222-222222222222']}
        onReworked={onReworked}
      />
    </QueryClientProvider>,
  );
  const rework = await screen.findByRole('button', { name: 'Gửi yêu cầu kiểm tra lại' });
  expect(rework).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Nội dung cần Staff kiểm tra lại'), {
    target: { value: 'Giường phòng 101 cần kiểm tra lại số lượng thực tế.' },
  });
  expect(rework).toBeEnabled();
  fireEvent.click(rework);
  await waitFor(() => expect(state.request).toHaveBeenCalledWith(
    path + '/rework',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        taskVersion: 9,
        itemIds: ['22222222-2222-4222-8222-222222222222'],
        note: 'Giường phòng 101 cần kiểm tra lại số lượng thực tế.',
      }),
    }),
  ));
  await waitFor(() => expect(onReworked).toHaveBeenCalledTimes(1));
});

it('allows a new Owner approval after the previous handover report became superseded', async () => {
  state.report = { ...approvedReport, status: 'Superseded', taskVersion: 8 };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocationAssetHandoverPanel task={task} notify={state.notify} />
    </QueryClientProvider>,
  );
  const approve = await screen.findByRole('button', { name: 'Duyệt và lập biên bản' });
  expect(approve).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/Tôi đã đối chiếu đầy đủ tài sản/));
  fireEvent.click(approve);
  await waitFor(() => expect(state.request).toHaveBeenCalledWith(
    path + '/approve',
    expect.objectContaining({ body: JSON.stringify({ taskVersion: 9, exceptionDecision: null }) }),
  ));
});
