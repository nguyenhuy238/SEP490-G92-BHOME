import { beforeEach, expect, it } from 'vitest';
import { createMockRepository } from '../../services/repositories/mockPortalRepository';
import { makeRecord } from '../../services/mock/seed';
import { availableQuantity, generateRoomCodes, investmentSummary } from './model';

beforeEach(() => localStorage.clear());

it('creates a Room Type and five inherited rooms without creating Actual Assets', async () => {
  const repository = createMockRepository();
  const before = await repository.read();
  const catalogId = before.property!.catalog[0].id;
  const location = makeRecord('locations', {
    id: 'loc-bulk-test',
    code: 'LOC-BULK',
    name: 'Cơ sở kiểm thử bulk',
    status: 'Đang vận hành',
    attributes: { address: 'Địa chỉ tổng hợp dùng cho kiểm thử', floors: '4' },
  });
  await repository.executeProperty({ kind: 'location', record: location });
  const type = makeRecord('room-types', {
    id: 'type-bulk-test',
    code: 'TYPE-BULK',
    name: 'Loại phòng kiểm thử bulk',
    locationId: location.id,
    status: 'Đang áp dụng',
    amount: 3_000_000,
    attributes: { area: '25', maxOccupants: '2', amenities: 'Wifi' },
  });

  await repository.executeProperty({
    kind: 'roomType',
    record: type,
    requirements: [{ catalogId, quantity: 1 }],
  });
  const afterType = await repository.read();
  expect(afterType.records.assets).toHaveLength(before.records.assets.length);

  const codes = generateRoomCodes([4], 401, 5, 'P.');
  expect(codes.map((item) => item.code)).toEqual(['P.401', 'P.402', 'P.403', 'P.404', 'P.405']);
  await repository.executeProperty({
    kind: 'createRooms',
    locationId: location.id,
    typeId: type.id,
    codes,
  });

  const afterRooms = await repository.read();
  const created = afterRooms.records.rooms.filter((room) => room.category === type.id);
  expect(created).toHaveLength(5);
  expect(created.every((room) => room.status === 'UNAVAILABLE')).toBe(true);
  expect(created.every((room) => room.attributes.setupStatus === 'IN_SETUP')).toBe(true);
  expect(JSON.parse(created[0].attributes.requirements)).toEqual([{ catalogId, quantity: 1 }]);
  expect(afterRooms.records.assets).toHaveLength(before.records.assets.length);
  await expect(
    repository.executeProperty({
      kind: 'createRooms',
      locationId: location.id,
      typeId: type.id,
      codes,
    }),
  ).rejects.toThrow('Mã phòng bị trùng');
});

it('copies setup templates without copying operational Location data', async () => {
  const repository = createMockRepository();
  const before = await repository.read();
  const sourceId = 'loc-1';
  const destination = makeRecord('locations', {
    id: 'loc-copy-test',
    code: 'LOC-COPY',
    name: 'Cơ sở nhận cấu hình mẫu',
    status: 'Đang vận hành',
    attributes: { address: 'Địa chỉ tổng hợp dùng cho kiểm thử', floors: '5' },
  });

  await repository.executeProperty({
    kind: 'location',
    record: destination,
    copyFrom: sourceId,
  });

  const after = await repository.read();
  const sourceTypes = before.records['room-types'].filter((row) => row.locationId === sourceId);
  const copiedTypes = after.records['room-types'].filter(
    (row) => row.locationId === destination.id,
  );
  const copyablePrices = before.records.pricing.filter(
    (row) => row.locationId === sourceId && row.attributes.scope !== 'room',
  );

  expect(copiedTypes).toHaveLength(sourceTypes.length);
  expect(after.records.pricing.filter((row) => row.locationId === destination.id)).toHaveLength(
    copyablePrices.length,
  );
  expect(after.records.rooms.some((row) => row.locationId === destination.id)).toBe(false);
  expect(after.records.assets.some((row) => row.locationId === destination.id)).toBe(false);
  expect(after.records.contracts.some((row) => row.locationId === destination.id)).toBe(false);
  expect(after.records.tenants.some((row) => row.locationId === destination.id)).toBe(false);
  expect(after.records.expenses.some((row) => row.locationId === destination.id)).toBe(false);
});

it('updates inventory on purchase and does not count assignment as a second investment', async () => {
  const repository = createMockRepository();
  const before = await repository.read();
  const catalogId = before.property!.catalog[0].id;
  const purchase = makeRecord('assets', {
    id: 'asset-purchase-test',
    code: 'PN-TEST-001',
    locationId: 'loc-1',
    date: '2026-10-30',
    attributes: { supplier: 'Nhà cung cấp kiểm thử' },
  });

  await repository.executeProperty({
    kind: 'purchase',
    record: purchase,
    info: {
      catalogId,
      quantity: 3,
      unitCost: 1_000_000,
      serial: '',
      condition: 'Active',
      retired: false,
    },
  });
  const purchased = await repository.read();
  expect(availableQuantity(purchased, purchase.id)).toBe(3);
  const investmentAfterPurchase = investmentSummary(purchased, 'loc-1').total;

  await repository.executeProperty({
    kind: 'allocate',
    allocations: [
      {
        assetId: purchase.id,
        locationId: 'loc-1',
        roomId: 'room-0',
        commonArea: '',
        quantity: 2,
      },
    ],
  });
  const allocated = await repository.read();
  expect(availableQuantity(allocated, purchase.id)).toBe(1);
  expect(investmentSummary(allocated, 'loc-1').total).toBe(investmentAfterPurchase);
});

it('rejects overlapping price periods and manual availability changes for occupied rooms', async () => {
  const repository = createMockRepository();
  const price = makeRecord('pricing', {
    id: 'price-future-test',
    code: 'PRICE-FUTURE-TEST',
    name: 'Giá phòng tương lai',
    locationId: 'loc-1',
    amount: 4_000_000,
    date: '2090-01-01',
    endDate: '2090-12-31',
    attributes: { scope: 'room', targetId: 'room-0' },
  });
  await repository.executeProperty({ kind: 'price', record: price });
  await expect(
    repository.executeProperty({
      kind: 'price',
      record: { ...price, id: 'price-overlap-test', code: 'PRICE-OVERLAP', date: '2090-06-01' },
    }),
  ).rejects.toThrow('chồng lấn');

  await expect(
    repository.executeProperty({
      kind: 'availability',
      roomId: 'room-0',
      status: 'UNAVAILABLE',
      reason: 'Không được bỏ qua hợp đồng đang hiệu lực',
    }),
  ).rejects.toThrow('hợp đồng hoặc người ở');
});
