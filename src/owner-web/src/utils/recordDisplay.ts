import type { DemoDatabase, PortalRecord, ResourceKind } from '../types/portal';
import { dateLabel, money } from './format';
import { invoiceBalance } from '../services/repositories/mockPortalRepository';
export function recordDisplay(
  row: PortalRecord,
  field: string,
  db: DemoDatabase,
  kind: ResourceKind,
): string {
  const lookup = (kind: ResourceKind, id: string) =>
    db.records[kind].find((item) => item.id === id);
  const room = lookup('rooms', row.roomId),
    location = lookup('locations', row.locationId),
    tenant = lookup('tenants', row.tenantId);
  if (field === 'name') return row.name;
  if (field === 'code') return row.code;
  if (field === 'status') return row.status;
  if (field === 'location') return location?.name || 'Toàn chuỗi';
  if (field === 'room') return room ? `${room.code} • ${location?.code || ''}` : 'Khu vực chung';
  if (field === 'tenant') return tenant?.name || 'Chưa gán khách thuê';
  if (field === 'staff' || field === 'manager')
    return lookup('staff', row.staffId)?.name || row.attributes.manager || 'Chưa phân công';
  if (field === 'amount') return money(row.amount);
  if (field === 'debt') {
    const invoice = kind === 'invoices' ? row : lookup('invoices', row.invoiceId);
    return money(invoice ? invoiceBalance(invoice) : Math.max(0, row.amount - row.paid));
  }
  if (field === 'date') return dateLabel(row.date);
  if (field === 'period') return `${dateLabel(row.date)} → ${dateLabel(row.endDate)}`;
  if (field === 'category')
    return kind === 'rooms'
      ? lookup('room-types', row.category)?.name || row.category
      : row.category || 'Chung';
  if (field === 'description') return row.description;
  if (field === 'contract')
    return lookup('contracts', row.contractId)?.status || 'Chưa có hợp đồng';
  if (field === 'signature') return row.signed ? 'Hai bên xác nhận (demo)' : 'Chưa ký';
  if (field === 'electricity')
    return `${row.previous} → ${row.current} • ${row.current - row.previous} kWh`;
  if (field === 'water')
    return `${row.attributes.waterPrevious || 0} → ${row.attributes.waterCurrent || 0} m³`;
  if (field === 'aging')
    return `${Math.max(0, Math.floor((Date.parse('2024-10-18') - Date.parse(row.date)) / 86400000))} ngày`;
  if (field === 'reminder') return row.status;
  if (field === 'occupancy' || (field === 'capacity' && kind === 'locations')) {
    const rooms = db.records.rooms.filter((room) =>
      kind === 'locations' ? room.locationId === row.id : room.category === row.id,
    );
    const occupied = rooms.filter((room) => room.status === 'Đang thuê').length;
    return field === 'capacity'
      ? `${rooms.length} phòng`
      : rooms.length
        ? `${occupied}/${rooms.length} • ${((occupied / rooms.length) * 100).toFixed(1)}%`
        : '0 phòng';
  }
  const value = row.attributes[field];
  if (
    ['rent', 'utilities', 'service', 'minimum', 'holdingDeposit', 'deposit'].includes(field) &&
    value &&
    /^\d+$/.test(value)
  )
    return money(Number(value));
  return value || '—';
}
