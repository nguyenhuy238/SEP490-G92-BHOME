// Owner browser, real Staff API, disposable PostgreSQL and real private MinIO.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';

assert.match(process.version, /^v22\./);
const { fetch } = globalThis;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
for (const value of [config.api, config.web]) assert.equal(new URL(value).hostname, '127.0.0.1');
assert.ok(path.resolve(config.output).startsWith(path.join(root, '.tools') + path.sep));
process.env.VITE_API_BASE_URL = config.api;
process.env.VITE_API_MODE = 'api';
const require = createRequire(path.join(root, 'src/owner-web/package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const vite = await createServer({
  root: path.join(root, 'src/owner-web'),
  configFile: path.join(root, 'src/owner-web/vite.config.ts'),
  server: { host: '127.0.0.1', port: Number(new URL(config.web).port), strictPort: true },
});
async function api(route, token, input, method = 'POST') {
  const response = await fetch(config.api + route, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  assert.ok(response.ok, `${method} ${route} failed with ${response.status}`);
  return response.json();
}
let browser;
try {
  await vite.listen();
  browser = await chromium.launch({
    executablePath:
      process.env.BHOME_TEST_BROWSER ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  await page.goto(config.web + '/login');
  await page.locator('#login-identifier').fill('owner.sample@example.invalid');
  await page.locator('#login-password').fill(config.password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL('**/dashboard');
  await page.goto(config.web + '/maintenance');
  await page.getByRole('button', { name: 'Tạo bảo trì chủ động', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Cơ sở' }).fill('[DEMO BF07]');
  await page.getByRole('option', { name: '[DEMO BF07] Cơ sở bảo trì tổng hợp' }).click();
  await dialog.getByRole('combobox', { name: 'Phòng' }).fill('BF07-102');
  await page.getByRole('option', { name: /BF07-102/ }).click();
  const description = 'Synthetic browser proactive maintenance ' + randomUUID();
  await dialog.getByRole('textbox', { name: 'Nội dung bảo trì' }).fill(description);
  await dialog
    .getByRole('textbox', { name: 'Kết quả yêu cầu' })
    .fill('Synthetic browser verified result');
  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await dialog.getByLabel('Hạn hoàn thành').fill(tomorrow + 'T12:00');
  const createdResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/work-orders') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Tạo và giao việc' }).click();
  const created = await (await createdResponse).json();
  assert.equal(created.incidentId, null);
  await dialog.waitFor({ state: 'hidden' });
  const login = await fetch(config.api + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'staff.sample@example.invalid', password: config.password }),
  });
  assert.ok(login.ok);
  const staff = (await login.json()).accessToken;
  let work = await api('/api/v1/work-orders/' + created.workOrderId, staff, undefined, 'GET');
  await api(`/api/v1/work-orders/${work.id}/proposal`, staff, {
    version: work.version,
    inspectionResult: 'Synthetic real API inspection',
    solution: 'Synthetic zero-cost adjustment',
    estimatedMinutes: 10,
    estimatedCost: 0,
    evidenceIds: [],
  });
  await page.goto(config.web + '/maintenance?workOrderId=' + work.id);
  await page.getByRole('button', { name: 'Duyệt phương án', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Đơn vị thực hiện').fill('Synthetic external vendor');
  let mutation = page.waitForResponse(
    (r) => r.url().endsWith('/plan-decision') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  assert.ok((await mutation).ok());
  await dialog.waitFor({ state: 'hidden' });
  work = await api('/api/v1/work-orders/' + work.id, staff, undefined, 'GET');
  assert.equal(work.status, 'PendingApproval');
  assert.equal(work.canStart, true);
  await api(`/api/v1/work-orders/${work.id}/start`, staff, { version: work.version });
  const png = await fs.readFile(
    path.join(root, 'docs/testing/postman/fixtures/synthetic-meter.png'),
  );
  const upload = await fetch(config.api + `/api/v1/work-orders/${work.id}/evidence?kind=3`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${staff}`,
      'Content-Type': 'image/png',
      'Idempotency-Key': randomUUID(),
    },
    body: png,
  });
  assert.ok(upload.ok, `Private evidence upload failed with ${upload.status}`);
  const evidence = await upload.json();
  work = await api('/api/v1/work-orders/' + work.id, staff, undefined, 'GET');
  await api(`/api/v1/work-orders/${work.id}/submit`, staff, {
    version: work.version,
    note: 'Synthetic work completed with real private evidence',
    evidenceIds: [evidence.resourceId],
  });
  await page.reload();
  await page.getByRole('button', { name: 'Xác minh hoàn tất', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Chi phí thực tế (VND)').fill('0');
  await dialog.getByLabel('Kết quả xác minh').fill('Synthetic Owner verified zero-cost result');
  mutation = page.waitForResponse(
    (r) => r.url().endsWith('/verify') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  assert.ok((await mutation).ok());
  await dialog.waitFor({ state: 'hidden' });
  await page.getByText('Đã xác minh', { exact: true }).first().waitFor();
  work = await api('/api/v1/work-orders/' + work.id, staff, undefined, 'GET');
  assert.equal(work.status, 'Verified');
  assert.equal(work.actualCost, 0);
  assert.equal(work.source, 'Proactive');
  const image = await fetch(
    config.api + `/api/v1/work-orders/${work.id}/evidence/${evidence.resourceId}`,
    { headers: { Authorization: `Bearer ${staff}` } },
  );
  assert.ok(image.ok);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  await page.screenshot({ path: path.join(config.output, 'owner-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(config.output, 'owner-mobile-width.png'),
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
    ),
    'Owner layout overflows at mobile width',
  );
  await fs.writeFile(
    path.join(config.output, 'passed.json'),
    JSON.stringify({
      proactiveCreate: true,
      serverAssigned: true,
      staffProposal: true,
      ownerApproval: true,
      explicitStaffStart: true,
      privateMinioEvidence: true,
      ownerVerification: true,
      responsiveOwner: true,
      workOrderId: work.id,
    }),
  );
} finally {
  if (browser) await browser.close();
  await vite.close();
}
