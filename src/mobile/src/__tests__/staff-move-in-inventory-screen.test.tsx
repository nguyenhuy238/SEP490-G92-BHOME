// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MoveInInventory } from '../services/moveInInventory';

const taskId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const locationId = '33333333-3333-4333-8333-333333333333';
const roomId = '44444444-4444-4444-8444-444444444444';
const assetId = '55555555-5555-4555-8555-555555555555';
const evidenceId = '66666666-6666-4666-8666-666666666666';

const state = vi.hoisted(() => ({
  data: null as MoveInInventory | null,
  request: vi.fn(),
  reload: vi.fn(),
  go: vi.fn(),
}));
function inventory(
  status: string,
  actual: number | null = null,
  condition: 'Good' | 'Missing' | 'Damaged' | null = null,
  evidenceIds: string[] = [],
): MoveInInventory {
  return {
    taskId,
    contractId: taskId,
    roomId,
    locationId,
    status,
    version: 1,
    dueAt: null,
    completedAt: null,
    readyForHandover: false,
    items: [
      {
        id: itemId,
        assetId,
        name: 'Giường đơn',
        expectedQuantity: 2,
        actualQuantity: actual,
        condition,
        notes: condition === 'Missing' ? 'Thiếu một giường' : '',
        evidenceIds,
        incidentId: null,
      },
    ],
  };
}
type C = { children?: React.ReactNode };
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ taskId }),
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api: { request: state.request }, session: { roles: ['Staff'] } }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ role: 'Staff', preview: false, go: state.go }),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: () => ({ data: state.data, loading: false, error: '', reload: state.reload }),
}));
vi.mock('../theme/theme', () => ({
  colors: { blue: '#1052cf', border: '#e2e8f0', tint: '#e8edff' },
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Box: ({ children }: C) => <section>{children}</section>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Row: ({ children }: C) => <div>{children}</div>,
  Pill: ({ children }: C) => <span>{children}</span>,
  Action: ({ children, disabled, onPress }: C & { disabled: boolean; onPress: () => void }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: C) => <span>{children}</span>,
  Button: ({ children, disabled, onPress }: C & { disabled: boolean; onPress: () => void }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  Checkbox: {
    Item: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <button onClick={onPress}>{label}</button>
    ),
  },
  RadioButton: {
    Item: ({ label, status, disabled, onPress }: { label: string; status: string; disabled: boolean; onPress: () => void }) => (
      <button role="radio" aria-label={label} aria-checked={status === 'checked'} disabled={disabled} onClick={onPress}>
        {label}
      </button>
    ),
  },
  SegmentedButtons: ({ value, onValueChange, buttons }: {
    value: string;
    onValueChange: (value: string) => void;
    buttons: { value: string; label: string; disabled?: boolean }[];
  }) => (
    <div role="group" aria-label="Tình trạng tài sản">
      {buttons.map((button) => (
        <button key={button.value} aria-pressed={value === button.value}
          disabled={button.disabled} onClick={() => onValueChange(button.value)}>
          {button.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('../components/WorkflowControls', () => ({
  Input: ({
    label,
    value,
    disabled,
    onChange,
  }: {
    label: string;
    value: string;
    disabled: boolean;
    onChange: (s: string) => void;
  }) => (
    <input
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
vi.mock('../components/IncidentEvidencePicker', () => ({
  IncidentEvidencePicker: ({ onChange }: { onChange: (photos: unknown[]) => void }) => (
    <button
      onClick={() =>
        onChange([
          {
            id: evidenceId,
            bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
            contentType: 'image/png',
          },
        ])
      }
    >
      Chụp ảnh tài sản
    </button>
  ),
}));
vi.mock('../lib/toast', () => ({ showSuccess: vi.fn() }));
import { StaffMoveInInventoryScreen } from '../screens/StaffMoveInInventoryScreen';
beforeEach(() => {
  state.data = inventory('Assigned');
  state.go.mockReset();
  state.reload.mockReset();
  state.request.mockReset();
  state.request.mockImplementation(
    async (path: string, init?: { method: string; body: string }) => {
      if (path.endsWith('/start')) {
        state.data = { ...state.data!, status: 'InProgress', version: 2 };
        return { ...state.data };
      }
      if (path.endsWith('/evidence')) return { id: evidenceId };
      if (path.includes('/items/') && init?.method === 'PUT') {
        const body = JSON.parse(init.body);
        state.data = {
          ...state.data!,
          version: state.data!.version + 1,
          items: [
            {
              ...state.data!.items[0],
              ...body,
            },
          ],
        };
        return { ...state.data };
      }
      if (path.endsWith('/complete')) {
        state.data = {
          ...state.data!,
          status: 'Completed',
          completedAt: '2026-11-18T00:00:00Z',
          version: 2,
        };
        return { ...state.data };
      }
      return state.data;
    },
  );
});
afterEach(cleanup);

it('starts a server-assigned inventory task before allowing edits', async () => {
  const view = render(<StaffMoveInInventoryScreen />);
  expect(screen.queryByText('Tải lại kiểm kê')).toBeNull();
  expect(screen.queryByLabelText('Số lượng thực tế – Giường đơn')).toBeNull();
  fireEvent.click(screen.getByText('Kiểm tra'));
  expect(screen.getByLabelText('Số lượng thực tế – Giường đơn')).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByText('Về danh sách tài sản'));
  fireEvent.click(screen.getByText('Bắt đầu kiểm kê'));
  await waitFor(() =>
    expect(
      state.request.mock.calls.some(
        ([path, init]) =>
          path.endsWith('/start') && init.method === 'POST' && JSON.parse(init.body).version === 1,
      ),
    ).toBe(true),
  );
  view.rerender(<StaffMoveInInventoryScreen />);
  fireEvent.click(screen.getByText('Kiểm tra'));
  expect(screen.getByLabelText('Số lượng thực tế – Giường đơn')).toHaveProperty('disabled', false);
  expect(state.reload).toHaveBeenCalled();
});

it('shows only the selected asset on mobile, keeps unsaved input and resets the modal scroll', () => {
  state.data = inventory('InProgress');
  const paneChange = vi.fn();
  state.data.items.push({
    ...state.data.items[0]!, id: '77777777-7777-4777-8777-777777777777',
    assetId: null, name: 'Bàn học', expectedQuantity: 1,
  });
  render(<StaffMoveInInventoryScreen embeddedTaskId={taskId} onPaneChange={paneChange} />);
  expect(screen.getByText('Giường đơn')).toBeTruthy();
  expect(screen.getByText('Bàn học')).toBeTruthy();
  expect(screen.queryByLabelText('Số lượng thực tế – Giường đơn')).toBeNull();
  fireEvent.click(screen.getAllByText('Kiểm tra')[1]!);
  expect(screen.queryByText('Giường đơn')).toBeNull();
  expect(screen.getByLabelText('Số lượng thực tế – Bàn học')).toBeTruthy();
  expect(screen.queryByLabelText('Số lượng thực tế – Giường đơn')).toBeNull();
  fireEvent.change(screen.getByLabelText('Số lượng thực tế – Bàn học'), { target: { value: '2' } });
  fireEvent.click(screen.getByText('Về danh sách tài sản'));
  expect(screen.getByText('Chưa lưu')).toBeTruthy();
  fireEvent.click(screen.getAllByText('Kiểm tra')[1]!);
  expect(screen.getByLabelText('Số lượng thực tế – Bàn học')).toHaveProperty('value', '2');
  expect(paneChange).toHaveBeenCalledTimes(3);
});

it('returns to the inventory list only after saving a single item on the server', async () => {
  state.data = inventory('InProgress');
  const paneChange = vi.fn();
  const view = render(<StaffMoveInInventoryScreen embeddedTaskId={taskId} onPaneChange={paneChange} />);
  fireEvent.click(screen.getByText('Kiểm tra'));
  fireEvent.change(screen.getByLabelText('Số lượng thực tế – Giường đơn'), { target: { value: '2' } });
  fireEvent.click(screen.getByText('Đạt'));
  fireEvent.click(screen.getByText('Chụp ảnh tài sản'));
  fireEvent.click(screen.getByText('Lưu mục này'));
  await waitFor(() => expect(state.request.mock.calls.some(([path, init]) =>
    path.includes('/move-in-inventory/items/') && init?.method === 'PUT')).toBe(true));
  await waitFor(() => expect(screen.queryByLabelText('Số lượng thực tế – Giường đơn')).toBeNull());
  view.rerender(<StaffMoveInInventoryScreen embeddedTaskId={taskId} onPaneChange={paneChange} />);
  expect(screen.getByText('Đạt')).toBeTruthy();
  expect(state.data!.items[0]!.condition).toBe('Good');
  expect(paneChange).toHaveBeenCalledTimes(2);
});

it('opens a compact one-asset screen, without expanding fields under the list', () => {
  state.data = inventory('InProgress');
  render(<StaffMoveInInventoryScreen embeddedTaskId={taskId} />);
  expect(screen.queryByLabelText('Số lượng thực tế – Giường đơn')).toBeNull();
  fireEvent.click(screen.getByText('Kiểm tra'));
  expect(screen.getByText('Về danh sách tài sản')).toBeTruthy();
  expect(screen.getByLabelText('Số lượng thực tế – Giường đơn')).toBeTruthy();
  expect(screen.getByRole('group', { name: 'Tình trạng tài sản' }).querySelectorAll('button')).toHaveLength(3);
  expect(screen.queryByRole('combobox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Hư hỏng' }));
  expect(screen.getByRole('button', { name: 'Hư hỏng' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByLabelText('Ghi chú – Giường đơn')).toBeTruthy();
  expect(state.request).not.toHaveBeenCalledWith(expect.stringContaining('/items/'), expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Về danh sách tài sản' }));
  expect(screen.queryByLabelText('Số lượng thực tế – Giường đơn')).toBeNull();
  expect(screen.getByText('Chưa lưu')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }));
  expect(screen.getByRole('button', { name: 'Hư hỏng' }).getAttribute('aria-pressed')).toBe('true');
});

it('saves missing count and item evidence, then opens existing BF-07 form prefilled', async () => {
  state.data = inventory('InProgress');
  render(<StaffMoveInInventoryScreen />);
  fireEvent.click(screen.getByText('Kiểm tra'));
  fireEvent.change(screen.getByLabelText('Số lượng thực tế – Giường đơn'), {
    target: { value: '1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Thiếu' }));
  fireEvent.change(screen.getByLabelText('Ghi chú – Giường đơn'), {
    target: { value: 'Thiếu một giường' },
  });
  fireEvent.click(screen.getByText('Chụp ảnh tài sản'));
  fireEvent.click(screen.getByText('Báo cáo sự cố'));
  await waitFor(() =>
    expect(state.go).toHaveBeenCalledWith(
      'report-incident',
      expect.objectContaining({
        inventoryTaskId: taskId,
        inventoryItemId: itemId,
        locationId,
        roomId,
        assetId,
        inventoryEvidenceIds: evidenceId,
        description: expect.stringContaining('Thiếu'),
      }),
    ),
  );
  const write = state.request.mock.calls.find(
    ([path, init]) => path.includes('/move-in-inventory/items/') && init.method === 'PUT',
  );
  expect(JSON.parse(write![1].body)).toMatchObject({
    actualQuantity: 1,
    condition: 'Missing',
    evidenceIds: [evidenceId],
    incidentId: null,
  });
});

it('completes directly from Staff without any Owner verification action', async () => {
  state.data = inventory('InProgress', 2, 'Good', [evidenceId]);
  const view = render(<StaffMoveInInventoryScreen />);
  fireEvent.click(screen.getByText('Hoàn thành kiểm kê'));
  await waitFor(() =>
    expect(
      state.request.mock.calls.some(
        ([path, init]) => path.endsWith('/complete') && init.method === 'POST',
      ),
    ).toBe(true),
  );
  expect(state.request.mock.calls.some(([path]) => path.endsWith('/verify'))).toBe(false);
  view.rerender(<StaffMoveInInventoryScreen />);
  expect(screen.getByText('Đã hoàn thành, không chờ Owner duyệt')).toBeTruthy();
});
