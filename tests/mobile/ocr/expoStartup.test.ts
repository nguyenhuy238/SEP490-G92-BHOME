import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const { supportedNode, selectRuntime, checkExpoOnline } = createRequire(import.meta.url)(
  '../../../scripts/Start-ExpoMobile.cjs',
);

describe('Expo startup runtime and online checks', () => {
  it('uses supported Node 22 and falls back from global Node 24 to local Node 22', () => {
    expect(supportedNode('22.13.0')).toBe(true);
    expect(supportedNode('22.23.4')).toBe(true);
    for (const version of ['20.19.0', '22.12.0', '23.0.0', '24.22.1'])
      expect(supportedNode(version)).toBe(false);
    expect(selectRuntime('22.23.4', 'node22', [])).toBe('node22');
    expect(selectRuntime('24.22.1', 'node24', [{ version: '22.23.4', executable: 'node22' }])).toBe(
      'node22',
    );
    expect(() => selectRuntime('24.22.1', 'node24', [])).toThrow('Node >=22.13');
    expect(() =>
      selectRuntime('24.22.1', 'node24', [{ version: '22.23.4', executable: 'node24' }]),
    ).toThrow();
  });
  const success = () => ({
    sdkVersion: '58.0.0',
    offline: false,
    fetchImpl: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ npmPackage: 'synthetic', versionRange: '1' }] }),
    }),
    whoami: vi.fn().mockReturnValue({ status: 0, stdout: 'synthetic-expo-user\n' }),
  });
  it('checks the actual Expo metadata endpoint and confirms CLI identity before starting Metro', async () => {
    const options = success();
    await expect(checkExpoOnline(options)).resolves.toBe('synthetic-expo-user');
    expect(options.fetchImpl).toHaveBeenCalledWith(
      'https://api.expo.dev/v2/sdks/58.0.0/native-modules',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(options.whoami).toHaveBeenCalledOnce();
  });
  it('rejects offline mode without sending any network or identity requests', async () => {
    const options = { ...success(), offline: true };
    await expect(checkExpoOnline(options)).rejects.toThrow('offline');
    expect(options.fetchImpl).not.toHaveBeenCalled();
    expect(options.whoami).not.toHaveBeenCalled();
  });
  it('reports an aborted network request as connectivity failure without a false login instruction', async () => {
    const options = success();
    options.fetchImpl.mockRejectedValue(
      new DOMException('This operation was aborted', 'AbortError'),
    );
    await expect(checkExpoOnline(options)).rejects.toThrow('Không kết nối được api.expo.dev');
    expect(options.whoami).not.toHaveBeenCalled();
  });
  it('does not continue on Expo API errors or malformed version data', async () => {
    const options = success();
    options.fetchImpl.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(checkExpoOnline(options)).rejects.toThrow('HTTP 503');
    options.fetchImpl.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await expect(checkExpoOnline(options)).rejects.toThrow('không hợp lệ');
    options.fetchImpl.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error('not JSON');
      },
    });
    await expect(checkExpoOnline(options)).rejects.toThrow('không hợp lệ');
    expect(options.whoami).not.toHaveBeenCalled();
  });
  it('requires a verified username and does not print session material or raw CLI errors', async () => {
    const options = success();
    for (const result of [
      { status: 1, stdout: '', stderr: 'SYNTHETIC-SECRET' },
      { status: 0, stdout: 'Not logged in' },
      { status: null, stdout: null, error: new Error('SYNTHETIC-SECRET') },
    ]) {
      options.whoami.mockReturnValueOnce(result);
      await expect(checkExpoOnline(options)).rejects.toThrow(
        'Không xác minh được tài khoản Expo CLI',
      );
    }
  });
});
