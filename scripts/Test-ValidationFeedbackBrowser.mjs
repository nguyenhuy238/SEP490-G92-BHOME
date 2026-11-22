import assert from 'node:assert/strict';
/* global document, window */
import process from 'node:process';
import console from 'node:console';
import { setTimeout } from 'node:timers';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, URL } from 'node:url';
import { chromium } from 'playwright-core';

// Browser fixture acceptance: all business traffic is intercepted; no real API or PII.
const root = process.cwd();
const output = path.join(root, '.tools/full-validation');
await fs.mkdir(output, { recursive: true });
process.env.VITE_API_BASE_URL = 'http://127.0.0.1:59993';
process.env.VITE_API_MODE = 'api';
const require = createRequire(path.join(root, 'src/owner-web/package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const server = await createServer({
  root: path.join(root, 'src/owner-web'),
  configFile: path.join(root, 'src/owner-web/vite.config.ts'),
  server: { host: '127.0.0.1', port: 5193, strictPort: true },
});
const results = [];
let browser;
const synthetic = {
  userId: 'synthetic-staff',
  fullName: 'Nhân viên tổng hợp',
  email: 'staff@example.invalid',
  phone: null,
  isActive: true,
  accountVersion: 'synthetic-v1',
  employment: {
    id: 'synthetic-employment',
    employmentType: 'Task',
    startDate: '2026-01-01',
    endDate: null,
    salaryType: null,
    baseRate: null,
    status: 'Active',
    contractNumber: null,
  },
};
try {
  await server.listen();
  browser = await chromium.launch({
    ...(process.env.BHOME_TEST_BROWSER
      ? { executablePath: process.env.BHOME_TEST_BROWSER }
      : { channel: 'chrome' }),
    headless: true,
  });
  async function test(name, work) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    let writes = 0,
      invalidEvents = 0;
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    await page.exposeFunction('recordInvalid', () => {
      invalidEvents++;
    });
    await page.addInitScript(() =>
      document.addEventListener('invalid', () => void window.recordInvalid(), true),
    );
    const state = { status: 200, problem: null, network: false, delay: 0 };
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url()),
        method = route.request().method();
      if (url.pathname === '/api/v1/staff' && method === 'POST') {
        writes++;
        if (state.network) return route.abort('timedout');
        if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
        return route.fulfill({
          status: state.status,
          contentType: 'application/json',
          body: JSON.stringify(state.problem ?? synthetic),
        });
      }
      let data = { items: [], totalCount: 0, page: 1, pageSize: 20 };
      if (url.pathname.includes('refresh'))
        data = {
          accessToken: 'synthetic-browser-fixture',
          userId: 'synthetic-owner',
          roles: ['Owner'],
        };
      else if (url.pathname.endsWith('/staff/synthetic-staff')) data = synthetic;
      else if (url.pathname.endsWith('/responsibilities'))
        data = { canDeactivate: true, assignments: [], tasks: [], moveOuts: [] };
      else if (url.pathname.endsWith('/employments'))
        data = [{ ...synthetic.employment, history: [] }];
      else if (url.pathname.includes('unread-count')) data = { count: 0 };
      else if (/locations|rooms|assets|notifications/.test(url.pathname)) data = [];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(data),
      });
    });
    const openStaff = async () => {
      await page.goto('http://127.0.0.1:5193/staff', {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });
      await page.getByRole('button', { name: 'Thêm nhân viên', exact: true }).click();
      assert.equal(await page.locator('#staff-editor').evaluate((form) => form.noValidate), true);
    };
    const fillStaff = async () => {
      await page.getByLabel(/^Họ tên/).fill(synthetic.fullName);
      await page.getByLabel(/^Email/).fill(synthetic.email);
      await page.getByLabel(/^Loại công việc/).fill('Task');
    };
    const submit = () => page.getByRole('button', { name: 'Tạo nhân viên', exact: true }).click();
    try {
      await work({ page, state, openStaff, fillStaff, submit, writes: () => writes });
      assert.equal(invalidEvents, 0, 'No browser native invalid event/pop-up is used');
      assert.deepEqual(failures, [], 'No uncaught client error');
      results.push({ name, passed: true, nativeInvalidEvents: invalidEvents, writes });
    } finally {
      await context.close();
    }
  }
  await test('Staff empty submit: Vietnamese inline, all errors, keyboard focus, no request/native popup', async ({
    page,
    openStaff,
    submit,
    writes,
  }) => {
    await openStaff();
    await submit();
    await page
      .getByText('Vui lòng kiểm tra các trường được đánh dấu trước khi tiếp tục.')
      .waitFor();
    assert.equal(await page.getByText('Vui lòng nhập thông tin này.', { exact: true }).count(), 3);
    assert.equal(
      await page.getByLabel(/^Họ tên/).evaluate((input) => input === document.activeElement),
      true,
    );
    assert.equal(writes(), 0);
    await page.screenshot({ path: path.join(output, 'owner-staff-empty.png') });
  });
  await test('Staff malformed email/short name: multiple inline errors and preserve draft', async ({
    page,
    openStaff,
    submit,
    writes,
  }) => {
    await openStaff();
    await page.getByLabel(/^Họ tên/).fill('N');
    await page.getByLabel(/^Email/).fill('bad');
    await submit();
    await page.getByText('Vui lòng nhập ít nhất 2 ký tự.').waitFor();
    await page.getByText('Vui lòng nhập địa chỉ email hợp lệ.').waitFor();
    assert.equal(await page.getByLabel(/^Email/).inputValue(), 'bad');
    assert.equal(writes(), 0);
  });
  await test('Staff reversed date: local business message and zero writes', async ({
    page,
    openStaff,
    fillStaff,
    submit,
    writes,
  }) => {
    await openStaff();
    await fillStaff();
    await page.getByLabel(/^Ngày bắt đầu/).fill('2026-06-01');
    await page.getByLabel(/^Ngày kết thúc/).fill('2026-05-01');
    await submit();
    await page.getByText('Ngày kết thúc không được trước ngày bắt đầu.').waitFor();
    assert.equal(writes(), 0);
  });
  await test('Staff structured server fieldErrors: focus and preserved inputs', async ({
    page,
    state,
    openStaff,
    fillStaff,
    submit,
    writes,
  }) => {
    state.status = 400;
    state.problem = {
      code: 'validation_error',
      fieldErrors: {
        email: [{ code: 'invalid_email_format', message: 'Email cần được kiểm tra lại.' }],
        fullName: [{ code: 'invalid_length', message: 'Họ tên cần được kiểm tra lại.' }],
      },
    };
    await openStaff();
    await fillStaff();
    await submit();
    await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
    await page.getByText('Email cần được kiểm tra lại.', { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel(/^Họ tên/).evaluate((input) => input === document.activeElement),
      true,
    );
    assert.equal(await page.getByLabel(/^Email/).inputValue(), synthetic.email);
    assert.equal(writes(), 1);
    await page.screenshot({ path: path.join(output, 'owner-staff-server-fields.png') });
  });
  for (const [status, code] of [
    [409, 'stale_staff_version'],
    [403, 'forbidden'],
    [500, 'internal_error'],
  ]) {
    await test(`Staff ${status}: safe feedback, draft retained, session preserved`, async ({
      page,
      state,
      openStaff,
      fillStaff,
      submit,
      writes,
    }) => {
      state.status = status;
      state.problem = { code, message: 'PRIVATE_PROVIDER_DETAIL English SQL exception' };
      await openStaff();
      await fillStaff();
      await submit();
      await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('[role=alert]').length > 1);
      assert.equal(await page.getByLabel(/^Email/).inputValue(), synthetic.email);
      assert.equal(
        (await page.locator('body').innerText()).includes('PRIVATE_PROVIDER_DETAIL'),
        false,
      );
      assert.equal(new URL(page.url()).pathname, '/staff');
      assert.equal(writes(), 1);
    });
  }
  await test('Staff timeout: no auto retry/no false success, draft retained', async ({
    page,
    state,
    openStaff,
    fillStaff,
    submit,
    writes,
  }) => {
    state.network = true;
    await openStaff();
    await fillStaff();
    await submit();
    await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[role=alert]').length > 1);
    assert.equal(await page.getByLabel(/^Email/).inputValue(), synthetic.email);
    assert.equal(writes(), 1);
    assert.equal(await page.locator('[role=alert][data-severity=success]').count(), 0);
  });
  await test('Staff valid save: loading disables duplicate intent, one server-confirmed write', async ({
    page,
    state,
    openStaff,
    fillStaff,
    submit,
    writes,
  }) => {
    state.delay = 700;
    await openStaff();
    await fillStaff();
    await submit();
    await page.getByRole('button', { name: 'Xác nhận', exact: true }).evaluate((button) => {
      button.click();
      button.click();
    });
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('button')).some(
        (button) => button.disabled && button.textContent.includes('Đang'),
      ),
    );
    await page.getByRole('dialog', { name: 'Chi tiết nhân viên', exact: true }).waitFor();
    assert.equal(writes(), 1);
  });
  await test('Login empty submit is localized and has no native popup', async ({ page }) => {
    await page.goto('http://127.0.0.1:5193/login');
    // The authenticated fixture redirects to dashboard; force refresh refusal for anonymous auth forms.
    await page.route('**/api/v1/auth/refresh', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'unauthorized' }),
      }),
    );
    await page.reload();
    await page.locator('button[type=submit]').click();
    await page.getByText('Vui lòng nhập email hoặc số điện thoại.', { exact: true }).waitFor();
  });
} finally {
  await browser?.close();
  await server.close();
  await fs.writeFile(
    path.join(output, 'owner-browser-results.json'),
    JSON.stringify(
      { scope: 'Chromium mock-transport UI acceptance; not real backend business E2E', results },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify({ passed: results.length, results }, null, 2));
