import { beforeEach, expect, it, vi } from 'vitest';
import type { MobileApi } from '../lib/api';

const state = vi.hoisted(() => ({
  os: 'ios',
  projectId: 'eas-project-for-tests',
  ownership: null as string | null,
  execution: null as string | null,
  permissions: vi.fn(),
  requestPermissions: vi.fn(),
  setChannel: vi.fn(),
  getToken: vi.fn(),
  request: vi.fn(),
  stored: null as string | null,
  secureGet: vi.fn(),
  secureSet: vi.fn(),
  secureDelete: vi.fn(),
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return state.os;
    },
  },
}));
vi.mock('expo-constants', () => ({
  default: {
    get easConfig() {
      return state.projectId ? { projectId: state.projectId } : null;
    },
    get expoConfig() {
      return null;
    },
    get appOwnership() {
      return state.ownership;
    },
    get executionEnvironment() {
      return state.execution;
    },
  },
}));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  getPermissionsAsync: state.permissions,
  requestPermissionsAsync: state.requestPermissions,
  setNotificationChannelAsync: state.setChannel,
  getExpoPushTokenAsync: state.getToken,
}));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: state.secureGet,
  setItemAsync: state.secureSet,
  deleteItemAsync: state.secureDelete,
}));

import { registerPushDevice, unregisterPushDevice } from '../services/pushRegistration';

const api = () => ({ request: state.request }) as unknown as Pick<MobileApi, 'request'>;
const identity = { userId: 'tenant-a', baseUrl: 'https://api.test' };
const deviceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, {
    os: 'ios',
    projectId: 'eas-project-for-tests',
    ownership: null,
    execution: null,
    stored: null,
  });
  state.permissions.mockResolvedValue({ granted: true, canAskAgain: false });
  state.requestPermissions.mockResolvedValue({ granted: true, canAskAgain: false });
  state.setChannel.mockResolvedValue(undefined);
  state.getToken.mockResolvedValue({ data: 'ExponentPushToken[test-device-token]' });
  state.request.mockResolvedValue({ id: deviceId, platform: 'iOS', isActive: true });
  state.secureGet.mockImplementation(async () => state.stored);
  state.secureSet.mockImplementation(async (_key: string, value: string) => {
    state.stored = value;
  });
  state.secureDelete.mockImplementation(async () => {
    state.stored = null;
  });
});

it('registers the signed-in iOS device through the authenticated API using EAS projectId', async () => {
  expect(await registerPushDevice(api(), identity)).toMatchObject({ registered: true });
  expect(state.getToken).toHaveBeenCalledWith({ projectId: 'eas-project-for-tests' });
  expect(state.request).toHaveBeenCalledWith('/api/v1/notifications/devices', {
    method: 'POST',
    body: JSON.stringify({ pushToken: 'ExponentPushToken[test-device-token]', platform: 'iOS' }),
  });
  expect(state.requestPermissions).not.toHaveBeenCalled();
  expect(JSON.parse(state.stored!)).toEqual({ id: deviceId, ...identity });
});

it('sets Android channel and asks permission only during opt-in before registering', async () => {
  state.os = 'android';
  state.permissions.mockResolvedValue({ granted: false, canAskAgain: true });
  expect(await registerPushDevice(api(), identity)).toMatchObject({ registered: true });
  expect(state.setChannel).toHaveBeenCalledWith('default', { name: 'BHOME', importance: 3 });
  expect(state.requestPermissions).toHaveBeenCalledOnce();
  expect(state.request).toHaveBeenCalledWith('/api/v1/notifications/devices', {
    method: 'POST',
    body: JSON.stringify({
      pushToken: 'ExponentPushToken[test-device-token]',
      platform: 'Android',
    }),
  });
});

it('does not register when the user denies permission', async () => {
  state.permissions.mockResolvedValue({ granted: false, canAskAgain: true });
  state.requestPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
  expect(await registerPushDevice(api(), identity)).toMatchObject({
    registered: false,
    message: expect.stringContaining('chưa cấp quyền'),
  });
  expect(state.getToken).not.toHaveBeenCalled();
  expect(state.request).not.toHaveBeenCalled();
});

it.each([
  { os: 'web', ownership: null, execution: null },
  { os: 'android', ownership: 'expo', execution: null },
  { os: 'ios', ownership: null, execution: 'storeClient' },
])(
  'never requests permission or an API call on unsupported environment %j',
  async ({ os, ownership, execution }) => {
    Object.assign(state, { os, ownership, execution });
    expect(await registerPushDevice(api(), identity)).toMatchObject({ registered: false });
    expect(state.permissions).not.toHaveBeenCalled();
    expect(state.request).not.toHaveBeenCalled();
  },
);

it('requires a configured EAS projectId before prompting for permission', async () => {
  state.projectId = '';
  expect(await registerPushDevice(api(), identity)).toMatchObject({
    registered: false,
    message: expect.stringContaining('EAS projectId'),
  });
  expect(state.permissions).not.toHaveBeenCalled();
  expect(state.request).not.toHaveBeenCalled();
});

it('refuses malformed provider tokens rather than sending them to the backend', async () => {
  state.getToken.mockResolvedValue({ data: 'bad token' });
  expect(await registerPushDevice(api(), identity)).toMatchObject({ registered: false });
  expect(state.request).not.toHaveBeenCalled();
});

it('unregisters a saved device on explicit disable and removes its local ID only after server confirmation', async () => {
  await registerPushDevice(api(), identity);
  state.request.mockClear();
  expect(await unregisterPushDevice(api(), identity)).toMatchObject({ removed: true });
  expect(state.request).toHaveBeenCalledWith(`/api/v1/notifications/devices/${deviceId}`, {
    method: 'DELETE',
  });
  expect(state.stored).toBeNull();
});

it('keeps the saved ID if server unregistration fails and blocks another account on the shared device', async () => {
  await registerPushDevice(api(), identity);
  state.request.mockRejectedValue(new Error('network unavailable'));
  await expect(unregisterPushDevice(api(), identity)).rejects.toThrow('network unavailable');
  expect(state.stored).not.toBeNull();
  state.request.mockClear();
  expect(
    await registerPushDevice(api(), { userId: 'tenant-b', baseUrl: identity.baseUrl }),
  ).toMatchObject({
    registered: false,
    message: expect.stringContaining('tài khoản trước'),
  });
  expect(state.request).not.toHaveBeenCalled();
  expect(state.getToken).toHaveBeenCalledTimes(1);
});
