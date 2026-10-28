import { beforeEach, expect, it } from 'vitest';
import { createMockRepository, invoiceBalance, STORAGE_KEY } from './mockPortalRepository';
import { makeRecord } from '../mock/seed';
import { baselineScenario, projectScenario } from '../../utils/scenario';
beforeEach(() => localStorage.clear());
it('persists CRUD and protects referenced master records', async () => {
  const repo = createMockRepository();
  const row = makeRecord('locations', { name: 'Cơ sở thử nghiệm', code: 'CS-TEST' });
  await repo.save('locations', row);
  expect((await createMockRepository().read()).records.locations).toContainEqual(row);
  await repo.save('locations', { ...row, name: 'Cơ sở đổi tên' });
  expect((await repo.read()).records.locations.find((item) => item.id === row.id)?.name).toBe(
    'Cơ sở đổi tên',
  );
  await repo.remove('locations', row.id);
  expect((await repo.read()).records.locations.some((item) => item.id === row.id)).toBe(false);
  await expect(repo.remove('locations', 'loc-1')).rejects.toThrow('tham chiếu');
});
it('validates relational location/room scope and nonnegative amounts', async () => {
  const repo = createMockRepository();
  const db = await repo.read();
  const row = db.records.assets[0];
  await expect(
    repo.save('assets', { ...row, locationId: 'loc-2', roomId: 'room-0' }),
  ).rejects.toThrow('không thuộc');
  await expect(repo.save('assets', { ...row, amount: -1 })).rejects.toThrow('không âm');
});
it('rejects decreasing meter readings', async () => {
  const repo = createMockRepository();
  const db = await repo.read();
  await expect(
    repo.save('meters', { ...db.records.meters[0], previous: 200, current: 199 }),
  ).rejects.toThrow('lớn hơn hoặc bằng');
});
it('preserves finalized invoices and refuses duplicate issued billing periods', async () => {
  const repo = createMockRepository(),
    db = await repo.read();
  const invoice = db.records.invoices[1];
  await expect(repo.save('invoices', { ...invoice, amount: 1 })).rejects.toThrow('bất biến');
  const draft = { ...invoice, id: 'new-invoice', code: 'HD-NEW', status: 'Nháp', paid: 0 };
  await repo.save('invoices', draft);
  await expect(repo.transition('invoices', draft.id, 'Đã phát hành')).rejects.toThrow(
    'Đã có hóa đơn',
  );
});
it('reconciles once and persists the corresponding invoice balance', async () => {
  const repo = createMockRepository(),
    db = await repo.read();
  const invoice = db.records.invoices[0],
    payment = db.records.payments.find((row) => row.id === 'payment-pending')!;
  await repo.reconcile(payment.id, invoice.id);
  await repo.reconcile(payment.id, invoice.id);
  const after = await repo.read();
  expect(after.records.invoices[0].paid).toBe(payment.amount);
  expect(invoiceBalance(after.records.invoices[0])).toBe(0);
  expect(after.records.debts.some((row) => row.invoiceId === invoice.id)).toBe(false);
});
it('requires signatures and deposit confirmation before activating a contract', async () => {
  const repo = createMockRepository(),
    db = await repo.read();
  const room = db.records.rooms.find((row) => row.status === 'Trống khai thác')!;
  const tenant = makeRecord('tenants', {
    id: 'new-tenant',
    code: 'KT-NEW',
    name: 'Khách thuê kiểm thử',
    roomId: room.id,
    locationId: room.locationId,
  });
  await repo.save('tenants', tenant);
  const contract = makeRecord('contracts', {
    id: 'new-contract',
    code: 'HD-NEW',
    name: 'Hợp đồng mới',
    roomId: room.id,
    tenantId: tenant.id,
    locationId: room.locationId,
    category: 'Thuê chính thức',
  });
  await repo.save('contracts', contract);
  await repo.transition('contracts', contract.id, 'Chờ ký số');
  await expect(repo.transition('contracts', contract.id, 'Chờ xác nhận cọc')).rejects.toThrow(
    'chữ ký',
  );
  await repo.save('contracts', { ...contract, status: 'Chờ ký số', signed: true });
  await repo.transition('contracts', contract.id, 'Chờ xác nhận cọc');
  await expect(repo.transition('contracts', contract.id, 'Đang hiệu lực')).rejects.toThrow(
    'khoản cọc',
  );
  await repo.save('contracts', {
    ...contract,
    status: 'Chờ xác nhận cọc',
    signed: true,
    depositConfirmed: true,
  });
  await repo.transition('contracts', contract.id, 'Đang hiệu lực');
  expect((await repo.read()).records.rooms.find((row) => row.id === room.id)?.status).toBe(
    'Đang thuê',
  );
});
it('retains the original invoice amount during an approved adjustment', async () => {
  const repo = createMockRepository(),
    db = await repo.read(),
    invoice = db.records.invoices[0];
  await repo.transition('invoices', invoice.id, 'Yêu cầu điều chỉnh');
  await repo.save('invoices', {
    ...invoice,
    status: 'Yêu cầu điều chỉnh',
    attributes: {
      ...invoice.attributes,
      requestedAdjustment: '-100000',
      adjustmentReason: 'Điều chỉnh minh họa',
    },
  });
  await repo.transition('invoices', invoice.id, 'Chờ duyệt điều chỉnh');
  await repo.transition('invoices', invoice.id, 'Đã phát hành');
  const saved = (await repo.read()).records.invoices[0];
  expect(saved.amount).toBe(invoice.amount);
  expect(saved.attributes.approvedAdjustment).toBe('-100000');
  expect(invoiceBalance(saved)).toBe(invoice.amount - 100000);
});
it('isolates saved What-if scenarios from actual records and handles nonpositive profit', async () => {
  const repo = createMockRepository(),
    before = await repo.read();
  await repo.saveScenario({ ...baselineScenario, id: 'scenario-1' });
  const after = await repo.read();
  expect(after.records).toEqual(before.records);
  expect(after.scenarios).toHaveLength(1);
  expect(projectScenario(0, 100000000, 91, 56, baselineScenario).payback).toBeNull();
});
it('fails visibly on corrupted or full storage and supports demo reset', async () => {
  localStorage.setItem(STORAGE_KEY, 'not-json');
  const repo = createMockRepository();
  await expect(repo.read()).rejects.toThrow('không hợp lệ');
  await repo.reset();
  expect((await repo.read()).records.rooms).toHaveLength(56);
  const unavailable = createMockRepository({
    getItem: () => null,
    setItem: () => {
      throw new Error('quota');
    },
  });
  await expect(
    unavailable.save('locations', makeRecord('locations', { name: 'Test', code: 'NEW' })),
  ).rejects.toThrow('quota');
});
it('rejects conflicting schedules, unsupported severity and financial detail edits', async () => {
  const repo = createMockRepository(),
    db = await repo.read();
  const schedule = db.records.schedules[0];
  await expect(
    repo.save('schedules', { ...schedule, id: 'conflict', code: 'CA-CONFLICT' }),
  ).rejects.toThrow('đã có lịch');
  await expect(
    repo.save('incidents', { ...db.records.incidents[0], category: 'AI phân loại' }),
  ).rejects.toThrow('Mức độ sự cố');
  const invoice = db.records.invoices[0];
  await repo.transition('invoices', invoice.id, 'Yêu cầu điều chỉnh');
  await expect(
    repo.save('invoices', {
      ...invoice,
      status: 'Yêu cầu điều chỉnh',
      attributes: { ...invoice.attributes, rent: '1' },
    }),
  ).rejects.toThrow('chi tiết hóa đơn');
});
