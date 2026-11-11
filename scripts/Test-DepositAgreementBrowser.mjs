// Opt-in browser acceptance. The .NET test creates the disposable PostgreSQL fixture and
// forwards network requests to the real ASP.NET host. No fetch/route mocks or real transfers.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { chromium } from 'playwright-core';

assert.match(process.version, /^v22\./, 'Use Node 22.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Match the Owner workspace's Vite/plugin versions; the root Vitest toolchain has its own Vite.
const ownerRequire = createRequire(path.join(root, 'src/owner-web/package.json'));
const { createServer } = await import(pathToFileURL(ownerRequire.resolve('vite')).href);
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
for (const url of [config.api, config.web]) {
  assert.equal(new URL(url).hostname, '127.0.0.1');
  assert.equal(new URL(url).protocol, 'http:');
}
assert.match(config.ownerEmail, /@example\.invalid$/);
assert.match(config.contractId, /^[a-f0-9-]{36}$/);
assert.ok(path.resolve(config.output).startsWith(path.join(root, '.tools') + path.sep));
process.env.VITE_API_BASE_URL = config.api;
process.env.VITE_API_MODE = 'api';
const vite = await createServer({
  root: path.join(root, 'src/owner-web'),
  configFile: path.join(root, 'src/owner-web/vite.config.ts'),
  server: { host: '127.0.0.1', port: Number(new URL(config.web).port), strictPort: true },
});
let browser, page;
try {
  await vite.listen();
  browser = await chromium.launch({
    executablePath:
      process.env.BHOME_TEST_BROWSER ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(config.web);
  await page.locator('#login-identifier').fill(config.ownerEmail);
  await page.locator('#login-password').fill(config.password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL('**/dashboard');
  await page.goto(`${config.web}/contracts?contractId=${config.contractId}`);
  await page.getByText('Hoàn cọc không khấu trừ', { exact: true }).waitFor();
  await page.getByLabel('Người nhận hoàn đã xác minh').click();
  await page.getByRole('option', { name: 'SYNTHETIC AGREED RECIPIENT', exact: true }).click();
  await page.getByLabel('Số tiền yêu cầu hoàn (VND)').fill('400000');
  await page.getByLabel('Lý do yêu cầu hoàn', { exact: true }).fill('SYNTHETIC browser agreement');
  const create = page.getByRole('button', { name: 'Lập yêu cầu hoàn tiền', exact: true });
  assert.equal(await create.isEnabled(), false);
  await page
    .getByLabel('Tôi xác nhận nguồn tiền và người nhận hoàn theo thỏa thuận hợp đồng')
    .check();
  await page
    .getByLabel('Tôi đã đối chiếu thỏa thuận hợp đồng và xác nhận người nhận hoàn cọc')
    .check();
  assert.equal(await create.isEnabled(), false);
  await page
    .getByLabel('Tôi xác nhận hoàn cọc không khấu trừ, không còn phí hoặc nghĩa vụ chờ xử lý')
    .check();
  const [created] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === `${config.api}/api/v1/contracts/${config.contractId}/deposit-refunds` &&
        response.request().method() === 'POST',
    ),
    create.click(),
  ]);
  assert.equal(created.status(), 200, 'Create refund through UI');
  const row = await created.json();
  assert.equal(row.beneficiaryResidentId, config.beneficiaryResidentId);
  assert.equal(row.status, 'REQUESTED');
  await page
    .getByLabel('Lý do quyết định / xác minh hoàn')
    .fill('SYNTHETIC Owner agreement confirmation');
  await page
    .getByLabel('Tôi đã kiểm tra nguồn, số tiền và người nhận trước khi quyết định')
    .check();
  const [approved] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith(`/refund-requests/${row.id}/decision`) &&
        response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Duyệt yêu cầu hoàn', exact: true }).click(),
  ]);
  assert.equal(approved.status(), 200, 'Approve refund through UI');
  const approval = await approved.json();
  await page.getByLabel('Tham chiếu giao dịch hoàn trên sao kê').waitFor();
  await page
    .getByLabel('Lý do quyết định / xác minh hoàn')
    .fill('SYNTHETIC bank statement checked; no real transfer');
  await page.getByLabel('Tham chiếu giao dịch hoàn trên sao kê').fill('SYNTHETIC-BROWSER-RETURN');
  // Preserve the UI's supported milliseconds; truncating to minutes can precede approval.
  await page.waitForFunction((at) => Date.now() - Date.parse(at) >= 1000, approval.decidedAt);
  assert.equal(
    await page.getByLabel('Thời gian hoàn thực tế (giờ Việt Nam)').getAttribute('step'),
    '0.001',
  );
  await page
    .getByLabel('Thời gian hoàn thực tế (giờ Việt Nam)')
    .fill(new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 23));
  await page.getByLabel('Chứng từ giao dịch hoàn', { exact: true }).setInputFiles(config.evidence);
  await page
    .getByLabel('Tôi đã đối chiếu sao kê, xác minh giao dịch hoàn thực sự hoàn tất đúng người nhận')
    .check();
  const [executedResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith(`/refund-requests/${row.id}/execution`) &&
        response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Ghi nhận giao dịch hoàn đã thực hiện', exact: true }).click(),
  ]);
  assert.equal(executedResponse.status(), 200, 'Record synthetic execution proof through UI');
  await page.getByRole('button', { name: 'Tải chứng từ hoàn tiền', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Tải chứng từ hoàn tiền', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Duyệt yêu cầu hoàn', exact: true }).count(),
    0,
  );
  await page
    .getByRole('button', { name: 'Tải chứng từ hoàn tiền', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(config.output, 'owner-completed.png'), fullPage: true });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Tải chứng từ hoàn tiền', exact: true }).click(),
  ]);
  assert.equal(await download.failure(), null);
  assert.deepEqual(await fs.readFile(await download.path()), await fs.readFile(config.evidence));
  assert.equal(errors.length, 0, errors.join('\n'));
  await fs.writeFile(
    path.join(config.output, 'result.json'),
    JSON.stringify({ refundId: row.id, status: 'COMPLETED', pageErrors: errors.length }),
  );
  console.log(
    'PASS: Owner browser agreement recipient, confirmation gates, create, approve, proof upload, reload and private download.',
  );
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(config.output, 'failure.png'), fullPage: true });
    await fs.writeFile(
      path.join(config.output, 'failure-text.txt'),
      await page.locator('body').innerText(),
    );
  }
  throw error;
} finally {
  await browser?.close();
  await vite.close();
}
