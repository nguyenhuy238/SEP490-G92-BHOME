const { chromium } = require('playwright-core');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
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
          requests.push({ origin: new URL(r.url()).origin, path: new URL(r.url()).pathname });
      });
      page.on('requestfailed', (r) => {
        const p = new URL(r.url());
        failures.push({ origin: p.origin, path: p.pathname });
      });
      const response = await page.goto('https://owner.103.146.23.157.sslip.io/login');
      assert.equal(response.status(), 200);
      await page.locator('#login-identifier').waitFor();
      await page.waitForLoadState('networkidle');
      await page.reload();
      await page.waitForLoadState('networkidle');
      assert.ok(requests.length);
      assert.ok(
        requests.every((r) =>
          ['https://owner.103.146.23.157.sslip.io', 'https://api.103.146.23.157.sslip.io'].includes(
            r.origin,
          ),
        ),
      );
      // Fresh context + explicit reload checks the current served assets, independent of an old user profile cache.
      const serviceWorkers = await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      );
      assert.equal(serviceWorkers, 0);
      await page.goto('https://www.103.146.23.157.sslip.io');
      await page.getByRole('heading', { name: 'Chào mừng đến với BHOME' }).waitFor();
      await page.getByRole('link', { name: 'Khám phá cơ sở' }).click();
      await page.waitForLoadState('networkidle');
      const publicLocationsRouteImplemented = new URL(page.url()).pathname === '/locations';
      evidence.push({
        viewport,
        owner: 'PASS_ANONYMOUS_REFRESH_ORIGIN',
        requests: [...requests],
        serviceWorkers,
        failures,
        publicLocationsRouteImplemented,
        authenticatedProductionFlow: 'NOT_RUN_NO_APPROVED_TEST_ACCOUNT',
      });
      await context.close();
    }
    fs.writeFileSync(
      '.tools/bhome-vps-session/production-browser-boundary.json',
      JSON.stringify(evidence, null, 2),
    );
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error('Production boundary test failed: ' + error.message);
  process.exitCode = 1;
});
