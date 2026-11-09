const { chromium } = require('playwright-core');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'src/owner-web/dist');
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const password = process.env.BHOME_E2E_PASSWORD;
const staffPassword = process.env.BHOME_E2E_STAFF_PASSWORD;
const pfxPassword = process.env.BHOME_E2E_PFX_PASSWORD;
if (!password || !staffPassword || !pfxPassword)
  throw new Error(
    'BHOME_E2E_PASSWORD, BHOME_E2E_STAFF_PASSWORD and BHOME_E2E_PFX_PASSWORD are required.',
  );

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const server = https.createServer(
  {
    pfx: fs.readFileSync(path.join(root, '.tools/mobile-tls/localhost.pfx')),
    passphrase: pfxPassword,
  },
  (req, res) => {
    const requested = decodeURIComponent(new URL(req.url, 'https://localhost').pathname);
    let file = path.join(dist, requested === '/' ? 'index.html' : requested.slice(1));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
      file = path.join(dist, 'index.html');
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  },
);

const results = [];
const network = [];
const stamp = Date.now();
const names = {
  location: `E2E Browser ${stamp}`,
  location2: `E2E Browser Secondary ${stamp}`,
  roomType: `Browser Type ${stamp}`,
  room: `B-${String(stamp).slice(-6)}`,
  asset: `Browser Asset ${stamp}`,
  staff: `staff.browser.${stamp}`,
};
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const tomorrowDate = new Date();
tomorrowDate.setDate(tomorrowDate.getDate() + 1);
const tomorrow = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(tomorrowDate);
const endDate = new Date();
endDate.setDate(endDate.getDate() + 30);
const assignmentEnd = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(endDate);

function check(value, message) {
  if (!value) throw new Error(message);
}
async function selectMui(page, label, option) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function openTaskDetail(page, title, locationName, statusName) {
  const back = page.getByRole('button', { name: 'Về danh sách' });
  if (await back.isVisible().catch(() => false)) await back.click();
  await selectMui(page, 'Cơ sở', 'Tất cả cơ sở');
  await selectMui(page, 'Cơ sở', locationName);
  await selectMui(page, 'Trạng thái', 'Tất cả trạng thái');
  await selectMui(page, 'Trạng thái', statusName);
  const row = page.locator('.MuiPaper-root').filter({ hasText: title });
  await row.getByRole('button', { name: 'Xem chi tiết' }).click();
  await page.getByRole('heading', { name: title }).waitFor();
}
async function apiAction(page, method, pathname, action, allowed = [200, 201, 204]) {
  const responsePromise = page.waitForResponse(
    (r) => r.request().method() === method && new URL(r.url()).pathname === pathname,
    { timeout: 15000 },
  );
  await action();
  let response;
  try {
    response = await responsePromise;
  } catch (error) {
    const alerts = await page.getByRole('alert').allTextContents();
    throw new Error(`${error.message}; url=${page.url()}; alerts=${alerts.join(' | ')}`, {
      cause: error,
    });
  }
  check(allowed.includes(response.status()), `${method} ${pathname} returned ${response.status()}`);
  return response;
}
async function scenario(id, run) {
  try {
    await run();
    results.push({ id, result: 'PASS' });
  } catch (error) {
    results.push({ id, result: 'FAIL', error: String(error.message || error) });
    throw error;
  }
}

(async () => {
  await new Promise((resolve) => server.listen(5173, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const context = await browser.newContext({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  const page = await context.newPage();
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/'))
      network.push({
        method: response.request().method(),
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes('/api/v1/'))
      network.push({
        method: request.method(),
        path: new URL(request.url()).pathname,
        status: 0,
        error: request.failure()?.errorText,
      });
  });
  let locationId, roomTypeId, roomId;
  try {
    await scenario('AUTH-01', async () => {
      await page.goto('https://localhost:5173/dashboard');
      await page.getByLabel('Email').fill('owner.dev@example.invalid');
      await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(password);
      await apiAction(page, 'POST', '/api/v1/auth/login', () =>
        page.getByRole('button', { name: 'Đăng nhập' }).click(),
      );
      await page.waitForURL('**/dashboard');
      await page.getByRole('heading', { name: 'Tổng quan BHOME' }).waitFor();
      await page.reload();
      await page.getByRole('heading', { name: 'Tổng quan BHOME' }).waitFor();
    });

    await scenario('ROUTES-01', async () => {
      const routes = [
        '/locations',
        '/room-types',
        '/rooms',
        '/assets',
        '/pricing',
        '/staff',
        '/dashboard',
      ];
      for (const route of routes) {
        const menuLink = page.locator(`a[href="${route}"]`).first();
        if (await menuLink.count()) await menuLink.click();
        else await page.goto(`https://localhost:5173${route}`);
        await page.waitForURL(`**${route}`);
        check(
          !(await page.getByText(/Chưa có hợp đồng API nghiệp vụ/).count()),
          `${route} fell back to demo repository`,
        );
      }
    });

    await scenario('BF01-01-02', async () => {
      await page.goto('https://localhost:5173/locations');
      await page.getByRole('button', { name: 'Thêm cơ sở' }).click();
      await page.getByRole('textbox', { name: /Tên cơ sở/ }).fill(names.location);
      await page.getByRole('textbox', { name: /Địa chỉ/ }).fill('Synthetic Browser Address');
      const created = await apiAction(
        page,
        'POST',
        '/api/v1/locations',
        () => page.getByRole('button', { name: 'Lưu' }).click(),
        [201],
      );
      locationId = (await created.json()).id;
      await page.getByText(names.location).waitFor();
      await page.reload();
      await page.getByText(names.location).waitFor();
      const card = page
        .getByText(names.location)
        .locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]');
      await card.getByRole('button', { name: 'Chỉnh sửa' }).click();
      await page
        .getByRole('textbox', { name: /Địa chỉ/ })
        .fill('Synthetic Browser Address Updated');
      await page.getByLabel('Lý do thay đổi').fill('Browser E2E update');
      await apiAction(page, 'PUT', `/api/v1/locations/${locationId}`, () =>
        page.getByRole('button', { name: 'Lưu' }).click(),
      );
      await page.reload();
      const updatedCard = page
        .getByText(names.location)
        .locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]');
      await updatedCard.getByText('Synthetic Browser Address Updated').waitFor();
      await page.getByRole('button', { name: 'Thêm cơ sở' }).click();
      await page.getByRole('textbox', { name: /Tên cơ sở/ }).fill(names.location2);
      await page.getByRole('textbox', { name: /Địa chỉ/ }).fill('Synthetic Secondary Address');
      await apiAction(
        page,
        'POST',
        '/api/v1/locations',
        () => page.getByRole('button', { name: 'Lưu' }).click(),
        [201],
      );
      await page.getByText(names.location2).waitFor();
    });

    await scenario('BF01-03-04', async () => {
      await page.goto(`https://localhost:5173/locations/${locationId}/room-types`);
      await page.getByRole('button', { name: 'Thêm loại phòng' }).click();
      await page.getByLabel('Tên loại phòng').fill(names.roomType);
      await page.getByLabel('Mô tả').fill('Synthetic browser room type');
      await page.getByLabel('Sức chứa mặc định').fill('2');
      const created = await apiAction(
        page,
        'POST',
        '/api/v1/room-types',
        () => page.getByRole('button', { name: 'Lưu' }).click(),
        [201],
      );
      roomTypeId = (await created.json()).id;
      await page.getByText(names.roomType).waitFor();
      await page
        .getByRole('row', { name: new RegExp(names.roomType) })
        .getByRole('button', { name: 'Sửa' })
        .click();
      await page.getByLabel('Mô tả').fill('Synthetic browser room type updated');
      await page.getByLabel('Lý do thay đổi').fill('Browser E2E update');
      await apiAction(page, 'PUT', `/api/v1/room-types/${roomTypeId}`, () =>
        page.getByRole('button', { name: 'Lưu' }).click(),
      );
      await page.reload();
      await page.getByText(names.roomType).waitFor();
    });

    await scenario('BF01-05-06-12', async () => {
      await page.goto(`https://localhost:5173/locations/${locationId}/rooms`);
      await page.getByRole('button', { name: 'Thêm phòng' }).click();
      await selectMui(page, 'Loại phòng', names.roomType);
      await page.getByLabel('Số phòng').fill(names.room);
      await page.getByLabel('Tầng').fill('1');
      const created = await apiAction(
        page,
        'POST',
        '/api/v1/rooms',
        () => page.getByRole('button', { name: 'Lưu' }).click(),
        [201],
      );
      roomId = (await created.json()).id;
      await page.getByRole('link', { name: names.room }).waitFor();
      await page
        .getByRole('row', { name: new RegExp(names.room) })
        .getByRole('button', { name: 'Sửa' })
        .click();
      await page.getByLabel('Tầng').fill('2');
      await page.getByLabel('Lý do thay đổi').fill('Browser E2E update');
      await apiAction(page, 'PUT', `/api/v1/rooms/${roomId}`, () =>
        page.getByRole('button', { name: 'Lưu' }).click(),
      );
      await page.reload();
      await page.getByRole('link', { name: names.room }).waitFor();
      await selectMui(page, 'Trạng thái phòng', 'Available');
      await page.getByRole('link', { name: names.room }).waitFor();
    });

    await scenario('BF01-07-08', async () => {
      await page.goto(`https://localhost:5173/locations/${locationId}/assets`);
      await page.getByRole('button', { name: 'Thêm tài sản' }).click();
      await page.getByLabel('Mã tài sản').fill(`AS-${stamp}`);
      await page.getByLabel('Tên tài sản').fill(names.asset);
      await page.getByLabel('Nhóm tài sản').fill('Equipment');
      await selectMui(page, 'Phòng (để trống nếu ở khu vực chung)', names.room);
      await page.getByLabel('Hiện trạng').fill('Synthetic new');
      const created = await apiAction(
        page,
        'POST',
        '/api/v1/assets',
        () => page.getByRole('button', { name: 'Lưu' }).click(),
        [201],
      );
      const assetId = (await created.json()).id;
      await page.getByText(names.asset).waitFor();
      await page
        .getByRole('row', { name: new RegExp(names.asset) })
        .getByRole('button', { name: 'Sửa' })
        .click();
      await page.getByLabel('Hiện trạng').fill('Synthetic verified updated');
      await page.getByLabel('Lý do thay đổi').fill('Browser E2E update');
      await apiAction(page, 'PUT', `/api/v1/assets/${assetId}`, () =>
        page.getByRole('button', { name: 'Lưu' }).click(),
      );
      await page.reload();
      await page.getByText('Synthetic verified updated').waitFor();
    });

    await scenario('BF01-12-STATES', async () => {
      await page.goto(`https://localhost:5173/locations/${locationId}/rooms`);
      const row = page.getByRole('row', { name: new RegExp(names.room) });
      await row.getByRole('button', { name: 'Sửa' }).click();
      await selectMui(page, 'Trạng thái', 'Unavailable');
      await page.getByLabel('Lý do thay đổi').fill('Browser E2E unavailable transition');
      await apiAction(page, 'PUT', `/api/v1/rooms/${roomId}`, () =>
        page.getByRole('button', { name: 'Lưu' }).click(),
      );
      await page.getByRole('row', { name: new RegExp(`${names.room}.*Unavailable`) }).waitFor();
      await page.reload();
      await page.getByRole('row', { name: new RegExp(`${names.room}.*Unavailable`) }).waitFor();
    });

    async function createPolicy(category, name, rate, code) {
      await selectMui(page, 'Khoản thu', category);
      await page.getByLabel('Tên khoản thu').fill(name);
      if (code) await page.getByLabel('Mã phí dịch vụ').fill(code);
      await page.getByLabel('Đơn giá VND').fill(rate);
      await page.getByLabel('Hiệu lực từ ngày').fill(today);
      await page.getByLabel('Lý do / ghi chú').fill('Browser E2E');
      await apiAction(
        page,
        'POST',
        '/api/v1/billing-policies',
        () => page.getByRole('button', { name: 'Lưu biểu giá' }).click(),
        [201],
      );
    }
    await scenario('BF01-09-10', async () => {
      await page.goto(`https://localhost:5173/locations/${locationId}/pricing`);
      await createPolicy('Tiền thuê', `Browser Rent ${stamp}`, '2500000');
      await createPolicy('Điện / kWh', `Browser Electricity ${stamp}`, '3500');
      await createPolicy('Nước / m³', `Browser Water ${stamp}`, '18000');
      await createPolicy(
        'Phí dịch vụ / tháng',
        `Browser Internet ${stamp}`,
        '100000',
        `INTERNET_${String(stamp).slice(-6)}`,
      );
      await page.reload();
      await page.getByText(`Browser Rent ${stamp}`, { exact: false }).waitFor();
    });

    await scenario('BF01-11', async () => {
      await page.getByLabel('Đơn giá VND').fill('-1');
      await page.getByLabel('Hiệu lực từ ngày').fill(today);
      await page.getByLabel('Lý do / ghi chú').fill('Invalid amount E2E');
      const beforeInvalid = network.filter(
        (x) => x.method === 'POST' && x.path === '/api/v1/billing-policies',
      ).length;
      await page.getByRole('button', { name: 'Lưu biểu giá' }).click();
      await page.waitForTimeout(300);
      const afterInvalid = network.filter(
        (x) => x.method === 'POST' && x.path === '/api/v1/billing-policies',
      ).length;
      check(afterInvalid === beforeInvalid, 'Invalid negative price reached Backend');
      const rentRow = page
        .getByText(`Browser Rent ${stamp}`, { exact: false })
        .first()
        .locator('xpath=..');
      await rentRow.getByRole('button', { name: 'Tạo giá kế tiếp' }).click();
      await page.getByLabel('Tên khoản thu').fill(`Browser Rent Future ${stamp}`);
      await page.getByLabel('Đơn giá VND').fill('2600000');
      await page.getByLabel('Hiệu lực từ ngày').fill(tomorrow);
      await page.getByLabel('Lý do / ghi chú').fill('Future replacement E2E');
      const replacement = page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          /\/api\/v1\/billing-policies\/[0-9a-f-]+\/replacement$/i.test(new URL(r.url()).pathname),
      );
      await page.getByRole('button', { name: 'Lưu biểu giá' }).click();
      check([200, 201].includes((await replacement).status()), 'Policy replacement failed');
    });

    await scenario('BF01-13', async () => {
      const historyResponse = page.waitForResponse(
        (r) => new URL(r.url()).pathname === `/api/v1/rooms/${roomId}/history`,
      );
      await page.goto(`https://localhost:5173/rooms/${roomId}`);
      await page.getByText('Lịch sử phòng').waitFor();
      check((await historyResponse).status() === 200, 'Room history request failed');
    });

    await scenario('BF02-01-02', async () => {
      await page.goto('https://localhost:5173/staff');
      await page.getByRole('button', { name: 'Tạo Staff' }).click();
      await page.getByLabel('Tên đăng nhập').fill(names.staff);
      await page.getByLabel('Email').fill(`${names.staff}@example.invalid`);
      await page.getByLabel('Mật khẩu ban đầu').fill(staffPassword);
      await apiAction(page, 'POST', '/api/v1/capture/staff', () =>
        page.getByRole('button', { name: 'Tạo tài khoản' }).click(),
      );
      await page.getByText(names.staff).waitFor();
      await page.getByText(/Backend hiện chưa có API sửa/).waitFor();
    });

    await scenario('BF02-04-05-06', async () => {
      await selectMui(page, 'Cơ sở', names.location);
      await page.getByRole('button', { name: 'Phân công cơ sở' }).click();
      await selectMui(page, 'Staff', names.staff);
      await page.getByLabel('Từ ngày').fill(today);
      await page.getByLabel('Đến ngày').fill(assignmentEnd);
      await apiAction(
        page,
        'POST',
        '/api/v1/staff-location-assignments',
        () => page.getByRole('button', { name: 'Phân công' }).click(),
        [201],
      );
      await page.getByRole('cell', { name: names.staff }).last().waitFor();
      const locationBox = page.getByRole('combobox', { name: 'Cơ sở' });
      await locationBox.click();
      await page.getByRole('option', { name: names.location2, exact: true }).click();
      await page.getByRole('button', { name: 'Phân công cơ sở' }).click();
      await selectMui(page, 'Staff', names.staff);
      await page.getByLabel('Từ ngày').fill(today);
      await page.getByLabel('Đến ngày').fill(assignmentEnd);
      await apiAction(
        page,
        'POST',
        '/api/v1/staff-location-assignments',
        () => page.getByRole('button', { name: 'Phân công' }).click(),
        [201],
      );
      await page.getByRole('cell', { name: names.staff }).last().waitFor();
      check(
        (await page.getByText(/chưa có API sửa\/vô hiệu hóa/).count()) > 0,
        'Unsupported assignment modification was not disclosed',
      );
    });

    await scenario('BF02-08-OPERATIONAL-TASKS', async () => {
      const taskTitle = `Browser Task ${stamp}`;
      await page.goto('https://localhost:5173/tasks');
      await page.getByRole('heading', { name: 'Công việc vận hành' }).waitFor();
      await page.getByRole('button', { name: 'Tạo công việc' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('combobox', { name: 'Cơ sở' }).click();
      await page.getByRole('option', { name: names.location, exact: true }).click();
      await dialog.getByLabel(/Tiêu đề/).fill(taskTitle);
      await dialog
        .getByLabel(/Yêu cầu thực hiện/)
        .fill('Kiểm tra vận hành bằng dữ liệu E2E tổng hợp');
      await dialog.getByLabel(/Hạn hoàn thành/).fill(`${tomorrow}T10:00`);
      await apiAction(
        page,
        'POST',
        '/api/v1/operational-tasks',
        () => dialog.getByRole('button', { name: 'Lưu' }).click(),
        [201],
      );
      await page.getByRole('heading', { name: taskTitle }).waitFor();
      await page.getByRole('button', { name: 'Ghi hướng dẫn' }).click();
      const actionDialog = page.getByRole('dialog');
      await actionDialog
        .getByLabel(/Nội dung \/ lý do/)
        .fill('Owner điều phối và xác nhận contract API thực');
      const coordinate = page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          /\/api\/v1\/operational-tasks\/[0-9a-f-]+\/coordinate$/i.test(new URL(r.url()).pathname),
      );
      await actionDialog.getByRole('button', { name: 'Xác nhận' }).click();
      check((await coordinate).status() === 200, 'Operational task coordinate failed');
      await page.reload();
      await page.getByText(taskTitle).waitFor();
    });

    await scenario('BF02-09-OPERATIONAL-TASK-LIFECYCLE', async () => {
      const apiBase = 'https://localhost:7241';
      const directFetch = (path, { method = 'GET', data, token, key } = {}) =>
        page.evaluate(
          async ({ url, method, data, token, key }) => {
            const headers = { Accept: 'application/json' };
            if (data !== undefined) headers['Content-Type'] = 'application/json';
            if (token) headers.Authorization = `Bearer ${token}`;
            if (key) headers['Idempotency-Key'] = key;
            const response = await fetch(url, {
              method,
              headers,
              credentials: 'omit',
              cache: 'no-store',
              body: data === undefined ? undefined : JSON.stringify(data),
            });
            let body = null;
            if (response.status !== 204) {
              const text = await response.text();
              try {
                body = text ? JSON.parse(text) : null;
              } catch {
                body = text;
              }
            }
            return { status: response.status, body };
          },
          { url: `${apiBase}${path}`, method, data, token, key },
        );
      const directLogin = async (email, secret) => {
        const response = await directFetch('/api/v1/auth/login', {
          method: 'POST',
          data: { email, password: secret },
        });
        check(response.status === 200, `Direct login failed with ${response.status}`);
        return response.body.accessToken;
      };
      const ownerToken = await directLogin('owner.dev@example.invalid', password);
      const staffToken = await directLogin(`${names.staff}@example.invalid`, staffPassword);
      const command = async (token, path, data, key = crypto.randomUUID(), method = 'POST') => {
        return directFetch(path, { method, data, token, key });
      };
      const taskTitle = `Lifecycle Task ${stamp}`;
      const work = {
        title: taskTitle,
        requirements: 'Yêu cầu ban đầu từ Browser E2E',
        priority: 'High',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        evidenceRequired: false,
      };
      const createdResponse = await command(ownerToken, '/api/v1/operational-tasks', {
        locationId,
        work,
      });
      check(createdResponse.status === 201, `Task create returned ${createdResponse.status}`);
      const created = createdResponse.body;

      await page.goto('https://localhost:5173/tasks');
      const taskRow = page.locator('.MuiPaper-root').filter({ hasText: taskTitle });
      await taskRow.getByRole('button', { name: 'Xem chi tiết' }).click();
      await page.getByRole('heading', { name: taskTitle }).waitFor();
      await page.getByRole('button', { name: 'Sửa yêu cầu' }).click();
      const editDialog = page.getByRole('dialog');
      await editDialog
        .getByLabel(/Yêu cầu thực hiện/)
        .fill('Yêu cầu đã cập nhật qua màn Owner Web ACTIVE');
      await editDialog
        .getByLabel(/Lý do cập nhật/)
        .fill('Kiểm tra update và optimistic concurrency');
      const updateResponsePromise = page.waitForResponse(
        (r) =>
          r.request().method() === 'PUT' &&
          new URL(r.url()).pathname === `/api/v1/operational-tasks/${created.id}`,
      );
      await editDialog.getByRole('button', { name: 'Lưu' }).click();
      const updateResponse = await updateResponsePromise;
      check(updateResponse.status() === 200, `Task update returned ${updateResponse.status()}`);
      const updated = await updateResponse.json();
      await page.getByText(/Yêu cầu đã cập nhật/).waitFor();

      const stale = await command(
        ownerToken,
        `/api/v1/operational-tasks/${created.id}/coordinate`,
        { version: created.version, note: 'stale version check', evidenceIds: [] },
      );
      check(stale.status === 409, `Stale task command returned ${stale.status}`);
      const invalid = await command(ownerToken, `/api/v1/operational-tasks/${created.id}/verify`, {
        version: updated.version,
        note: '',
        evidenceIds: [],
      });
      check(invalid.status === 409, `Invalid verify returned ${invalid.status}`);

      await page.getByRole('button', { name: 'Đồng bộ phân công' }).click();
      const assignDialog = page.getByRole('dialog');
      const assignPromise = page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          new URL(r.url()).pathname === `/api/v1/operational-tasks/${created.id}/assign`,
      );
      await assignDialog.getByRole('button', { name: 'Xác nhận' }).click();
      check((await assignPromise).status() === 200, 'Task assign failed');
      await page.getByRole('heading', { name: 'Lịch sử' }).waitFor();
      await page.getByText('Chưa có bằng chứng.').waitFor();

      const currentResponse = await directFetch(`/api/v1/operational-tasks/${created.id}`, {
        token: ownerToken,
      });
      const current = currentResponse.body;
      const replayKey = crypto.randomUUID();
      const replayBody = {
        version: current.version,
        note: 'Idempotency replay check',
        evidenceIds: [],
      };
      const firstReplay = await command(
        ownerToken,
        `/api/v1/operational-tasks/${created.id}/coordinate`,
        replayBody,
        replayKey,
      );
      const secondReplay = await command(
        ownerToken,
        `/api/v1/operational-tasks/${created.id}/coordinate`,
        replayBody,
        replayKey,
      );
      check(
        firstReplay.status === 200 && secondReplay.status === 200,
        'Idempotent command did not replay successfully',
      );
      const coordinated = firstReplay.body;
      const replayed = secondReplay.body;
      check(
        coordinated.id === replayed.id && coordinated.version === replayed.version,
        'Idempotent replay returned a different result',
      );

      const startedResponse = await command(
        staffToken,
        `/api/v1/operational-tasks/${created.id}/start`,
        { version: coordinated.version, note: '', evidenceIds: [] },
      );
      check(startedResponse.status === 200, `Staff start returned ${startedResponse.status}`);
      const started = startedResponse.body;
      const submittedResponse = await command(
        staffToken,
        `/api/v1/operational-tasks/${created.id}/submit`,
        { version: started.version, note: 'Staff hoàn tất dữ liệu tổng hợp', evidenceIds: [] },
      );
      check(submittedResponse.status === 200, `Staff submit returned ${submittedResponse.status}`);

      await openTaskDetail(page, taskTitle, names.location, 'Chờ Owner kiểm tra');
      await page.getByRole('button', { name: 'Yêu cầu làm lại' }).click();
      const reworkDialog = page.getByRole('dialog');
      await reworkDialog.getByLabel(/Nội dung \/ lý do/).fill('Cần bổ sung xác nhận vận hành');
      const reworkPromise = page.waitForResponse(
        (r) => new URL(r.url()).pathname === `/api/v1/operational-tasks/${created.id}/rework`,
      );
      await reworkDialog.getByRole('button', { name: 'Xác nhận' }).click();
      const reworkResponse = await reworkPromise;
      check(reworkResponse.status() === 200, 'Owner rework failed');
      const reworked = await reworkResponse.json();
      const resubmitResponse = await command(
        staffToken,
        `/api/v1/operational-tasks/${created.id}/submit`,
        { version: reworked.version, note: 'Staff bổ sung và gửi lại', evidenceIds: [] },
      );
      check(resubmitResponse.status === 200, 'Staff resubmit failed');

      await openTaskDetail(page, taskTitle, names.location, 'Chờ Owner kiểm tra');
      await page.getByRole('button', { name: 'Xác nhận hoàn thành' }).click();
      const verifyDialog = page.getByRole('dialog');
      const verifyPromise = page.waitForResponse(
        (r) => new URL(r.url()).pathname === `/api/v1/operational-tasks/${created.id}/verify`,
      );
      await verifyDialog.getByRole('button', { name: 'Xác nhận' }).click();
      check((await verifyPromise).status() === 200, 'Owner verify failed');

      const cancelTitle = `Cancel Task ${stamp}`;
      const cancelCreate = await command(ownerToken, '/api/v1/operational-tasks', {
        locationId,
        work: { ...work, title: cancelTitle },
      });
      check(cancelCreate.status() === 201, 'Cancel fixture create failed');
      const cancelTask = await cancelCreate.json();
      await openTaskDetail(page, cancelTitle, names.location, 'Cần làm');
      await page.getByRole('button', { name: 'Hủy công việc' }).click();
      const cancelDialog = page.getByRole('dialog');
      await cancelDialog
        .getByLabel(/Nội dung \/ lý do/)
        .fill('Hủy fixture E2E theo trạng thái hợp lệ');
      const cancelPromise = page.waitForResponse(
        (r) => new URL(r.url()).pathname === `/api/v1/operational-tasks/${cancelTask.id}/cancel`,
      );
      await cancelDialog.getByRole('button', { name: 'Xác nhận' }).click();
      check((await cancelPromise).status() === 200, 'Owner cancel failed');

      await page.getByRole('button', { name: 'Về danh sách' }).click();
      await selectMui(page, 'Cơ sở', names.location);
      await selectMui(page, 'Trạng thái', 'Hoàn thành');
      await page.getByText(taskTitle).waitFor();
      await page.reload();
      await page.getByText(taskTitle).waitFor();
    });

    await scenario('BF02-07', async () => {
      await apiAction(
        page,
        'POST',
        '/api/v1/auth/logout',
        () => page.getByRole('button', { name: 'Đăng xuất' }).click(),
        [204],
      );
      await page.getByLabel('Email').fill(`${names.staff}@example.invalid`);
      await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(staffPassword);
      await apiAction(page, 'POST', '/api/v1/auth/login', () =>
        page.getByRole('button', { name: 'Đăng nhập' }).click(),
      );
      await page.goto('https://localhost:5173/staff');
      await page.waitForURL(/\/login(?:\?|$)/);
    });
  } finally {
    fs.mkdirSync(path.join(root, '.tools'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.tools/bf01-bf02-browser-evidence.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          fixture: names,
          ids: { locationId, roomTypeId, roomId },
          results,
          network,
        },
        null,
        2,
      ),
    );
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(JSON.stringify({ results, requests: network.length }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
