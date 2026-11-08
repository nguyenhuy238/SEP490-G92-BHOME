// @vitest-environment jsdom
import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
}));
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
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
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
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
vi.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: native.granted }, native.request],
  CameraView: forwardRef(function Camera({ onCameraReady }: { onCameraReady: () => void }, ref) {
    useImperativeHandle(ref, () => ({ takePictureAsync: native.take }), []);
    useEffect(onCameraReady, [onCameraReady]);
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
      renderAsync: native.render,
      release: native.release,
    }),
  },
}));
import { CameraCapture } from '../components/CameraCapture';

beforeEach(() => {
  vi.clearAllMocks();
  native.granted = true;
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
it('uses only capture/close then use/retake controls for meters and keeps a compact preview during review', async () => {
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
    'Chụp ảnh',
    'Đóng camera',
  ]);
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
  expect(native.resized).toHaveBeenCalledWith({ width: 1600 });
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
