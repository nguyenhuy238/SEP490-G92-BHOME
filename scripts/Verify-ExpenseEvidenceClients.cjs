/* global document */
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
module.exports = async function verify(page) {
  const photo = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext('2d');
      const pixels = context.createImageData(256, 256);
      let seed = 123456789;
      for (let i = 0; i < pixels.data.length; i += 4) {
        for (let color = 0; color < 3; color++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          pixels.data[i + color] = seed >>> 24;
        }
        pixels.data[i + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      context.fillStyle = 'white';
      context.fillRect(0, 0, 100, 40);
      context.fillStyle = 'black';
      context.fillText('SYNTHETIC RECEIPT', 2, 20);
      return canvas.toDataURL('image/png').split(',')[1];
    }),
    'base64',
  );
  assert.ok(photo.length > 32768 && photo.length < 5 * 1024 * 1024);
  await page.getByRole('button', { name: 'Chi tiết / chỉnh sửa', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Chi tiết khoản chi', exact: true });
  await dialog.getByText('Chưa có ảnh chứng từ.', { exact: true }).waitFor();
  await dialog
    .getByLabel('Chọn ảnh chứng từ khoản chi', { exact: true })
    .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: photo });
  const response = page.waitForResponse(
    (r) =>
      /\/expenses\/[^/]+\/evidence$/.test(new URL(r.url()).pathname) &&
      r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Tải lên chứng từ', exact: true }).click();
  const uploaded = await response;
  assert.equal(uploaded.status(), 200);
  const metadata = await uploaded.json();
  assert.equal(metadata.status, 'Uploaded');
  assert.equal(metadata.length, photo.length);
  assert.equal(metadata.objectKey, undefined);
  await dialog.getByText('Đã lưu chứng từ riêng tư.', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Chi tiết / chỉnh sửa', exact: true }).click();
  const fileResponse = page.waitForResponse((r) =>
    new URL(r.url()).pathname.endsWith('/evidence/' + metadata.id),
  );
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Tải chứng từ 1', exact: true }).click();
  const saved = await download;
  assert.equal(saved.suggestedFilename(), 'chung-tu.png');
  const downloaded = await fileResponse;
  assert.equal(downloaded.status(), 200);
  const savedBytes = await readFile(await saved.path());
  assert.equal(savedBytes.length, photo.length);
  assert.equal(
    createHash('sha256').update(savedBytes).digest('hex'),
    createHash('sha256').update(photo).digest('hex'),
  );
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
  console.log(
    'PASS: Owner browser uploads, reloads and downloads exact private expense evidence bytes through Compact24 and real MinIO.',
  );
};
