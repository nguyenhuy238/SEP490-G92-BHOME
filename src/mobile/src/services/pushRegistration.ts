import { Platform } from 'react-native';
import type { MobileApi } from '../lib/api';

type RegistrationResult = { registered: boolean; message: string };
type PushIdentity = { userId: string; baseUrl: string };
type StoredDevice = PushIdentity & { id: string };
const deviceStorageKey = 'bhome.mobile.push-device.v1';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

async function configuredProjectId(): Promise<{ id: string | null; expoGo: boolean }> {
  const { default: Constants } = await import('expo-constants');
  const fallback = Constants.expoConfig?.extra?.eas;
  const fromExtra =
    fallback && typeof fallback === 'object' && 'projectId' in fallback ? fallback.projectId : null;
  const id = Constants.easConfig?.projectId ?? fromExtra;
  return {
    id: typeof id === 'string' && id.trim() ? id.trim() : null,
    expoGo: Constants.appOwnership === 'expo' || Constants.executionEnvironment === 'storeClient',
  };
}

async function readDevice(): Promise<StoredDevice | null> {
  const SecureStore = await import('expo-secure-store');
  const text = await SecureStore.getItemAsync(deviceStorageKey);
  if (!text) return null;
  const value: unknown = JSON.parse(text);
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !uuid.test(value.id) ||
    !('userId' in value) ||
    typeof value.userId !== 'string' ||
    !value.userId ||
    !('baseUrl' in value) ||
    typeof value.baseUrl !== 'string' ||
    !value.baseUrl
  )
    throw new Error('invalid_push_registration_record');
  return value as StoredDevice;
}

async function saveDevice(value: StoredDevice | null) {
  const SecureStore = await import('expo-secure-store');
  if (!value) await SecureStore.deleteItemAsync(deviceStorageKey);
  else
    await SecureStore.setItemAsync(deviceStorageKey, JSON.stringify(value), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
}

/** Called only when the signed-in user explicitly opts in from Notifications. */
export async function registerPushDevice(
  api: Pick<MobileApi, 'request'>,
  identity: PushIdentity,
): Promise<RegistrationResult> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return {
      registered: false,
      message: 'Thông báo đẩy chỉ hỗ trợ ứng dụng BHOME trên Android hoặc iOS.',
    };
  }
  const config = await configuredProjectId();
  if (config.expoGo) {
    return {
      registered: false,
      message: 'Thông báo đẩy cần bản cài đặt Development/Production Build, không hỗ trợ Expo Go.',
    };
  }
  const projectId = config.id;
  if (!projectId) {
    return {
      registered: false,
      message:
        'Ứng dụng chưa có EAS projectId. Cần cấu hình dự án và build lại trước khi bật thông báo đẩy.',
    };
  }

  // A shared handset may still be registered to another account. Never overwrite
  // that cleanup record or let the new account delete an unrelated account's device.
  const previous = await readDevice();
  if (previous && (previous.userId !== identity.userId || previous.baseUrl !== identity.baseUrl)) {
    return {
      registered: false,
      message:
        'Thiết bị còn liên kết thông báo với tài khoản trước. Hãy đăng nhập tài khoản đó và tắt thông báo khi có mạng.',
    };
  }

  const Notifications = await import('expo-notifications');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'BHOME',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const allows = (permission: Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>) =>
    permission.granted ||
    permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  let permission = await Notifications.getPermissionsAsync();
  if (!allows(permission) && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!allows(permission)) {
    return {
      registered: false,
      message:
        'Bạn chưa cấp quyền thông báo. Có thể bật lại trong cài đặt hệ thống của điện thoại.',
    };
  }

  const pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  if (
    typeof pushToken !== 'string' ||
    pushToken.length < 8 ||
    pushToken.length > 4096 ||
    /\s/.test(pushToken)
  ) {
    return {
      registered: false,
      message: 'Không nhận được mã thiết bị hợp lệ để đăng ký thông báo.',
    };
  }
  // Retire the previous registration only after a replacement token is available.
  // This avoids keeping multiple active records when the provider rotates tokens.
  if (previous) {
    await api.request(`/api/v1/notifications/devices/${encodeURIComponent(previous.id)}`, {
      method: 'DELETE',
    });
    await saveDevice(null);
  }
  const response: unknown = await api.request('/api/v1/notifications/devices', {
    method: 'POST',
    body: JSON.stringify({ pushToken, platform: Platform.OS === 'ios' ? 'iOS' : 'Android' }),
  });
  if (
    !response ||
    typeof response !== 'object' ||
    !('id' in response) ||
    typeof response.id !== 'string' ||
    !uuid.test(response.id)
  ) {
    throw new Error('invalid_push_registration_response');
  }
  const id = response.id;
  try {
    await saveDevice({ id, ...identity });
  } catch (error) {
    // The server registration must not be considered completed without a durable
    // device ID for explicit disabling and sign-out cleanup.
    await api
      .request(`/api/v1/notifications/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .catch(() => {});
    throw error;
  }
  return { registered: true, message: 'Đã đăng ký thiết bị nhận thông báo đẩy từ BHOME.' };
}

/** Deletes only this signed-in user's saved registration; retain the ID on failure. */
export async function unregisterPushDevice(
  api: Pick<MobileApi, 'request'>,
  identity: PushIdentity,
): Promise<{ removed: boolean; message: string }> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return { removed: true, message: 'Thông báo đẩy không sử dụng trên trình duyệt.' };
  }
  const saved = await readDevice();
  if (!saved) return { removed: true, message: 'Thiết bị chưa có đăng ký thông báo đẩy được lưu.' };
  if (saved.userId !== identity.userId || saved.baseUrl !== identity.baseUrl) {
    return {
      removed: false,
      message:
        'Thiết bị vẫn còn đăng ký với tài khoản trước. Không thể hủy bằng tài khoản hiện tại.',
    };
  }
  await api.request(`/api/v1/notifications/devices/${encodeURIComponent(saved.id)}`, {
    method: 'DELETE',
  });
  await saveDevice(null);
  return { removed: true, message: 'Đã hủy đăng ký thông báo đẩy trên thiết bị này.' };
}
