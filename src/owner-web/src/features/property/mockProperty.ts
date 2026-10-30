import type { DemoDatabase, PortalRecord } from '../../types/portal';
import { makeRecord, DEMO_DATE } from '../../services/mock/seed';
import { availableQuantity, assignedQuantity, roomStatus, roomStatuses, conditions, type PropertyCommand, type Requirement } from './model';

/** Additive upgrade of the existing browser demo. No source contracts or invoices are copied. */
export function prepareProperty(db: DemoDatabase) {
  if (db.property) return db;
  db.property = {
    version: 1,
    catalog: [
      { id: 'cat-ac', name: 'Máy lạnh 1 HP', category: 'Điện máy', description: 'Máy lạnh treo tường, tiết kiệm điện', image: '/property-assets/air-conditioner.svg' },
      { id: 'cat-bed', name: 'Giường gỗ 1,6 m', category: 'Nội thất', description: 'Khung giường và vạt giường', image: '/property-assets/bed.svg' },
      { id: 'cat-chair', name: 'Ghế làm việc', category: 'Nội thất', description: 'Ghế gỗ tiêu chuẩn', image: '/property-assets/chair.svg' },
    ], requirements: {}, purchases: {}, allocations: [], events: [],
  };
  const p = db.property;
  db.records.locations.forEach(l => { l.attributes.floors ||= String(Math.max(1, ...db.records.rooms.filter(r => r.locationId === l.id).map(r => Number(r.attributes.floor || 1)))); });
  // Legacy room types were global. Scope copies of templates only; rooms retain source IDs where possible.
  const templates = [...db.records['room-types']];
  for (const l of db.records.locations) {
    for (const t of templates) {
      const id = l.id === db.records.locations[0].id ? t.id : `${t.id}-${l.id}`;
      const type = l.id === db.records.locations[0].id ? t : { ...structuredClone(t), id, code: `${t.code}-${l.code}` };
      type.locationId = l.id;
      type.attributes.area = String(Number.parseInt(type.attributes.capacity || '28') || 28);
      type.attributes.maxOccupants = '2';
      p.requirements[id] = [{ catalogId: 'cat-ac', quantity: 1 }, { catalogId: 'cat-bed', quantity: 1 }, { catalogId: 'cat-chair', quantity: 2 }];
      if (type !== t) db.records['room-types'].push(type);
      db.records.rooms.filter(r => r.locationId === l.id && r.category === t.id).forEach(r => {
        r.category = id; r.attributes.area = type.attributes.area; r.attributes.maxOccupants = '2';
        r.attributes.requirements = JSON.stringify(p.requirements[id]);
      });
    }
  }
  for (const [i, a] of db.records.assets.entries()) {
    const catalog = p.catalog[i % p.catalog.length];
    a.name = catalog.name; a.tenantId = ''; a.staffId = ''; a.roomId = '';
    a.locationId = db.records.locations[i % db.records.locations.length].id;
    const quantity = i % 3 === 2 ? 12 : 3;
    const unitCost = Math.max(1, Math.round(a.amount / quantity));
    a.amount = unitCost * quantity;
    p.purchases[a.id] = { catalogId: catalog.id, quantity, unitCost, serial: '', condition: i === 0 ? 'Under Repair' : 'Active', retired: false };
    const room = db.records.rooms.find(r => r.locationId === a.locationId);
    if (room) p.allocations.push({ id: `allocation-${a.id}`, assetId: a.id, roomId: room.id, locationId: a.locationId, commonArea: '', quantity: 1, date: DEMO_DATE });
    p.events.push({ id: `purchase-${a.id}`, assetId: a.id, date: DEMO_DATE, description: `Nhập kho minh họa: ${quantity} ${catalog.name}` });
  }
  // Repair legacy imported relationships so every room-related record shares its room's Location.
  for (const kind of ['incidents', 'maintenance', 'expenses', 'tasks'] as const) {
    db.records[kind].forEach(r => {
      const room = db.records.rooms.find(x => x.id === r.roomId);
      if (room) { r.locationId = room.locationId; r.tenantId = db.records.tenants.find(t => t.roomId === room.id)?.id || ''; }
    });
  }
  db.records.maintenance.forEach(w => {
    const incident = db.records.incidents.find(i => i.id === w.incidentId);
    if (incident) { w.roomId = incident.roomId; w.locationId = incident.locationId; }
    w.assetId = p.allocations.find(a => a.roomId === w.roomId)?.assetId || '';
  });
  db.records.pricing.forEach(r => { r.roomId = ''; r.tenantId = ''; r.attributes.scope = 'location'; r.attributes.targetId = r.locationId; });
  return db;
}
function assert(valid: unknown, message: string): asserts valid { if (!valid) throw new Error(message); }
const money = (n: number) => Number.isSafeInteger(n) && n >= 0;
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
function validateRequirements(db: DemoDatabase, reqs: Requirement[]) {
  assert(new Set(reqs.map(r => r.catalogId)).size === reqs.length, 'Danh mục trang bị bị lặp.');
  assert(reqs.every(r => positive(r.quantity) && db.property!.catalog.some(c => c.id === r.catalogId)), 'Yêu cầu trang bị không hợp lệ.');
}
function dateValid(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value; }
function put(rows: PortalRecord[], row: PortalRecord) { const index = rows.findIndex(r => r.id === row.id); if (index < 0) rows.push(structuredClone(row)); else rows[index] = structuredClone(row); }

export function applyPropertyCommand(db: DemoDatabase, cmd: PropertyCommand) {
  const p = db.property!;
  const location = (id: string) => { const l = db.records.locations.find(l => l.id === id); assert(l, 'Cơ sở không tồn tại.'); return l; };
  const event = (assetId: string, description: string) => p.events.unshift({ id: crypto.randomUUID(), assetId, date: new Date().toISOString(), description });
  if (cmd.kind === 'location') {
    const r = cmd.record;
    assert(r.name.trim() && r.code.trim() && r.attributes.address?.trim(), 'Nhập tên, mã và địa chỉ cơ sở.');
    assert(positive(Number(r.attributes.floors)) && Number(r.attributes.floors) <= 100, 'Số tầng phải từ 1 đến 100.');
    assert(!db.records.locations.some(l => l.id !== r.id && l.code.toLowerCase() === r.code.toLowerCase()), 'Mã cơ sở đã tồn tại.');
    assert(!db.records.rooms.some(room => room.locationId === r.id && Number(room.attributes.floor) > Number(r.attributes.floors)), 'Số tầng nhỏ hơn tầng đang có phòng.');
    assert(!r.staffId || db.records.staff.some(s => s.id === r.staffId && s.locationId === r.id), 'Staff phải được phân công tại cơ sở.');
    if (cmd.copyFrom) {
      location(cmd.copyFrom);
      assert(!db.records.locations.some(l => l.id === r.id), 'Chỉ sao chép cấu hình khi tạo cơ sở mới.');
      const typeMap = new Map<string, string>();
      db.records['room-types'].filter(t => t.locationId === cmd.copyFrom).forEach(t => {
        const id = crypto.randomUUID(); typeMap.set(t.id, id);
        db.records['room-types'].push({ ...structuredClone(t), id, code: `${r.code}-${t.code}`, locationId: r.id });
        p.requirements[id] = structuredClone(p.requirements[t.id] || []);
      });
      db.records.pricing.filter(price => price.locationId === cmd.copyFrom && price.attributes.scope !== 'room').forEach(price => {
        const targetId = price.attributes.scope === 'type' ? typeMap.get(price.attributes.targetId) : r.id;
        if (targetId) db.records.pricing.push({ ...structuredClone(price), id: crypto.randomUUID(), code: `${r.code}-${price.code}`, locationId: r.id, attributes: { ...price.attributes, targetId } });
      });
    }
    put(db.records.locations, r);
  } else if (cmd.kind === 'roomType') {
    const r = cmd.record; location(r.locationId);
    assert(r.name.trim() && r.code.trim(), 'Nhập tên và mã loại phòng.');
    assert(money(r.amount) && positive(Number(r.attributes.maxOccupants)) && Number(r.attributes.area) > 0 && Number.isFinite(Number(r.attributes.area)), 'Diện tích, sức chứa hoặc giá không hợp lệ.');
    assert(!db.records['room-types'].some(t => t.id !== r.id && t.locationId === r.locationId && t.code.toLowerCase() === r.code.toLowerCase()), 'Mã loại phòng đã tồn tại.');
    const old = db.records['room-types'].find(t => t.id === r.id);
    assert(!old || old.locationId === r.locationId || !db.records.rooms.some(room => room.category === r.id), 'Không chuyển loại phòng đang được sử dụng sang cơ sở khác.');
    validateRequirements(db, cmd.requirements); p.requirements[r.id] = structuredClone(cmd.requirements); put(db.records['room-types'], r);
  } else if (cmd.kind === 'createRooms') {
    const l = location(cmd.locationId), type = db.records['room-types'].find(t => t.id === cmd.typeId && t.locationId === l.id && t.status === 'Đang áp dụng');
    assert(type, 'Chọn loại phòng đang áp dụng tại cơ sở.');
    assert(cmd.codes.length > 0 && cmd.codes.length <= 200, 'Mỗi lần tạo từ 1 đến 200 phòng.');
    const codes = cmd.codes.map(c => c.code.trim().toLocaleLowerCase());
    assert(codes.every(Boolean) && new Set(codes).size === codes.length && !db.records.rooms.some(r => r.locationId === l.id && codes.includes(r.code.trim().toLocaleLowerCase())), 'Mã phòng bị trùng trong cơ sở.');
    assert(cmd.codes.every(c => positive(c.floor) && c.floor <= Number(l.attributes.floors)), 'Tầng nằm ngoài cấu hình cơ sở.');
    for (const { code, floor } of cmd.codes) db.records.rooms.push(makeRecord('rooms', { code: code.trim(), name: `Phòng ${code.trim()}`, locationId: l.id, category: type.id, amount: type.amount, status: 'Trống khai thác', attributes: { floor: String(floor), area: type.attributes.area, maxOccupants: type.attributes.maxOccupants, capacity: `${type.attributes.area} m² • ${type.attributes.maxOccupants} người`, amenities: type.attributes.amenities, requirements: JSON.stringify(p.requirements[type.id] || []) } }));
  } else if (cmd.kind === 'availability') {
    const room = db.records.rooms.find(r => r.id === cmd.roomId); assert(room, 'Phòng không tồn tại.');
    assert(['AVAILABLE', 'UNAVAILABLE'].includes(roomStatus(room)) && !db.records.contracts.some(c => c.roomId === room.id && !['Đã chấm dứt', 'Đã hủy', 'Bản nháp'].includes(c.status)) && !db.records.tenants.some(t => t.roomId === room.id && t.status === 'Đang ở'), 'Phòng có hợp đồng hoặc người ở; cần quy trình backend.');
    assert(cmd.reason.trim(), 'Nhập lý do thay đổi.'); room.status = roomStatuses[cmd.status].label;
  } else if (cmd.kind === 'catalog') {
    const item = cmd.item; assert(item.name.trim() && item.category.trim(), 'Nhập tên và nhóm thiết bị.');
    assert(!item.image || /^(https:\/\/|\/[^/])/.test(item.image), 'Ảnh cần đường dẫn nội bộ hoặc HTTPS.');
    const i = p.catalog.findIndex(c => c.id === item.id); if (i < 0) p.catalog.push(structuredClone(item)); else p.catalog[i] = structuredClone(item);
  } else if (cmd.kind === 'purchase') {
    const r = cmd.record, info = cmd.info; location(r.locationId);
    assert(p.catalog.some(c => c.id === info.catalogId) && positive(info.quantity) && money(info.unitCost) && money(info.quantity * info.unitCost), 'Danh mục, số lượng hoặc đơn giá không hợp lệ.');
    assert(!p.purchases[r.id] && !db.records.assets.some(a => a.code.toLowerCase() === r.code.toLowerCase()), 'Phiếu mua đã tồn tại.');
    assert(!info.serial || (info.quantity === 1 && !Object.values(p.purchases).some(a => a.serial === info.serial)), 'Tài sản có serial cần số lượng 1 và serial duy nhất.');
    assert(r.code.trim() && dateValid(r.date) && r.attributes.supplier?.trim(), 'Nhập mã phiếu, ngày mua và nhà cung cấp.');
    p.purchases[r.id] = { ...info, condition: 'Active', retired: false };
    db.records.assets.push({ ...r, roomId: '', amount: info.quantity * info.unitCost, name: p.catalog.find(c => c.id === info.catalogId)!.name });
    event(r.id, `Nhập kho ${info.quantity} đơn vị; phiếu ${r.code}`);
  } else if (cmd.kind === 'allocate') {
    assert(cmd.allocations.length > 0, 'Chọn tài sản để cấp phát.');
    for (const a of cmd.allocations) {
      location(a.locationId); const purchase = db.records.assets.find(r => r.id === a.assetId);
      assert(purchase?.locationId === a.locationId, 'Tài sản không thuộc kho cơ sở đã chọn.');
      assert(positive(a.quantity) && availableQuantity(db, a.assetId) >= a.quantity, 'Số lượng vượt tồn kho khả dụng hoặc tài sản đang sửa chữa.');
      assert(a.roomId ? db.records.rooms.some(r => r.id === a.roomId && r.locationId === a.locationId) && !a.commonArea : a.commonArea.trim(), 'Chọn đúng phòng hoặc khu vực chung.');
      p.allocations.push({ ...a, id: crypto.randomUUID(), date: new Date().toISOString() });
      event(a.assetId, `Cấp ${a.quantity} → ${db.records.rooms.find(r => r.id === a.roomId)?.code || a.commonArea}`);
    }
  } else if (cmd.kind === 'return') {
    const a = p.allocations.find(a => a.id === cmd.allocationId); assert(a && !a.returnedAt, 'Lượt cấp phát đã được thu hồi hoặc không tồn tại.');
    assert(cmd.reason.trim(), 'Nhập lý do thu hồi.'); a.returnedAt = new Date().toISOString(); event(a.assetId, `Thu hồi ${a.quantity}: ${cmd.reason}`);
  } else if (cmd.kind === 'condition') {
    const info = p.purchases[cmd.assetId]; assert(info && !info.retired && cmd.condition in conditions && cmd.reason.trim(), 'Chọn tài sản còn sử dụng và nhập lý do.');
    assert(cmd.condition !== 'Retired' || assignedQuantity(db, cmd.assetId) === 0, 'Thu hồi các cấp phát trước khi ngừng sử dụng.');
    info.condition = cmd.condition; info.retired = cmd.condition === 'Retired'; event(cmd.assetId, `${conditions[cmd.condition]}: ${cmd.reason}`);
  } else if (cmd.kind === 'price') {
    const r = cmd.record; location(r.locationId);
    assert(r.name.trim() && money(r.amount) && dateValid(r.date) && (!r.endDate || (dateValid(r.endDate) && r.endDate >= r.date)), 'Tên, giá hoặc ngày hiệu lực không hợp lệ.');
    const scope = r.attributes.scope, target = r.attributes.targetId;
    assert(scope === 'location' ? target === r.locationId : scope === 'room' ? db.records.rooms.some(x => x.id === target && x.locationId === r.locationId) : scope === 'type' && db.records['room-types'].some(x => x.id === target && x.locationId === r.locationId), 'Phạm vi giá không hợp lệ.');
    assert(['electricityRate', 'waterRate', 'serviceRate'].every(k => money(Number(r.attributes[k] || 0))), 'Phí phải là số nguyên VND không âm.');
    assert(!db.records.pricing.some(x => x.attributes.scope === scope && x.attributes.targetId === target && x.date <= (r.endDate || '9999-12-31') && (x.endDate || '9999-12-31') >= r.date), 'Khoảng hiệu lực chồng lấn; giữ lịch sử và chọn kỳ khác.');
    db.records.pricing.push(structuredClone(r));
  } else if (cmd.kind === 'investment') {
    const r = cmd.record; location(r.locationId);
    assert(r.name.trim() && money(r.amount) && r.amount > 0 && dateValid(r.date), 'Tên, số tiền hoặc ngày ghi nhận không hợp lệ.');
    assert(['Đầu tư ban đầu', 'Vận hành', 'Bảo trì'].includes(r.category), 'Chọn nhóm chi phí.');
    assert(!r.roomId || db.records.rooms.some(room => room.id === r.roomId && room.locationId === r.locationId), 'Phòng không thuộc cơ sở.');
    assert(!db.records.expenses.some(e => e.code.toLowerCase() === r.code.toLowerCase()), 'Mã khoản đầu tư/chi phí đã tồn tại.');
    db.records.expenses.push({ ...structuredClone(r), status: 'Bản ghi mô phỏng' });
  }
}
