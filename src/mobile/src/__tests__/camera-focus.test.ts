import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ platform: 'android', module: vi.fn() }));
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return native.platform;
    },
  },
}));
vi.mock('expo', () => ({ requireOptionalNativeModule: native.module }));
import {
  acceptCameraFocusEvent,
  cameraFocusMessage,
  supportsNativeCameraFocus,
  type CameraFocusEvent,
} from '../lib/cameraFocus';
const event = (state: CameraFocusEvent['state'] = 'focusing', requestId = 1): CameraFocusEvent => ({
  state,
  requestId,
  x: 0.25,
  y: 0.75,
  supportsAutoFocus: true,
  supportsTapFocus: true,
  supportsContinuousFocus: true,
});
beforeEach(() => {
  native.platform = 'android';
  native.module.mockReset().mockReturnValue({ bhomeFocusVersion: 1 });
});
describe('focus extension compatibility', () => {
  it.each(['ios', 'android'])('enables the versioned extension on %s', (platform) => {
    native.platform = platform;
    expect(supportsNativeCameraFocus()).toBe(true);
  });
  it.each([null, {}, { bhomeFocusVersion: 2 }])(
    'keeps standard camera fallback for %j',
    (module) => {
      native.module.mockReturnValue(module);
      expect(supportsNativeCameraFocus()).toBe(false);
    },
  );
  it('uses the standard web camera without invoking a native focus module', () => {
    native.platform = 'web';
    expect(supportsNativeCameraFocus()).toBe(false);
    expect(native.module).not.toHaveBeenCalled();
  });
});
describe('native focus feedback', () => {
  it('accepts only the latest request and its real result', () => {
    const current = acceptCameraFocusEvent(null, event('focusing', 2));
    expect(acceptCameraFocusEvent(current, event('focused', 1))).toBe(current);
    expect(acceptCameraFocusEvent(current, event('focused', 2))?.state).toBe('focused');
    expect(acceptCameraFocusEvent(current, event('failed', 3))?.state).toBe('failed');
  });
  it.each([
    null,
    {},
    { ...event(), state: 'invented' },
    { ...event(), requestId: NaN },
    { ...event(), x: NaN },
    { ...event(), x: -0.1 },
    { ...event(), y: 1.01 },
    { ...event(), x: -1 },
    { ...event(), supportsTapFocus: 'true' },
  ])('ignores malformed or out-of-preview coordinates %j', (input) => {
    const previous = event();
    expect(acceptCameraFocusEvent(previous, input)).toBe(previous);
  });
  it('accepts native center/edge coordinates and events without a tap point', () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.5, y: 0.5 },
      { x: -1, y: -1 },
    ]) {
      expect(acceptCameraFocusEvent(null, { ...event(), ...point })).toEqual({
        ...event(),
        ...point,
      });
    }
  });
  it('never promotes unsupported fixed-focus feedback to success', () => {
    expect(
      acceptCameraFocusEvent(null, { ...event('focused'), supportsAutoFocus: false }),
    ).toBeNull();
    expect(
      acceptCameraFocusEvent(null, { ...event('focused'), supportsTapFocus: false }),
    ).toBeNull();
  });
  it('reserves success text for confirmed native AF success', () => {
    expect(cameraFocusMessage(event('focused'), true)).toBe('Đã lấy nét');
    for (const state of [
      'idle',
      'focusing',
      'settled',
      'failed',
      'timeout',
      'unsupported',
    ] as const) {
      expect(cameraFocusMessage(event(state), true)).not.toBe('Đã lấy nét');
    }
    expect(cameraFocusMessage(null, true)).not.toBe('Đã lấy nét');
    expect(cameraFocusMessage(null, false)).toContain('cần bản ứng dụng hỗ trợ');
  });
});
