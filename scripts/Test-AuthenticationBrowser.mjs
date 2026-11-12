// Browser acceptance against a real ASP.NET test host and disposable PostgreSQL.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

assert.match(process.version, /^v22\./);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
for (const value of [config.api, config.web]) {
  assert.equal(new URL(value).hostname, '127.0.0.1');
  assert.equal(new URL(value).protocol, 'http:');
}
assert.match(config.email, /@example\.invalid$/);
assert.ok(path.resolve(config.output).startsWith(path.join(root, '.tools') + path.sep));
process.env.VITE_API_BASE_URL = config.api;
process.env.VITE_API_MODE = 'api';
const ownerRequire = createRequire(path.join(root, 'src/owner-web/package.json'));
const { createServer } = await import(pathToFileURL(ownerRequire.resolve('vite')).href);
const vite = await createServer({
  root: path.join(root, 'src/owner-web'),
  configFile: path.join(root, 'src/owner-web/vite.config.ts'),
  server: { host: '127.0.0.1', port: Number(new URL(config.web).port), strictPort: true },
});
let browser;
try {
  await vite.listen();
  browser = await chromium.launch({
    executablePath:
      process.env.BHOME_TEST_BROWSER ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  await page.goto(config.web + '/login');
  await page.locator('#login-identifier').fill(config.email);
  await page.locator('#login-password').fill(config.password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL('**/dashboard');
  const credential = () =>
    context.cookies().then((cookies) => cookies.find((c) => c.name === '__Secure-bhome-refresh'));
  const cookie = await credential();
  assert.ok(
    cookie?.httpOnly && cookie.secure && cookie.sameSite === 'Strict',
    'Cookie security flags must remain enabled.',
  );
  await page.goto(config.web + '/account/profile');
  await page.getByRole('heading', { name: 'Hồ sơ tài khoản', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/account/profile');
  const before = (await credential()).value;
  await page.getByLabel(/^Họ và tên/).fill('Synthetic Browser Profile');
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
  await page.getByText('Đã cập nhật hồ sơ tài khoản.', { exact: true }).waitFor();
  assert.equal(
    (await credential()).value,
    before,
    'Profile save must preserve the current session.',
  );
  await page.reload();
  await page.getByRole('heading', { name: 'Hồ sơ tài khoản', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/account/profile');
  assert.ok((await credential()).value !== before, 'Reload must rotate the refresh cookie.');
  const extra = await context.newPage();
  await extra.goto(config.web + '/account/profile');
  await extra.getByRole('heading', { name: 'Hồ sơ tài khoản', exact: true }).waitFor();
  await fs.writeFile(
    path.join(config.output, 'passed.json'),
    JSON.stringify({
      sameOriginCookie: true,
      secureHttpOnlyStrict: true,
      nestedReload: true,
      newTabRestore: true,
      profileSaveWithoutLogout: true,
      realApi: true,
    }),
  );
} finally {
  if (browser) await browser.close();
  await vite.close();
}
