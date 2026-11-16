import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { IncidentDetail, WorkOrderDetail, IncidentWorkspace } from './IncidentWorkspace';
import { formatIncidentMoney } from './incidentContracts';
import { IncidentReferenceField } from './IncidentReferenceField';
import { FastRepairPolicyPanel } from './MaintenanceControls';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../meters/useMeterApi', () => ({ useMeterApi: () => ({ request: mocks.request }) }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner', roles: ['Owner'] } }),
}));
const incident = {
  id: 'incident',
  code: 'INC-SYN',
  locationId: 'location',
  description: 'Synthetic incident',
  status: 'Submitted',
  severity: 'Emergency',
  type: null,
  category: null,
  version: 7,
};
function mount(element: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      {element}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.request.mockImplementation(async (path: string) => {
    if (path === '/api/v1/incidents/incident') return incident;
    if (
      path.includes('/history?') ||
      path.startsWith('/api/v1/locations?') ||
      path.includes('/maintenance-history?') ||
      path.startsWith('/api/v1/work-orders?')
    )
      return { items: [], totalCount: 0 };
    return [];
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('renders proactive maintenance with work-owned evidence and no incident request', async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string) =>
    path === '/api/v1/work-orders/proactive'
      ? {
          id: 'proactive',
          incidentId: null,
          source: 'Proactive',
          locationId: 'location',
          roomId: null,
          commonArea: 'Synthetic corridor',
          description: 'Synthetic proactive work',
          expectedOutcome: 'Safe corridor',
          status: 'InProgress',
          version: 3,
          targetCompletionAt: '2027-01-01T03:00:00Z',
        }
      : original(path),
  );
  mount(<WorkOrderDetail id="proactive" showIncident />);
  expect(await screen.findByText(/Synthetic proactive work/)).toBeVisible();
  expect(
    mocks.request.mock.calls.some(([path]) => path === '/api/v1/work-orders/proactive/evidence'),
  ).toBe(true);
  expect(
    mocks.request.mock.calls.some(
      ([path]) => path.includes('/incidents/null') || path.includes('incidentId=null'),
    ),
  ).toBe(false);
});
it.each([true, false])(
  'loads work order evidence through the authorized API (allowed=%s)',
  async (allowed) => {
    const createUrl = vi.fn(() => 'blob:synthetic-work-evidence');
    const revokeUrl = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createUrl;
        static revokeObjectURL = revokeUrl;
      },
    );
    const original = mocks.request.getMockImplementation()!;
    // PrivateEvidenceViewer verifies the file signature before allowing inline
    // rendering, so the fixture must contain a real PNG signature rather than
    // arbitrary text labelled as image/png.
    const blob = new Blob(
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0])],
      { type: 'image/png' },
    );
    mocks.request.mockImplementation(async (path: string, init?: RequestInit, type?: string) => {
      if (path === '/api/v1/work-orders/work')
        return {
          id: 'work',
          incidentId: null,
          locationId: 'location',
          expectedOutcome: 'Synthetic completed repair',
          status: 'Verified',
          targetCompletionAt: '2026-11-15T03:00:00Z',
          version: 9,
        };
      if (path === '/api/v1/work-orders/work/evidence')
        return [{ id: 'proof', kind: 'Completion', length: 200 }];
      if (path === '/api/v1/work-orders/work/evidence/proof' && type === 'blob') {
        if (!allowed) throw { status: 403 };
        return blob;
      }
      return original(path, init);
    });
    const view = mount(<WorkOrderDetail id="work" />);
    // Evidence is private: it is fetched only after the Owner explicitly
    // chooses the preview action, and the verified image is rendered in a
    // dialog rather than embedded automatically in the detail page.
    fireEvent.click(await screen.findByRole('button', { name: 'Xem ảnh kết quả sửa chữa' }));
    const dialog = screen.getByRole('dialog', { name: 'Xem ảnh kết quả sửa chữa' });
    if (allowed) {
      expect(
        await within(dialog).findByRole('img', { name: 'ảnh kết quả sửa chữa' }),
      ).toHaveAttribute('src', 'blob:synthetic-work-evidence');
      expect(createUrl).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png' }));
    } else {
      expect(await within(dialog).findByText('Không tải được chứng từ.')).toBeVisible();
      expect(within(dialog).queryByRole('img')).toBeNull();
      expect(createUrl).not.toHaveBeenCalled();
    }
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/work-orders/work/evidence/proof',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'blob',
    );
    view.unmount();
    if (allowed) expect(revokeUrl).toHaveBeenCalledWith('blob:synthetic-work-evidence');
  },
);
it('keeps suggested fast repair categories inactive until Owner saves a policy decision', async () => {
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/work-orders/fast-repair-policy' && !init?.method)
      return { version: 0, activeCategories: [] };
    return {};
  });
  mount(<FastRepairPolicyPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Chính sách sửa nhanh' }));
  const field = await screen.findByLabelText('Nhóm công việc được kích hoạt, mỗi dòng một nhóm');
  expect(field).toHaveValue('');
  expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  fireEvent.change(field, { target: { value: 'Synthetic Owner-enabled category' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu chính sách' }));
  await screen.findByRole('button', { name: 'Chính sách sửa nhanh' });
  const write = mocks.request.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(JSON.parse(write![1].body)).toEqual({
    version: 0,
    activeCategories: ['Synthetic Owner-enabled category'],
  });
});
it('posts the reviewed incident version once and preserves fields and retry key after uncertain failure', async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') throw new Error('Synthetic network failure');
    return original(path, init);
  });
  mount(<IncidentDetail id="incident" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Phân loại' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(/Loại sự cố/), { target: { value: 'Plumbing' } });
  fireEvent.change(within(dialog).getByLabelText(/Nhóm xử lý/), { target: { value: 'Water' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
  await within(dialog).findByText(
    'Chưa hoàn thành yêu cầu. Tải lại dữ liệu để kiểm tra trước khi thử lại.',
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
  const writes = mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes).toHaveLength(2);
  expect(JSON.parse(writes[0][1].body)).toEqual({
    version: 7,
    type: 'Plumbing',
    category: 'Water',
  });
  expect(writes[0][1].headers['Idempotency-Key']).toBe(writes[1][1].headers['Idempotency-Key']);
  expect(screen.queryByRole('button', { name: 'Tiếp nhận khẩn cấp' })).toBeNull();
});

it('shows both private evidence actions and never bypasses the authorized incident request', async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit, type?: string) => {
    if (path === '/api/v1/incidents/incident/evidence')
      return [{ id: 'proof', kind: 'Direct', workOrderId: null, activityId: null, length: 200 }];
    if (path === '/api/v1/incidents/incident/evidence/proof' && type === 'blob')
      throw { status: 403 };
    return original(path, init);
  });
  mount(<IncidentDetail id="incident" />);
  const label = /Direct · 200 byte · Sự cố/;
  expect(
    await screen.findByRole('button', { name: new RegExp(`Tải xuống ${label.source}`) }),
  ).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Xem ${label.source}`) }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/incidents/incident/evidence/proof',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'blob',
    ),
  );
});
it('offers Owner approval but no Staff execution for a proposed work order', async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string) =>
    path === '/api/v1/work-orders/work'
      ? {
          id: 'work',
          incidentId: 'incident',
          locationId: 'location',
          expectedOutcome: 'Repair pipe',
          status: 'PendingApproval',
          proposalVersion: 3,
          version: 8,
          targetCompletionAt: '2026-11-10T03:00:00Z',
        }
      : original(path),
  );
  mount(<WorkOrderDetail id="work" />);
  expect(await screen.findByRole('button', { name: 'Duyệt phương án' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Bắt đầu sửa chữa' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Xác minh hoàn tất' })).toBeNull();
});
it('keeps failed lists distinct from empty data and filters emergencies on the server', async () => {
  mocks.request.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/incidents?')) throw new Error('Synthetic unavailable');
    return { items: [], totalCount: 0 };
  });
  mount(
    <MemoryRouter>
      <IncidentWorkspace />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText('Không có dữ liệu phù hợp với bộ lọc.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ưu tiên khẩn cấp' }));
  await vi.waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      expect.stringContaining('severity=Emergency'),
      expect.anything(),
    ),
  );
});
it('opens linked work orders directly and preserves the incident filter', async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string) =>
    path === '/api/v1/work-orders/work'
      ? {
          id: 'work',
          incidentId: 'incident',
          locationId: 'location',
          expectedOutcome: 'Linked repair',
          status: 'Verified',
          targetCompletionAt: '2026-11-10T03:00:00Z',
          version: 9,
        }
      : original(path),
  );
  mount(
    <MemoryRouter initialEntries={['/maintenance?workOrderId=work&incidentId=incident']}>
      <IncidentWorkspace maintenance />
    </MemoryRouter>,
  );
  expect(await screen.findByText(/Linked repair/)).toBeInTheDocument();
  expect(mocks.request).toHaveBeenCalledWith(
    expect.stringContaining('incidentId=incident'),
    expect.anything(),
  );
  expect(screen.getAllByRole('link', { name: 'Mở sự cố' })[0]).toHaveAttribute(
    'href',
    '/incidents?incidentId=incident',
  );
});
it('requires a rework reason and posts the reviewed version once', async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/work-orders/work')
      return {
        id: 'work',
        incidentId: 'incident',
        locationId: 'location',
        expectedOutcome: 'Repair',
        status: 'PendingVerification',
        targetCompletionAt: '2026-11-10T03:00:00Z',
        version: 9,
      };
    if (path.endsWith('/rework') && init?.method === 'POST')
      return { incidentId: 'incident', workOrderId: 'work' };
    return original(path, init);
  });
  mount(<WorkOrderDetail id="work" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Yêu cầu làm lại' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
  expect(await within(dialog).findByText('Nhập yêu cầu làm lại.')).toBeInTheDocument();
  expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  fireEvent.change(within(dialog).getByLabelText(/Yêu cầu làm lại/), {
    target: { value: 'Cần bổ sung bằng chứng sửa chữa tổng hợp.' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
  await vi.waitFor(() =>
    expect(mocks.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1),
  );
  const call = mocks.request.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(call[1].body)).toEqual({
    version: 9,
    note: 'Cần bổ sung bằng chứng sửa chữa tổng hợp.',
  });
});
it('does not display rounded financial values beyond JavaScript exact integers', () => {
  expect(formatIncidentMoney(9007199254740992)).toBe('Cần đối chiếu số tiền trên chứng từ.');
  expect(formatIncidentMoney(null)).toBe('Chưa có');
  expect(formatIncidentMoney(100000)).toMatch(/^100\.000\s₫$/);
});
it('chooses a duplicate reference by code and excludes itself or mismatched Room records', async () => {
  const change = vi.fn();
  mocks.request.mockResolvedValue({
    items: [
      { ...incident, id: 'self', roomId: null, assetId: null },
      { ...incident, id: 'other-room', code: 'WRONG', roomId: 'outside', assetId: null },
      { ...incident, id: 'candidate', code: 'INC-ORIGINAL', roomId: null, assetId: null },
    ],
    totalCount: 3,
  });
  mount(
    <IncidentReferenceField
      scope={{ id: 'self', locationId: 'location', roomId: null, assetId: null }}
      change={change}
      disabled={false}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Chọn sự cố gốc' }));
  const dialog = screen.getByRole('dialog', { name: 'Chọn sự cố gốc cùng phạm vi' });
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Chọn sự cố này' }));
  expect(change).toHaveBeenCalledWith('candidate');
  expect(screen.queryByText('WRONG')).not.toBeInTheDocument();
});
