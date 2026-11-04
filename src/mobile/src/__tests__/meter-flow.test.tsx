// @vitest-environment jsdom
import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  role: 'Staff',
  request: vi.fn(),
  image: vi.fn(),
  json: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  hardwareBack: null as (() => boolean) | null,
}));
const api = { request: state.request, image: state.image, json: state.json };
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api, session: { roles: [state.role] } }),
}));
vi.mock('expo-router', () => ({
  Redirect: () => <span>Đăng nhập</span>,
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  useLocalSearchParams: () => ({ taskId: 'task-a' }),
  router: { replace: state.replace, back: state.back, canGoBack: () => true },
}));
vi.mock('react-native', () => ({
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: (s: unknown) => s },
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
  BackHandler: {
    addEventListener: (_: string, callback: () => boolean) => {
      state.hardwareBack = callback;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock('../components/WorkspaceShell', () => ({
  WorkspaceShell: ({
    children,
    onBack,
    backDisabled,
    screen: name,
  }: {
    children: React.ReactNode;
    onBack: () => void;
    backDisabled: boolean;
    screen: string;
  }) => (
    <main data-screen={name}>
      <header>BHOME Staff</header>
      <button disabled={backDisabled} onClick={onBack} aria-label="Quay lại bước">
        Quay lại
      </button>
      {children}
      <nav>Công việc · Thông báo · Cá nhân</nav>
    </main>
  ),
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/Controls', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  styles: {},
  Field: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <label>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  ),
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  ui: {},
}));
vi.mock('../theme/theme', () => ({ colors: {} }));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  ActivityIndicator: () => <span>Đang tải</span>,
  Button: ({
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
vi.mock('../components/CameraCapture', () => ({
  CameraCapture: ({
    onCapture,
    onPhotoCleared,
    disabled,
    reviewBeforeSubmit,
    retainPreview,
    label,
    meterStep,
  }: {
    onCapture: (b: Uint8Array<ArrayBuffer>) => Promise<void>;
    onPhotoCleared: () => void;
    disabled: boolean;
    reviewBeforeSubmit: boolean;
    retainPreview: boolean;
    label: string;
    meterStep: number;
  }) => {
    const [photo, setPhoto] = useState(false);
    return (
      <>
        <button
          disabled={disabled}
          onClick={() => {
            onPhotoCleared();
            setPhoto(true);
            if (!reviewBeforeSubmit) void onCapture(new Uint8Array([1]));
          }}
        >
          {label}
        </button>
        {photo && (
          <>
            <img alt="Ảnh công tơ" />
            {meterStep < 3 && (
              <button
                disabled={disabled}
                onClick={() => {
                  void onCapture(new Uint8Array([1]));
                  if (!retainPreview) setPhoto(false);
                }}
              >
                {meterStep === 1 ? 'Dùng ảnh này' : 'Thử lại OCR'}
              </button>
            )}
            <button
              disabled={disabled}
              onClick={() => {
                setPhoto(false);
                onPhotoCleared();
              }}
            >
              Chụp lại
            </button>
          </>
        )}
      </>
    );
  },
}));
import MeterScreen from '../app/meter';
const task = {
  id: 'task-a',
  location: 'Cơ sở mẫu',
  room: '101',
  meterCode: 'E101',
  utilityType: 0,
  decimalPlaces: 2,
  purpose: 1,
  billingPeriod: '2026-11-01',
  readingDate: '2026-11-03',
  status: 0,
  previousValue: '100',
};
const proposal = {
  proposedFields: { reading: '120' },
  confidence: 0.94,
  warnings: [],
  isFallback: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  state.role = 'Staff';
  state.request.mockResolvedValue(task);
  state.image.mockImplementation(async (path: string) =>
    path.includes('/ocr/') ? proposal : { id: 'evidence-a' },
  );
  state.json.mockResolvedValue({
    id: 'reading-a',
    taskId: 'task-a',
    confirmedValue: '121',
    previousValue: '100',
    consumption: '21',
    status: 1,
    confirmedAt: '2026-11-03T01:00:00Z',
  });
});
afterEach(cleanup);
async function recognize() {
  render(<MeterScreen />);
  await screen.findByText('Điện · Phòng 101');
  fireEvent.click(screen.getByRole('button', { name: 'Chụp công tơ điện' }));
  expect(state.image).not.toHaveBeenCalled();
  expect(state.json).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Dùng ảnh này' }));
  await screen.findByLabelText('Chỉ số xác nhận (kWh)');
}
function review() {
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  fireEvent.click(screen.getByRole('checkbox'));
}
it('previews before OCR, permits correction and only saves on explicit confirmation', async () => {
  await recognize();
  expect(screen.getByAltText('Ảnh công tơ')).toBeTruthy();
  expect(screen.getByText('Độ tin cậy OCR: 94%')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Chỉ số xác nhận (kWh)'), { target: { value: '121' } });
  expect(screen.getByText('Tiêu thụ dự kiến: 21 kWh')).toBeTruthy();
  expect(state.json).not.toHaveBeenCalled();
  review();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận & lưu' }));
  await screen.findByText('Đã lưu chỉ số');
  expect(state.json).toHaveBeenCalledWith(
    '/api/v1/capture/meter-tasks/task-a/confirm',
    { humanConfirmed: true, confirmedValue: '121', evidenceId: 'evidence-a' },
    expect.any(AbortSignal),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Chọn tác vụ tiếp theo' }));
  expect(state.back).toHaveBeenCalled();
});
it('clears proposal, evidence and typed value when retaking', async () => {
  await recognize();
  fireEvent.click(screen.getByRole('button', { name: 'Chụp lại' }));
  expect(screen.queryByLabelText('Chỉ số xác nhận (kWh)')).toBeNull();
  expect(screen.queryByText(/Chỉ số OCR/)).toBeNull();
  expect(state.json).not.toHaveBeenCalled();
});
it('allows manual correction with evidence when OCR fails', async () => {
  state.image.mockImplementation(async (path: string) => {
    if (path.includes('/ocr/')) throw Error('offline');
    return { id: 'evidence-a' };
  });
  await recognize();
  expect(screen.getByText(/Không nhận diện được chỉ số/)).toBeTruthy();
  expect(screen.getByLabelText('Chỉ số xác nhận (kWh)').getAttribute('value')).toBe('');
  fireEvent.change(screen.getByLabelText('Chỉ số xác nhận (kWh)'), { target: { value: '121' } });
  review();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận & lưu' }));
  await screen.findByText('Đã lưu chỉ số');
});
it.each(['', '-2', 'abc', '120.123', '99'])(
  'prevents confirmation of invalid reading %s',
  async (value) => {
    await recognize();
    fireEvent.change(screen.getByLabelText('Chỉ số xác nhận (kWh)'), { target: { value } });
    expect((screen.getByRole('button', { name: 'Tiếp tục' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(state.json).not.toHaveBeenCalled();
  },
);
it('keeps edited value and evidence on save failure, locks double taps and retries same payload', async () => {
  let reject!: (e: Error) => void;
  state.json.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await recognize();
  review();
  const save = screen.getByRole('button', { name: 'Xác nhận & lưu' });
  fireEvent.click(save);
  fireEvent.click(save);
  expect(state.json).toHaveBeenCalledTimes(1);
  await act(async () => reject(Error('offline')));
  expect(screen.queryByText('Đã lưu chỉ số')).toBeNull();
  expect(screen.getByText('Chỉ số xác nhận: 120 kWh')).toBeTruthy();
  expect(screen.getByAltText('Ảnh công tơ')).toBeTruthy();
  fireEvent.click(save);
  await screen.findByText('Đã lưu chỉ số');
  expect(state.json.mock.calls[0].slice(0, 2)).toEqual(state.json.mock.calls[1].slice(0, 2));
});
it('keeps reading when returning to review and clears consent after editing', async () => {
  await recognize();
  review();
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại bước' }));
  expect(screen.getByLabelText('Chỉ số xác nhận (kWh)').getAttribute('value')).toBe('120');
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  expect(
    (screen.getByRole('button', { name: 'Xác nhận & lưu' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it('never exposes a failed scoped task or opens capture', async () => {
  state.request.mockRejectedValue(Object.assign(Error('forbidden'), { status: 403 }));
  render(<MeterScreen />);
  await screen.findByRole('button', { name: 'Thử tải lại tác vụ' });
  expect(screen.queryByRole('button', { name: 'Chụp công tơ điện' })).toBeNull();
  expect(state.image).not.toHaveBeenCalled();
});
it('does not fetch a Staff task for a Tenant', async () => {
  state.role = 'Tenant';
  render(<MeterScreen />);
  await waitFor(() => expect(screen.getByText(/Chỉ Staff/)).toBeTruthy());
  expect(state.request).not.toHaveBeenCalled();
});
it.each([
  [0, 'Điện', 'kWh', 'Chụp công tơ điện'],
  [1, 'Nước', 'm³', 'Chụp đồng hồ nước'],
] as const)(
  'keeps the Staff shell and the correct %s labels throughout OCR and confirmation',
  async (utilityType, label, unit, captureLabel) => {
    state.request.mockResolvedValue({ ...task, utilityType });
    render(<MeterScreen />);
    await screen.findByText(`${label} · Phòng 101`);
    const shell = screen.getByRole('main');
    expect(screen.getByText('BHOME Staff')).toBeTruthy();
    expect(screen.getAllByText('Ghi chỉ số điện nước')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: captureLabel }));
    expect(state.image).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dùng ảnh này' }));
    await waitFor(() =>
      expect((screen.getByLabelText(`Chỉ số xác nhận (${unit})`) as HTMLInputElement).value).toBe(
        '120',
      ),
    );
    expect(screen.getByText(`Chỉ số OCR: 120 ${unit}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    expect(screen.getByText(`Chỉ số xác nhận: 120 ${unit}`)).toBeTruthy();
    expect(screen.getByText(`Tiêu thụ dự kiến: 20 ${unit}`)).toBeTruthy();
    expect(screen.getByRole('main')).toBe(shell);
    expect(screen.getByText('BHOME Staff')).toBeTruthy();
    expect(state.json).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận & lưu' }));
    await screen.findByText('Đã lưu chỉ số');
    expect(screen.getByText(`121 ${unit}`)).toBeTruthy();
  },
);
it('preserves a correction through Android back and forward without rerunning OCR', async () => {
  await recognize();
  fireEvent.change(screen.getByLabelText('Chỉ số xác nhận (kWh)'), { target: { value: '122' } });
  const requests = state.image.mock.calls.length;
  act(() => {
    expect(state.hardwareBack?.()).toBe(true);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Dùng ảnh này' }));
  await screen.findByLabelText('Chỉ số xác nhận (kWh)');
  expect((screen.getByLabelText('Chỉ số xác nhận (kWh)') as HTMLInputElement).value).toBe('122');
  expect(state.image).toHaveBeenCalledTimes(requests);
});
it('keeps confirmation disabled if the evidence upload fails', async () => {
  state.image.mockImplementation(async (path: string) => {
    if (path.includes('/ocr/')) return proposal;
    throw Error('offline');
  });
  await recognize();
  await waitFor(() => expect(state.image).toHaveBeenCalledTimes(2));
  expect((screen.getByRole('button', { name: 'Tiếp tục' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(state.json).not.toHaveBeenCalled();
  expect(screen.getByAltText('Ảnh công tơ')).toBeTruthy();
});
