// Exported Web browser check with synthetic transport; no real identity or credentials.
const { chromium } = require('playwright-core');
const http = require('http'),
  fs = require('fs'),
  path = require('path'),
  assert = require('assert/strict');
const repo = path.resolve(__dirname, '../..');
const root = path.resolve(
  repo,
  process.env.BHOME_MOBILE_WEB_DIST || 'src/mobile/.expo/onboarding-email-browser',
);
const out = path.join(repo, '.tools/onboarding-browser');
const widths = [360, 768, 1280, 1920];
fs.mkdirSync(out, { recursive: true });
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const existing = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const fresh = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const requests = [],
  errors = [],
  consoleErrors = [];
let confirmations = 0;
const confirmationConflict = process.env.BHOME_ONBOARDING_CONFIRM_CONFLICT === '1';
const resident = {
  id: existing,
  roomId: id,
  displayLabel: 'SYNTHETIC OCCUPANT',
  residentType: 0,
  verificationStatus: 0,
  email: 'synthetic@example.invalid',
};
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(root, 'index.html');
  res.setHeader(
    'Content-Type',
    {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.ttf': 'font/ttf',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
    }[path.extname(file)] || 'application/octet-stream',
  );
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({
    executablePath:
      process.env.BHOME_BROWSER_EXECUTABLE ||
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  await context.route('https://api.example.invalid/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      p = url.pathname,
      method = req.method();
    requests.push({ path: p, method });
    let status = 200,
      data = [];
    if (p === '/api/v1/auth/login') {
      const payload = Buffer.from(
        JSON.stringify({ sub: id, role: ['Staff'], exp: Math.floor(Date.now() / 1000) + 3600 }),
      ).toString('base64url');
      data = { accessToken: `synthetic.${payload}.test-only`, refreshToken: 'synthetic-only' };
    } else if (p === '/api/v1/capture/locations') data = [{ id, label: 'SYNTHETIC LOCATION' }];
    else if (p.endsWith('/rooms')) data = [{ id, label: '101', status: 'Available', capacity: 3 }];
    else if (p.endsWith('/residents') && method === 'GET')
      data = [
        resident,
        ...(confirmationConflict && confirmations > 0
          ? [{ id: fresh, roomId: id, verificationStatus: 1 }]
          : []),
      ];
    else if (p === '/api/v1/contracts/main-drafts/preparation') {
      data = {
        roomId: id,
        locationId: id,
        locationName: 'SYNTHETIC LOCATION',
        roomNumber: '101',
        address: 'Synthetic address',
        effectiveOn: '2026-11-14',
        residents: [
          {
            id: fresh,
            fullName: 'NEW SYNTHETIC PERSON',
            maskedCitizenNumber: '********0002',
            dateOfIssue: null,
            representative: true,
            email: 'new@example.invalid',
          },
        ],
        charges: [],
        securityDeposit: '0',
        paymentTerms: 'Synthetic terms',
        ownerName: 'SYNTHETIC OWNER',
        blockers: [],
      };
    } else if (p === '/api/v1/capture/residents' && method === 'POST') {
      if (req.postDataJSON().email.toLowerCase() === resident.email) {
        status = 409;
        data = { code: 'resident_email_already_associated' };
      } else data = { id: fresh };
    } else if (p === `/api/v1/capture/residents/${fresh}/confirm`) {
      assert.equal(req.postDataJSON().humanConfirmed, true);
      confirmations++;
      if (confirmations === 1) {
        status = confirmationConflict ? 409 : 503;
        data = {
          code: confirmationConflict ? 'identity_already_confirmed' : 'synthetic_temporary_failure',
        };
      } else data = { id: fresh, verificationStatus: 1 };
    } else if (p.endsWith('/unread-count')) data = { count: 0 };
    else if (p.includes('operational-tasks') || p.includes('/incidents'))
      data = { items: [], page: 1, pageSize: 20, totalCount: 0 };
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(data),
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
    await page
      .getByLabel('Email hoặc số điện thoại đăng nhập', { exact: true })
      .fill('staff.synthetic@example.invalid');
    await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill('Synthetic-UI-Only!2026');
    await page.getByRole('button', { name: /Đăng nhập$/ }).click();
    await page.getByRole('button', { name: 'Tiếp nhận người thuê', exact: true }).click();
    await page.getByRole('button', { name: 'Phòng *', exact: true }).click();
    await page.getByRole('radio', { name: '101', exact: true }).click();
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await page.getByLabel('Tên gọi hồ sơ', { exact: true }).fill('SYNTHETIC OCCUPANT');
    await page.getByLabel('Email người ở', { exact: true }).fill('synthetic@example.invalid');
    await page.getByRole('button', { name: 'Tiếp tục đến CCCD', exact: true }).click();
    await page.getByRole('button', { name: /Nhập thủ công$/ }).click();
    await page.getByRole('button', { name: 'Mở hồ sơ đã có tại phòng này', exact: true }).waitFor();
    assert.match(await page.getByRole('alert').innerText(), /Email này đã gắn với một hồ sơ/);
    assert.equal(
      requests.filter((r) => r.method === 'POST' && r.path === '/api/v1/capture/residents').length,
      1,
    );
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByText('Kiểm tra hồ sơ đã có', { exact: true }).scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
        ),
        false,
      );
      await page.screenshot({ path: path.join(out, `conflict-${width}.png`) });
    }
    await page.getByRole('button', { name: 'Mở hồ sơ đã có tại phòng này', exact: true }).click();
    await page.getByRole('button', { name: 'Rời quy trình', exact: true }).click();
    await page.getByText('Chi tiết cư dân', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('residentId'), existing);
    await page.getByRole('button', { name: /Nhập thông tin thủ công$/ }).click();
    await page.getByRole('textbox', { name: 'Số CCCD (12 chữ số)', exact: true }).waitFor();
    const input = page.getByRole('textbox', { name: 'Số CCCD (12 chữ số)', exact: true });
    await page.getByRole('dialog').evaluate(async (el) => {
      await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));
    });
    const layout = await input.evaluate((el) => {
      const rows = [];
      for (let node = el; node && rows.length < 14; node = node.parentElement) {
        const r = node.getBoundingClientRect(),
          s = globalThis.getComputedStyle(node);
        rows.push({
          tag: node.tagName,
          height: r.height,
          top: r.top,
          display: s.display,
          flex: s.flex,
          overflow: s.overflow,
          direction: s.flexDirection,
          paddingTop: s.paddingTop,
          paddingBottom: s.paddingBottom,
          position: s.position,
          css: node.getAttribute('style'),
        });
      }
      return rows;
    });
    fs.writeFileSync(path.join(out, 'manual-layout.json'), JSON.stringify(layout, null, 2));
    await page.screenshot({ path: path.join(out, 'manual-before-fill.png') });
    assert(
      layout.filter((row) => row.overflow === 'hidden auto').every((row) => row.height > 0),
      'Manual input has a collapsed scroll viewport: ' + JSON.stringify(layout),
    );
    await input.fill('000000000001', { timeout: 3000 });
    const fullName = page.getByRole('textbox', { name: 'Họ và tên', exact: true });
    await fullName.fill('SYNTHETIC PERSON');
    await page
      .getByRole('textbox', { name: 'Ngày sinh (dd/MM/yyyy)', exact: true })
      .fill('01/01/2000');
    const issueDate = page.getByRole('textbox', { name: 'Ngày cấp (dd/MM/yyyy)', exact: true });
    const confirm = page.getByRole('button', { name: /Xác nhận thông tin$/ });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await input.scrollIntoViewIfNeeded();
      await input.fill('000000000001', { timeout: 3000 });
      assert(
        await input.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= globalThis.innerHeight;
        }),
        'First input must be visible in the viewport',
      );
      await page.screenshot({ path: path.join(out, `manual-${width}.png`) });
      await issueDate.fill('01/01/2020', { timeout: 3000 });
      await confirm.scrollIntoViewIfNeeded();
      assert(
        await confirm.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= globalThis.innerHeight;
        }),
        'Confirmation must be reachable by scrolling',
      );
      assert.equal(await confirm.isEnabled(), false);
      assert.equal(
        await page.getByRole('dialog').evaluate((el) => el.scrollWidth > el.clientWidth),
        false,
      );
    }
    await page.getByRole('button', { name: 'Đóng xác minh CCCD', exact: true }).click();
    await page.getByRole('button', { name: /Nhập thông tin thủ công$/ }).click();
    await page.getByRole('dialog').evaluate(async (el) => {
      await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));
    });
    await input.fill('000000000001', { timeout: 3000 });
    assert.equal(await fullName.inputValue(), 'SYNTHETIC PERSON');
    await page.getByRole('button', { name: 'Đóng xác minh CCCD', exact: true }).click();
    assert.equal(
      requests.some((r) => r.path.includes('/ocr/identity/') || r.path.endsWith('/confirm')),
      false,
    );
    // Exercise the new-onboarding parent as well as the existing-profile modal.
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
    await page
      .getByLabel('Email hoặc số điện thoại đăng nhập', { exact: true })
      .fill('staff.synthetic@example.invalid');
    await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill('Synthetic-UI-Only!2026');
    await page.getByRole('button', { name: /Đăng nhập$/ }).click();
    await page.getByRole('button', { name: 'Tiếp nhận người thuê', exact: true }).click();
    await page.getByRole('button', { name: 'Phòng *', exact: true }).click();
    await page.getByRole('radio', { name: '101', exact: true }).click();
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await page.getByLabel('Tên gọi hồ sơ', { exact: true }).fill('NEW SYNTHETIC OCCUPANT');
    await page.getByLabel('Email người ở', { exact: true }).fill('new@example.invalid');
    await page.getByRole('button', { name: 'Tiếp tục đến CCCD', exact: true }).click();
    await page.getByRole('button', { name: /Nhập thủ công$/ }).click();
    await page
      .getByRole('textbox', { name: 'Số CCCD (12 chữ số)', exact: true })
      .fill('000000000002');
    await page
      .getByRole('textbox', { name: 'Họ và tên', exact: true })
      .fill('NEW SYNTHETIC PERSON');
    await page
      .getByRole('textbox', { name: 'Ngày sinh (dd/MM/yyyy)', exact: true })
      .fill('01/01/2000');
    await page.getByRole('button', { name: 'Đóng xác minh CCCD', exact: true }).click();
    assert.equal(
      await page.getByRole('button', { name: 'Tiếp tục tạo hợp đồng', exact: true }).isEnabled(),
      false,
    );
    await page.getByRole('button', { name: /Nhập thủ công$/ }).click();
    assert.equal(
      await page.getByRole('textbox', { name: 'Họ và tên', exact: true }).inputValue(),
      'NEW SYNTHETIC PERSON',
    );
    await page
      .getByRole('checkbox', {
        name: 'Tôi đã đối chiếu giấy tờ gốc và xác nhận toàn bộ thông tin',
        exact: true,
      })
      .click();
    await page.getByRole('button', { name: /Xác nhận thông tin$/ }).click();
    if (confirmationConflict)
      await page.getByRole('button', { name: 'Dùng hồ sơ đã xác nhận', exact: true }).waitFor();
    else
      await page
        .getByRole('dialog')
        .getByText('Dịch vụ tạm chưa sẵn sàng. Hãy thử tải lại sau.', { exact: true })
        .waitFor();
    await page.screenshot({
      path: path.join(out, confirmationConflict ? 'confirmed-conflict.png' : 'confirm-retry.png'),
    });
    assert.equal(
      await page.getByRole('button', { name: 'Tiếp tục tạo hợp đồng', exact: true }).isEnabled(),
      false,
    );
    if (confirmationConflict)
      await page.getByRole('button', { name: 'Dùng hồ sơ đã xác nhận', exact: true }).click();
    else await page.getByRole('button', { name: /Xác nhận thông tin$/ }).click();
    await page.getByText('Đã xác nhận 1/1 người ở', { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(
        out,
        confirmationConflict ? 'recovered-confirmation.png' : 'saved-confirmation.png',
      ),
    });
    await page.getByRole('button', { name: 'Tiếp tục tạo hợp đồng', exact: true }).click();
    await page.waitForURL('**/workspace/prepare-contract?**');
    assert.equal(new URL(page.url()).searchParams.get('representativeResidentId'), fresh);
    assert.deepEqual(JSON.parse(new URL(page.url()).searchParams.get('residentIds')), [fresh]);
    assert.equal(confirmations, confirmationConflict ? 1 : 2);
    assert.deepEqual(errors, []);
    const relevant = consoleErrors.filter((e) =>
      /Unexpected text node|ScreenCapture|UnavailabilityError/.test(e),
    );
    assert.deepEqual(relevant, []);
    fs.writeFileSync(
      path.join(out, 'result.json'),
      JSON.stringify(
        {
          scope: 'Synthetic transport, Expo Web export; not live backend or OCR',
          requests,
          errors,
          consoleErrors,
          relevant,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        status: 'PASS',
        errors,
        relevant,
        residentCreates: 2,
        confirmations,
        confirmationConflict,
        widths,
        manual: 'visible, editable, scrollable, reopen retained',
      }),
    );
  } catch (e) {
    console.error(e.message);
    console.error(JSON.stringify({ errors, consoleErrors, requests }));
    fs.writeFileSync(path.join(out, 'failure.txt'), await page.locator('body').innerText());
    await page.screenshot({ path: path.join(out, 'failure.png') });
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
