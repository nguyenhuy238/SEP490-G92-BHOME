// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ContractClient, ContractView } from '../../../../packages/client-core/src/contracts';
import type { MoveInDraft } from '../services/moveInHandover';
import { roomHandoverChecks } from '../services/moveInHandover';

const state = vi.hoisted(() => ({
  location: '12345678-1234-4234-8234-123456789abc',
  transport: vi.fn(),
  documents: vi.fn(),
  updated: vi.fn(),
  draft: {} as MoveInDraft,
}));

vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  StyleSheet: { create: (styles: object) => styles },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../theme/theme', () => ({
  colors: { blue: '#1052cf', border: '#e2e8f0', tint: '#e8edff' },
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ staffLocationId: state.location }),
}));
vi.mock('../lib/randomUUID', () => ({
  randomUUID: () => '10000000-0000-4000-8000-000000000001',
}));
vi.mock('../lib/toast', () => ({ conciseMessage: (message: string) => message }));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title, detail }: { title: string; detail?: string }) => (
    <section><h2>{title}</h2><small>{detail}</small></section>
  ),
  Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Action: ({ children, onPress, disabled }: { children: React.ReactNode; onPress: () => void; disabled?: boolean }) => (
    <button disabled={disabled} onClick={onPress}>{children}</button>
  ),
  ui: {},
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  ProgressBar: ({ progress }: { progress: number }) => <div role="progressbar" aria-valuenow={progress * 100} />,
  Button: ({ children, onPress, disabled }: { children: React.ReactNode; onPress: () => void; disabled?: boolean }) => (
    <button disabled={disabled} onClick={onPress}>{children}</button>
  ),
  SegmentedButtons: ({ value, onValueChange, buttons }: {
    value: string;
    onValueChange: (value: string) => void;
    buttons: { value: string; label: string; disabled?: boolean }[];
  }) => (
    <div>{buttons.map((button) => (
      <button key={button.value} aria-pressed={value === button.value}
        disabled={button.disabled} onClick={() => onValueChange(button.value)}>
        {button.label}
      </button>
    ))}</div>
  ),
  Checkbox: { Item: ({ label, status, onPress, disabled }: { label: string; status: string; onPress: () => void; disabled?: boolean }) => (
    <button aria-label={label} aria-pressed={status === 'checked'} disabled={disabled} onClick={onPress}>{label}</button>
  ) },
}));
vi.mock('../components/WorkflowControls', () => ({
  Input: ({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) => (
    <label>{label}<input aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>
  ),
}));
vi.mock('../components/CameraCapture', () => ({
  CameraCapture: ({ onCapture, disabled }: { onCapture: (bytes: Uint8Array) => void; disabled: boolean }) => (
    <button disabled={disabled} onClick={() => onCapture(new Uint8Array([1, 2, 3]))}>Chụp ảnh hiện trạng</button>
  ),
}));
vi.mock('../features/contracts/ContractInitialMeterTasks', () => ({
  ContractInitialMeterTasks: ({ integrated }: { integrated?: boolean }) => (
    <span>{integrated ? 'Chụp điện nước trong công việc' : 'Nhiệm vụ chỉ số điện nước ban đầu'}</span>
  ),
}));
vi.mock('../features/contracts/ContractEvidence', () => ({
  ContractEvidence: ({ label, handoverDocumentId, draftHandoverPdf, draftHandoverEvidence }: {
    label: string;
    handoverDocumentId?: string;
    draftHandoverPdf?: boolean;
    draftHandoverEvidence?: boolean;
  }) => (
    <span
      data-testid={handoverDocumentId ? 'final-handover-pdf' : draftHandoverPdf ? 'draft-handover-pdf' : draftHandoverEvidence ? 'private-handover-photo' : undefined}
      data-document-id={handoverDocumentId}
    >{label}</span>
  ),
}));
vi.mock('../features/contracts/HandoverAssetFields', () => ({
  HandoverAssetFields: ({ asset, set, evidenceIds }: { asset: { id: string; name: string }; set: (key: string, value: string) => void; evidenceIds: string[] }) => (
    <button onClick={() => {
      set(`${asset.id}.checked`, 'true');
      if (evidenceIds[0]) set(`${asset.id}.evidence.${evidenceIds[0]}`, 'true');
    }}>{`Đã kiểm kê ${asset.name}`}</button>
  ),
}));

import { MoveInDraftHandoverPanel } from '../features/contracts/MoveInDraftHandoverPanel';

const contract = {
  id: '00000000-0000-4000-8000-000000000001',
  locationId: state.location,
  kind: 'Main',
  status: 'PendingActivation',
} as ContractView;

const api = { transport: state.transport, handoverDocuments: state.documents } as unknown as ContractClient;

function draft(status: MoveInDraft['status'], missing: string[] = []): MoveInDraft {
  return {
    version: 7,
    status,
    contractId: contract.id,
    roomNumber: '101',
    locationName: 'Cơ sở thử nghiệm',
    locationAddress: 'Địa chỉ thử nghiệm',
    startDate: '2026-11-20',
    endDate: '2027-11-19',
    monthlyRent: 3200000,
    requiredDeposit: 3200000,
    terms: '',
    electricity: null,
    water: null,
    assets: [{ id: '20000000-0000-4000-8000-000000000001', name: 'Quạt', inventoryCondition: 'Tốt', observedCondition: 'Tốt', checked: false }],
    roomCondition: 'Sạch',
    keysAndAccess: '1 chìa',
    notes: '',
    evidenceIds: [],
    roomChecks: [],
    accessItems: [],
    outstandingIssues: [],
    moveInTask: {
      id: '40000000-0000-4000-8000-000000000000',
      status: 'InProgress',
      version: 3,
      canInspect: true,
    },
    noAssetsConfirmed: false,
    requests: [],
    missing,
  };
}

beforeEach(() => {
  state.location = contract.locationId;
  state.draft = draft('Draft', ['Chưa xác nhận điện']);
  state.documents.mockResolvedValue([]);
  state.transport.mockImplementation(async (path: string) => {
    if (path.endsWith('/handover/draft/evidence')) return { id: '30000000-0000-4000-8000-000000000001' };
    if (path.endsWith('/handover/draft')) return state.draft;
    return { ...state.draft };
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('allows Tenant to view Draft but hides both actions until Owner marks Ready', async () => {
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Tenant" />);
  expect(await screen.findByText('Đang chuẩn bị')).toBeTruthy();
  expect(screen.getByText(/Biên bản đang được Staff và Owner/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Xác nhận biên bản bàn giao' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Gửi yêu cầu chỉnh sửa' })).toBeNull();
  expect(state.transport).toHaveBeenCalledTimes(1);
});

it('translates handover readiness blockers, including invalid asset quantities or evidence, into Vietnamese', async () => {
  state.draft = draft('Draft', [
    'contract_active', 'electricity', 'assets', 'asset_quantities_or_evidence', 'unknown_new_guard',
  ]);
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Tenant" />);
  expect(await screen.findByText(/Hợp đồng chưa được kích hoạt/)).toBeTruthy();
  expect(screen.getByText(/Chưa có chỉ số điện khởi tạo đã xác nhận/)).toBeTruthy();
  expect(screen.getByText(/Chưa kiểm kê đầy đủ các nhóm tài sản/)).toBeTruthy();
  expect(screen.getByText(/Số lượng, tình trạng hoặc ảnh bằng chứng tài sản chưa hợp lệ/)).toBeTruthy();
  expect(screen.getByText(/Còn điều kiện bàn giao chưa đạt/)).toBeTruthy();
  expect(screen.queryByText(/asset_quantities_or_evidence|contract_active|unknown_new_guard/)).toBeNull();
});

it('Tenant requires acknowledgement and reason before requesting a revision, sends versioned request', async () => {
  state.draft = draft('Ready');
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Tenant" onUpdated={state.updated} />);
  const acknowledge = await screen.findByRole('button', { name: 'Tôi đã kiểm tra nội dung biên bản phiên bản 7' });
  const correction = screen.getByRole('button', { name: 'Gửi yêu cầu chỉnh sửa' });
  expect((correction as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(acknowledge);
  expect((correction as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Ghi chú / nội dung cần sửa'), { target: { value: 'Sửa số lượng tài sản bàn giao' } });
  fireEvent.click(correction);
  await waitFor(() => expect(state.transport).toHaveBeenCalledWith(
    `/api/v1/contracts/${contract.id}/handover/draft/requests`,
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ version: 7, reason: 'Sửa số lượng tài sản bàn giao' }),
      headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
    }),
  ));
  expect(state.updated).toHaveBeenCalledOnce();
});

it('Tenant confirms a ready and complete version without a signature', async () => {
  state.draft = draft('Ready');
  render(<MoveInDraftHandoverPanel api={api} contract={{ ...contract, status: 'Active' }} role="Tenant" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tôi đã kiểm tra nội dung biên bản phiên bản 7' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận biên bản bàn giao' }));
  await waitFor(() => expect(state.transport).toHaveBeenCalledWith(
    `/api/v1/contracts/${contract.id}/handover/draft/tenant-confirmation`,
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ version: 7, note: '' }) }),
  ));
});

it('Tenant may request correction while activation is pending but cannot confirm occupancy', async () => {
  state.draft = draft('Ready');
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Tenant" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tôi đã kiểm tra nội dung biên bản phiên bản 7' }));
  expect((screen.getByRole('button', { name: 'Xác nhận biên bản bàn giao' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Chờ hợp đồng được kích hoạt/)).toBeTruthy();
});

it('uses the legacy panel when an older active contract has no handover draft', async () => {
  state.transport.mockRejectedValue({ status: 404 });
  render(<MoveInDraftHandoverPanel api={api} contract={{ ...contract, status: 'Active' }} role="Tenant" legacyFallback={<span>Biên bản cũ</span>} />);
  expect(await screen.findByText('Biên bản cũ')).toBeTruthy();
});

it('blocks confirmation when readiness still contains missing work and blocks Staff in another Location', async () => {
  state.draft = draft('Ready', ['Công tơ nước']);
  const page = render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Tenant" />);
  expect(await screen.findByText('Sẵn sàng bàn giao')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Xác nhận biên bản bàn giao' })).toBeNull();
  page.unmount();
  state.transport.mockClear();
  state.location = '30000000-0000-4000-8000-000000000001';
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  expect(screen.getByText(/Không thể mở biên bản của cơ sở/)).toBeTruthy();
  expect(state.transport).not.toHaveBeenCalled();
});

it('requires a successful server start before showing meter capture, inventory or evidence upload', async () => {
  state.draft.moveInTask = {
    id: '40000000-0000-4000-8000-000000000000',
    version: 3,
    status: 'Assigned',
    canInspect: false,
  };
  state.transport.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path.endsWith('/start') && options?.method === 'POST') {
      state.draft.moveInTask = { ...state.draft.moveInTask!, status: 'InProgress', canInspect: true, version: 4 };
      return state.draft.moveInTask;
    }
    return state.draft;
  });
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  expect(await screen.findByRole('button', { name: 'Bắt đầu công việc' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Tiếp tục kiểm tra' })).toBeNull();
  expect(screen.queryByText('Chụp điện nước trong công việc')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Chụp ảnh hiện trạng' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu công việc' }));
  await waitFor(() => expect(state.transport).toHaveBeenCalledWith(
    '/api/v1/operational-tasks/40000000-0000-4000-8000-000000000000/start',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ version: 3 }),
      headers: { 'Idempotency-Key': expect.any(String) },
    }),
  ));
  expect(await screen.findByRole('button', { name: 'Tiếp tục kiểm tra' })).toBeTruthy();
  expect(screen.getByText('Chụp điện nước trong công việc')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục kiểm tra' }));
  expect(screen.getAllByRole('button', { name: 'Đạt' })).toHaveLength(7);
});

it('guides Staff through one step at a time and preserves unsaved input while navigating', async () => {
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục kiểm tra' }));
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  expect(screen.getByLabelText('Hiện trạng phòng')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Đã kiểm kê Quạt' })).toBeNull();
  expect(screen.queryByLabelText('Chìa khóa / quyền truy cập')).toBeNull();
  fireEvent.change(screen.getByLabelText('Hiện trạng phòng'), {
    target: { value: 'Trần và sàn đã kiểm tra' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp theo: Kiểm kê tài sản' }));
  expect(screen.getByRole('button', { name: 'Đã kiểm kê Quạt' })).toBeTruthy();
  expect(screen.queryByLabelText('Hiện trạng phòng')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp theo: Chìa khóa và ảnh bàn giao' }));
  expect(screen.getByLabelText('Chìa khóa / quyền truy cập')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Đã kiểm kê Quạt' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
  expect((screen.getByLabelText('Hiện trạng phòng') as HTMLInputElement).value).toBe('Trần và sàn đã kiểm tra');
  expect(state.transport.mock.calls.some(([path, options]) =>
    path.endsWith('/handover/draft') && options?.method === 'POST')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ bàn giao' }));
  await waitFor(() => expect(state.transport.mock.calls.some(([path, options]) =>
    path.endsWith('/handover/draft') && options?.method === 'POST')).toBe(true));
});

it('resumes Staff at the first unfinished wizard step using saved server progress', async () => {
  state.draft.electricity = {
    id: 'reading-e', meterCode: 'ELEC-01', utilityType: 0,
    date: '2026-11-20', value: '4', evidenceId: 'photo-e', evidenceHash: 'hash-e',
  };
  state.draft.water = {
    id: 'reading-w', meterCode: 'WATER-01', utilityType: 1,
    date: '2026-11-20', value: '5', evidenceId: 'photo-w', evidenceHash: 'hash-w',
  };
  state.draft.roomChecks = roomHandoverChecks.map(({ code }) => ({
    code, status: 'Passed', notes: '', evidenceIds: [],
  }));
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  expect(await screen.findByText('Kiểm kê tài sản')).toBeTruthy();
  expect(screen.getByText('BƯỚC 3 / 4')).toBeTruthy();
  expect(screen.queryByText('Chụp điện nước trong công việc')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục kiểm tra' }));
  expect(screen.getByRole('button', { name: 'Đã kiểm kê Quạt' })).toBeTruthy();
});

it('does not call a room issue finished when its required inspection photo is missing', async () => {
  state.draft.electricity = {
    id: 'reading-e', meterCode: 'ELEC-01', utilityType: 0,
    date: '2026-11-20', value: '4', evidenceId: 'photo-e', evidenceHash: 'hash-e',
  };
  state.draft.water = {
    id: 'reading-w', meterCode: 'WATER-01', utilityType: 1,
    date: '2026-11-20', value: '5', evidenceId: 'photo-w', evidenceHash: 'hash-w',
  };
  state.draft.roomChecks = roomHandoverChecks.map(({ code }, index) => ({
    code, status: index === 0 ? 'Issue' : 'Passed',
    notes: index === 0 ? 'Tường bị ẩm' : '', evidenceIds: [],
  }));
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  expect(await screen.findByText('BƯỚC 2 / 4')).toBeTruthy();
  expect(screen.getByText('Cần kiểm tra')).toBeTruthy();
  expect(screen.queryByText('Chụp điện nước trong công việc')).toBeNull();
});

it('keeps all inspection and meter steps locked on failed start or mismatched responsible Staff', async () => {
  state.draft.moveInTask = {
    id: '40000000-0000-4000-8000-000000000000',
    status: 'Assigned',
    version: 5,
    canInspect: false,
  };
  state.transport.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path.endsWith('/start') && options?.method === 'POST')
      throw { status: 403, code: 'forbidden' };
    return state.draft;
  });
  const page = render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu công việc' }));
  await waitFor(() => expect(state.transport.mock.calls.some(([path, options]) =>
    path.endsWith('/start') && options?.method === 'POST')).toBe(true));
  expect(screen.queryByRole('button', { name: 'Tiếp tục kiểm tra' })).toBeNull();
  expect(screen.queryByText('Chụp điện nước trong công việc')).toBeNull();
  page.unmount();
  state.draft.moveInTask = { ...state.draft.moveInTask!, status: 'InProgress', canInspect: false };
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  expect(await screen.findByText(/Chưa thể ghi nhận/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Tiếp tục kiểm tra' })).toBeNull();
});

it('Staff updates condition without altering meter baselines or contract creation', async () => {
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục kiểm tra' }));
  fireEvent.change(screen.getByLabelText('Hiện trạng phòng'), { target: { value: 'Đã vệ sinh và kiểm tra' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ bàn giao' }));
  await waitFor(() => expect(state.transport).toHaveBeenCalledWith(
    `/api/v1/contracts/${contract.id}/handover/draft`,
    expect.objectContaining({
      method: 'POST',
      body: expect.any(String),
    }),
  ));
  const mutation = state.transport.mock.calls.find(([path, init]) => path.endsWith('/handover/draft') && init.method === 'POST');
  expect(JSON.parse(mutation![1].body)).toMatchObject({ version: 7, roomCondition: 'Đã vệ sinh và kiểm tra' });
  expect(JSON.parse(mutation![1].body)).not.toHaveProperty('electricityReadingId');
  expect(JSON.parse(mutation![1].body)).not.toHaveProperty('waterReadingId');
  expect(JSON.parse(mutation![1].body)).not.toHaveProperty('assets');
});

it('blocks Staff edits while the Owner reviews a Tenant change request', async () => {
  state.draft = draft('ChangesRequested');
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  expect(await screen.findByText(/Chờ Owner quyết định trước khi Staff cập nhật/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Tiếp tục kiểm tra' })).toBeNull();
  expect(state.transport).toHaveBeenCalledTimes(1);
});

it('preserves uploaded photo assignment to an asset when saving the draft', async () => {
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục kiểm tra' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp theo: Kiểm kê tài sản' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ảnh không có giấy tờ cá nhân hoặc thông tin riêng tư' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh hiện trạng' }));
  await waitFor(() => expect(state.transport).toHaveBeenCalledWith(
    `/api/v1/contracts/${contract.id}/handover/draft/evidence`,
    expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'image/jpeg' } }),
  ));
  fireEvent.click(await screen.findByRole('button', { name: 'Đã kiểm kê Quạt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ bàn giao' }));
  await waitFor(() => expect(state.transport.mock.calls.some(
    ([path, init]) => path.endsWith('/handover/draft') && init.method === 'POST',
  )).toBe(true));
  const mutation = state.transport.mock.calls.find(([path, init]) => path.endsWith('/handover/draft') && init.method === 'POST');
  expect(JSON.parse(mutation![1].body).assets[0]).toMatchObject({
    checked: true,
    evidenceIds: ['30000000-0000-4000-8000-000000000001'],
  });
  expect(JSON.parse(mutation![1].body).evidenceIds).not.toContain('30000000-0000-4000-8000-000000000001');
});

it('saves asset groups across separate Staff visits without resetting the first inspection', async () => {
  const secondId = '20000000-0000-4000-8000-000000000002';
  state.draft.assets.push({
    id: secondId, name: 'Bàn', inventoryCondition: 'Tốt', observedCondition: 'Tốt', checked: false,
  });
  const submissions: Array<{ version: number; assets: { id: string; checked: boolean }[] }> = [];
  state.transport.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (path.endsWith('/handover/draft') && init?.method === 'POST') {
      const body = JSON.parse(init.body!);
      submissions.push(body);
      for (const asset of body.assets ?? []) {
        const index = state.draft.assets.findIndex((existing) => existing.id === asset.id);
        state.draft.assets[index] = { ...state.draft.assets[index]!, ...asset, observedCondition: asset.condition };
      }
      state.draft.version++;
      return state.draft;
    }
    return state.draft;
  });
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục kiểm tra' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp theo: Kiểm kê tài sản' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đã kiểm kê Quạt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ bàn giao' }));
  await waitFor(() => expect(submissions).toHaveLength(1));
  expect(submissions[0].assets.map((asset) => asset.id)).toEqual([state.draft.assets[0]!.id]);
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục kiểm tra' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đã kiểm kê Bàn' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ bàn giao' }));
  await waitFor(() => expect(submissions).toHaveLength(2));
  expect(submissions[1].version).toBe(8);
  expect(state.draft.assets.map((asset) => asset.checked)).toEqual([true, true]);
  expect(state.draft.version).toBe(9);
});

it('saves only the room checks edited during this visit and requires a reason when not applicable', async () => {
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục kiểm tra' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Đạt' })[0]!);
  fireEvent.click(screen.getAllByRole('button', { name: 'Không áp dụng' })[1]!);
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ bàn giao' }));
  expect(await screen.findByText(/Hãy ghi lý do cho mục "Cửa, cửa sổ và ổ khóa"/)).toBeTruthy();
  expect(state.transport.mock.calls.filter(([path, options]) =>
    path.endsWith('/handover/draft') && options?.method === 'POST')).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Ghi chú · Cửa, cửa sổ và ổ khóa'),
    { target: { value: 'Không có cửa sổ ở phòng này' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ bàn giao' }));
  await waitFor(() => expect(state.transport.mock.calls.some(([path, options]) =>
    path.endsWith('/handover/draft') && options?.method === 'POST')).toBe(true));
  const mutation = state.transport.mock.calls.find(([path, options]) =>
    path.endsWith('/handover/draft') && options?.method === 'POST');
  const body = JSON.parse(mutation![1].body);
  expect(body.roomChecks).toEqual([
    { code: 'walls_ceiling_floor', status: 'Passed', notes: '', evidenceIds: [] },
    { code: 'doors_windows_locks', status: 'NotApplicable', notes: 'Không có cửa sổ ở phòng này', evidenceIds: [] },
  ]);
  expect(body).not.toHaveProperty('accessItems');
  expect(body).not.toHaveProperty('outstandingIssues');
});

it('sends the seven exact server-required room checklist codes without replacing existing asset inspections', async () => {
  state.draft.assets[0]!.checked = true;
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục kiểm tra' }));
  const passButtons = screen.getAllByRole('button', { name: 'Đạt' });
  expect(passButtons).toHaveLength(7);
  passButtons.forEach((button) => fireEvent.click(button));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ bàn giao' }));
  await waitFor(() => expect(state.transport.mock.calls.some(([path, options]) =>
    path.endsWith('/handover/draft') && options?.method === 'POST')).toBe(true));
  const mutation = state.transport.mock.calls.find(([path, options]) =>
    path.endsWith('/handover/draft') && options?.method === 'POST');
  const body = JSON.parse(mutation![1].body);
  expect(body.roomChecks.map((check: { code: string }) => check.code)).toEqual(
    roomHandoverChecks.map((check) => check.code));
  expect(body.roomChecks.every((check: { status: string }) => check.status === 'Passed')).toBe(true);
  expect(body.assets[0].id).toBe(state.draft.assets[0]!.id);
});

it('Tenant can review seven room inspections, attached Issue image, access items and outstanding work', async () => {
  state.draft = draft('Ready');
  state.draft.roomChecks = roomHandoverChecks.map(({ code }, index) => ({
    code,
    status: index === 2 ? 'Issue' : 'Passed',
    notes: index === 2 ? 'Ổ điện bị hỏng' : '',
    evidenceIds: index === 2 ? ['30000000-0000-4000-8000-000000000001'] : [],
  }));
  state.draft.accessItems = [{ type: 'RoomKey', quantity: 2, notes: 'Đã thử khóa' }];
  state.draft.outstandingIssues = [{
    code: 'electrical_lighting_outlets', description: 'Sửa ổ điện',
    responsibleParty: 'Owner', dueDate: '2026-11-30',
  }];
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Tenant" />);
  expect(await screen.findByText('Sẵn sàng bàn giao')).toBeTruthy();
  for (const { label } of roomHandoverChecks) {
    expect(screen.getByText(label)).toBeTruthy();
  }
  expect(screen.getByText(/Chìa khóa phòng: 2/)).toBeTruthy();
  expect(screen.getByText(/Sửa ổ điện/)).toBeTruthy();
  expect(screen.getByText(/Ổ điện bị hỏng/)).toBeTruthy();
  expect(screen.getAllByTestId('private-handover-photo')).toHaveLength(1);
});

it('saves a room problem as a factual inspection with notes and photo, without assigning repairs', async () => {
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục kiểm tra' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Có vấn đề' })[2]!);
  fireEvent.change(screen.getByLabelText('Ghi chú · Hệ thống điện, đèn và ổ cắm'),
    { target: { value: 'Ổ cắm bên trái không có điện' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ bàn giao' }));
  expect(await screen.findByText(/cần gắn ít nhất một ảnh bằng chứng riêng/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ảnh không có giấy tờ cá nhân hoặc thông tin riêng tư' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh hiện trạng' }));
  await waitFor(() => expect(state.transport.mock.calls.some(([path]) =>
    path.endsWith('/handover/draft/evidence'))).toBe(true));
  fireEvent.click(await screen.findByRole('button', { name: 'Gắn ảnh 1 cho Hệ thống điện, đèn và ổ cắm' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ bàn giao' }));
  await waitFor(() => expect(state.transport.mock.calls.some(([path, options]) =>
    path.endsWith('/handover/draft') && options?.method === 'POST')).toBe(true));
  const mutation = state.transport.mock.calls.find(([path, options]) =>
    path.endsWith('/handover/draft') && options?.method === 'POST');
  const body = JSON.parse(mutation![1].body);
  expect(body.roomChecks).toEqual([{
    code: 'electrical_lighting_outlets',
    status: 'Issue',
    notes: 'Ổ cắm bên trái không có điện',
    evidenceIds: ['30000000-0000-4000-8000-000000000001'],
  }]);
  expect(body).not.toHaveProperty('outstandingIssues');
  expect(screen.queryByLabelText('Nội dung cần xử lý · Hệ thống điện, đèn và ổ cắm')).toBeNull();
  expect(screen.queryByLabelText('Hạn xử lý Hệ thống điện, đèn và ổ cắm (dd/MM/yyyy)')).toBeNull();
});

it('replaces access items only when edited and validates digital access with quantity zero', async () => {
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục kiểm tra' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp theo: Kiểm kê tài sản' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp theo: Chìa khóa và ảnh bàn giao' }));
  fireEvent.click(screen.getByRole('button', { name: 'Thêm chìa khóa phòng' }));
  fireEvent.change(screen.getByLabelText('Số lượng bàn giao 1'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Thêm quyền truy cập số' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ bàn giao' }));
  expect(await screen.findByText(/quyền truy cập số có thể bằng 0 nếu có ghi chú/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Ghi chú quyền ra vào 2'),
    { target: { value: 'Cấp mã cổng theo tài khoản Tenant' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ bàn giao' }));
  await waitFor(() => expect(state.transport.mock.calls.some(([path, options]) =>
    path.endsWith('/handover/draft') && options?.method === 'POST')).toBe(true));
  const mutation = state.transport.mock.calls.find(([path, options]) =>
    path.endsWith('/handover/draft') && options?.method === 'POST');
  expect(JSON.parse(mutation![1].body).accessItems).toEqual([
    { type: 'RoomKey', quantity: 2, notes: '' },
    { type: 'DigitalAccess', quantity: 0, notes: 'Cấp mã cổng theo tài khoản Tenant' },
  ]);
});

it('does not modify previous Owner plans when Staff changes the factual inspection result', async () => {
  state.draft.roomChecks = [
    { code: 'walls_ceiling_floor', status: 'Issue', notes: 'Tường bong sơn', evidenceIds: ['30000000-0000-4000-8000-000000000001'] },
    { code: 'doors_windows_locks', status: 'Passed', notes: '', evidenceIds: [] },
  ];
  state.draft.outstandingIssues = [
    { code: 'walls_ceiling_floor', description: 'Sơn lại', responsibleParty: 'Owner', dueDate: '2026-11-25' },
    { code: 'other', description: 'Đối chiếu vật dụng', responsibleParty: 'Staff', dueDate: '2026-11-27' },
  ];
  render(<MoveInDraftHandoverPanel api={api} contract={contract} role="Staff" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục kiểm tra' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Đạt' })[0]!);
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tiến độ bàn giao' }));
  await waitFor(() => expect(state.transport.mock.calls.some(([path, options]) =>
    path.endsWith('/handover/draft') && options?.method === 'POST')).toBe(true));
  const mutation = state.transport.mock.calls.find(([path, options]) =>
    path.endsWith('/handover/draft') && options?.method === 'POST');
  const body = JSON.parse(mutation![1].body);
  expect(body.roomChecks.map((check: { code: string }) => check.code)).toEqual(['walls_ceiling_floor']);
  expect(body).not.toHaveProperty('outstandingIssues');
});

it('shows a synthetic JPEG upload button only for a development demo contract on localhost Expo Web', async () => {
  vi.stubGlobal('__DEV__', true);
  vi.stubGlobal('location', { hostname: 'localhost', port: '8081' });
  const testContract = { ...contract, isDevelopmentDemo: true };
  const liveContract = { ...contract, isDevelopmentDemo: false };
  const first = render(<MoveInDraftHandoverPanel api={api} contract={liveContract} role="Staff" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục kiểm tra' }));
  expect(screen.queryByRole('button', { name: 'Ảnh giả lập DEV – không dùng làm bằng chứng thực tế' })).toBeNull();
  first.unmount();
  render(<MoveInDraftHandoverPanel api={api} contract={testContract} role="Staff" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục kiểm tra' }));
  const sample = screen.getByRole('button', { name: 'Ảnh giả lập DEV – không dùng làm bằng chứng thực tế' });
  expect((sample as HTMLButtonElement).disabled).toBe(true);
  const sampleJpeg = [0xff, 0xd8, 0xff, ...Array(140).fill(0)];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(), fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    `data:image/jpeg;base64,${btoa(String.fromCharCode(...sampleJpeg))}`);
  fireEvent.click(screen.getByRole('button', { name: 'Ảnh không có giấy tờ cá nhân hoặc thông tin riêng tư' }));
  fireEvent.click(sample);
  await waitFor(() => expect(state.transport).toHaveBeenCalledWith(
    `/api/v1/contracts/${contract.id}/handover/draft/evidence`,
    expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'image/jpeg' } }),
  ));
  expect(await screen.findByText('Đã tải ảnh giả lập DEV lên biên bản test.')).toBeTruthy();
});

it('Confirmed exposes only the newest immutable MoveInReport belonging to this contract', async () => {
  state.draft = draft('Confirmed');
  const finalId = '40000000-0000-4000-8000-000000000001';
  state.documents.mockResolvedValue([
    { id: '40000000-0000-4000-8000-000000000002', kind: 'AssetChangeReport', contractId: contract.id, recordedAt: '2026-11-19T12:00:00Z' },
    { id: '40000000-0000-4000-8000-000000000003', kind: 'MoveInReport', contractId: '50000000-0000-4000-8000-000000000001', recordedAt: '2026-11-19T12:00:00Z' },
    { id: '40000000-0000-4000-8000-000000000004', kind: 'MoveInReport', contractId: contract.id, recordedAt: '2026-11-18T12:00:00Z' },
    { id: finalId, kind: 'MoveInReport', contractId: contract.id, recordedAt: '2026-11-19T12:00:00Z' },
  ]);
  render(<MoveInDraftHandoverPanel api={api} contract={{ ...contract, status: 'Active' }} role="Tenant" />);
  const document = await screen.findByTestId('final-handover-pdf');
  expect(document.getAttribute('data-document-id')).toBe(finalId);
  expect(screen.getAllByTestId('final-handover-pdf')).toHaveLength(1);
  expect(screen.queryByTestId('draft-handover-pdf')).toBeNull();
  expect(state.documents).toHaveBeenCalledWith(contract.id, expect.any(AbortSignal));
});

it('Confirmed reports a missing or inaccessible final PDF without offering a watermarked draft', async () => {
  state.draft = draft('Confirmed');
  state.documents.mockRejectedValueOnce({ status: 403, code: 'forbidden' });
  const page = render(<MoveInDraftHandoverPanel api={api} contract={{ ...contract, status: 'Active' }} role="Tenant" />);
  expect(await screen.findByText(/Không tải được PDF bàn giao cuối cùng/)).toBeTruthy();
  expect(screen.queryByTestId('draft-handover-pdf')).toBeNull();
  expect(screen.queryByTestId('final-handover-pdf')).toBeNull();
  page.unmount();
  state.documents.mockResolvedValue([]);
  render(<MoveInDraftHandoverPanel api={api} contract={{ ...contract, status: 'Active' }} role="Tenant" />);
  expect(await screen.findByText(/PDF cuối cùng chưa có/)).toBeTruthy();
  expect(screen.queryByTestId('draft-handover-pdf')).toBeNull();
});
