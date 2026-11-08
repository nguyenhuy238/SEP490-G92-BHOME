// @vitest-environment jsdom
import React, { useEffect } from 'react';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  image: vi.fn(),
  request: vi.fn(),
  json: vi.fn(),
  onState: null as ((state: string) => void) | null,
  success: vi.fn(),
}));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ taskId: 'synthetic-task' }),
  Redirect: () => null,
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
}));
vi.mock('react-native', () => ({
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
  AppState: {
    addEventListener: (_event: string, callback: (state: string) => void) => {
      mocks.onState = callback;
      return { remove: vi.fn() };
    },
  },
}));
type Children = { children?: React.ReactNode };
vi.mock('react-native-paper', () => ({
  ActivityIndicator: () => <span>Đang tải</span>,
  Text: ({ children }: Children) => <span>{children}</span>,
  Button: ({
    children,
    onPress,
    disabled,
  }: Children & { onPress: () => void; disabled?: boolean }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
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
      disabled?: boolean;
    }) => (
      <label>
        <input
          type="checkbox"
          checked={status === 'checked'}
          disabled={disabled}
          onChange={onPress}
        />
        {label}
      </label>
    ),
  },
}));
vi.mock('../../../src/mobile/src/components/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: Children) => <main>{children}</main>,
}));
vi.mock('../../../src/mobile/src/components/WorkspaceKit', () => ({
  Box: ({ children }: Children) => <div>{children}</div>,
  Pill: ({ children }: Children) => <span>{children}</span>,
  Heading: () => null,
  ui: {},
}));
vi.mock('../../../src/mobile/src/screens/MeterRoomOverview', () => ({
  MeterRoomOverview: ({
    tasks,
    onSelect,
  }: {
    tasks: { id: string }[];
    onSelect: (id: string) => void;
  }) => (
    <div>
      {tasks.map((task) => (
        <button key={task.id} onClick={() => onSelect(task.id)}>
          Chọn đồng hồ
        </button>
      ))}
    </div>
  ),
}));
vi.mock('../../../src/mobile/src/lib/toast', async (original) => ({
  ...(await original<typeof import('../../../src/mobile/src/lib/toast')>()),
  showSuccess: mocks.success,
}));
vi.mock('../../../src/mobile/src/components/Controls', () => ({
  Page: ({ children }: Children) => <div>{children}</div>,
  styles: {},
  Field: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <label>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  ),
}));
vi.mock('../../../src/mobile/src/components/CameraCapture', () => ({
  CameraCapture: ({
    onCapture,
    onPhotoCleared,
    disabled,
  }: {
    onCapture: (bytes: Uint8Array) => Promise<void>;
    onPhotoCleared: () => void;
    disabled?: boolean;
  }) => (
    <button
      disabled={disabled}
      onClick={() => {
        onPhotoCleared();
        void onCapture(new Uint8Array([1, 2, 3]));
      }}
    >
      Chụp ảnh thử
    </button>
  ),
}));
vi.mock('../../../src/mobile/src/lib/SessionProvider', () => ({
  useSession: () => ({ api: mocks, session: { roles: ['Staff'] } }),
}));
import MeterScreen from '../../../src/mobile/src/app/meter';

const proposal = {
  proposedFields: { reading: '00123.4' },
  warnings: ['possible_glare'],
  isFallback: false,
};
const confirmLabel = 'Tôi đã đối chiếu ảnh và chỉ số';
const valueLabel = 'Chỉ số xác nhận (kWh)';
const saveLabel = 'Xác nhận chỉ số';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.request.mockResolvedValue({
    id: 'synthetic-task',
    status: 0,
    location: 'Synthetic',
    room: 'P1',
    meterCode: 'E1',
    readingDate: '2026-11-04',
    decimalPlaces: 1,
    previousValue: '100',
    utilityType: 0,
  });
});
afterEach(cleanup);
async function capture() {
  const select = screen.queryByText('Chọn đồng hồ');
  if (select) fireEvent.click(select);
  else if (!screen.queryByText('Chụp ảnh thử'))
    fireEvent.click(await screen.findByText('Chọn đồng hồ'));
  fireEvent.click(await screen.findByText('Chụp ảnh thử'));
  await waitFor(() => expect(mocks.image).toHaveBeenCalled());
}

it('shows OCR progress, warnings, explicit correction and only one pending confirmation', async () => {
  let finishOcr!: (value: unknown) => void;
  mocks.image
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishOcr = resolve;
      }),
    )
    .mockResolvedValueOnce({ id: 'evidence' });
  let finishSave!: (value: unknown) => void;
  mocks.json.mockReturnValue(
    new Promise((resolve) => {
      finishSave = resolve;
    }),
  );
  render(<MeterScreen />);
  await capture();
  expect(screen.getByText('Đang xử lý…')).toBeTruthy();
  await act(async () => finishOcr(proposal));
  await waitFor(() => expect(screen.getByLabelText(valueLabel)).toHaveValue('00123.4'));
  expect(screen.getByText('Kiểm tra lại mặt số và dấu thập phân.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(valueLabel), { target: { value: '123.5' } });
  fireEvent.click(screen.getByLabelText(confirmLabel));
  fireEvent.click(screen.getByText(saveLabel));
  fireEvent.click(screen.getByText(saveLabel));
  await waitFor(() => expect(mocks.json).toHaveBeenCalledTimes(1));
  expect(mocks.json.mock.calls[0][1]).toEqual({
    humanConfirmed: true,
    confirmedValue: '123.5',
    evidenceId: 'evidence',
  });
  await act(async () =>
    finishSave({
      id: 'reading',
      confirmedValue: '123.5',
      previousValue: '100',
      consumption: '23.5',
    }),
  );
  await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Đã lưu chỉ số.'));
  expect(await screen.findByText('Chọn đồng hồ')).toBeTruthy();
});

it('clears the old proposal on retake and keeps manual entry when OCR fails', async () => {
  mocks.image
    .mockResolvedValueOnce(proposal)
    .mockResolvedValueOnce({ id: 'old-evidence' })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ id: 'new-evidence' });
  render(<MeterScreen />);
  await capture();
  await waitFor(() => expect(screen.getByLabelText(valueLabel)).toHaveValue('00123.4'));
  await waitFor(() => expect(screen.getByText('Chụp ảnh thử')).not.toBeDisabled());
  fireEvent.click(screen.getByLabelText(confirmLabel));
  await capture();
  await screen.findByText('Không nhận diện được chỉ số. Hãy thử lại hoặc nhập tay.');
  expect(screen.getByLabelText(valueLabel)).toHaveValue('');
  expect(screen.getByLabelText(confirmLabel)).not.toBeChecked();
  fireEvent.change(screen.getByLabelText(valueLabel), { target: { value: '125' } });
  fireEvent.click(screen.getByLabelText(confirmLabel));
  fireEvent.click(screen.getByText(saveLabel));
  await waitFor(() => expect(mocks.json).toHaveBeenCalledTimes(1));
  expect(mocks.json.mock.calls[0][1].evidenceId).toBe('new-evidence');
});

it('ignores a late OCR response after cancellation and never uploads its evidence', async () => {
  let finish!: (value: unknown) => void;
  mocks.image.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<MeterScreen />);
  await capture();
  fireEvent.click(screen.getByText('Hủy yêu cầu'));
  await act(async () => finish(proposal));
  expect(screen.getByLabelText(valueLabel)).toHaveValue('');
  expect(mocks.image).toHaveBeenCalledTimes(1);
  expect(screen.getByText(saveLabel)).toBeDisabled();
});
