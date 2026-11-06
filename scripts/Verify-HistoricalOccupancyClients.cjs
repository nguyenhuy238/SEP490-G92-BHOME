// Real Compact24 API and shipped Owner Web. Only synthetic, disposable property data.
const assert = require('node:assert/strict');
module.exports = async function verify({ owner, room, today, page, settings }) {
  const period = `from=${today}&to=${today}`;
  const original = await owner.api.request(
    `/api/v1/financial-reports?${period}&locationId=${room.locationId}`,
  );
  // This old fixture has no Property creation audit. Current Occupied cannot fill that gap.
  assert.equal(original.total.occupiedRooms, 1);
  assert.equal(original.historicalOccupancy.status, 'InsufficientData');
  assert.equal(original.historicalOccupancy.occupancyRate, null);
  const create = (route, body) =>
    owner.api.request(`/api/v1/${route}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  const location = await create('locations', {
    name: 'SYNTHETIC OCCUPANCY HISTORY',
    address: 'Synthetic address',
  });
  const type = await create('room-types', {
    locationId: location.id,
    name: 'Synthetic history type',
    defaultCapacity: 2,
    areaM2: 20,
    amenities: [],
  });
  await create('rooms', {
    locationId: location.id,
    roomTypeId: type.id,
    roomNumber: 'HISTORY-01',
    capacity: 2,
  });
  const report = await owner.api.request(
    `/api/v1/financial-reports?${period}&locationId=${location.id}`,
  );
  const property = await owner.api.request(
    `/api/v1/locations/${location.id}/occupancy-summary?${period}`,
  );
  assert.deepEqual(report.historicalOccupancy, property.historical);
  assert.equal(report.historicalOccupancy.status, 'Complete');
  assert.equal(report.historicalOccupancy.rentableRoomDays, 1);
  assert.equal(report.historicalOccupancy.occupiedRoomDays, 0);
  assert.equal(report.historicalOccupancy.occupancyRate, 0);
  await page.goto(settings.origin + '/reports');
  await page.getByLabel('Từ ngày').fill(today);
  await page.getByLabel('Đến ngày').fill(today);
  await page.getByRole('combobox', { name: 'Cơ sở', exact: true }).click();
  await page.getByRole('option', { name: location.name, exact: true }).click();
  await page.getByRole('button', { name: 'Xem báo cáo', exact: true }).click();
  await page.getByText('Tỷ lệ lấp đầy trong kỳ: 0%', { exact: true }).waitFor();
  await page.getByText('Ngày-phòng có thể cho thuê: 1', { exact: true }).waitFor();
  const yesterday = new Date(today + 'T00:00:00Z');
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  await page.getByLabel('Từ ngày').fill(yesterday.toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Xem báo cáo', exact: true }).click();
  await page
    .getByText('Chưa đủ lịch sử trạng thái cơ sở/phòng để tính tỷ lệ lấp đầy trong kỳ.', {
      exact: true,
    })
    .waitFor();
  assert.equal(await page.getByText('Tỷ lệ lấp đầy trong kỳ: 0%', { exact: true }).count(), 0);
  console.log(
    'PASS: Owner browser reports exact Property history room-days and explains missing audit without deriving past occupancy from the currently Occupied Room.',
  );
};
