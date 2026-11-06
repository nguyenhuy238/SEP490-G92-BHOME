// Manual refund evidence is synthetic; the harness never instructs a bank to send money.
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
module.exports = async function verify({ owner, tenants, excess, invoiceId, settings, page }) {
  const sourceRoute = `/api/v1/payment-transactions/${excess.id}/refunds`;
  for (const actor of tenants)
    await assert.rejects(actor.api.request(sourceRoute), (e) => e.status === 403);
  const before = await owner.api.request('/api/v1/financial-reports?from=2000-01-01&to=2100-12-31');
  await page.getByRole('button', { name: 'Xử lý hoàn tiền thừa', exact: true }).click();
  await page.getByText('Còn có thể lập yêu cầu: 10.000 ₫', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Người nhận hoàn đã xác minh', exact: true }).click();
  await page.getByRole('option', { name: 'SYNTHETIC CO-OCCUPANT 1', exact: true }).click();
  await page.getByLabel('Số tiền yêu cầu hoàn (VND)', { exact: true }).fill('10000');
  await page
    .getByLabel('Lý do yêu cầu hoàn', { exact: true })
    .fill('Hoàn tiền thừa tổng hợp cho đúng người thực trả');
  const create = page.getByRole('button', { name: 'Lập yêu cầu hoàn tiền', exact: true });
  assert.equal(await create.isEnabled(), false);
  await page
    .getByLabel('Tôi xác nhận nguồn tiền và đúng người thực trả được nhận hoàn', { exact: true })
    .check();
  const createdResponse = page.waitForResponse(
    (r) => r.url().endsWith(sourceRoute) && r.request().method() === 'POST',
  );
  await create.click();
  const response = await createdResponse;
  assert.equal(response.status(), 200);
  const refund = await response.json();
  assert.equal(refund.status, 'REQUESTED');
  assert.equal(refund.isDevelopmentDemo, true);
  await page.getByText('Còn có thể lập yêu cầu: 0 ₫', { exact: true }).waitFor();
  await page
    .getByLabel('Lý do quyết định / xác minh hoàn', { exact: true })
    .fill('Đã kiểm tra nguồn và đúng người nhận tổng hợp');
  await page
    .getByLabel('Tôi đã kiểm tra nguồn, số tiền và người nhận trước khi quyết định', {
      exact: true,
    })
    .check();
  const approvedResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/refund-requests/${refund.id}/decision`) && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Duyệt yêu cầu hoàn', exact: true }).click();
  const approved = await approvedResponse;
  assert.equal(approved.status(), 200);
  assert.equal((await approved.json()).status, 'APPROVED');
  await page.getByText('Đã duyệt, chờ ghi nhận hoàn', { exact: false }).waitFor();
  assert.equal((await owner.api.request(sourceRoute)).refundedAmount, '0');
  const evidence = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 160;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 600, 160);
      ctx.fillStyle = 'black';
      ctx.fillText('SYNTHETIC REFUND 10,000 VND - NO REAL BANK TRANSFER', 20, 80);
      return canvas.toDataURL('image/png').split(',')[1];
    }),
    'base64',
  );
  await page
    .getByLabel('Lý do quyết định / xác minh hoàn', { exact: true })
    .fill('Đã đối chiếu sao kê hoàn tổng hợp');
  await page
    .getByLabel('Tham chiếu giao dịch hoàn trên sao kê', { exact: true })
    .fill('SYNTHETIC-REFUND-' + refund.id);
  const localTime = new Date(Date.now() + 7 * 3600000)
    .toISOString()
    .slice(0, 23)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '')
    .replace(/:00$/, '');
  await page.getByLabel('Thời gian hoàn thực tế (giờ Việt Nam)', { exact: true }).fill(localTime);
  await page
    .getByLabel('Chứng từ giao dịch hoàn', { exact: true })
    .setInputFiles({ name: 'synthetic-refund.png', mimeType: 'image/png', buffer: evidence });
  const execute = page.getByRole('button', {
    name: 'Ghi nhận giao dịch hoàn đã thực hiện',
    exact: true,
  });
  assert.equal(await execute.isEnabled(), false);
  await page
    .getByLabel(
      'Tôi đã đối chiếu sao kê, xác minh giao dịch hoàn thực sự hoàn tất đúng người nhận',
      { exact: true },
    )
    .check();
  const executionResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/refund-requests/${refund.id}/execution`) &&
      r.request().method() === 'POST',
  );
  await execute.click();
  const executed = await executionResponse;
  assert.equal(executed.status(), 200);
  assert.equal((await executed.json()).status, 'COMPLETED');
  await page.getByText('Đã ghi nhận hoàn', { exact: false }).waitFor();
  await page.reload();
  await page.goto(settings.origin + '/payments');
  const refundSource = await owner.api.request(sourceRoute);
  assert.equal(refundSource.refundedAmount, '10000');
  assert.equal(refundSource.availableAmount, '0');
  assert.equal(refundSource.requests.length, 1);
  assert.equal(refundSource.requests[0].history.length, 3);
  const after = await owner.api.request('/api/v1/financial-reports?from=2000-01-01&to=2100-12-31');
  assert.equal(after.hasUnclassifiedRefunds, false);
  assert.deepEqual(after.total, before.total);
  assert.deepEqual(after.capital, before.capital);
  for (const actor of tenants) {
    const payment = await actor.payments.payment(invoiceId);
    assert.equal(payment.paymentStatus, 'Paid');
    assert.equal(payment.pendingReview, false);
    assert.equal(payment.history.length, 2);
  }
  // Each existing transfer has its own reconciliation panel in the Payments list.
  const row = page
    .getByText(excess.bankReference + ' ·', { exact: false })
    .first()
    .locator('..');
  await row.getByRole('button', { name: 'Xử lý hoàn tiền thừa', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Tải chứng từ hoàn tiền', exact: true }).click();
  const file = await download;
  const target = path.join(settings.temporary, 'refund-proof.png');
  await file.saveAs(target);
  assert.deepEqual(await readFile(target), evidence);
  console.log(
    'PASS: Owner browser reserves, approves and records a synthetic excess refund with private MinIO evidence; reload/download hash matches, no allocation or report totals change and all Tenant pending-review flags clear only after completion.',
  );
};
