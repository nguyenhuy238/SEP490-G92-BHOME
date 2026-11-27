import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export type FocusState =
  'idle' | 'focusing' | 'focused' | 'settled' | 'failed' | 'timeout' | 'unsupported';
export interface CameraFocusEvent {
  requestId: number;
  state: FocusState;
  x: number;
  y: number;
  supportsAutoFocus: boolean;
  supportsTapFocus: boolean;
  supportsContinuousFocus: boolean;
}

// Expo Go and older binaries expose the standard CameraView without our native extension.
export function supportsNativeCameraFocus() {
  if (Platform.OS === 'web' || typeof requireOptionalNativeModule !== 'function') return false;
  return (
    requireOptionalNativeModule<{ bhomeFocusVersion?: number }>('ExpoCamera')?.bhomeFocusVersion ===
    1
  );
}

const states: readonly string[] = [
  'idle',
  'focusing',
  'focused',
  'settled',
  'failed',
  'timeout',
  'unsupported',
];
export function acceptCameraFocusEvent(
  previous: CameraFocusEvent | null,
  input: unknown,
): CameraFocusEvent | null {
  if (!input || typeof input !== 'object') return previous;
  const event = input as CameraFocusEvent;
  if (
    !Number.isSafeInteger(event.requestId) ||
    event.requestId < 0 ||
    (previous && event.requestId < previous.requestId) ||
    !states.includes(event.state) ||
    !Number.isFinite(event.x) ||
    !Number.isFinite(event.y) ||
    typeof event.supportsAutoFocus !== 'boolean' ||
    typeof event.supportsTapFocus !== 'boolean' ||
    typeof event.supportsContinuousFocus !== 'boolean'
  )
    return previous;
  const noPoint = event.x === -1 && event.y === -1;
  if (!noPoint && (event.x < 0 || event.x > 1 || event.y < 0 || event.y > 1)) return previous;
  if (event.state === 'focused' && (!event.supportsAutoFocus || !event.supportsTapFocus))
    return previous;
  return event;
}

export function cameraFocusMessage(event: CameraFocusEvent | null, extension: boolean) {
  if (!extension) return '';
  if (!event) return 'Đang chuẩn bị lấy nét…';
  switch (event.state) {
    case 'focusing':
      return 'Đang lấy nét…';
    case 'focused':
      return 'Đã lấy nét';
    case 'settled':
      return 'Đã điều chỉnh tiêu cự. Kiểm tra chữ rõ trước khi chụp.';
    case 'failed':
    case 'timeout':
      return 'Chưa xác nhận được nét. Hãy lùi máy hoặc tăng ánh sáng.';
    case 'unsupported':
      return 'Máy không hỗ trợ lấy nét tại điểm này. Điều chỉnh khoảng cách và kiểm tra ảnh.';
    default:
      return event.supportsContinuousFocus
        ? 'Tự động lấy nét. Chạm vào vùng chữ hoặc mặt số để lấy nét tại đó.'
        : event.supportsTapFocus
          ? 'Chạm vùng chữ để lấy nét. Giữ máy yên và kiểm tra ảnh trước khi chụp.'
          : 'Điều chỉnh khoảng cách, giữ máy yên và kiểm tra ảnh trước khi chụp.';
  }
}
