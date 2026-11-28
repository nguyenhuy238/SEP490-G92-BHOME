import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const { supportedNode, selectRuntime, checkExpoOnline, main } = createRequire(import.meta.url)(
  '../../../scripts/Start-ExpoMobile.cjs',
);
const { STAGING_API_URL, startStagingMobile } = createRequire(import.meta.url)(
  '../../../scripts/Start-StagingMobile.cjs',
);
const { PRODUCT_API_URL, startProductMobile } = createRequire(import.meta.url)(
  '../../../scripts/Start-ProductMobile.cjs',
);
const supportedRuntime = {
  nodeVersion: '22.23.4',
  nodeExecutable: 'supported-node22',
  nodeCandidates: [],
};

describe.each([
  ['Staging', STAGING_API_URL, startStagingMobile, 'EXPO_PUBLIC_STAGING_WEB_PROXY', 'true'],
  ['Product', PRODUCT_API_URL, startProductMobile, 'EXPO_PUBLIC_PRODUCT_WEB_PROXY', 'false'],
])('%s mobile launch', (_name, apiUrl, startMobile, proxyFlag, demoClock) => {
  it('uses the selected HTTPS API, ignores local API settings and bypasses the local supervisor', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', 'https://localhost:7240');
    vi.stubEnv('EXPO_PUBLIC_DEV_API_BASE_URL', 'https://192.168.2.102:7240');
    vi.stubEnv('EXPO_PUBLIC_STAGING_WEB_PROXY', '1');
    vi.stubEnv('EXPO_PUBLIC_PRODUCT_WEB_PROXY', '1');
    vi.stubEnv('EXPO_PUBLIC_DEMO_CLOCK_ENABLED', 'true');
    vi.stubEnv('EXPO_PUBLIC_SMS_DEMO_ENABLED', 'true');
    vi.stubEnv('EXPO_NO_DOTENV', undefined);
    vi.stubEnv('EXPO_PUBLIC_DEV_SERVER_ID', 'old-local-server');
    try {
      const launch = vi.fn().mockResolvedValue(0);
      await expect(startMobile(['--port', '8082'], launch)).resolves.toBe(0);
      expect(process.env.EXPO_PUBLIC_API_BASE_URL).toBe(apiUrl);
      expect(process.env.EXPO_PUBLIC_DEV_API_BASE_URL).toBeUndefined();
      expect(process.env.EXPO_PUBLIC_DEV_SERVER_ID).toBeUndefined();
      expect(process.env[proxyFlag]).toBe('1');
      expect(
        process.env[
          proxyFlag === 'EXPO_PUBLIC_PRODUCT_WEB_PROXY'
            ? 'EXPO_PUBLIC_STAGING_WEB_PROXY'
            : 'EXPO_PUBLIC_PRODUCT_WEB_PROXY'
        ],
      ).toBeUndefined();
      expect(process.env.EXPO_PUBLIC_DEMO_CLOCK_ENABLED).toBe(demoClock);
      if (demoClock === 'false') expect(process.env.EXPO_PUBLIC_SMS_DEMO_ENABLED).toBe('false');
      expect(process.env.EXPO_NO_DOTENV).toBe('1');
      expect(launch).toHaveBeenCalledExactlyOnceWith([
        '--metro-only',
        '--lan',
        '--clear',
        '--port',
        '8082',
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('Expo startup runtime and online checks', () => {
  it.each([
    [],
    ['--clear'],
    ['--lan', '--port', '8082'],
    ['-c', '--port=8083'],
    ['--lan-api'],
    ['--hostname-api'],
  ])(
    'starts the API/HTTPS supervisor for a normal Windows npm start (%j)',
    async (...args: string[]) => {
      const runCommand = vi.fn().mockResolvedValue(0);
      await expect(
        main(args, { ...supportedRuntime, platform: 'win32', runCommand }),
      ).resolves.toBe(0);
      expect(runCommand).toHaveBeenCalledExactlyOnceWith(
        'powershell.exe',
        expect.arrayContaining([
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          expect.stringContaining('Start-OcrMobileApp.ps1'),
        ]),
      );
      const forwarded = runCommand.mock.calls[0]![1];
      if (args.includes('--clear') || args.includes('-c')) expect(forwarded).toContain('-Clear');
      if (args.includes('--lan-api')) expect(forwarded).toContain('-LanApi');
      if (args.includes('--hostname-api')) expect(forwarded).toContain('-HostnameApi');
      if (args.includes('8082')) expect(forwarded.slice(-2)).toEqual(['-Port', '8082']);
      if (args.includes('--port=8083')) expect(forwarded.slice(-2)).toEqual(['-Port', '8083']);
    },
  );
  it.each([['--port'], ['--port', '0'], ['--port=65536'], ['--port', '8081;whoami'], ['--tunnel']])(
    'rejects unsupported supervisor arguments without launching a process (%j)',
    async (...args: string[]) => {
      const runCommand = vi.fn();
      await expect(
        main(args, { ...supportedRuntime, platform: 'win32', runCommand }),
      ).rejects.toThrow();
      expect(runCommand).not.toHaveBeenCalled();
    },
  );
  it('preserves the supervisor exit status instead of reporting a failed API startup as success', async () => {
    const runCommand = vi.fn().mockResolvedValue(1);
    await expect(main([], { ...supportedRuntime, platform: 'win32', runCommand })).resolves.toBe(1);
    expect(runCommand).toHaveBeenCalledOnce();
  });
  it('does not recurse into the supervisor or send the internal flag to Expo', async () => {
    const runCommand = vi.fn().mockResolvedValue(0);
    await expect(
      main(['--metro-only', '--help'], { ...supportedRuntime, platform: 'win32', runCommand }),
    ).resolves.toBe(0);
    expect(runCommand).toHaveBeenCalledExactlyOnceWith(supportedRuntime.nodeExecutable, [
      expect.stringMatching(/expo[/\\]bin[/\\]cli$/),
      'start',
      '--help',
    ]);
  });
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
  it('restarts with local Node 22 before supervisor dispatch and forwards all startup flags', async () => {
    const runCommand = vi.fn().mockResolvedValue(3);
    await expect(
      main(['--clear', '--lan', '--port', '8082'], {
        platform: 'win32',
        runCommand,
        nodeVersion: '24.22.1',
        nodeExecutable: 'global-node24',
        nodeCandidates: [{ version: '22.23.4', executable: 'local-node22' }],
      }),
    ).resolves.toBe(3);
    expect(runCommand).toHaveBeenCalledExactlyOnceWith('local-node22', [
      expect.stringMatching(/scripts[/\\]Start-ExpoMobile\.cjs$/),
      '--clear',
      '--lan',
      '--port',
      '8082',
    ]);
  });
  it('preserves the internal --metro-only flag during the Node 22 restart', async () => {
    const runCommand = vi.fn().mockResolvedValue(0);
    await expect(
      main(['--metro-only', '--help'], {
        platform: 'win32',
        runCommand,
        nodeVersion: '24.22.1',
        nodeExecutable: 'global-node24',
        nodeCandidates: [{ version: '22.23.4', executable: 'local-node22' }],
      }),
    ).resolves.toBe(0);
    expect(runCommand).toHaveBeenCalledExactlyOnceWith('local-node22', [
      expect.stringMatching(/scripts[/\\]Start-ExpoMobile\.cjs$/),
      '--metro-only',
      '--help',
    ]);
  });
  it('rejects Node 24 when no compatible local runtime is available', async () => {
    const runCommand = vi.fn();
    await expect(
      main(['--metro-only', '--help'], {
        platform: 'win32',
        runCommand,
        nodeVersion: '24.22.1',
        nodeExecutable: 'global-node24',
        nodeCandidates: [],
      }),
    ).rejects.toThrow('Node >=22.13');
    expect(runCommand).not.toHaveBeenCalled();
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
