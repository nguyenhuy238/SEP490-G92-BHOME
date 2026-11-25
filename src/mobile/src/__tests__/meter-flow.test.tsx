// @vitest-environment jsdom
import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  role: 'Staff',
  taskId: 'task-a',
  request: vi.fn(),
  image: vi.fn(),
  json: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  hardwareBack: null as (() => boolean) | null,
  platform: 'android' as 'android' | 'web',
}));
const api = { request: state.request, image: state.image, json: state.json };
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api, session: { userId: 'staff-1', roles: [state.role] } }),
}));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ staffLocationId: 'location-a' }),
}));
vi.mock('expo-router', () => ({
  Redirect: () => <span>Đăng nhập</span>,
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  useLocalSearchParams: () => ({ taskId: state.taskId }),
  router: { replace: state.replace, back: state.back, canGoBack: () => true },
}));
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return state.platform;
    },
  },
  View: ({
    children,
    style,
    testID,
  }: {
    children?: React.ReactNode;
    style?: React.CSSProperties;
    testID?: string;
  }) => (
    <div style={style} data-testid={testID}>
      {children}
    </div>
  ),
  Image: ({
    source,
    accessibilityLabel,
  }: {
    source: { uri: string };
    accessibilityLabel: string;
  }) => <img src={source.uri} alt={accessibilityLabel} />,
  StyleSheet: { create: (s: unknown) => s },
  Modal: ({
    children,
    visible,
    onRequestClose,
  }: {
    children: React.ReactNode;
    visible: boolean;
    onRequestClose: () => void;
  }) =>
    visible ? (
      <div
        role="dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onRequestClose();
        }}
      >
        {children}
      </div>
    ) : null,
  KeyboardAvoidingView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  Row: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ui: {},
}));
vi.mock('../theme/theme', () => ({ colors: {} }));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Icon: () => null,
  ProgressBar: () => null,
  ActivityIndicator: () => <span>Đang tải</span>,
  Button: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) => (
    <button disabled={disabled} onClick={onPress} aria-label={accessibilityLabel}>
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
    meterRetryResets,
  }: {
    onCapture: (b: Uint8Array<ArrayBuffer>) => Promise<void>;
    onPhotoCleared: () => void;
    disabled: boolean;
    reviewBeforeSubmit: boolean;
    retainPreview: boolean;
    label: string;
    meterStep: number;
    meterRetryResets?: boolean;
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
                  if (meterStep === 2 && meterRetryResets) {
                    setPhoto(false);
                    onPhotoCleared();
                    return;
                  }
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
import MeterScreen, { MeterTaskScreen } from '../app/meter';
import type { MeterTask } from '../lib/api';
import type { ConfirmedReading } from '../../../../packages/client-core/src/meter';
const electric: MeterTask = {
  id: 'task-a',
  meterId: 'meter-electric',
  locationId: 'location-a',
  roomId: 'room-a',
  location: 'Cơ sở mẫu',
  room: '101',
  meterCode: 'E101',
  utilityType: 0,
  display: 0,
  decimalPlaces: 2,
  purpose: 1,
  billingPeriod: '2026-11-01',
  readingDate: '2026-11-03',
  status: 0,
  previousValue: '100',
};
const water: MeterTask = {
  ...electric,
  id: 'task-water',
  meterId: 'meter-water',
  meterCode: 'W101',
  utilityType: 1,
  previousValue: '10',
};
const proposal = {
  proposedFields: { reading: '120' },
  confidence: 0.94,
  warnings: [],
  isFallback: false,
};
let serverTasks: MeterTask[];
let serverReadings: Record<string, ConfirmedReading>;
beforeEach(() => {
  vi.clearAllMocks();
  state.role = 'Staff';
  state.taskId = 'task-a';
  state.platform = 'android';
  state.hardwareBack = null;
  serverTasks = [{ ...electric }, { ...water }];
  serverReadings = {};
  state.request.mockImplementation(async (path: string) => {
    if (path.includes('/readings/')) return serverReadings[path.split('/').at(-1)!];
    if (path.includes('?roomId=')) return serverTasks;
    const found = serverTasks.find((task) => path.endsWith('/' + task.id));
    if (!found) throw Error('not found');
    return { ...found };
  });
  state.image.mockImplementation(async (path: string) =>
    path.includes('/ocr/')
      ? { ...proposal, proposedFields: { reading: path.includes('task-water') ? '15' : '120' } }
      : { id: path.includes('task-water') ? 'evidence-water' : 'evidence-electric' },
  );
  state.json.mockImplementation(async (path: string, body: { confirmedValue: string }) => {
    const task = serverTasks.find((task) => path.includes('/' + task.id + '/confirm'))!;
    const result: ConfirmedReading = {
      id: task.id + '-reading',
      taskId: task.id,
      confirmedValue: body.confirmedValue,
      previousValue: task.previousValue,
      consumption: '5',
      status: 1,
      confirmedAt: '2026-11-04T01:00:00Z',
    };
    serverReadings[result.id] = result;
    task.confirmedReadingId = result.id;
    task.status = 2;
    return result;
  });
});
afterEach(cleanup);
async function overview() {
  render(<MeterScreen />);
  await screen.findByText('0/2 đồng hồ đã ghi');
}
async function capture(utility: 'điện' | 'nước' = 'điện') {
  fireEvent.click(screen.getByRole('button', { name: `Chụp ảnh đồng hồ ${utility}` }));
  const label = utility === 'điện' ? 'Chụp công tơ điện' : 'Chụp đồng hồ nước';
  fireEvent.click(await screen.findByRole('button', { name: label }));
  expect(state.image).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Dùng ảnh này' }));
  await screen.findByLabelText(`Chỉ số xác nhận (${utility === 'điện' ? 'kWh' : 'm³'})`);
}
function consent() {
  fireEvent.click(screen.getByRole('checkbox'));
}
async function save() {
  consent();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chỉ số' }));
  await screen.findByText('1/2 đồng hồ đã ghi');
}
it('opens a room overview with independent electricity and water actions and no stepper or camera', async () => {
  await overview();
  expect(screen.getByText('Đồng hồ điện')).toBeTruthy();
  expect(screen.getByText('Đồng hồ nước')).toBeTruthy();
  expect(screen.getByText('BHOME Staff')).toBeTruthy();
  expect(screen.queryByText('Chọn tác vụ')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Chụp công tơ điện' })).toBeNull();
  expect(state.image).not.toHaveBeenCalled();
});
it.each(['điện', 'nước'] as const)(
  'allows %s first, confirms only that meter and returns to overview',
  async (utility) => {
    await overview();
    await capture(utility);
    expect(state.json).not.toHaveBeenCalled();
    expect(
      state.image.mock.calls.every((call) =>
        String(call[0]).includes(utility === 'điện' ? 'task-a' : 'task-water'),
      ),
    ).toBe(true);
    await save();
    expect(state.json).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', {
        name: `Chụp ảnh đồng hồ ${utility === 'điện' ? 'nước' : 'điện'}`,
      }),
    ).toBeTruthy();
    expect(screen.queryByAltText('Ảnh công tơ')).toBeNull();
    expect(screen.queryByText('Phòng đã hoàn tất')).toBeNull();
  },
);
it('preserves a confirmed reading across leaving and reopening, then completes the other meter later', async () => {
  await overview();
  await capture();
  await save();
  cleanup();
  render(<MeterScreen />);
  await screen.findByText('1/2 đồng hồ đã ghi');
  expect(screen.getByText('120 kWh')).toBeTruthy();
  state.image.mockClear();
  await capture('nước');
  consent();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chỉ số' }));
  await screen.findByText('2/2 đồng hồ đã ghi');
  expect(screen.getByText('Phòng đã hoàn tất')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Xem chi tiết đồng hồ điện' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Xem chi tiết đồng hồ nước' })).toBeTruthy();
});
it('sends the corrected reading with the selected task evidence and requires fresh consent after editing', async () => {
  await overview();
  await capture();
  consent();
  fireEvent.change(screen.getByLabelText('Chỉ số xác nhận (kWh)'), { target: { value: '121' } });
  expect(
    (screen.getByRole('button', { name: 'Xác nhận chỉ số' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await save();
  expect(state.json).toHaveBeenCalledWith(
    '/api/v1/capture/meter-tasks/task-a/confirm',
    { humanConfirmed: true, confirmedValue: '121', evidenceId: 'evidence-electric' },
    expect.any(AbortSignal),
  );
  expect(screen.getByText('121 kWh')).toBeTruthy();
});
it('clears OCR, evidence and entered value when retaking a photo', async () => {
  await overview();
  await capture();
  fireEvent.click(screen.getByRole('button', { name: 'Chụp lại' }));
  expect(screen.queryByLabelText('Chỉ số xác nhận (kWh)')).toBeNull();
  expect(screen.queryByText(/Chỉ số OCR/)).toBeNull();
  expect(state.json).not.toHaveBeenCalled();
});
it('allows manual correction after OCR failure when evidence was uploaded', async () => {
  state.image.mockImplementation(async (path: string) => {
    if (path.includes('/ocr/')) throw Error('OCR failed');
    return { id: 'evidence-electric' };
  });
  await overview();
  await capture();
  expect(screen.getByText(/Không nhận diện được chỉ số/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Chỉ số xác nhận (kWh)'), { target: { value: '121' } });
  await save();
  expect(screen.getByText('121 kWh')).toBeTruthy();
});
it('shows only the concise OCR failure notice for a fallback proposal', async () => {
  state.image.mockImplementation(async (path: string) =>
    path.includes('/ocr/')
      ? {
          ...proposal,
          isFallback: true,
          proposedFields: { reading: '' },
          warnings: ['ocr_unavailable'],
        }
      : { id: 'evidence-electric' },
  );
  await overview();
  await capture();
  expect(screen.getByText(/Không nhận diện được chỉ số/)).toBeTruthy();
  expect(screen.queryByText(/OCR chưa đọc được/)).toBeNull();
  expect(screen.queryByText(/Hãy kiểm tra đúng phòng, mã đồng hồ/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Chỉ số xác nhận (kWh)'), { target: { value: '121' } });
  await save();
  expect(screen.getByText('121 kWh')).toBeTruthy();
});
it.each(['', '-2', 'abc', '120.123', '99'])(
  'blocks invalid or decreased reading %s',
  async (value) => {
    await overview();
    await capture();
    fireEvent.change(screen.getByLabelText('Chỉ số xác nhận (kWh)'), { target: { value } });
    consent();
    expect(
      (screen.getByRole('button', { name: 'Xác nhận chỉ số' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(state.json).not.toHaveBeenCalled();
  },
);
it('does not allow confirmation when evidence upload fails', async () => {
  state.image.mockImplementation(async (path: string) => {
    if (path.includes('/ocr/')) return proposal;
    throw Error('upload failed');
  });
  await overview();
  await capture();
  consent();
  await waitFor(() => expect(state.image).toHaveBeenCalledTimes(2));
  expect(
    (screen.getByRole('button', { name: 'Xác nhận chỉ số' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(state.json).not.toHaveBeenCalled();
});
it('keeps correction and photo on save failure, locks double taps, and retries the same payload', async () => {
  let reject!: (error: Error) => void;
  state.json.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await overview();
  await capture();
  fireEvent.change(screen.getByLabelText('Chỉ số xác nhận (kWh)'), { target: { value: '122' } });
  consent();
  const confirm = screen.getByRole('button', { name: 'Xác nhận chỉ số' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(state.json).toHaveBeenCalledTimes(1));
  await act(async () => reject(Error('offline')));
  expect((screen.getByLabelText('Chỉ số xác nhận (kWh)') as HTMLInputElement).value).toBe('122');
  expect(screen.getByAltText('Ảnh công tơ')).toBeTruthy();
  fireEvent.click(confirm);
  await screen.findByText('1/2 đồng hồ đã ghi');
  expect(state.json.mock.calls[0]!.slice(0, 2)).toEqual(state.json.mock.calls[1]!.slice(0, 2));
});
it('reconciles a successful server save after its response was lost, without sending a duplicate', async () => {
  const original = state.json.getMockImplementation()!;
  state.json.mockImplementationOnce(async (...args: unknown[]) => {
    await original(...args);
    throw Error('response lost');
  });
  await overview();
  await capture();
  consent();
  const confirm = screen.getByRole('button', { name: 'Xác nhận chỉ số' });
  fireEvent.click(confirm);
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(confirm);
  await screen.findByText('1/2 đồng hồ đã ghi');
  expect(state.json).toHaveBeenCalledTimes(1);
});
it('returns to overview on Android back without capturing or confirming the other meter', async () => {
  await overview();
  await capture();
  act(() => {
    expect(state.hardwareBack?.()).toBe(true);
  });
  await screen.findByText('0/2 đồng hồ đã ghi');
  expect(state.json).not.toHaveBeenCalled();
});
it('does not register an unsupported hardware BackHandler on Web', async () => {
  state.platform = 'web';
  await overview();
  await capture();
  expect(state.hardwareBack).toBeNull();
  expect(state.json).not.toHaveBeenCalled();
});
it('shows persisted completed details as read-only and returns to the same overview', async () => {
  const original = state.request.getMockImplementation()!;
  state.request.mockImplementation(async (...args: unknown[]) =>
    String(args[0]).endsWith('/evidence')
      ? new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
      : original(...args),
  );
  await overview();
  await capture();
  await save();
  fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết đồng hồ điện' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Chỉ số đã xác nhận')).toBeTruthy();
  expect(within(dialog).getByText('120 kWh')).toBeTruthy();
  expect(await within(dialog).findByRole('img', { name: 'Ảnh minh chứng điện' })).toBeTruthy();
  expect(within(dialog).queryByText(/Chỉ số trước:/)).toBeNull();
  expect(within(dialog).queryByRole('button', { name: 'Xác nhận chỉ số' })).toBeNull();
  expect(within(dialog).queryByRole('button', { name: 'Chụp công tơ điện' })).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
  await screen.findByText('1/2 đồng hồ đã ghi');
  expect(state.json).toHaveBeenCalledTimes(1);
});
it.each([
  [electric, '22.0000', '22 kWh', 'Ảnh minh chứng điện'],
  [water, '15.2500', '15,25 m³', 'Ảnh minh chứng nước'],
] as const)(
  'shows the captured evidence for a confirmed embedded utility',
  async (meter, value, display, label) => {
    const readingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    serverTasks = [{ ...meter, status: 2, confirmedReadingId: readingId }];
    serverReadings[readingId] = {
      id: readingId,
      taskId: meter.id,
      confirmedValue: value,
      previousValue: meter.previousValue,
      consumption: null,
      status: 1,
      confirmedAt: '2026-11-04T01:00:00Z',
    };
    const original = state.request.getMockImplementation()!;
    state.request.mockImplementation(async (...args: unknown[]) => {
      if (String(args[0]).endsWith('/evidence'))
        return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      return original(...args);
    });
    render(<MeterTaskScreen embedded taskId={meter.id} onReturn={vi.fn()} />);
    await screen.findByText(`Đã chốt: ${display}`);
    const photo = await screen.findByRole('img', { name: label });
    expect(photo.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(state.request).toHaveBeenCalledWith(
      `/api/v1/capture/readings/${readingId}/evidence`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'bytes',
    );
    expect(state.image).not.toHaveBeenCalled();
    expect(state.json).not.toHaveBeenCalled();
  },
);
it('preserves the confirmed reading on evidence access failure and retries only the photo', async () => {
  const readingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  serverTasks = [{ ...electric, status: 2, confirmedReadingId: readingId }];
  serverReadings[readingId] = {
    id: readingId,
    taskId: electric.id,
    confirmedValue: '22.0000',
    previousValue: null,
    consumption: null,
    status: 1,
    confirmedAt: '2026-11-04T01:00:00Z',
  };
  const original = state.request.getMockImplementation()!;
  const photoRequest = vi
    .fn()
    .mockRejectedValueOnce(Object.assign(Error('forbidden'), { status: 403 }))
    .mockResolvedValueOnce(new Uint8Array([255, 216, 255]));
  state.request.mockImplementation(async (...args: unknown[]) =>
    String(args[0]).endsWith('/evidence') ? photoRequest() : original(...args),
  );
  render(<MeterTaskScreen embedded taskId={electric.id} onReturn={vi.fn()} />);
  await screen.findByText('Đã chốt: 22 kWh');
  const retry = await screen.findByRole('button', { name: 'Thử tải lại ảnh' });
  expect(screen.queryByRole('img', { name: 'Ảnh minh chứng điện' })).toBeNull();
  fireEvent.click(retry);
  const photo = await screen.findByRole('img', { name: 'Ảnh minh chứng điện' });
  expect(photo.getAttribute('src')).toBe('data:image/jpeg;base64,/9j/');
  expect(photoRequest).toHaveBeenCalledTimes(2);
  expect(state.json).not.toHaveBeenCalled();
});
it('does not show a completed room or enable capture when a persisted reading cannot be loaded', async () => {
  const task = serverTasks[0]!;
  task.status = 2;
  task.confirmedReadingId = 'missing';
  const original = state.request.getMockImplementation()!;
  state.request.mockImplementation(async (...args: unknown[]) => {
    if (String(args[0]).includes('/readings/'))
      throw Object.assign(Error('forbidden'), { status: 403 });
    return original(...args);
  });
  render(<MeterScreen />);
  await screen.findByRole('button', { name: 'Thử tải lại đồng hồ' });
  expect(screen.queryByText('Phòng đã hoàn tất')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Chụp ảnh đồng hồ nước' })).toBeNull();
});
it('collects all room task pages so a later-page utility is not omitted', async () => {
  const original = state.request.getMockImplementation()!;
  state.request.mockImplementation(async (path: string) => {
    if (path.includes('?roomId=') && path.includes('page=1'))
      return Array.from({ length: 100 }, () => electric);
    if (path.includes('?roomId=') && path.includes('page=2')) return [water];
    return original(path);
  });
  await overview();
  expect(state.request.mock.calls.some((call) => String(call[0]).includes('page=2'))).toBe(true);
});
it('does not invent a missing water task or block an electricity-only room', async () => {
  serverTasks = [{ ...electric }];
  render(<MeterScreen />);
  await screen.findByText('0/1 đồng hồ đã ghi');
  expect(screen.getByText('Chưa có tác vụ ghi chỉ số.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Chụp ảnh đồng hồ nước' })).toBeNull();
});
it('never exposes an inaccessible room task or opens its camera', async () => {
  state.request.mockRejectedValue(Object.assign(Error('forbidden'), { status: 403 }));
  render(<MeterScreen />);
  await screen.findByRole('button', { name: 'Thử tải lại đồng hồ' });
  expect(state.image).not.toHaveBeenCalled();
  expect(screen.queryByText('Đồng hồ điện')).toBeNull();
});
it('shows initial baseline reading without calculating monthly consumption', async () => {
  serverTasks = [
    { ...electric, purpose: 0, billingPeriod: null, previousValue: null },
    { ...water, purpose: 0, billingPeriod: null, previousValue: null },
  ];
  await overview();
  expect(screen.getAllByText(/Mốc chỉ số ban đầu/)).toHaveLength(2);
  await capture();
  expect(screen.getByText(/Loại ghi: Chỉ số ban đầu/)).toBeTruthy();
  expect(screen.queryByText(/Tiêu thụ dự kiến/)).toBeNull();
  await save();
  fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết đồng hồ điện' }));
  await screen.findByText('Đã lưu chỉ số');
  expect(screen.getByText('Đã lưu chỉ số ban đầu')).toBeTruthy();
  expect(screen.getByText('Tiêu thụ: Chỉ số ban đầu')).toBeTruthy();
  expect(screen.queryByText(/Đã gửi hóa đơn cho Tenant/)).toBeNull();
  expect(screen.queryByText(/Đã tạo mã QR/)).toBeNull();
  expect(screen.queryByText(/Tenant đã nhận thông báo/)).toBeNull();
});
it('does not fetch Staff meter data for a Tenant', async () => {
  state.role = 'Tenant';
  render(<MeterScreen />);
  await screen.findByText(/Chỉ Staff/);
  expect(state.request).not.toHaveBeenCalled();
});

it('shows only loading above the periodic meter modal until OCR finishes', async () => {
  let finishOcr!: (value: typeof proposal) => void;
  state.image.mockImplementationOnce(
    () =>
      new Promise<typeof proposal>((resolve) => {
        finishOcr = resolve;
      }),
  );
  await overview();
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh đồng hồ điện' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Chụp công tơ điện' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dùng ảnh này' }));
  const overlay = await screen.findByTestId('periodic-meter-processing-overlay');
  const card = screen.getByTestId('periodic-meter-modal-card');
  expect(card.contains(overlay)).toBe(false);
  expect(within(card).queryByText('Đang xử lý…')).toBeNull();
  expect(within(overlay).getByText('Đang xử lý…')).toBeTruthy();
  expect(within(overlay).queryByRole('button')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hủy yêu cầu' })).toBeNull();
  await act(async () => finishOcr(proposal));
  await waitFor(() => expect(screen.queryByTestId('periodic-meter-processing-overlay')).toBeNull());
  expect(screen.getByTestId('periodic-meter-modal-card')).toBeTruthy();
});

it('returns to the capture choice when retrying periodic OCR, clearing the old photo and confirmation', async () => {
  await overview();
  await capture();
  fireEvent.change(screen.getByLabelText('Chỉ số xác nhận (kWh)'), { target: { value: '125' } });
  consent();
  const previousCalls = state.image.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại OCR' }));
  expect(screen.getByRole('button', { name: 'Chụp công tơ điện' })).toBeTruthy();
  expect(screen.queryByAltText('Ảnh công tơ')).toBeNull();
  expect(screen.queryByLabelText('Chỉ số xác nhận (kWh)')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByTestId('periodic-meter-processing-overlay')).toBeNull();
  expect(state.image).toHaveBeenCalledTimes(previousCalls);
  expect(state.json).not.toHaveBeenCalled();
  expect(screen.getByTestId('periodic-meter-modal-card')).toBeTruthy();
});
