// Invoked only by BHome.ContractVerification. All accounts/data are synthetic; all API traffic
// reaches the shipped HTTPS API. No route.fulfill, provider replacement or seeded Active contract.
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

function sourceModule(relative) {
  const file = path.join(root, relative);
  const code = require('esbuild').buildSync({
    entryPoints: [file],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    write: false,
    logLevel: 'silent',
  }).outputFiles[0].text;
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = module.paths;
  loaded._compile(code, file);
  return loaded.exports;
}
async function main(settings) {
  assert.equal(new URL(settings.baseUrl).hostname, 'localhost');
  assert.equal(new URL(settings.baseUrl).protocol, 'https:');
  assert.equal(new URL(settings.origin).hostname, 'localhost');
  const { MobileApi } = sourceModule('src/mobile/src/lib/api.ts');
  const { SessionClient } = sourceModule('packages/client-core/src/sessionClient.ts');
  const { createApiClient } = sourceModule('packages/client-core/src/api.ts');
  const { contractClient, businessToday } = sourceModule('packages/client-core/src/contracts.ts');
  const checks = [];
  const check = async (name, work) => {
    try {
      await work();
      checks.push({ name, result: 'PASS' });
    } catch (e) {
      e.message = name + ': ' + e.message;
      throw e;
    }
  };
  const denied = async (work, status) => {
    try {
      await work();
      assert.fail(`Expected HTTP ${status}, received success`);
    } catch (e) {
      assert.equal(e.status, status, `Expected HTTP ${status}, received ${e.status ?? e.name}`);
    }
  };
  const sessions = {};
  for (const [name, actor] of Object.entries(settings.actors)) {
    const auth = new SessionClient(settings.baseUrl, 'mobile');
    await auth.login(actor.email, actor.password);
    const mobile = new MobileApi(
      settings.baseUrl,
      () => auth.session?.accessToken,
      auth.refresh,
      auth.clear,
    );
    const raw = createApiClient(
      settings.baseUrl,
      () => auth.session?.accessToken,
      auth.clear,
      auth.refresh,
    );
    sessions[name] = {
      auth,
      mobile,
      raw,
      contracts: contractClient((...args) => mobile.request(...args)),
    };
  }
  const owner = sessions.owner,
    staff = sessions.staff,
    tenant = sessions.tenant;
  const post = (actor, url, body) => actor.raw(url, { method: 'POST', body: JSON.stringify(body) });
  const today = businessToday();
  const after = (days) => {
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const location = await post(owner, '/api/v1/locations', {
    name: 'SYNTHETIC LIVE LOCATION',
    address: 'Synthetic verification workspace',
  });
  const type = await post(owner, '/api/v1/room-types', {
    locationId: location.id,
    name: 'Synthetic studio',
    defaultCapacity: 2,
    areaM2: 20,
    amenities: [],
  });
  const room = await post(owner, '/api/v1/rooms', {
    locationId: location.id,
    roomTypeId: type.id,
    roomNumber: 'LIVE101',
    capacity: 2,
  });
  await post(owner, '/api/v1/staff-location-assignments', {
    locationId: location.id,
    staffUserId: settings.actors.staff.id,
    startDate: today,
    endDate: after(2),
  });
  const resident = await post(owner, '/api/v1/capture/residents', {
    roomId: room.id,
    displayLabel: 'SYNTHETIC REPRESENTATIVE',
    residentType: 0,
  });
  await post(staff, `/api/v1/capture/residents/${resident.id}/confirm`, {
    humanConfirmed: true,
    citizenIdentityNumber: '000000000000',
    fullName: 'SYNTHETIC VERIFICATION PERSON',
    dateOfBirth: '2000-01-01',
  });
  await check(
    'Identity login + property/assignment + confirmed synthetic resident via real HTTP',
    async () => {
      const response = await fetch(settings.baseUrl + '/health/ready');
      assert.equal(response.status, 200);
      const probe = await fetch(settings.baseUrl + '/test-probes/error', {
        headers: { Authorization: 'Bearer ' + owner.auth.session.accessToken },
      });
      assert.equal(probe.status, 404);
    },
  );
  const artifacts = path.join(root, '.tools/contract-stabilization/live');
  mkdirSync(artifacts, { recursive: true });
  const playwright = require(path.join(root, '.tools/contract-browser/node_modules/playwright'));
  const viteEntry = require.resolve('vite', { paths: [path.join(root, 'src/owner-web')] });
  const { createServer } = await import(pathToFileURL(viteEntry).href);
  process.env.VITE_API_MODE = 'api';
  process.env.VITE_API_BASE_URL = settings.baseUrl;
  const web = await createServer({
    root: path.join(root, 'src/owner-web'),
    configFile: path.join(root, 'src/owner-web/vite.config.ts'),
    envDir: settings.temporary,
    logLevel: 'error',
    server: {
      host: 'localhost',
      port: settings.webPort,
      strictPort: true,
      hmr: false,
      https: { pfx: readFileSync(settings.pfxPath), passphrase: settings.pfxPassword },
    },
  });
  let browser;
  try {
    await web.listen();
    browser = await playwright.chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.name));
    await page.goto(settings.origin + '/contracts');
    await page.getByLabel('Email hoặc Số điện thoại').fill(settings.actors.owner.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(settings.actors.owner.password);
    await page.getByRole('button', { name: 'Đăng nhập vào hệ thống', exact: true }).click();
    await page.getByRole('heading', { name: 'Hợp đồng thuê & Vòng đời' }).waitFor();
    await check(
      'Owner web authenticates against real API with protected refresh cookie',
      async () => {
        const cookie = (await context.cookies(settings.baseUrl + '/api/v1/auth/refresh')).find(
          (c) => c.name === '__Secure-bhome-refresh',
        );
        assert.ok(cookie?.httpOnly && cookie.secure && cookie.sameSite === 'Strict');
      },
    );
    await page.getByRole('button', { name: 'Tạo hợp đồng thuê', exact: true }).click();
    const dialog = page.getByRole('dialog');
    async function select(label, value) {
      await dialog.getByRole('combobox', { name: label, exact: true }).click();
      await page.getByRole('option', { name: value, exact: true }).click();
    }
    await select('Cơ sở', 'SYNTHETIC LIVE LOCATION');
    await select('Phòng', 'LIVE101');
    await dialog.getByRole('checkbox', { name: 'SYNTHETIC REPRESENTATIVE' }).check();
    await select('Người đại diện', 'SYNTHETIC REPRESENTATIVE');
    await dialog.getByLabel('UUID tài khoản Tenant ký hợp đồng').fill(settings.actors.tenant.id);
    await dialog.getByLabel('Ngày bắt đầu', { exact: true }).fill(today);
    await dialog.getByLabel('Ngày hết hạn', { exact: true }).fill(after(365));
    await dialog.getByLabel('Tiền thuê tháng (VND)', { exact: true }).fill('3000000');
    await dialog.getByLabel('Cọc yêu cầu (VND)', { exact: true }).fill('3000000');
    await dialog
      .getByLabel('Điều khoản đã thống nhất')
      .fill('SYNTHETIC agreed terms for disposable integration verification.');
    const createdResponse = page.waitForResponse(
      (r) => r.url() === settings.baseUrl + '/api/v1/contracts' && r.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
    const response = await createdResponse;
    assert.equal(response.status(), 201);
    const id = (await response.json()).id;
    await page.getByText('Tiền cọc đã xác minh chưa đủ.').waitFor();
    await check('Owner web creates Main draft through real service/repository', async () => {
      assert.equal((await tenant.contracts.get(id)).status, 'Draft');
      assert.equal(
        await page.getByRole('button', { name: 'Kích hoạt hợp đồng', exact: true }).isDisabled(),
        true,
      );
    });
    const bankReference = 'SYNTHETIC-STATEMENT-' + randomUUID();
    const deposit = {
      bankTransactionReference: bankReference,
      amount: '3000000',
      verificationReason:
        'Synthetic bank-statement attestation for test data; no actual bank transfer.',
    };
    await page.getByRole('button', { name: 'Xác minh cọc ngân hàng', exact: true }).click();
    await dialog.getByLabel('Mã giao dịch trên sao kê').fill(deposit.bankTransactionReference);
    await dialog.getByLabel('Số tiền cọc đã nhận (VND)').fill(deposit.amount);
    await dialog.getByLabel('Căn cứ đối chiếu sao kê').fill(deposit.verificationReason);
    const deposited = page.waitForResponse(
      (r) => r.url().endsWith('/deposit-verifications') && r.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
    assert.equal((await deposited).status(), 200);
    await page.getByText('Cần đủ bằng chứng ký đã xác minh của Owner và Tenant.').waitFor();
    await check(
      'Owner manual deposit persists but cannot bypass required signature evidence',
      async () => {
        const ready = await tenant.contracts.readiness(id);
        assert.equal(ready.verifiedDeposit, '3000000');
        assert.equal(ready.ready, false);
        assert.equal(
          await page.getByRole('button', { name: 'Kích hoạt hợp đồng', exact: true }).isDisabled(),
          true,
        );
      },
    );
    await page
      .getByRole('button', { name: 'Khai báo chứng thư MySign của bạn', exact: true })
      .click();
    await page
      .getByLabel('Mã thuê bao MySign của bạn', { exact: true })
      .fill('synthetic-no-provider');
    const unavailable = page.waitForResponse(
      (r) => r.url().endsWith('/digital-signing/certificates') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Tra cứu và lưu chứng thư', exact: true }).click();
    await check(
      'Real MySign declaration fails closed when capability is unconfigured',
      async () => {
        assert.equal((await unavailable).status(), 503);
        assert.equal((await tenant.contracts.get(id)).signatures.length, 0);
      },
    );
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Tải lại trạng thái', exact: true }).click();
    await page.getByText(/Kết quả thao tác chưa được xác nhận/).waitFor();
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Tải lại', exact: true }).click();
    await page.getByText('Cần đủ bằng chứng ký đã xác minh của Owner và Tenant.').waitFor();
    await check(
      'Owner web handles offline read/recovery without inventing a successful transition',
      async () => {
        assert.equal((await tenant.contracts.get(id)).status, 'Draft');
        assert.deepEqual(pageErrors, []);
      },
    );
    await page.screenshot({ path: path.join(artifacts, 'owner-real-api-blocked.png') });

    const input = {
      roomId: room.id,
      ownerSignerId: settings.actors.owner.id,
      tenantUserId: settings.actors.tenant.id,
      representativeResidentId: resident.id,
      residentIds: [resident.id],
      startDate: today,
      endDate: after(365),
      monthlyRent: '3000000',
      requiredDeposit: '3000000',
      terms: 'SYNTHETIC mobile draft agreed terms',
      holdingContractId: null,
    };
    let staffContract;
    await check(
      'Staff Mobile transport creates draft and replays one idempotent result',
      async () => {
        const key = randomUUID();
        staffContract = await staff.contracts.mutate(null, '', input, key);
        assert.deepEqual(await staff.contracts.mutate(null, '', input, key), staffContract);
        await denied(
          () => staff.contracts.mutate(null, '', { ...input, monthlyRent: '4000000' }, key),
          409,
        );
        await denied(() => staff.mobile.json('/api/v1/contracts', input), 400);
      },
    );
    await check('Tenant and Staff real reads/list isolation', async () => {
      assert.equal((await tenant.contracts.list()).totalCount, 2);
      assert.equal((await staff.contracts.get(id)).id, id);
      assert.equal((await sessions.otherTenant.contracts.list()).totalCount, 0);
      assert.equal((await sessions.otherStaff.contracts.list()).totalCount, 0);
      await denied(() => sessions.otherTenant.contracts.get(id), 404);
      await denied(() => sessions.otherStaff.contracts.get(id), 404);
      await denied(() => sessions.otherTenant.contracts.document(id), 404);
      assert.equal((await fetch(settings.baseUrl + '/api/v1/contracts')).status, 401);
    });
    await check(
      'Staff cannot sign, verify deposits, activate, settle or close contracts',
      async () => {
        for (const operation of [
          'signing',
          'deposit-verifications',
          'activate',
          'move-out/settlement',
          'move-out/complete',
        ])
          await denied(
            () =>
              staff.contracts.mutate(
                id,
                operation,
                {
                  certificateId: randomUUID(),
                  ...deposit,
                  decision: 'Synthetic',
                  actualEndDate: today,
                },
                randomUUID(),
              ),
            403,
          );
        await denied(
          () => staff.mobile.request(`/api/v1/contracts/${id}/activation-readiness`),
          403,
        );
        await denied(
          () => staff.mobile.request(`/api/v1/contracts/${id}/move-out/settlement-history`),
          403,
        );
        await denied(() => staff.contracts.document(id), 403);
      },
    );
    await check(
      'Deposit replay/reference deduplication is durable and cannot double-credit',
      async () => {
        const key = randomUUID();
        const first = await owner.contracts.mutate(id, 'deposit-verifications', deposit, key);
        assert.deepEqual(
          await owner.contracts.mutate(id, 'deposit-verifications', deposit, key),
          first,
        );
        await denied(
          () =>
            owner.contracts.mutate(id, 'deposit-verifications', { ...deposit, amount: '1' }, key),
          409,
        );
        assert.equal((await tenant.contracts.readiness(id)).verifiedDeposit, '3000000');
      },
    );
    await check('Unsigned contract has no downloadable document and cannot activate', async () => {
      await denied(() => owner.contracts.document(id), 409);
      await denied(() => owner.contracts.mutate(id, 'activate', undefined, randomUUID()), 409);
      await denied(() => tenant.contracts.mutate(id, 'activate', undefined, randomUUID()), 403);
    });
    await check('Signing with unavailable certificate never manufactures evidence', async () => {
      await denied(
        () => tenant.contracts.mutate(id, 'signing', { certificateId: randomUUID() }, randomUUID()),
        404,
      );
      const c = await tenant.contracts.get(id);
      assert.equal(c.status, 'PendingSigning');
      assert.equal(c.signatures.length, 0);
      await denied(() => tenant.contracts.mutate(id, 'signing/sync', undefined, randomUUID()), 404);
    });
    await check('Missing Holding adapter rolls back Main draft creation', async () => {
      await denied(
        () =>
          owner.contracts.mutate(
            null,
            '',
            { ...input, holdingContractId: randomUUID() },
            randomUUID(),
          ),
        503,
      );
      assert.equal((await tenant.contracts.list()).totalCount, 2);
    });
    await check('Renewal cannot version an inactive contract or bypass signing', async () => {
      await denied(
        () =>
          staff.contracts.mutate(
            id,
            'renewals',
            { endDate: after(730), monthlyRent: '4000000', terms: 'Synthetic renewal' },
            randomUUID(),
          ),
        409,
      );
      await denied(
        () =>
          tenant.contracts.mutate(
            id,
            'renewals',
            { endDate: after(730), monthlyRent: '4000000', terms: 'Synthetic renewal' },
            randomUUID(),
          ),
        403,
      );
    });
    await check(
      'Move-out/inspection/settlement/closure cannot release an inactive tenancy',
      async () => {
        await denied(
          () =>
            tenant.contracts.mutate(
              id,
              'termination-requests',
              { proposedDate: after(10), reason: 'Synthetic move-out request' },
              randomUUID(),
            ),
          409,
        );
        await denied(
          () =>
            owner.contracts.mutate(
              id,
              'expiry-move-out',
              { proposedDate: after(365), reason: 'Synthetic expiry' },
              randomUUID(),
            ),
          409,
        );
        await denied(
          () =>
            staff.contracts.mutate(
              id,
              'move-out/inspection',
              {
                electricityReadingId: randomUUID(),
                waterReadingId: randomUUID(),
                notes: 'Synthetic inspection',
                evidenceIds: [randomUUID()],
              },
              randomUUID(),
            ),
          404,
        );
        await denied(
          () =>
            owner.contracts.mutate(
              id,
              'move-out/settlement',
              { decision: 'Synthetic settlement review' },
              randomUUID(),
            ),
          404,
        );
        await denied(
          () =>
            owner.contracts.mutate(id, 'move-out/complete', { actualEndDate: today }, randomUUID()),
          404,
        );
        assert.equal((await owner.raw(`/api/v1/rooms/${room.id}`)).status, 0);
      },
    );
    await check(
      'Mobile abort reports uncertainty and a fresh authenticated read recovers actual state',
      async () => {
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(
          () => tenant.mobile.request(`/api/v1/contracts/${id}`, { signal: controller.signal }),
          (e) => e.name === 'AbortError',
        );
        assert.equal((await tenant.contracts.get(id)).status, 'PendingSigning');
        const previousToken = tenant.auth.session.accessToken;
        const refreshed = await tenant.auth.refresh();
        assert.ok(
          refreshed && refreshed !== previousToken,
          'Real token refresh did not rotate the access token',
        );
        assert.equal((await tenant.contracts.get(id)).status, 'PendingSigning');
      },
    );
    const summary = {
      checksPassed: checks.length,
      checksFailed: 0,
      fullFlowsCompleted: 0,
      api: 'shipped HTTPS API + PostgreSQL16 + MinIO',
      providerOverrides: false,
      mobile: 'actual MobileApi transport; native UI/device NOT RUN',
      blockedFlows: [
        'Main signing/evidence/activation: approved PDF template/signer and real MySign unavailable',
        'Renewal version/signing/activation: no legitimately active parent from blocked Main flow',
        'Termination/inspection/readings/settlement/closure/release: Main blocked; production Settlement Ledger unavailable and OQ-01/02/05 unresolved',
      ],
      checks,
    };
    writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (browser) await browser.close();
    await web.close();
    await Promise.all(Object.values(sessions).map((s) => s.auth.logout().catch(() => undefined)));
  }
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  main(JSON.parse(input)).catch((e) => {
    console.error('Live client check failed:', e.name, e.message);
    process.exitCode = 1;
  });
});
