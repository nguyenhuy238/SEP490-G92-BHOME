// Browser integration against the production Expo web export. All transport is
// synthetic; this does not establish native-device or live-provider behavior.
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const repo = path.resolve(__dirname, '../..');
const root = path.resolve(repo, process.env.BHOME_MOBILE_WEB_DIST || 'src/mobile/dist');
const out = path.join(repo, '.tools/owner-redesign-20261114/browser');
fs.mkdirSync(out, { recursive: true });
const ids = {
  owner: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  location: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  incident: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  work: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  task: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  room: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
};
const requests = [],
  errors = [],
  unexpected = [];
let verified = false,
  approved = false;
const now = '2026-11-14T01:00:00Z';
const incident = {
  id: ids.incident,
  code: 'SC-MAU',
  locationId: ids.location,
  roomId: ids.room,
  assetId: null,
  commonArea: null,
  description: 'Mất nước tại tầng hai',
  severity: 'Emergency',
  status: 'InProgress',
  type: 'Nước',
  category: 'Thiết bị',
  acknowledgedAt: now,
  resolutionNote: null,
  version: 2,
  createdAt: now,
  staffAvailable: true,
  escalationEnabled: false,
};
const work = () => ({
  id: ids.work,
  incidentId: ids.incident,
  locationId: ids.location,
  roomId: ids.room,
  assetId: null,
  assignedStaffId: ids.owner,
  expectedOutcome: 'Khôi phục máy bơm nước',
  targetCompletionAt: '2026-12-14T10:00:00Z',
  isOverdue: false,
  status: approved ? 'InProgress' : 'PendingApproval',
  inspectionResult: 'Rơ-le hỏng',
  proposedSolution: 'Thay rơ-le',
  estimatedMinutes: 45,
  estimatedCost: 150000,
  vendor: null,
  proposalVersion: 1,
  planApproved: approved,
  canStart: approved,
  approvedById: null,
  approvedAt: null,
  result: null,
  actualCost: null,
  verifiedById: null,
  verifiedAt: null,
  version: approved ? 4 : 3,
});
const task = () => ({
  id: ids.task,
  locationId: ids.location,
  kind: 'AdHoc',
  title: 'Kiểm tra hệ thống chiếu sáng',
  requirements: 'Kiểm tra hành lang và lối thoát hiểm',
  priority: 'Normal',
  dueAt: '2026-12-14T10:00:00Z',
  evidenceRequired: false,
  status: verified ? 'Completed' : 'PendingVerification',
  isOverdue: false,
  currentResponsibleStaffUserId: ids.owner,
  responsibilityAvailable: true,
  result: 'Các đèn đang hoạt động tốt',
  version: verified ? 5 : 4,
  verifiedAt: verified ? now : null,
});
const pageData = (items, url, total = items.length) => ({
  items,
  totalCount: total,
  page: +(url.searchParams.get('page') || 1),
  pageSize: +(url.searchParams.get('pageSize') || 20),
});
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
      '.ttf': 'font/ttf',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
    }[path.extname(file)] || 'application/octet-stream',
  );
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    executablePath:
      process.env.BHOME_BROWSER_EXECUTABLE ||
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('https://api.example.invalid/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        p = url.pathname,
        method = request.method();
      requests.push({
        path: p + url.search,
        method,
        ...(method === 'POST' && !p.includes('/auth/')
          ? { body: request.postDataJSON(), key: request.headers()['idempotency-key'] }
          : {}),
      });
      let data,
        status = 200;
      if (method === 'OPTIONS') return route.fulfill({ status: 204 });
      if (p === '/api/v1/auth/login') {
        const payload = Buffer.from(
          JSON.stringify({
            sub: ids.owner,
            role: ['Owner'],
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        ).toString('base64url');
        data = { accessToken: `synthetic.${payload}.test-only`, refreshToken: 'synthetic-only' };
      } else if (p === '/api/v1/account/profile')
        data = {
          userId: ids.owner,
          fullName: 'Chủ cơ sở mẫu',
          phone: null,
          email: 'owner.synthetic@example.invalid',
          roles: ['Owner'],
          isActive: true,
          version: 'synthetic-v1',
        };
      else if (p === '/api/v1/notifications/unread-count') data = { unreadCount: 2 };
      else if (p === '/api/v1/notifications') data = pageData([], url);
      else if (p === '/api/v1/capture/locations')
        data = [{ id: ids.location, label: 'Cơ sở Bình An' }];
      else if (p === '/api/v1/capture/staff') data = [{ id: ids.owner, label: 'Nhân viên mẫu' }];
      else if (p === '/api/v1/locations') data = pageData([{ id: ids.location }], url, 2);
      else if (p === '/api/v1/rooms')
        data = pageData(
          [{ id: ids.room }],
          url,
          url.searchParams.get('roomStatus') === '2'
            ? 18
            : url.searchParams.get('roomStatus') === '0'
              ? 6
              : 24,
        );
      else if (p === `/api/v1/locations/${ids.location}`)
        data = { id: ids.location, name: 'Cơ sở Bình An' };
      else if (p === `/api/v1/rooms/${ids.room}`) data = { id: ids.room, roomNumber: '201' };
      else if (p === '/api/v1/debts/summary')
        data = { outstandingAmount: '12500000', overdueAmount: '3500000', overdueInvoiceCount: 2 };
      else if (p === '/api/v1/contracts') data = pageData([], url);
      else if (p === '/api/v1/operational-tasks')
        data = pageData(
          url.searchParams.get('status') === 'PendingVerification' && verified ? [] : [task()],
          url,
        );
      else if (p === `/api/v1/operational-tasks/${ids.task}/verify`) {
        assert.equal(method, 'POST');
        assert.equal(request.postDataJSON().version, 4);
        assert.ok(request.headers()['idempotency-key']);
        verified = true;
        data = task();
      } else if (p === `/api/v1/operational-tasks/${ids.task}`) data = task();
      else if (p.includes('/operational-tasks/') && p.endsWith('/history'))
        data = pageData([], url);
      else if (p.includes('/operational-tasks/') && p.endsWith('/evidence')) data = [];
      else if (p === '/api/v1/incidents')
        data = pageData(url.searchParams.get('status') === 'Submitted' ? [] : [incident], url);
      else if (p === `/api/v1/incidents/${ids.incident}`) data = incident;
      else if (p === `/api/v1/incidents/${ids.incident}/history`) data = pageData([], url);
      else if (p.startsWith(`/api/v1/incidents/${ids.incident}/`)) data = [];
      else if (p === '/api/v1/work-orders')
        data = pageData(
          url.searchParams.get('workOrderStatus') === 'PendingVerification' ||
            (url.searchParams.get('workOrderStatus') === 'PendingApproval' && approved)
            ? []
            : [work()],
          url,
        );
      else if (p === `/api/v1/work-orders/${ids.work}/plan-decision`) {
        assert.equal(method, 'POST');
        assert.equal(request.postDataJSON().version, 3);
        approved = true;
        data = { incidentId: ids.incident, workOrderId: ids.work, resourceId: null };
      } else if (p === '/api/v1/work-orders/maintenance-history') data = pageData([], url);
      else if (p === `/api/v1/work-orders/${ids.work}`) data = work();
      else {
        unexpected.push({ path: p, method });
        status = 404;
        data = { code: 'synthetic_unhandled_endpoint' };
      }
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
    await page
      .getByLabel('Email hoặc số điện thoại đăng nhập', { exact: true })
      .fill('owner.synthetic@example.invalid');
    await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill('Synthetic-UI-Only!2026');
    await page.getByRole('button', { name: /Đăng nhập$/ }).click();
    await page.getByText('Tổng số phòng', { exact: true }).waitFor();
    await page.getByText('24', { exact: true }).waitFor();
    assert.equal(await page.getByText('Test OCR', { exact: true }).count(), 0);
    const tab = (name) => page.getByRole('tab', { name, exact: true });
    const capture = async (name) => {
      await page.evaluate(async () => {
        for (const el of globalThis.document.querySelectorAll('*'))
          if (
            el.scrollHeight > el.clientHeight &&
            globalThis.getComputedStyle(el).overflowY === 'auto'
          )
            el.scrollTop = 0;
        await globalThis.document.fonts.ready;
        await Promise.all(
          globalThis.document
            .getAnimations()
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      assert.equal(
        await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
        ),
        false,
        `Horizontal overflow on ${name}`,
      );
      await page.screenshot({ path: path.join(out, name + '.png') });
    };
    for (const width of [360, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await tab('Tổng quan').click();
      await page.getByText('Tổng số phòng', { exact: true }).waitFor();
      const amount = page.getByText('12.500.000 ₫', { exact: true }).filter({ visible: true });
      await amount.waitFor();
      assert.equal(
        await amount.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
        false,
        'The debt KPI must show the full amount on compact screens',
      );
      await capture(`overview-${width}`);
      const overviewAction = await page
        .getByRole('button', { name: 'Xem tất cả', exact: true })
        .boundingBox();
      assert.ok(
        overviewAction && overviewAction.height >= 48,
        'Owner dashboard actions must have a 48px touch target',
      );
      const reads = requests.filter((item) => item.method === 'GET').length;
      await tab('Cần xử lý').click();
      await page
        .getByText('Cần xử lý', { exact: true })
        .filter({ visible: true })
        .first()
        .waitFor();
      await page
        .getByRole('button', { name: 'Xem cảnh báo: Mất nước tại tầng hai', exact: true })
        .last()
        .waitFor();
      await capture(`attention-${width}`);
      const attentionFilter = await page
        .getByRole('button', { name: 'Tất cả', exact: true })
        .boundingBox();
      assert.ok(
        attentionFilter && attentionFilter.height >= 48 && attentionFilter.width >= 48,
        'Owner attention filters must have a 48px touch target',
      );
      const emergencyContrast = await page
        .getByRole('button', { name: 'Xem cảnh báo: Mất nước tại tầng hai', exact: true })
        .getByText('Khẩn cấp · Đang xử lý', { exact: true })
        .evaluate((element) => {
          const luminance = (color) => {
            const values = color
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number)
              .map((value) => {
                const channel = value / 255;
                return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
              });
            return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
          };
          const foreground = luminance(globalThis.getComputedStyle(element).color);
          let parent = element.parentElement;
          while (
            parent &&
            globalThis.getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)'
          )
            parent = parent.parentElement;
          const background = luminance(globalThis.getComputedStyle(parent).backgroundColor);
          return (
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
          );
        });
      assert.ok(emergencyContrast >= 4.5, 'Owner emergency labels must meet normal-text contrast');
      await tab('Tổng quan').click();
      assert.equal(
        requests.filter((item) => item.method === 'GET').length,
        reads,
        'Fresh Overview/Attention must share cached reads',
      );
      await tab('Vận hành').click();
      await page.getByRole('button', { name: 'Trạng thái', exact: true }).waitFor();
      await capture(`operations-${width}`);
      const operationsFilter = await page
        .getByRole('button', { name: 'Sự cố', exact: true })
        .boundingBox();
      assert.ok(
        operationsFilter && operationsFilter.height >= 48 && operationsFilter.width >= 48,
        'Owner operations filters must have a 48px touch target',
      );
      await tab('Tài khoản').click();
      await page.getByText('Chủ cơ sở mẫu', { exact: true }).first().waitFor();
      await capture(`account-${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await tab('Cần xử lý').click();
    await page
      .getByRole('button', { name: 'Kiểm tra kết quả: Kiểm tra hệ thống chiếu sáng', exact: true })
      .click();
    await page.getByRole('button', { name: 'Thao tác', exact: true }).click();
    await page.getByRole('radio', { name: 'Xác nhận hoàn thành', exact: true }).click();
    await page.getByRole('button', { name: 'Xác nhận thao tác', exact: true }).click();
    await page.getByRole('button', { name: 'Xác nhận gửi', exact: true }).waitFor();
    assert.equal(
      requests.some((item) => item.path.endsWith('/verify')),
      false,
    );
    await page.getByRole('button', { name: 'Xác nhận gửi', exact: true }).click();
    await page.getByText('Hoàn thành', { exact: true }).waitFor();
    assert.equal(requests.filter((item) => item.path.endsWith('/verify')).length, 1);
    await page.getByLabel('Quay lại', { exact: true }).click();
    await page.getByText('Cần xử lý', { exact: true }).filter({ visible: true }).first().waitFor();
    await page
      .getByRole('button', { name: 'Kiểm tra kết quả: Kiểm tra hệ thống chiếu sáng', exact: true })
      .waitFor({ state: 'hidden' });
    assert.equal(
      await page
        .getByRole('button', {
          name: 'Kiểm tra kết quả: Kiểm tra hệ thống chiếu sáng',
          exact: true,
        })
        .count(),
      0,
    );
    await page
      .getByRole('button', { name: 'Xem phương án: Khôi phục máy bơm nước', exact: true })
      .click();
    await page.getByRole('button', { name: 'Chọn thao tác', exact: true }).click();
    await page.getByRole('radio', { name: 'Quyết định phương án', exact: true }).click();
    await page.getByRole('button', { name: 'Quyết định phê duyệt', exact: true }).click();
    await page.getByRole('radio', { name: 'Phê duyệt', exact: true }).click();
    await page
      .getByRole('checkbox', {
        name: 'Tôi đã kiểm tra thông tin và xác nhận gửi thao tác này',
        exact: true,
      })
      .click();
    await page.getByRole('button', { name: 'Quyết định phương án', exact: true }).click();
    await page.getByRole('button', { name: 'Xác nhận gửi', exact: true }).click();
    await page.getByText('Phương án: Đã được duyệt', { exact: false }).waitFor();
    assert.equal(requests.filter((item) => item.path.endsWith('/plan-decision')).length, 1);
    await capture('maintenance-approved-390');
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    assert.equal(
      requests.some((item) =>
        /payment-transactions|invoice-adjustments|financial-reports/.test(item.path),
      ),
      false,
    );
    fs.writeFileSync(
      path.join(out, 'results.json'),
      JSON.stringify(
        {
          passed: true,
          platform: 'Expo web export with synthetic transport',
          widths: [360, 390, 768],
          requests,
          errors,
          unexpected,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS: four Owner tabs, responsive layout, shared cache, task verification, maintenance decision and server-confirmed queue refresh. Synthetic transport; no native/live-provider claim.',
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
