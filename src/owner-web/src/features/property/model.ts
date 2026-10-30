import type { DemoDatabase, PortalRecord } from '../../types/portal';

export type RoomStatus = 'AVAILABLE' | 'ON_HOLD' | 'OCCUPIED' | 'UNAVAILABLE';
export const roomStatuses: Record<
  RoomStatus,
  { label: string; color: string; background: string }
> = {
  AVAILABLE: { label: 'Trống khai thác', color: '#1d4ed8', background: '#eff6ff' },
  ON_HOLD: { label: 'Đang giữ chỗ', color: '#b45309', background: '#fffbeb' },
  OCCUPIED: { label: 'Đang thuê', color: '#15803d', background: '#f0fdf4' },
  UNAVAILABLE: { label: 'Tạm ngừng khai thác', color: '#64748b', background: '#f1f5f9' },
};
// Adapter for the existing localized mock records. Real providers return canonical statuses.
export function roomStatus(room: PortalRecord): RoomStatus {
  if (room.status in roomStatuses) return room.status as RoomStatus;
  const localized: Record<string, RoomStatus> = {
    'Trống khai thác': 'AVAILABLE',
    'Đang giữ chỗ': 'ON_HOLD',
    'Đang thuê': 'OCCUPIED',
  };
  return localized[room.status] || 'UNAVAILABLE';
}
export type AssetCondition = 'Active' | 'Needs Repair' | 'Under Repair' | 'Retired';
export const conditions: Record<AssetCondition, string> = {
  Active: 'Hoạt động tốt',
  'Needs Repair': 'Cần sửa chữa',
  'Under Repair': 'Đang sửa chữa',
  Retired: 'Ngừng sử dụng',
};
export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  description: string;
  image: string;
}
export interface Requirement {
  catalogId: string;
  quantity: number;
}
export interface PurchaseInfo {
  catalogId: string;
  quantity: number;
  unitCost: number;
  serial: string;
  condition: AssetCondition;
  retired: boolean;
}
export interface Allocation {
  id: string;
  assetId: string;
  locationId: string;
  roomId: string;
  commonArea: string;
  quantity: number;
  date: string;
  returnedAt?: string;
}
export interface AssetEvent {
  id: string;
  assetId: string;
  date: string;
  description: string;
}
export interface PropertyData {
  version: 1;
  catalog: CatalogItem[];
  requirements: Record<string, Requirement[]>;
  purchases: Record<string, PurchaseInfo>;
  allocations: Allocation[];
  events: AssetEvent[];
}
export type PropertyCommand =
  | { kind: 'location'; record: PortalRecord; copyFrom?: string }
  | { kind: 'roomType'; record: PortalRecord; requirements: Requirement[] }
  | {
      kind: 'createRooms';
      locationId: string;
      typeId: string;
      codes: { code: string; floor: number }[];
    }
  | { kind: 'availability'; roomId: string; status: 'AVAILABLE' | 'UNAVAILABLE'; reason: string }
  | { kind: 'catalog'; item: CatalogItem }
  | { kind: 'purchase'; record: PortalRecord; info: PurchaseInfo }
  | { kind: 'allocate'; allocations: Omit<Allocation, 'id' | 'date' | 'returnedAt'>[] }
  | { kind: 'return'; allocationId: string; reason: string }
  | { kind: 'condition'; assetId: string; condition: AssetCondition; reason: string }
  | { kind: 'price'; record: PortalRecord }
  | { kind: 'investment'; record: PortalRecord };

export function assignedQuantity(db: DemoDatabase, assetId: string) {
  return db
    .property!.allocations.filter((a) => a.assetId === assetId && !a.returnedAt)
    .reduce((s, a) => s + a.quantity, 0);
}
export function availableQuantity(db: DemoDatabase, assetId: string) {
  const info = db.property!.purchases[assetId];
  return !info || info.retired || info.condition !== 'Active'
    ? 0
    : info.quantity - assignedQuantity(db, assetId);
}
export function requirementsForRoom(db: DemoDatabase, room: PortalRecord) {
  const requirements: Requirement[] = JSON.parse(room.attributes.requirements || '[]');
  return requirements.map((req) => {
    const assigned = db
      .property!.allocations.filter(
        (a) =>
          a.roomId === room.id &&
          !a.returnedAt &&
          db.property!.purchases[a.assetId]?.catalogId === req.catalogId,
      )
      .reduce((sum, a) => sum + a.quantity, 0);
    return {
      ...req,
      assigned,
      missing: Math.max(0, req.quantity - assigned),
      name:
        db.property!.catalog.find((c) => c.id === req.catalogId)?.name ||
        'Danh mục không còn tồn tại',
    };
  });
}
export function roomSummary(db: DemoDatabase, room: PortalRecord) {
  const contract = db.records.contracts.find(
    (c) => c.roomId === room.id && ['Đang hiệu lực', 'Chờ gia hạn'].includes(c.status),
  );
  const occupants = db.records.tenants.filter((t) => t.roomId === room.id && t.status === 'Đang ở');
  const incidents = db.records.incidents.filter(
    (i) =>
      i.roomId === room.id &&
      !['Đã giải quyết', 'Đã đóng', 'Từ chối', 'Trùng lặp'].includes(i.status),
  );
  const assets = db.property!.allocations.filter((a) => a.roomId === room.id && !a.returnedAt);
  const repairs = assets.filter((a) =>
    ['Needs Repair', 'Under Repair'].includes(db.property!.purchases[a.assetId]?.condition),
  );
  const debt = db.records.invoices
    .filter((i) => i.roomId === room.id && i.status !== 'Nháp')
    .reduce(
      (s, i) => s + Math.max(0, i.amount + Number(i.attributes.approvedAdjustment || 0) - i.paid),
      0,
    );
  // Preview window is explicit in the UI, not a reminder cadence or contract policy.
  const expiryDays = contract
    ? Math.ceil((Date.parse(contract.endDate) - Date.parse('2024-10-18')) / 86400000)
    : null;
  const alerts = [
    ...(incidents.some((i) => i.category === 'Khẩn cấp')
      ? [{ label: 'Sự cố khẩn cấp', color: '#dc2626' }]
      : []),
    ...(incidents.some((i) => i.category !== 'Khẩn cấp')
      ? [{ label: 'Sự cố đang mở', color: '#ea580c' }]
      : []),
    ...(repairs.length ? [{ label: 'Tài sản cần bảo trì', color: '#9333ea' }] : []),
    ...(debt > 0 ? [{ label: 'Có công nợ', color: '#b45309' }] : []),
    ...(expiryDays !== null && expiryDays >= 0 && expiryDays <= 30
      ? [{ label: 'Hết hạn trong 30 ngày', color: '#b45309' }]
      : []),
  ];
  return {
    contract,
    occupants,
    incidents,
    assets,
    debt,
    expiryDays,
    alerts,
    capacity: Number(room.attributes.maxOccupants || 2),
    requirements: requirementsForRoom(db, room),
  };
}
export function investmentSummary(db: DemoDatabase, locationId = 'all', roomId?: string) {
  const inScope = (r: { locationId: string }) =>
    locationId === 'all' || r.locationId === locationId;
  const purchases = db.records.assets.filter(inScope);
  const assetValue = purchases.reduce((s, a) => s + a.amount, 0);
  const allocations = db.property!.allocations.filter((a) => !a.returnedAt && inScope(a));
  const value = (a: Allocation) => a.quantity * (db.property!.purchases[a.assetId]?.unitCost || 0);
  const roomValue = allocations
    .filter((a) => (roomId ? a.roomId === roomId : !!a.roomId))
    .reduce((s, a) => s + value(a), 0);
  const commonValue = allocations.filter((a) => !a.roomId).reduce((s, a) => s + value(a), 0);
  const unallocated = purchases.reduce(
    (s, a) =>
      s +
      (db.property!.purchases[a.id].quantity - assignedQuantity(db, a.id)) *
        db.property!.purchases[a.id].unitCost,
    0,
  );
  const expenses = db.records.expenses.filter(
    (r) => inScope(r) && (!roomId || r.roomId === roomId),
  );
  const other = expenses
    .filter((e) => e.category === 'Đầu tư ban đầu')
    .reduce((s, e) => s + e.amount, 0);
  const operating = expenses
    .filter((e) => e.category !== 'Đầu tư ban đầu')
    .reduce((s, e) => s + e.amount, 0);
  const maintenance = expenses
    .filter((e) => e.category === 'Bảo trì')
    .reduce((s, e) => s + e.amount, 0);
  return {
    assetValue,
    other,
    total: assetValue + other,
    roomValue,
    commonValue,
    unallocated,
    operating,
    maintenance,
  };
}
export function generateRoomCodes(
  floors: number[],
  start: number,
  quantity: number,
  prefix = 'P.',
) {
  const startSuffix = start >= 100 ? start % 100 : start;
  if (
    !floors.length ||
    floors.some((f) => !Number.isInteger(f) || f < 1 || f > 100) ||
    !Number.isInteger(start) ||
    start < 1 ||
    startSuffix < 1 ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 50 ||
    startSuffix + quantity - 1 > 99 ||
    floors.length * quantity > 200
  )
    throw new Error('Chọn tầng 1–100, số thứ tự 1–99, tối đa 50 phòng/tầng và 200 phòng mỗi lần.');
  return floors.flatMap((floor) =>
    Array.from({ length: quantity }, (_, i) => ({
      floor,
      code: `${prefix.trim()}${floor}${String(startSuffix + i).padStart(2, '0')}`,
    })),
  );
}
