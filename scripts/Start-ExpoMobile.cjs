const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const repository = path.resolve(__dirname, '..');
const project = path.join(repository, 'src/mobile');
const cli = path.join(repository, 'node_modules/expo/bin/cli');

function supportedNode(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return major === 22 && minor >= 13;
}

function selectRuntime(version, executable, candidates) {
  if (supportedNode(version)) return executable;
  const candidate = candidates.find((item) => supportedNode(item.version));
  if (candidate && path.resolve(candidate.executable) !== path.resolve(executable))
    return candidate.executable;
  throw new Error('BHOME cần Node >=22.13 và <23. Cài Node 22 hoặc đặt bản Node 22 trong .tools.');
}

async function checkExpoOnline({ sdkVersion, offline, fetchImpl, whoami }) {
  if (offline)
    throw new Error(
      'Expo đang ở chế độ offline. Bỏ --offline/EXPO_OFFLINE trước khi mở bằng Expo Go trên iPhone.',
    );
  let response;
  try {
    response = await fetchImpl(`https://api.expo.dev/v2/sdks/${sdkVersion}/native-modules`, {
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error(
      'Không kết nối được api.expo.dev. Kiểm tra Internet/proxy/VPN rồi chạy lại; Metro chưa được khởi động.',
    );
  }
  if (!response.ok)
    throw new Error(
      `Expo API trả HTTP ${response.status}. Chưa khởi động Metro; thử lại khi dịch vụ Expo hoạt động.`,
    );
  let body;
  try {
    body = await response.json();
  } catch {
    /* Validate the expected public version response below. */
  }
  if (!Array.isArray(body?.data) || !body.data.length)
    throw new Error(
      'Expo API trả dữ liệu phiên bản không hợp lệ. Chưa khởi động Metro; kiểm tra kết nối rồi thử lại.',
    );
  const result = await whoami();
  // Never print CLI stderr, credentials or session files. Only accept its username output.
  const username = result.stdout?.trim();
  if (result.status !== 0 || !username || !/^[a-zA-Z0-9_.-]+$/.test(username))
    throw new Error(
      'Không xác minh được tài khoản Expo CLI. Chạy npx expo whoami; nếu phiên hết hạn, chạy npx expo login với cùng tài khoản Expo Go.',
    );
  return username;
}

function developmentArguments(args) {
  const result = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(repository, 'scripts/Start-OcrMobileApp.ps1'),
  ];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--lan') continue;
    if (argument === '--clear' || argument === '-c') result.push('-Clear');
    else if (argument === '--port' || argument === '-p' || argument.startsWith('--port=')) {
      const value = argument.startsWith('--port=') ? argument.slice(7) : args[++index];
      if (!/^\d+$/.test(value ?? '') || Number(value) < 1024 || Number(value) > 65535)
        throw new Error('Cổng Expo phải là số từ 1024 đến 65535.');
      result.push('-Port', value);
    } else
      throw new Error(
        'Khởi động BHOME dùng --clear, --lan hoặc --port <cổng>. Dùng --metro-only cho tùy chọn Expo khác và tự chạy API HTTPS.',
      );
  }
  return result;
}

async function main(
  args = process.argv.slice(2),
  { platform = process.platform, runCommand = run } = {},
) {
  const tools = path.join(repository, '.tools');
  const candidates = fs.existsSync(tools)
    ? fs.readdirSync(tools).flatMap((name) => {
        const match = /^node-v(22\.\d+\.\d+)-win-x64$/.exec(name);
        const executable = path.join(tools, name, 'node.exe');
        return match && fs.existsSync(executable) ? [{ version: match[1], executable }] : [];
      })
    : [];
  const runtime = selectRuntime(process.versions.node, process.execPath, candidates);
  if (runtime !== process.execPath) {
    console.log('BHOME: sử dụng Node 22 trong .tools cho Expo.');
    return runCommand(runtime, [__filename, ...args]);
  }
  if (!fs.existsSync(cli))
    throw new Error('Chưa có Expo CLI local. Chạy npm ci tại thư mục gốc repository.');
  // npm start must keep the API alive alongside Metro. The supervisor calls back
  // with --metro-only after verifying HTTPS readiness, without recursively starting it.
  if (
    platform === 'win32' &&
    !args.some((argument) => ['--metro-only', '--check', '--help', '-h'].includes(argument))
  )
    return runCommand('powershell.exe', developmentArguments(args));
  args = args.filter((argument) => argument !== '--metro-only');
  if (!args.includes('--help') && !args.includes('-h')) {
    // Match Expo's environment and HTTP transport, including HTTP_PROXY support.
    process.env.NODE_ENV ??= 'development';
    require('@expo/env').load(project);
    const version = require(path.join(repository, 'node_modules/expo/package.json')).version;
    const username = await checkExpoOnline({
      sdkVersion: `${version.split('.')[0]}.0.0`,
      offline: /^(1|true)$/i.test(process.env.EXPO_OFFLINE ?? '') || args.includes('--offline'),
      fetchImpl: require('fetch-nodeshim').fetch,
      whoami: () =>
        spawnSync(runtime, [cli, 'whoami'], {
          cwd: project,
          encoding: 'utf8',
          timeout: 30000,
          windowsHide: true,
          env: { ...process.env, CI: '1' },
        }),
    });
    console.log(
      `BHOME: Expo online, CLI đã xác minh tài khoản ${username}. Expo Go trên iPhone cần cùng tài khoản.`,
    );
  }
  if (args.includes('--check')) return 0;
  return runCommand(runtime, [cli, 'start', ...args]);
}

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: project, stdio: 'inherit', windowsHide: true });
    const stop = () => child.kill('SIGINT');
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      resolve(code ?? (signal === 'SIGINT' ? 130 : 1));
    });
  });
}

module.exports = { supportedNode, selectRuntime, checkExpoOnline, main };
if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
