import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';
async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.chdir(root);
  const privateDirectory = path.join(root, '.tmp/sms-demo');
  const settings = JSON.parse(
    await fs.readFile(path.join(privateDirectory, 'settings.json'), 'utf8'),
  );
  assert.equal(settings.Sms__Mode, 'Mock');
  assert.equal(settings.Sms__DemoIsolated, 'true');
  await fs.mkdir(path.join(root, '.tmp/sms-validation'), { recursive: true });
  const email = 'owner.sms-demo@sms-demo.example.invalid';
  const password = await fs
    .readFile(path.join(privateDirectory, 'OWNER_CURRENT_PASSWORD.txt'), 'utf8')
    .catch(() => settings.BHOME_SMS_DEMO_PASSWORD);
  const newPassword = 'Demo!Recovery-' + randomUUID() + '9a';
  const browser = await chromium.launch({
    executablePath:
      process.env.BHOME_TEST_BROWSER ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
  });
  try {
    const owner = await browser.newContext();
    const inbox = await owner.newPage();
    inbox.setDefaultTimeout(45000);
    await inbox.goto('http://localhost:5178/login');
    await inbox.locator('#login-identifier').fill(email);
    await inbox.locator('#login-password').fill(password);
    await inbox.locator('button[type=submit]').click();
    await inbox.waitForURL('**/dashboard');
    await inbox.goto('http://localhost:5178/demo/sms');
    await inbox.getByText('Hộp thư SMS Demo', { exact: true }).waitFor();
    const anonymous = await browser.newContext();
    const page = await anonymous.newPage();
    page.setDefaultTimeout(45000);
    await page.goto('http://localhost:5178/forgot-password');
    await page.getByLabel('Tài khoản hoặc số điện thoại').fill(email);
    await page.getByRole('button', { name: 'Gửi mã xác minh', exact: true }).click();
    await page.getByLabel('Mã xác minh').waitFor();
    let otp;
    for (let i = 0; i < 20; i++) {
      await inbox.getByRole('button', { name: 'Làm mới', exact: true }).click();
      const content = await inbox.locator('body').innerText();
      otp = /Ma OTP dat lai mat khau la ([0-9]{6})/.exec(content)?.[1];
      if (otp) break;
      await sleep(500);
    }
    assert.ok(otp, 'Protected Demo Inbox must receive a dynamically generated OTP');
    assert.equal((await globalThis.fetch('http://127.0.0.1:5288/api/v1/demo/sms')).status, 401);
    await page.getByLabel('Mã xác minh').fill(otp);
    await page.getByRole('button', { name: 'Xác minh', exact: true }).click();
    await page.getByLabel('Mật khẩu mới', { exact: true }).waitFor();
    await page.screenshot({ path: '.tmp/sms-validation/recovery-web.png', fullPage: true });
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill(newPassword);
    await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true }).click();
    await page.getByText('Đã đặt lại mật khẩu', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Quay lại đăng nhập', exact: true }).click();
    await page.locator('#login-identifier').fill(email);
    await page.locator('#login-password').fill(newPassword);
    await page.locator('button[type=submit]').click();
    await page.waitForURL('**/dashboard');
    const oldLogin = await globalThis.fetch('http://127.0.0.1:5288/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(oldLogin.status, 401);
    await fs.writeFile(path.join(privateDirectory, 'OWNER_CURRENT_PASSWORD.txt'), newPassword);
    await fs.writeFile(
      path.join(privateDirectory, 'ACCOUNTS.txt'),
      `Synthetic isolated accounts only.\nOwner: ${email}\nCurrent Owner password: ${newPassword}\nStaff: staff.sms-demo@sms-demo.example.invalid\nInitial Staff password: ${settings.BHOME_SMS_DEMO_PASSWORD}\nTenant: tenant.sms-demo@sms-demo.example.invalid\nInitial Tenant password: ${settings.BHOME_SMS_DEMO_PASSWORD}\n`,
    );
    await fs.writeFile(
      '.tmp/sms-validation/browser-e2e.json',
      JSON.stringify({
        result: 'PASS',
        mode: 'Mock',
        protectedInbox: true,
        passwordReset: true,
        newLogin: true,
        oldPasswordRejected: true,
        physicalSmsSent: false,
      }),
    );
    console.log(
      'PASS: Web recovery -> protected Demo Inbox -> OTP -> Identity reset -> new login; old password rejected.',
    );
  } catch (error) {
    console.error(
      'SMS_DEMO_BROWSER_FAILED (' +
        (error instanceof Error ? error.name : 'UnknownError') +
        '); private values suppressed.',
    );
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
await main().catch((error) => {
  console.error(
    'SMS_DEMO_BROWSER_FAILED (' +
      (error instanceof Error ? error.name : 'UnknownError') +
      '); private values suppressed.',
  );
  process.exitCode = 1;
});
