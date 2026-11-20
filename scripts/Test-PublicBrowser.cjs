const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const origin = 'https://public-staging.103.146.23.157.sslip.io';
const api = 'https://api-staging.103.146.23.157.sslip.io';
const id = '11111111-1111-4111-8111-111111111111';
const roomId = '22222222-2222-4222-8222-222222222222';
const photoPath = `/api/v1/public/locations/${id}/photos/0`;
const fixture = {
  locationId: id,
  name: 'Cơ sở kiểm thử tổng hợp',
  address: 'Địa chỉ minh họa',
  summary: 'Dữ liệu tổng hợp chỉ dùng cho kiểm thử giao diện.',
  amenities: ['Wifi'],
  contactPhone: null,
  contactEmail: 'public@example.invalid',
  photos: [{ index: 0, url: photoPath, contentType: 'image/png', length: 68 }],
  published: true,
  publishedAt: '2026-11-20T00:00:00Z',
};
const room = {
  roomId,
  locationId: id,
  roomNumber: 'DEMO-01',
  floor: '1',
  capacity: 2,
  description: 'Phòng kiểm thử tổng hợp',
  amenities: ['Wifi'],
  indicativePrice: 3500000,
  vacancy: 'Available',
  photos: [],
  published: true,
  publishedAt: '2026-11-20T00:00:00Z',
};
(async () => {
  const output = path.resolve('.tools/public-browser');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    executablePath:
      process.env.BHOME_TEST_BROWSER ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
  });
  const evidence = [];
  try {
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const requests = [],
        failures = [];
      page.on('request', (r) => {
        if (new URL(r.url()).pathname.startsWith('/api/'))
          requests.push({
            origin: new URL(r.url()).origin,
            path: new URL(r.url()).pathname,
            method: r.method(),
          });
      });
      page.on('requestfailed', (r) => failures.push(new URL(r.url()).pathname));
      const response = await page.goto(origin);
      assert.equal(response.status(), 200);
      await page.getByRole('link', { name: 'Khám phá cơ sở' }).click();
      await page.getByText('Hiện chưa có cơ sở được công bố.', { exact: false }).waitFor();
      await page.screenshot({
        path: path.join(output, `live-${viewport.width}.png`),
        fullPage: true,
      });
      await page.goto(origin + '/rooms/00000000-0000-0000-0000-000000000000');
      await page.getByText('Thông tin không tồn tại hoặc chưa được công bố.').waitFor();
      await page.goto(origin + '/not-a-page');
      await page.getByRole('heading', { name: 'Không tìm thấy trang' }).waitFor();
      assert.ok(requests.length && requests.every((r) => r.origin === api && r.method === 'GET'));
      assert.deepEqual(failures, []);
      evidence.push({ viewport, mode: 'LIVE_STAGING', result: 'PASS', requests: [...requests] });
      // The live dataset has no publications. Positive content tests use explicit synthetic responses.
      await page.route(api + '/api/v1/public/**', async (route) => {
        const p = new URL(route.request().url()).pathname;
        if (p === photoPath)
          return route.fulfill({
            contentType: 'image/png',
            body: Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
              'base64',
            ),
            headers: { 'Access-Control-Allow-Origin': origin },
          });
        let body;
        if (p === '/api/v1/public/locations') body = [fixture];
        if (p === `/api/v1/public/locations/${id}`) body = fixture;
        if (p === `/api/v1/public/locations/${id}/rooms`) body = [room];
        if (p === `/api/v1/public/rooms/${roomId}`) body = room;
        return route.fulfill({
          status: body ? 200 : 404,
          contentType: 'application/json',
          body: JSON.stringify(body || {}),
          headers: { 'Access-Control-Allow-Origin': origin },
        });
      });
      await page.goto(origin + '/locations');
      await page.getByRole('link', { name: fixture.name, exact: true }).click();
      await page.getByRole('heading', { name: fixture.name }).waitFor();
      await page.getByRole('img', { name: `${fixture.name} — ảnh 1` }).waitFor();
      assert.ok(
        await page
          .getByRole('img', { name: `${fixture.name} — ảnh 1` })
          .evaluate((image) => image.complete && image.naturalWidth > 0),
        'Synthetic public photo loads',
      );
      await page.getByRole('link', { name: 'Phòng DEMO-01' }).click();
      await page.getByRole('heading', { name: 'Phòng DEMO-01', exact: true }).first().waitFor();
      await page.getByText('3.500.000 ₫ / tháng (tham khảo)').waitFor();
      await page.reload();
      await page.getByText('Phòng kiểm thử tổng hợp').waitFor();
      assert.equal(
        await page.locator('form,input').count(),
        0,
        'Guest site must not capture personal data',
      );
      assert.ok(
        await page
          .locator('html')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
        'No horizontal overflow',
      );
      await page.screenshot({
        path: path.join(output, `fixture-room-${viewport.width}.png`),
        fullPage: true,
      });
      await page.route(api + '/api/v1/public/locations', (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{}',
          headers: { 'Access-Control-Allow-Origin': origin },
        }),
      );
      await page.goto(origin + '/locations');
      await page.getByText('Chưa thể tải thông tin.', { exact: false }).waitFor();
      evidence.push({
        viewport,
        mode: 'SYNTHETIC_UI_CONTRACT',
        result: 'PASS',
        details: [
          'published location',
          'room',
          'price',
          'reload',
          'error',
          'no forms',
          'responsive',
        ],
      });
      await context.close();
    }
    fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error('Public browser smoke failed: ' + error.message);
  process.exitCode = 1;
});
