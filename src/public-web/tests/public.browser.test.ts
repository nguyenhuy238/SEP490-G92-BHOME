import { afterAll, beforeAll, expect, test } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const id = '00000000-0000-0000-0000-000000000001';
const location = {
  locationId: id,
  name: 'Cơ sở kiểm thử',
  address: 'Địa chỉ tổng hợp',
  summary: 'Thông tin công bố',
  amenities: ['Wifi'],
  photos: [],
  contactPhone: '0900000000',
  contactEmail: 'demo@example.invalid',
  published: true,
  publishedAt: null,
};
const room = {
  roomId: id,
  locationId: id,
  roomNumber: 'A1',
  floor: '1',
  capacity: 2,
  description: 'Phòng kiểm thử',
  amenities: ['Wifi'],
  indicativePrice: 2500000,
  vacancy: 'Available',
  photos: [],
  published: true,
  publishedAt: null,
};
let browser: Browser;
let server: Server;
let base: string;
const artifactDir = resolve('../../.tools/full-validation');
const evidence: { name: string; status: string; assertions: string }[] = [];
beforeAll(async () => {
  const dist = resolve('dist');
  if (!existsSync(resolve(dist, 'index.html')))
    throw new Error('Build public-web before browser tests.');
  server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname);
    let file = resolve(dist, '.' + pathname);
    if (!file.startsWith(dist) || !existsSync(file) || pathname === '/')
      file = resolve(dist, 'index.html');
    const contentType: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
    };
    response.writeHead(200, {
      'Content-Type': contentType[extname(file)] ?? 'application/octet-stream',
    });
    response.end(readFileSync(file));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback port');
  base = `http://127.0.0.1:${address.port}`;
  const executablePath =
    process.env.BHOME_PUBLIC_CHROMIUM_PATH ??
    [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
  mkdirSync(artifactDir, { recursive: true });
});
afterAll(async () => {
  if (browser) await browser.close();
  if (server) await new Promise<void>((done) => server.close(() => done()));
  writeFileSync(
    resolve(artifactDir, 'public-browser-results.json'),
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        browser: 'Chromium (local Edge/Chrome)',
        environment: 'isolated loopback static build + synthetic API fixtures',
        productionAccess: false,
        tests: evidence,
      },
      null,
      2,
    ),
  );
});
async function run(
  name: string,
  assertions: string,
  body: (page: Page, context: BrowserContext) => Promise<void>,
) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await body(page, context);
    expect(errors).toEqual([]);
    evidence.push({ name, status: 'PASS', assertions });
  } catch (error) {
    evidence.push({ name, status: 'FAIL', assertions });
    throw error;
  } finally {
    await context.close();
  }
}
function fixture(page: Page, body: unknown, status = 200) {
  return page.route('**/api/v1/public/**', (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    }),
  );
}

test('Guest approved photos load only through the anonymous proxy', () =>
  run(
    'approved-gallery',
    'Approved proxy image decodes; external private URL is never requested.',
    async (page) => {
      const requests: string[] = [];
      page.on('request', (request) => requests.push(request.url()));
      await page.route('**/api/v1/public/**', (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.endsWith('/rooms'))
          return route.fulfill({ json: [], headers: { 'access-control-allow-origin': '*' } });
        if (pathname.endsWith('/photos/7'))
          return route.fulfill({
            contentType: 'image/png',
            body: Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
              'base64',
            ),
            headers: { 'access-control-allow-origin': '*' },
          });
        return route.fulfill({
          json: {
            ...location,
            photos: [
              {
                index: 7,
                url: `/api/v1/public/locations/${id}/photos/7`,
                contentType: 'image/png',
                length: 68,
              },
              { index: 9, url: 'https://private.example.invalid/hidden.png' },
            ],
          },
          headers: { 'access-control-allow-origin': '*' },
        });
      });
      await page.goto(base + `/locations/${id}`);
      const photo = page.getByRole('img', { name: `${location.name} — ảnh 8` });
      await photo.waitFor();
      await photo.evaluate(async (image) => {
        await (image as HTMLImageElement).decode();
      });
      expect(
        await photo.evaluate((image) => (image as HTMLImageElement).naturalWidth),
      ).toBeGreaterThan(0);
      expect(requests.some((url) => url.includes('private.example.invalid'))).toBe(false);
    },
  ));

for (const width of [1440, 768, 390])
  test(`Published catalogue search, room filters and layout at ${width}px`, () =>
    run(
      `catalogue-${width}`,
      'Synthetic published data; name/address search, room filters, contact, SEO, GET-only requests and no horizontal overflow.',
      async (page) => {
        const methods: string[] = [];
        await page.setViewportSize({ width, height: 900 });
        await page.route('**/api/v1/public/**', (route) => {
          methods.push(route.request().method());
          const path = new URL(route.request().url()).pathname;
          const body =
            path === '/api/v1/public/locations'
              ? [location]
              : path.endsWith('/rooms')
                ? [
                    room,
                    {
                      ...room,
                      roomId: '00000000-0000-0000-0000-000000000002',
                      roomNumber: 'B2',
                      vacancy: 'Occupied',
                      capacity: 4,
                      indicativePrice: null,
                      amenities: ['Parking'],
                    },
                  ]
                : path.includes('/public/rooms/')
                  ? room
                  : location;
          return route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
        });
        await page.goto(base);
        await page.getByRole('heading', { name: location.name }).waitFor();
        await page.screenshot({
          path: resolve(artifactDir, `fe09-home-${width}.png`),
          fullPage: true,
        });
        await page.getByLabel('Tìm tên cơ sở hoặc địa chỉ').fill('không có');
        await page.getByText(/Không có cơ sở phù hợp/).waitFor();
        await page.getByLabel('Tìm tên cơ sở hoặc địa chỉ').fill('tổng hợp');
        await page.getByRole('link', { name: 'Xem cơ sở và phòng' }).click();
        await page.getByRole('link', { name: 'Phòng B2', exact: true }).waitFor();
        await page.getByLabel('Tình trạng phòng').click();
        await page.getByRole('option', { name: 'Còn trống', exact: true }).click();
        expect(await page.getByRole('link', { name: 'Phòng B2', exact: true }).count()).toBe(0);
        await page.getByLabel('Giá tối đa (VND)').fill('1000000');
        await page.getByText('Không có phòng phù hợp với bộ lọc.').waitFor();
        await page.getByRole('button', { name: 'Xóa bộ lọc phòng' }).click();
        await page.getByLabel('Sức chứa tối thiểu').click();
        await page.getByRole('option', { name: '4 người', exact: true }).click();
        expect(await page.getByRole('link', { name: 'Phòng A1', exact: true }).count()).toBe(0);
        await page.getByRole('button', { name: 'Xóa bộ lọc phòng' }).click();
        await page.getByLabel('Tiện ích phòng').click();
        await page.getByRole('option', { name: 'Wifi', exact: true }).click();
        expect(await page.getByRole('link', { name: 'Phòng B2', exact: true }).count()).toBe(0);
        await page.getByRole('link', { name: 'Phòng A1', exact: true }).click();
        await page.getByRole('link', { name: location.contactEmail }).waitFor();
        expect(await page.title()).toBe('Phòng A1 | BHOME');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(methods.every((method) => method === 'GET')).toBe(true);
        expect(
          await page.getByRole('button', { name: /đặt phòng|đặt cọc|thanh toán/i }).count(),
        ).toBe(0);
        await page.screenshot({
          path: resolve(artifactDir, `fe09-room-${width}.png`),
          fullPage: true,
        });
      },
    ));

test('Guest home, navigation, unknown URL and mobile layout', () =>
  run(
    'home-navigation-not-found-mobile',
    'Both navigation links, home CTA, local 404; no Guest write forms; 390px no overflow.',
    async (page) => {
      await fixture(page, []);
      await page.goto(base);
      await page.getByRole('heading', { name: 'Chào mừng đến với BHOME' }).waitFor();
      await page.getByRole('navigation', { name: 'Điều hướng chính' }).waitFor();
      await page.keyboard.press('Tab');
      expect(
        await page
          .getByRole('link', { name: 'Trang chủ', exact: true })
          .evaluate((link) => getComputedStyle(link).outlineColor),
      ).toBe('rgb(255, 255, 255)');
      await page.screenshot({ path: resolve(artifactDir, 'fe09-nav-focus.png'), fullPage: true });
      expect(
        await page
          .locator('form,textarea,input[type=password],input[type=email],input[type=tel]')
          .count(),
      ).toBe(0);
      await page.getByRole('link', { name: 'Khám phá cơ sở', exact: true }).click();
      await page.getByText(/Hiện chưa có cơ sở được công bố/).waitFor();
      await page.getByRole('link', { name: 'Trang chủ', exact: true }).click();
      await page.getByRole('heading', { name: 'Chào mừng đến với BHOME' }).waitFor();
      await page.getByRole('navigation').getByRole('link', { name: 'Cơ sở', exact: true }).click();
      await page.getByRole('heading', { name: 'Khám phá cơ sở' }).waitFor();
      await page.goto(base + '/unknown-page');
      await page.getByRole('heading', { name: 'Không tìm thấy trang' }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: resolve(artifactDir, 'public-mobile-not-found.png'),
        fullPage: true,
      });
    },
  ));

test('Guest can navigate published list, location, room and back', () =>
  run(
    'published-navigation',
    'All public content links work using GET fixtures; long published names fit mobile width.',
    async (page) => {
      const longName = 'Cơ sở ' + 'A'.repeat(160);
      await page.route('**/api/v1/public/**', (route) => {
        const pathname = new URL(route.request().url()).pathname;
        const data =
          pathname === '/api/v1/public/locations'
            ? [{ ...location, name: longName }]
            : pathname === `/api/v1/public/locations/${id}/rooms`
              ? [room]
              : pathname === `/api/v1/public/locations/${id}`
                ? { ...location, name: longName }
                : room;
        return route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } });
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(base + '/locations');
      await page.getByRole('link', { name: 'Xem cơ sở và phòng' }).click();
      await page.getByRole('heading', { name: longName, exact: true }).waitFor();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.getByRole('link', { name: 'Phòng A1', exact: true }).click();
      await page.getByRole('heading', { name: 'Phòng A1', level: 1 }).waitFor();
      await page.getByRole('link', { name: 'Xem cơ sở', exact: true }).click();
      await page.getByRole('link', { name: 'Tất cả cơ sở' }).click();
      await page.getByRole('heading', { name: 'Khám phá cơ sở' }).waitFor();
    },
  ));

test('Guest loading and empty published list', () =>
  run(
    'locations-loading-empty',
    'Visible live loading followed by localized empty state, read-only GET.',
    async (page) => {
      let release!: () => void;
      const held = new Promise<void>((done) => {
        release = done;
      });
      await page.route('**/api/v1/public/locations', async (route) => {
        await held;
        await route.fulfill({ json: [], headers: { 'access-control-allow-origin': '*' } });
      });
      await page.goto(base + '/locations');
      await page.getByRole('status').filter({ hasText: 'Đang tải thông tin' }).waitFor();
      release();
      await page.getByText('Hiện chưa có cơ sở được công bố. Vui lòng quay lại sau.').waitFor();
    },
  ));

test('Guest structured 503 redaction and locked manual retry', () =>
  run(
    'locations-503-safe-retry',
    'One bounded automatic replay; manual retry disabled while pending; raw provider detail absent; recovery clears alert.',
    async (page) => {
      let count = 0;
      let release!: () => void;
      const held = new Promise<void>((done) => {
        release = done;
      });
      await page.route('**/api/v1/public/locations', async (route) => {
        count++;
        if (count <= 2)
          await route.fulfill({
            status: 503,
            json: { detail: 'NpgsqlException secret SELECT * FROM users' },
            headers: { 'access-control-allow-origin': '*' },
          });
        else {
          await held;
          await route.fulfill({
            json: [location],
            headers: { 'access-control-allow-origin': '*' },
          });
        }
      });
      await page.goto(base + '/locations');
      await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
      const retry = page.getByRole('button', { name: 'Đang thử lại…', exact: true });
      await retry.waitFor();
      expect(await retry.isDisabled()).toBe(true);
      expect(count).toBe(3);
      expect(await page.getByText(/NpgsqlException|SELECT/).count()).toBe(0);
      release();
      await page.getByRole('heading', { name: location.name }).waitFor();
      expect(await page.getByRole('alert').count()).toBe(0);
      await page.screenshot({
        path: resolve(artifactDir, 'public-locations-recovered.png'),
        fullPage: true,
      });
    },
  ));

for (const status of [400, 401, 403, 404, 429])
  test(`Guest ${status} refuses without automatic replay or raw detail`, () =>
    run(
      `public-${status}`,
      'Permanent refusal is localized, request count stays one, no private error detail.',
      async (page) => {
        let count = 0;
        await page.route('**/api/v1/public/**', async (route) => {
          count++;
          await route.fulfill({
            status,
            json: { detail: 'private backend detail' },
            headers: { 'access-control-allow-origin': '*' },
          });
        });
        await page.goto(base + `/rooms/${id}`);
        await page.getByRole('alert').waitFor();
        await page.waitForTimeout(1300);
        expect(count).toBe(1);
        expect(await page.getByText('private backend detail').count()).toBe(0);
        if (status === 404)
          await page.getByText('Thông tin không tồn tại hoặc chưa được công bố.').waitFor();
      },
    ));

test('Guest location rooms independent error and retry, static contact only', () =>
  run(
    'location-rooms-retry',
    'Location stays visible; rooms failure can recover to empty; contact values are static; no contact submission.',
    async (page) => {
      let roomsCalls = 0;
      await page.route('**/api/v1/public/**', async (route) => {
        const rooms = new URL(route.request().url()).pathname.endsWith('/rooms');
        if (rooms) roomsCalls++;
        await route.fulfill({
          status: rooms && roomsCalls <= 2 ? 503 : 200,
          json: rooms ? (roomsCalls <= 2 ? {} : []) : location,
          headers: { 'access-control-allow-origin': '*' },
        });
      });
      await page.goto(base + `/locations/${id}`);
      await page.getByRole('heading', { name: location.name }).waitFor();
      await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
      await page.getByText('Cơ sở chưa công bố phòng.').waitFor();
      await page.getByText('demo@example.invalid').waitFor();
      expect(
        await page
          .locator('form,textarea,input[type=password],input[type=email],input[type=tel]')
          .count(),
      ).toBe(0);
    },
  ));

test('Guest published room, price, vacancy and broken image recovery', () =>
  run(
    'room-photo-recovery',
    'Published VND/availability; failed image fallback/retry; no private/external image request or write API.',
    async (page) => {
      const methods: string[] = [];
      await page.route('**/api/v1/public/**', async (route) => {
        methods.push(route.request().method());
        const photo = new URL(route.request().url()).pathname.endsWith('/photos/0');
        if (photo) await route.fulfill({ status: 503, body: '' });
        else
          await route.fulfill({
            json: {
              ...room,
              photos: [
                { index: 0, url: `/api/v1/public/rooms/${id}/photos/0` },
                { index: 1, url: 'https://private.example.invalid/secret.png' },
              ],
            },
            headers: { 'access-control-allow-origin': '*' },
          });
      });
      await page.goto(base + `/rooms/${id}`);
      await page.getByRole('heading', { name: 'Phòng A1', exact: true, level: 1 }).waitFor();
      await page.getByText('2.500.000 ₫ / tháng (tham khảo)').waitFor();
      await page.getByText('2 người · Còn trống').waitFor();
      const retry = page.getByRole('button', { name: 'Thử tải lại ảnh 1' });
      await retry.waitFor();
      await retry.click();
      await retry.waitFor();
      expect(methods.every((method) => method === 'GET')).toBe(true);
      expect(await page.locator('img[src*="private.example.invalid"]').count()).toBe(0);
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: resolve(artifactDir, 'public-room-image-failure.png'),
        fullPage: true,
      });
    },
  ));

test('Guest offline request has safe retry feedback', () =>
  run(
    'public-offline',
    'Aborted transport is localized and recoverable; no browser/library English error.',
    async (page) => {
      await page.route('**/api/v1/public/**', (route) => route.abort('internetdisconnected'));
      await page.goto(base + '/locations');
      await page.getByText('Chưa thể tải thông tin. Vui lòng thử lại.').waitFor();
      expect(await page.getByText(/Failed to fetch|NetworkError|TypeError/).count()).toBe(0);
      await page.unroute('**/api/v1/public/**');
      await fixture(page, []);
      await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
      await page.getByText(/Hiện chưa có cơ sở được công bố/).waitFor();
    },
  ));
