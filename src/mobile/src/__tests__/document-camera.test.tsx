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
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: {
    addEventListener: (_: string, cb: (s: string) => void) => {
      native.listeners.add(cb);
      return { remove: () => native.listeners.delete(cb) };
    },
  },
  StyleSheet: { create: (s: unknown) => s },
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
    Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    ActivityIndicator: () => <span>Loading</span>,
    Icon: () => null,
  };
});
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
