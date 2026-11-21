// Dedicated SMTP inbox -> actual Web setup page -> real API/disposable PostgreSQL.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
for (const value of [config.api, config.web]) {
  const url = new URL(value);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.protocol, 'http:');
}
assert.match(config.email, /@example\.invalid$/);
assert.ok(path.resolve(config.output).startsWith(path.join(root, '.tools') + path.sep));
process.env.VITE_API_BASE_URL = config.api;
process.env.VITE_API_MODE = 'api';
delete process.env.VITE_DEPLOYMENT_ORIGIN;
delete process.env.VITE_DEPLOYMENT_ENVIRONMENT;
process.env.BHOME_WEB_HTTPS = 'false';
const ownerRequire = createRequire(path.join(root, 'src/owner-web/package.json'));
const { createServer } = await import(pathToFileURL(ownerRequire.resolve('vite')).href);
const vite = await createServer({
  root: path.join(root, 'src/owner-web'),
  configFile: path.join(root, 'src/owner-web/vite.config.ts'),
  server: { host: '127.0.0.1', port: Number(new URL(config.web).port), strictPort: true },
  logLevel: 'error',
});
let browser;
let stage = 'launch';
let activePage;
try {
  await vite.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  activePage = page;
  page.setDefaultTimeout(45000);
  page.on('response', (response) => {
    const route = new URL(response.url()).pathname;
    if (route.startsWith('/api/v1/auth/'))
      process.stdout.write(`AUTH_ROUTE ${route} ${response.status()}\n`);
  });
  // This HTML was read from the dedicated Mailpit after the real sender delivered it.
  await page.setContent(config.html);
  stage = 'email-action';
  const action = page.getByRole('link', { name: 'Thiết lập tài khoản', exact: true });
  const href = await action.getAttribute('href');
  assert.equal(new URL(href).origin, config.web);
  assert.ok(
    !(await page
      .locator('body')
      .innerText()
      .then((text) => text.includes(config.token))),
  );
  await action.click();
  stage = 'web-setup';
  await page.getByLabel('Email nhận lời mời').waitFor();
  stage = 'email-displayed';
  assert.equal(await page.getByLabel('Email nhận lời mời').inputValue(), config.email);
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(new URL(page.url()).search, '');
  stage = 'password-fields';
  await page.getByLabel(/^Mật khẩu mới/).fill(config.password);
  await page.getByLabel(/^Xác nhận mật khẩu/).fill(config.password);
  stage = 'submit';
  await page.getByRole('button', { name: 'Thiết lập mật khẩu', exact: true }).click();
  await page.waitForURL('**/login');
  stage = 'success-message';
  await page.getByText(/Đã thiết lập tài khoản/).waitFor();
  // Reuse must show the existing Vietnamese recovery state, never another password form.
  await page.goto(href);
  stage = 'reuse-rejected';
  await page.getByText(/Tài khoản của bạn đã được kích hoạt/).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Thiết lập mật khẩu', exact: true }).count(),
    0,
  );
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(
    await page.locator('html').evaluate((element) => element.scrollWidth > element.clientWidth),
    false,
  );
  await fs.writeFile(
    path.join(config.output, 'passed.json'),
    JSON.stringify({
      realMailpit: true,
      actualEmailAction: true,
      realApi: true,
      tokenScrubbed: true,
      accountSetup: true,
      reusedLinkRejected: true,
      width: 390,
      overflow: false,
    }),
  );
} catch {
  // Playwright errors can include hrefs; do not print them or emit traces containing tokens.
  process.stderr.write(`Email browser acceptance failed at ${stage}; link credentials withheld.\n`);
  if (activePage) {
    process.stderr.write(`Page path: ${new URL(activePage.url()).pathname}\n`);
    const labels = await activePage
      .locator('label')
      .allTextContents()
      .catch(() => []);
    process.stderr.write(`Field labels: ${JSON.stringify(labels)}\n`);
    for (const message of [
      'Lời mời đã hết hạn',
      'Liên kết lời mời không hợp lệ',
      'Không thể kết nối để kiểm tra lời mời',
      'Tài khoản của bạn đã được kích hoạt',
    ])
      if (
        await activePage
          .getByText(message, { exact: false })
          .isVisible()
          .catch(() => false)
      )
        process.stderr.write(`Recovery state: ${message}\n`);
  }
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await vite.close();
}
