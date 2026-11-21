// @vitest-environment jsdom
import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CameraViewProps } from 'expo-camera';
import type { CameraFocusEvent } from '../lib/cameraFocus';

type NativeCameraProps = CameraViewProps & {
  bhomeFocusEnabled?: boolean;
  onBhomeFocusChanged?: (event: { nativeEvent: CameraFocusEvent }) => void;
};

const native = vi.hoisted(() => ({
  granted: true,
  request: vi.fn(),
  take: vi.fn(),
  release: vi.fn(),
  render: vi.fn(),
  save: vi.fn(),
  resized: vi.fn(),
  files: new Set<string>(),
  bytes: new Uint8Array([1, 2, 3]),
  listeners: new Set<(state: string) => void>(),
  platform: 'android',
  autoReady: true,
  mounts: 0,
  props: {} as NativeCameraProps,
  focusExtension: false,
  lenses: vi.fn(),
  allowMeterDemo: false,
}));
vi.mock('../lib/cameraFocus', async (original) => ({
  ...(await original<typeof import('../lib/cameraFocus')>()),
  supportsNativeCameraFocus: () => native.focusExtension,
}));
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
}));
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return native.platform;
    },
  },
  AppState: {
    addEventListener: (_: string, cb: (s: string) => void) => {
      native.listeners.add(cb);
      return { remove: () => native.listeners.delete(cb) };
    },
  },
  StyleSheet: { create: (s: unknown) => s },
  Modal: ({
    visible,
    children,
    onRequestClose,
  }: {
    visible: boolean;
    children: React.ReactNode;
    onRequestClose: () => void;
  }) =>
    visible ? (
      <div role="dialog">
        <button aria-label="Android back" onClick={onRequestClose} />
        {children}
      </div>
    ) : null,
  View: ({
    children,
    accessibilityLabel,
    style,
  }: {
    children?: React.ReactNode;
    accessibilityLabel?: string;
    style?: unknown;
  }) => (
    <div aria-label={accessibilityLabel} data-style={JSON.stringify(style)}>
      {children}
    </div>
  ),
  Image: ({
    accessibilityLabel,
    source,
    resizeMode,
  }: {
    accessibilityLabel: string;
    source: { uri: string };
    resizeMode: string;
  }) => <img alt={accessibilityLabel} src={source.uri} data-resize={resizeMode} />,
}));
vi.mock('react-native-paper', () => {
  const Button = ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) => (
    <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  );
  return {
    MD3LightTheme: { colors: {} },
    configureFonts: () => ({}),
    Button,
    TouchableRipple: Button,
    IconButton: Button,
    Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    ActivityIndicator: () => <span>Loading</span>,
    Icon: () => null,
  };
});
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/Controls', () => ({ styles: {} }));
vi.mock('../lib/captureFiles', () => ({ ownCapture: (uri: string) => uri }));
vi.mock('../lib/meterDemoCapture', () => ({
  canUseLocalMeterDemo: () => native.allowMeterDemo,
  createMeterDemoJpeg: () => 'data:image/jpeg;base64,/9j/AAECAw==',
  meterDemoJpegBytes: () => new Uint8Array([0xff, 0xd8, 0xff, 0, 1, 2, 3]),
}));
vi.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: native.granted }, native.request],
  CameraView: forwardRef(function Camera(props: CameraViewProps, ref) {
    native.props = props;
    const { onCameraReady } = props;
    useImperativeHandle(
      ref,
      () => ({ takePictureAsync: native.take, getAvailableLensesAsync: native.lenses }),
      [],
    );
    useEffect(() => {
      native.mounts++;
      if (native.autoReady) onCameraReady?.();
    }, [onCameraReady]);
    return <div data-testid="native-camera" />;
  }),
}));
vi.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'cache://' } },
  File: class {
    constructor(public uri: string) {}
    get exists() {
      return native.files.has(this.uri);
    }
    get size() {
      return 100;
    }
    delete() {
      native.files.delete(this.uri);
    }
    async bytes() {
      return native.bytes;
    }
  },
}));
vi.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      resize: native.resized,
      reset: vi.fn(),
      renderAsync: native.render,
      release: native.release,
    }),
  },
}));
import { CameraCapture } from '../components/CameraCapture';

beforeEach(() => {
  vi.clearAllMocks();
  native.granted = true;
  native.focusExtension = false;
  native.platform = 'android';
  native.autoReady = true;
  native.allowMeterDemo = false;
  native.mounts = 0;
  native.lenses.mockResolvedValue([]);
  native.files.clear();
  native.listeners.clear();
  native.bytes = new Uint8Array([1, 2, 3]);
  native.request.mockResolvedValue({ granted: false });
  native.take.mockResolvedValue({ width: 2000, height: 1200, release: native.release });
  native.render.mockResolvedValue({ saveAsync: native.save, release: native.release });
  native.save.mockImplementation(async () => {
    const uri = 'cache://temporary.jpg';
    native.files.add(uri);
    return { uri };
  });
});
afterEach(cleanup);
it('opens only the selected meter camera automatically and still waits for photo review before upload', async () => {
  const capture = vi.fn();
  render(
    <CameraCapture
      label="Chụp đồng hồ nước"
      disabled={false}
      presentation="meter"
      autoOpen
      retainPreview
      reviewBeforeSubmit
      onCapture={capture}
    />,
  );
  await screen.findByTestId('native-camera');
  expect(native.take).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled();
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Chụp ảnh' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh' }));
  await screen.findByAltText('Ảnh công tơ đã chụp');
  expect(capture).not.toHaveBeenCalled();
});
it('handles denied permission when opening the selected meter camera automatically', async () => {
  native.granted = false;
  const capture = vi.fn();
  render(
    <CameraCapture
      label="Chụp công tơ điện"
      disabled={false}
      presentation="meter"
      autoOpen
      retainPreview
      reviewBeforeSubmit
      onCapture={capture}
    />,
  );
  await screen.findByText(/Cần cấp quyền camera/);
  expect(native.take).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled();
});
it('uses a synthetic JPEG without camera permission only in local web meter testing', async () => {
  native.platform = 'web';
  native.granted = false;
  native.allowMeterDemo = true;
  const captured: number[][] = [];
  const capture = vi.fn(async (bytes: Uint8Array) => {
    captured.push([...bytes]);
  });
  const view = render(
    <CameraCapture
      label="Chụp công tơ điện"
      disabled={false}
      presentation="meter"
      autoOpen
      retainPreview
      reviewBeforeSubmit
      onCapture={capture}
    />,
  );
  const demo = screen.getByRole('button', { name: 'Dùng ảnh mẫu để test' });
  expect(demo).toBeTruthy();
  fireEvent.click(demo);
  await waitFor(() => expect(capture).toHaveBeenCalledOnce());
  expect(captured).toEqual([[0xff, 0xd8, 0xff, 0, 1, 2, 3]]);
  expect(native.take).not.toHaveBeenCalled();
  expect(screen.getByAltText('Ảnh công tơ đã chụp')).toBeTruthy();
  view.rerender(
    <CameraCapture
      label="Chụp công tơ điện"
      disabled={false}
      presentation="meter"
      meterStep={2}
      retainPreview
      reviewBeforeSubmit
      onCapture={capture}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại OCR' }));
  await waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
  expect(captured[1]).toEqual(captured[0]);
  expect(native.files.size).toBe(0);
});
it('hides local meter demo on ordinary mobile capture and disables it while busy', async () => {
  native.allowMeterDemo = false;
  native.platform = 'android';
  const view = render(
    <CameraCapture
      label="Chụp công tơ"
      disabled={false}
      presentation="meter"
      onCapture={vi.fn()}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Dùng ảnh mẫu để test' })).toBeNull();
  native.allowMeterDemo = true;
  view.rerender(
    <CameraCapture label="Chụp công tơ" disabled presentation="meter" onCapture={vi.fn()} />,
  );
  expect(screen.getByRole('button', { name: 'Dùng ảnh mẫu để test' })).toHaveProperty(
    'disabled',
    true,
  );
});
it('shares camera controls with meters and keeps a compact preview during review', async () => {
  const capture = vi.fn().mockResolvedValue(undefined);
  const clear = vi.fn();
  const props = {
    label: 'Chụp đồng hồ nước',
    disabled: false,
    retainPreview: true,
    reviewBeforeSubmit: true,
    onCapture: capture,
    onPhotoCleared: clear,
    presentation: 'meter' as const,
  };
  const view = render(<CameraCapture {...props} meterStep={1} />);
  fireEvent.click(screen.getByRole('button', { name: 'Chụp đồng hồ nước' }));
  await screen.findByTestId('native-camera');
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
    'Thu bớt',
    'Phóng thêm',
    'Chụp ảnh',
    'Đóng camera',
  ]);
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Chụp ảnh' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh' }));
  const image = await screen.findByAltText('Ảnh công tơ đã chụp');
  expect(image.getAttribute('data-resize')).toBe('contain');
  expect(capture).not.toHaveBeenCalled();
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
    'Dùng ảnh này',
    'Chụp lại',
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Dùng ảnh này' }));
  await waitFor(() => expect(capture).toHaveBeenCalledOnce());
  view.rerender(<CameraCapture {...props} meterStep={2} />);
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Thử lại OCR' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(screen.getAllByRole('button')).toHaveLength(1);
  view.rerender(<CameraCapture {...props} meterStep={3} />);
  expect(screen.getByAltText('Ảnh công tơ đã chụp')).toBeTruthy();
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(native.files.size).toBe(1);
  view.unmount();
  expect(native.files.size).toBe(0);
});
it('retains a meter preview after OCR, clears it on retake and never submits on capture', async () => {
  const capture = vi.fn().mockResolvedValue(undefined);
  const clear = vi.fn();
  render(
    <CameraCapture
      label="Chụp công tơ"
      disabled={false}
      retainPreview
      reviewBeforeSubmit
      reviewActionLabel="Nhận diện chỉ số"
      onCapture={capture}
      onPhotoCleared={clear}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Chụp công tơ' }));
  await screen.findByTestId('native-camera');
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Chụp ảnh' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh' }));
  await screen.findByAltText('Ảnh vừa chụp');
  expect(capture).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Nhận diện chỉ số' }));
  await waitFor(() => expect(capture).toHaveBeenCalledOnce());
  await waitFor(() => expect([...native.bytes]).toEqual([0, 0, 0]));
  expect(native.files.size).toBe(1);
  expect(screen.getByAltText('Ảnh vừa chụp')).toBeTruthy();
  const calls = clear.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Chụp lại' }));
  expect(clear.mock.calls.length).toBeGreaterThan(calls);
  expect(native.files.size).toBe(0);
  expect(screen.queryByAltText('Ảnh vừa chụp')).toBeNull();
});
it('handles denied meter camera permission without capturing or uploading', async () => {
  native.granted = false;
  const capture = vi.fn();
  render(
    <CameraCapture
      label="Chụp công tơ"
      disabled={false}
      retainPreview
      reviewBeforeSubmit
      onCapture={capture}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Chụp công tơ' }));
  await screen.findByText(/Cần cấp quyền camera/);
  expect(screen.queryByTestId('native-camera')).toBeNull();
  expect(native.take).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled();
});
async function takePhoto() {
  await screen.findByTestId('native-camera');
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Chụp ảnh mặt trước' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh mặt trước' }));
  await screen.findByAltText('Ảnh CCCD vừa chụp');
}
it('unmounts the camera for an undistorted preview and deletes a rejected image on retake', async () => {
  const capture = vi.fn();
  render(
    <CameraCapture
      label="CCCD"
      disabled={false}
      presentation="document"
      reviewBeforeSubmit
      onCapture={capture}
    />,
  );
  await takePhoto();
  expect(screen.queryByTestId('native-camera')).toBeNull();
  expect(screen.getByAltText('Ảnh CCCD vừa chụp').getAttribute('data-resize')).toBe('contain');
  expect(capture).not.toHaveBeenCalled();
  expect(native.files.size).toBe(1);
  expect(native.resized).not.toHaveBeenCalled();
  expect(native.save).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.95 });
  expect(native.release).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByRole('button', { name: 'Chụp lại' }));
  await screen.findByTestId('native-camera');
  expect(native.files.size).toBe(0);
  expect(screen.queryByAltText('Ảnh CCCD vừa chụp')).toBeNull();
});
it('submits only once while OCR is pending, then zeroes bytes and removes the temporary file', async () => {
  let finish!: () => void;
  const capture = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <CameraCapture
      label="CCCD"
      disabled={false}
      presentation="document"
      reviewBeforeSubmit
      onCapture={capture}
    />,
  );
  await takePhoto();
  const use = screen.getByRole('button', { name: 'Sử dụng ảnh' });
  fireEvent.click(use);
  fireEvent.click(use);
  await waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
  expect(screen.getByText('Đang nhận diện thông tin CCCD...')).toBeTruthy();
  expect(screen.queryByTestId('native-camera')).toBeNull();
  await act(async () => finish());
  expect(native.files.size).toBe(0);
  expect([...native.bytes]).toEqual([0, 0, 0]);
});
it('keeps manual input available when camera permission is refused', async () => {
  native.granted = false;
  const manual = vi.fn();
  render(
    <CameraCapture
      label="CCCD"
      disabled={false}
      presentation="document"
      reviewBeforeSubmit
      onCapture={vi.fn()}
      onManual={manual}
    />,
  );
  await screen.findByText(/Cần cấp quyền camera/);
  expect(screen.queryByTestId('native-camera')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Nhập thủ công' }));
  expect(manual).toHaveBeenCalledOnce();
});
it('uses the same capture pipeline for the back side and reports a real preview', async () => {
  const captured = vi.fn();
  render(
    <CameraCapture
      label="CCCD"
      documentSide="back"
      disabled={false}
      presentation="document"
      reviewBeforeSubmit
      onCapture={vi.fn()}
      onPhotoCaptured={captured}
    />,
  );
  await screen.findByTestId('native-camera');
  const shutter = screen.getByRole('button', { name: 'Chụp ảnh mặt sau' });
  await waitFor(() => expect((shutter as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByText('Đảm bảo phần Ngày cấp rõ nét và đủ sáng')).toBeTruthy();
  expect(captured).not.toHaveBeenCalled();
  fireEvent.click(shutter);
  await screen.findByAltText('Ảnh CCCD vừa chụp');
  expect(captured).toHaveBeenCalledOnce();
});
it('releases an unused preview on close and releases its AppState subscription', async () => {
  const { unmount } = render(
    <CameraCapture
      label="CCCD"
      disabled={false}
      presentation="document"
      reviewBeforeSubmit
      onCapture={vi.fn()}
    />,
  );
  await takePhoto();
  unmount();
  expect(native.files.size).toBe(0);
  expect(native.listeners.size).toBe(0);
});
it('discards a capture that completes after the app goes to background', async () => {
  let finish!: (picture: unknown) => void;
  native.take.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const capture = vi.fn();
  render(
    <CameraCapture
      label="CCCD"
      disabled={false}
      presentation="document"
      reviewBeforeSubmit
      onCapture={capture}
    />,
  );
  await screen.findByTestId('native-camera');
  const shutter = screen.getByRole('button', { name: 'Chụp ảnh mặt trước' });
  await waitFor(() => expect((shutter as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(shutter);
  await waitFor(() => expect(native.take).toHaveBeenCalledOnce());
  act(() => native.listeners.forEach((cb) => cb('background')));
  await act(async () => finish({ width: 2000, height: 1200, release: native.release }));
  expect(native.files.size).toBe(0);
  expect(screen.queryByTestId('native-camera')).toBeNull();
  expect(screen.queryByAltText('Ảnh CCCD vừa chụp')).toBeNull();
  expect(capture).not.toHaveBeenCalled();
});

async function evidencePhoto() {
  fireEvent.click(screen.getByRole('button', { name: 'Thêm ảnh minh chứng' }));
  await screen.findByTestId('native-camera');
  const shutter = screen.getByRole('button', { name: 'Chụp ảnh minh chứng' });
  await waitFor(() => expect((shutter as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(shutter);
  await screen.findByAltText('Ảnh minh chứng vừa chụp');
}
it('opens evidence in an opaque modal, unmounts live camera for review, retakes and uploads bytes', async () => {
  const upload = vi.fn().mockResolvedValue(true);
  render(
    <CameraCapture
      presentation="evidence"
      label="Thêm ảnh minh chứng"
      disabled={false}
      reviewBeforeSubmit
      onCapture={upload}
    />,
  );
  expect(screen.queryByTestId('native-camera')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  await evidencePhoto();
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.queryByTestId('native-camera')).toBeNull();
  expect(screen.getByAltText('Ảnh minh chứng vừa chụp').getAttribute('data-resize')).toBe(
    'contain',
  );
  expect(upload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Chụp lại' }));
  expect(native.files.size).toBe(0);
  await screen.findByTestId('native-camera');
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Chụp ảnh minh chứng' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh minh chứng' }));
  await screen.findByAltText('Ảnh minh chứng vừa chụp');
  fireEvent.click(screen.getByRole('button', { name: 'Dùng ảnh' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(upload).toHaveBeenCalledOnce();
  expect(upload.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
  expect(native.files.size).toBe(0);
});
it('preserves evidence preview after upload failure, blocks duplicate submission and retries', async () => {
  let finish!: (ok: boolean) => void;
  const upload = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(true);
  const view = render(
    <CameraCapture
      presentation="evidence"
      label="Thêm ảnh minh chứng"
      disabled={false}
      reviewBeforeSubmit
      onCapture={upload}
    />,
  );
  await evidencePhoto();
  fireEvent.click(screen.getByRole('button', { name: 'Dùng ảnh' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dùng ảnh' }));
  await waitFor(() => expect(upload).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Android back' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  await act(async () => finish(false));
  expect(screen.getByAltText('Ảnh minh chứng vừa chụp')).toBeTruthy();
  expect(native.files.size).toBe(1);
  view.rerender(
    <CameraCapture
      presentation="evidence"
      label="Thêm ảnh minh chứng"
      disabled={false}
      retryOnly
      uploadError="Kết nối gián đoạn. Hãy thử lại."
      reviewBeforeSubmit
      onCapture={upload}
    />,
  );
  expect((screen.getByRole('button', { name: 'Chụp lại' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(upload).toHaveBeenCalledTimes(2);
});
it('handles denied evidence permission without manual OCR controls and closes on Android back', async () => {
  native.granted = false;
  render(
    <CameraCapture
      presentation="evidence"
      label="Thêm ảnh minh chứng"
      disabled={false}
      reviewBeforeSubmit
      onCapture={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Thêm ảnh minh chứng' }));
  await screen.findByText(/Cần cấp quyền camera/);
  expect(screen.queryByTestId('native-camera')).toBeNull();
  expect(screen.queryByText(/Nhập thủ công/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Android back' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('cleans an evidence preview on Android back and background', async () => {
  render(
    <CameraCapture
      presentation="evidence"
      label="Thêm ảnh minh chứng"
      disabled={false}
      reviewBeforeSubmit
      onCapture={vi.fn()}
    />,
  );
  await evidencePhoto();
  fireEvent.click(screen.getByRole('button', { name: 'Android back' }));
  expect(native.files.size).toBe(0);
  await evidencePhoto();
  act(() => native.listeners.forEach((cb) => cb('background')));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByTestId('native-camera')).toBeNull();
  expect(native.files.size).toBe(0);
});

async function readyShutter(name = 'Chụp ảnh mặt trước') {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).toHaveProperty('disabled', false));
  return button;
}
it.each(['document', 'meter', 'inline'] as const)(
  'shares continuous AF, zero zoom and readiness gating with %s',
  async (presentation) => {
    native.autoReady = false;
    render(
      <CameraCapture
        label="Mở thử OCR"
        presentation={presentation}
        autoOpen
        disabled={false}
        onCapture={vi.fn()}
      />,
    );
    if (presentation === 'inline')
      fireEvent.click(screen.getByRole('button', { name: 'Mở thử OCR' }));
    await screen.findByTestId('native-camera');
    const name = presentation === 'document' ? 'Chụp ảnh mặt trước' : 'Chụp ảnh';
    expect(screen.getByRole('button', { name })).toHaveProperty('disabled', true);
    expect(native.props.autofocus).toBe('off');
    expect(native.props.zoom).toBe(0);
    expect(native.props.selectedLens).toBeUndefined();
    expect(native.props.onAvailableLensesChanged).toBeUndefined();
    act(() => native.props.onCameraReady?.());
    await readyShutter(name);
    expect(native.mounts).toBe(1);
    expect(screen.queryByRole('button', { name: 'Camera chính' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Phóng thêm' })).toBeTruthy();
  },
);
it('changes iOS lenses and zoom in place, resets zoom on lens selection and guards rapid switches', async () => {
  native.platform = 'ios';
  const lenses = [
    { deviceType: 'AVCaptureDeviceTypeBuiltInWideAngleCamera' },
    { deviceType: 'AVCaptureDeviceTypeBuiltInUltraWideCamera' },
    { deviceType: 'AVCaptureDeviceTypeBuiltInTelephotoCamera' },
  ];
  native.lenses.mockResolvedValue(lenses);
  render(
    <CameraCapture label="CCCD" presentation="document" disabled={false} onCapture={vi.fn()} />,
  );
  await readyShutter();
  expect(native.lenses).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Phóng thêm' }));
  expect(native.props.zoom).toBe(0.02);
  expect(screen.getByRole('button', { name: 'Chụp ảnh mặt trước' })).toHaveProperty(
    'disabled',
    true,
  );
  await readyShutter();
  fireEvent.click(screen.getByRole('button', { name: 'Siêu rộng' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tele' }));
  expect(native.props.selectedLens).toBe('AVCaptureDeviceTypeBuiltInUltraWideCamera');
  expect(native.props.zoom).toBe(0);
  act(() =>
    native.props.onAvailableLensesChanged?.({
      lenses: lenses.map((lens) => ({ ...lens, localizedName: 'Synthetic lens' })),
    }),
  );
  await readyShutter();
  fireEvent.click(screen.getByRole('button', { name: 'Tự động' }));
  await readyShutter();
  expect(native.props.selectedLens).toBeUndefined();
  expect(native.mounts).toBe(1);
  expect(screen.queryByRole('button', { name: 'Lấy nét lại' })).toBeNull();
});
it('falls back to the default iOS camera when discovery fails', async () => {
  native.platform = 'ios';
  native.lenses.mockRejectedValue(new Error('unsupported discovery'));
  render(
    <CameraCapture label="CCCD" presentation="document" disabled={false} onCapture={vi.fn()} />,
  );
  await readyShutter();
  expect(native.props.selectedLens).toBeUndefined();
  expect(screen.queryByRole('button', { name: 'Siêu rộng' })).toBeNull();
});
it('retries a mount failure and ignores ready callbacks from the closed camera', async () => {
  native.autoReady = false;
  render(
    <CameraCapture label="CCCD" presentation="document" disabled={false} onCapture={vi.fn()} />,
  );
  await screen.findByTestId('native-camera');
  const old = native.props;
  act(() => old.onMountError?.({ message: 'Synthetic camera failure' }));
  expect(screen.queryByTestId('native-camera')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Mở camera' }));
  await screen.findByTestId('native-camera');
  act(() => old.onCameraReady?.());
  expect(screen.getByRole('button', { name: 'Chụp ảnh mặt trước' })).toHaveProperty(
    'disabled',
    true,
  );
  act(() => native.props.onCameraReady?.());
  await readyShutter();
});
it('reopens after background and ignores a late capture failure from the previous session', async () => {
  let reject!: (reason: Error) => void;
  native.take.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  render(
    <CameraCapture label="CCCD" presentation="document" disabled={false} onCapture={vi.fn()} />,
  );
  fireEvent.click(await readyShutter());
  act(() => native.listeners.forEach((listener) => listener('background')));
  await act(async () => reject(new Error('old capture failure')));
  act(() => native.listeners.forEach((listener) => listener('active')));
  fireEvent.click(screen.getByRole('button', { name: 'Mở camera' }));
  await readyShutter();
  expect(screen.queryByText(/Không xử lý được ảnh/)).toBeNull();
});
it('allows a native permission prompt to return through inactive and active states', async () => {
  native.granted = false;
  let grant!: (permission: { granted: boolean }) => void;
  native.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  render(
    <CameraCapture label="CCCD" presentation="document" disabled={false} onCapture={vi.fn()} />,
  );
  await waitFor(() => expect(native.request).toHaveBeenCalledOnce());
  act(() => native.listeners.forEach((listener) => listener('inactive')));
  await act(async () => grant({ granted: true }));
  expect(screen.queryByTestId('native-camera')).toBeNull();
  act(() => native.listeners.forEach((listener) => listener('active')));
  await readyShutter();
});
it('uploads the exact reviewed JPEG bytes once and zeroes the buffer after processing', async () => {
  let uploaded: number[] = [];
  const capture = vi.fn(async (bytes: Uint8Array) => {
    uploaded = [...bytes];
  });
  render(
    <CameraCapture
      label="CCCD"
      presentation="document"
      reviewBeforeSubmit
      disabled={false}
      onCapture={capture}
    />,
  );
  await takePhoto();
  expect(capture).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Sử dụng ảnh' }));
  await waitFor(() => expect(capture).toHaveBeenCalledOnce());
  expect(uploaded).toEqual([1, 2, 3]);
  await waitFor(() => expect([...native.bytes]).toEqual([0, 0, 0]));
  expect(native.files.size).toBe(0);
});
it('bounds normalized zoom without remounting or claiming an optical multiplier', async () => {
  render(
    <CameraCapture label="CCCD" presentation="document" disabled={false} onCapture={vi.fn()} />,
  );
  await readyShutter();
  for (let step = 0; step < 6; step++) {
    fireEvent.click(screen.getByRole('button', { name: 'Phóng thêm' }));
    await readyShutter();
  }
  expect(native.props.zoom).toBe(0.12);
  expect(screen.getByRole('button', { name: 'Phóng thêm' })).toHaveProperty('disabled', true);
  expect(screen.getByText('Zoom 12%')).toBeTruthy();
  expect(native.mounts).toBe(1);
});
it('blocks simultaneous native captures while the first capture is pending', async () => {
  let finish!: (picture: unknown) => void;
  native.take.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <CameraCapture
      label="CCCD"
      presentation="document"
      reviewBeforeSubmit
      disabled={false}
      onCapture={vi.fn()}
    />,
  );
  const shutter = await readyShutter();
  fireEvent.click(shutter);
  fireEvent.click(shutter);
  expect(native.take).toHaveBeenCalledOnce();
  await act(async () => finish({ width: 2000, height: 1200, release: native.release }));
  await screen.findByAltText('Ảnh CCCD vừa chụp');
});

function nativeFocus(
  state: CameraFocusEvent['state'],
  requestId: number,
  point = { x: 0.25, y: 0.75 },
) {
  act(() =>
    native.props.onBhomeFocusChanged?.({
      nativeEvent: {
        state,
        requestId,
        ...point,
        supportsAutoFocus: true,
        supportsTapFocus: true,
        supportsContinuousFocus: true,
      },
    }),
  );
}
it.each(['ios', 'android'])(
  'enables native taps only on a ready supported %s camera, then captures with real feedback',
  async (platform) => {
    native.platform = platform;
    native.focusExtension = true;
    render(
      <CameraCapture
        label="CCCD"
        presentation="document"
        reviewBeforeSubmit
        disabled={false}
        onCapture={vi.fn()}
      />,
    );
    await readyShutter();
    expect(native.props.bhomeFocusEnabled).toBe(true);
    expect(native.props.autofocus).toBe('off');
    nativeFocus('focusing', 1);
    expect(screen.getByText('Đang lấy nét…')).toBeTruthy();
    expect(
      JSON.parse(screen.getByLabelText('Điểm lấy nét').getAttribute('data-style')!),
    ).toMatchObject({
      left: '25%',
      top: '75%',
    });
    expect(screen.queryByText('Đã lấy nét')).toBeNull();
    nativeFocus(platform === 'android' ? 'focused' : 'settled', 1);
    expect(
      screen.getByText(platform === 'android' ? 'Đã lấy nét' : /Đã điều chỉnh tiêu cự/),
    ).toBeTruthy();
    fireEvent.click(await readyShutter());
    await screen.findByAltText('Ảnh CCCD vừa chụp');
  },
);
it('keeps capture available during focus and on unsupported, failed or timed-out AF', async () => {
  native.focusExtension = true;
  render(
    <CameraCapture
      label="CCCD"
      presentation="document"
      reviewBeforeSubmit
      disabled={false}
      onCapture={vi.fn()}
    />,
  );
  await readyShutter();
  for (const [id, state] of ['focusing', 'failed', 'timeout', 'unsupported'].entries()) {
    nativeFocus(state as CameraFocusEvent['state'], id);
    expect(screen.getByRole('button', { name: 'Chụp ảnh mặt trước' })).toHaveProperty(
      'disabled',
      false,
    );
    expect(screen.queryByText('Đã lấy nét')).toBeNull();
  }
  fireEvent.click(await readyShutter());
  await screen.findByAltText('Ảnh CCCD vừa chụp');
});
it('ignores old focus results after a later tap, zoom, background and unmount', async () => {
  native.focusExtension = true;
  const view = render(
    <CameraCapture label="CCCD" presentation="document" disabled={false} onCapture={vi.fn()} />,
  );
  await readyShutter();
  nativeFocus('focusing', 2);
  nativeFocus('focused', 1);
  expect(screen.queryByText('Đã lấy nét')).toBeNull();
  const previous = native.props;
  fireEvent.click(screen.getByRole('button', { name: 'Phóng thêm' }));
  expect(native.props.bhomeFocusEnabled).toBe(false);
  await readyShutter();
  nativeFocus('focused', 1);
  nativeFocus('focused', 2);
  expect(screen.queryByText('Đã lấy nét')).toBeNull();
  nativeFocus('failed', 3);
  expect(screen.getByText(/Chưa xác nhận được nét/)).toBeTruthy();
  act(() => native.listeners.forEach((listener) => listener('background')));
  act(() =>
    previous.onBhomeFocusChanged?.({
      nativeEvent: {
        requestId: 4,
        state: 'focused',
        x: 0.5,
        y: 0.5,
        supportsAutoFocus: true,
        supportsTapFocus: true,
        supportsContinuousFocus: true,
      },
    }),
  );
  expect(screen.queryByText('Đã lấy nét')).toBeNull();
  view.unmount();
  expect(native.listeners.size).toBe(0);
});
it('shows a standard-camera fallback in an Expo Go or older binary', async () => {
  render(
    <CameraCapture label="CCCD" presentation="document" disabled={false} onCapture={vi.fn()} />,
  );
  await readyShutter();
  expect(native.props.bhomeFocusEnabled).toBeUndefined();
  expect(native.props.onBhomeFocusChanged).toBeUndefined();
  expect(screen.getByText(/Chạm lấy nét cần bản ứng dụng hỗ trợ/)).toBeTruthy();
});
it.each([
  ['CCCD mặt sau', 'document', 'back'],
  ['Công tơ điện', 'meter', undefined],
  ['Đồng hồ nước', 'meter', undefined],
  ['Test OCR', 'inline', undefined],
] as const)(
  'uses native focus feedback through the shared %s capture entry',
  async (label, presentation, documentSide) => {
    native.focusExtension = true;
    const capture = vi.fn();
    render(
      <CameraCapture
        label={label}
        presentation={presentation}
        documentSide={documentSide}
        autoOpen
        disabled={false}
        reviewBeforeSubmit
        onCapture={capture}
      />,
    );
    if (presentation === 'inline') fireEvent.click(screen.getByRole('button', { name: label }));
    const shutter = await readyShutter(
      presentation === 'document' ? 'Chụp ảnh mặt sau' : 'Chụp ảnh',
    );
    expect(native.props.bhomeFocusEnabled).toBe(true);
    nativeFocus('focusing', 1);
    nativeFocus('focused', 1);
    expect(screen.getByText('Đã lấy nét')).toBeTruthy();
    fireEvent.click(shutter);
    await screen.findByAltText(
      presentation === 'document'
        ? 'Ảnh CCCD vừa chụp'
        : presentation === 'meter'
          ? 'Ảnh công tơ đã chụp'
          : 'Ảnh vừa chụp',
    );
    expect(capture).not.toHaveBeenCalled();
  },
);
