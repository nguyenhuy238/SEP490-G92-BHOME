import { useState } from 'react';
import { Box, Button, Chip, Stack, TextField, Typography } from '@mui/material';
import { Building2, Copy, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { usePortal } from '../../app/PortalProvider';
import { PageHeader } from '../../components/common/PortalUI';
import { makeRecord } from '../../services/mock/seed';
import type { DemoDatabase, PortalRecord } from '../../types/portal';
import { DataList, EditDrawer, ListView, Panel, PropertyBoundary, currency, matches, type FormField } from './PropertyUI';
import { roomStatus, type Requirement } from './model';
import { usePropertyMutation } from './usePropertyMutation';

export function Locations() { return <PropertyBoundary>{db => <LocationContent db={db} />}</PropertyBoundary>; }
function LocationContent({ db }: { db: DemoDatabase }) {
  const { locationId, search } = usePortal(), save = usePropertyMutation();
  const [editing, setEditing] = useState<{ record: PortalRecord; source?: string } | null>(null);
  const rows = db.records.locations.filter(l => (locationId === 'all' || locationId === l.id) && matches(l.name + l.attributes.address, search));
  return <><PageHeader title="Quản lý cơ sở" subtitle="Cấu hình không gian, theo dõi khai thác và nhân viên phụ trách tại từng cơ sở." actions={<Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setEditing({ record: makeRecord('locations', { code: '', attributes: { floors: '3' } }) })}>Thêm cơ sở</Button>} />
    <ListView rows={rows} noun="cơ sở" searchText={l => l.name + l.code + l.attributes.address}>{page => <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)', xl: 'repeat(3,1fr)' }, gap: 2 }}>{page.map(l => {
      const rooms = db.records.rooms.filter(r => r.locationId === l.id), count = (s: string) => rooms.filter(r => roomStatus(r) === s).length;
      return <Panel key={l.id} title={l.name} actions={<Building2 size={24} color="#2563eb" />}><Chip size="small" label={l.status} /><Typography color="text.secondary"   sx={{ mt: 2, mb: 2 }}>{l.attributes.address}</Typography><Stack direction="row"  sx={{ gap: 3 }}><Box><Typography variant="h5">{rooms.length}</Typography><Typography variant="caption">Phòng • {l.attributes.floors} tầng</Typography></Box><Box><Typography variant="h5" color="success.main">{count('OCCUPIED')}</Typography><Typography variant="caption">Đang thuê</Typography></Box><Box><Typography variant="h5" color="primary.main">{count('AVAILABLE')}</Typography><Typography variant="caption">Trống khai thác</Typography></Box></Stack><Typography variant="body2"  sx={{ mt: 2 }}>Phụ trách: {db.records.staff.find(s => s.id === l.staffId)?.name || db.records.staff.find(s => s.locationId === l.id)?.name || 'Chưa phân công'}</Typography><Stack direction="row"    sx={{ flexWrap: "wrap", gap: 1, mt: 3 }}><Button component={Link} to={`/rooms?location=${l.id}`} variant="contained">Xem phòng</Button><Button onClick={() => setEditing({ record: structuredClone(l) })}>Chỉnh sửa</Button><Button startIcon={<Copy size={14} />} onClick={() => setEditing({ record: makeRecord('locations', { name: `${l.name} — bản sao`, code: '', attributes: { floors: l.attributes.floors, address: '' } }), source: l.id })}>Sao chép cấu hình</Button></Stack></Panel>;
    })}</Box>}</ListView>
    {editing && <EditDrawer title={editing.source ? 'Sao chép cấu hình cơ sở' : 'Thông tin cơ sở'} initial={{ name: editing.record.name, code: editing.record.code, address: editing.record.attributes.address || '', floors: editing.record.attributes.floors || '1', status: editing.record.status, staff: editing.record.staffId }} fields={[
      { key: 'name', label: 'Tên cơ sở', required: true }, { key: 'code', label: 'Mã cơ sở', required: true }, { key: 'address', label: 'Địa chỉ', required: true }, { key: 'floors', label: 'Số tầng', type: 'number', required: true },
      { key: 'status', label: 'Trạng thái vận hành', options: ['Đang vận hành', 'Tạm ngừng'].map(id => ({ id, name: id })) },
      { key: 'staff', label: 'Nhân viên phụ trách đã được phân công', options: [{ id: '', name: 'Chưa phân công' }, ...db.records.staff.filter(s => s.locationId === editing.record.id).map(s => ({ id: s.id, name: s.name }))] },
    ]} description={editing.source ? 'Chỉ sao chép mẫu loại phòng, yêu cầu trang bị và chính sách giá cấp cơ sở/loại phòng. Không sao chép phòng, cư dân, hợp đồng, giao dịch hoặc kho tài sản.' : undefined} onClose={() => setEditing(null)} onSave={v => save({ kind: 'location', record: { ...editing.record, name: v.name.trim(), code: v.code.trim(), status: v.status, staffId: v.staff, attributes: { ...editing.record.attributes, address: v.address, floors: v.floors } }, copyFrom: editing.source })} />}
  </>;
}
export function RoomTypes() { return <PropertyBoundary>{db => <TypeContent db={db} />}</PropertyBoundary>; }
function TypeContent({ db }: { db: DemoDatabase }) {
  const { locationId, search } = usePortal(), save = usePropertyMutation();
  const [editing, setEditing] = useState<PortalRecord | null>(null), [requirements, setRequirements] = useState<Requirement[]>([]);
  const edit = (r: PortalRecord) => { setEditing(structuredClone(r)); setRequirements(structuredClone(db.property!.requirements[r.id] || [])); };
  const rows = db.records['room-types'].filter(t => (locationId === 'all' || t.locationId === locationId) && matches(t.name, search));
  const fields: FormField[] = [
    { key: 'locationId', label: 'Cơ sở', options: db.records.locations.map(l => ({ id: l.id, name: l.name })), required: true },
    { key: 'name', label: 'Tên loại phòng', required: true }, { key: 'code', label: 'Mã loại phòng', required: true }, { key: 'description', label: 'Mô tả' },
    { key: 'area', label: 'Diện tích mặc định (m²)', type: 'number', required: true }, { key: 'capacity', label: 'Sức chứa tối đa', type: 'number', required: true }, { key: 'rent', label: 'Giá thuê mặc định (VND/tháng)', type: 'number', required: true }, { key: 'amenities', label: 'Tiện ích' },
    { key: 'status', label: 'Trạng thái', options: ['Đang áp dụng', 'Ngừng áp dụng'].map(id => ({ id, name: id })) },
  ];
  return <><PageHeader title="Loại phòng & Trang bị tiêu chuẩn" subtitle="Mẫu cấu hình cho phòng mới. Thay đổi mẫu không làm thay đổi hợp đồng hoặc tài sản đã mua." actions={<Button variant="contained" startIcon={<Plus size={16} />} onClick={() => edit(makeRecord('room-types', { code: '', locationId: locationId === 'all' ? db.records.locations[0]?.id || '' : locationId, status: 'Đang áp dụng', attributes: { area: '28', maxOccupants: '2' } }))}>Thêm loại phòng</Button>} />
    <Panel title="Danh mục loại phòng"><DataList rows={rows} noun="loại phòng" searchText={r => r.name + r.code} columns={[
      { label: 'Loại phòng', value: t => <><Typography  sx={{ fontWeight: 650 }}>{t.name}</Typography><Typography variant="caption" color="text.secondary">{t.description}</Typography></> },
      { label: 'Cơ sở', value: t => db.records.locations.find(l => l.id === t.locationId)?.name },
      { label: 'Cấu hình', value: t => `${t.attributes.area} m² • ${t.attributes.maxOccupants} người` },
      { label: 'Giá mặc định', value: t => currency(t.amount) }, { label: 'Tiện ích', value: t => t.attributes.amenities || '—' },
      { label: 'Trang bị yêu cầu', value: t => (db.property!.requirements[t.id] || []).map(r => `${db.property!.catalog.find(c => c.id === r.catalogId)?.name} × ${r.quantity}`).join(', ') || 'Chưa cấu hình' },
      { label: 'Số phòng', value: t => db.records.rooms.filter(r => r.category === t.id).length }, { label: 'Trạng thái', value: t => <Chip size="small" label={t.status} /> }, { label: 'Thao tác', value: t => <Button onClick={() => edit(t)}>Chỉnh sửa</Button> },
    ]} /></Panel>
    {editing && <EditDrawer title="Cấu hình loại phòng" fields={fields} initial={{ locationId: editing.locationId, name: editing.name, code: editing.code, description: editing.description, area: editing.attributes.area, capacity: editing.attributes.maxOccupants, rent: String(editing.amount), amenities: editing.attributes.amenities || '', status: editing.status }} description="Phòng đã tạo giữ cấu hình kế thừa tại thời điểm tạo. Checklist dưới đây chỉ là nhu cầu, không tạo tài sản thực tế." onClose={() => setEditing(null)} onSave={v => save({ kind: 'roomType', record: { ...editing, locationId: v.locationId, name: v.name, code: v.code, description: v.description, amount: Number(v.rent), status: v.status, attributes: { area: v.area, maxOccupants: v.capacity, capacity: `${v.area} m² • ${v.capacity} người`, amenities: v.amenities } }, requirements })}>
      <Typography  sx={{ fontWeight: 650 }}>Checklist trang bị tiêu chuẩn</Typography>{db.property!.catalog.map(c => <TextField key={c.id} label={`${c.name} — số lượng (0 = không yêu cầu)`} type="number" value={requirements.find(r => r.catalogId === c.id)?.quantity || 0} onChange={e => setRequirements([...requirements.filter(r => r.catalogId !== c.id), ...(Number(e.target.value) ? [{ catalogId: c.id, quantity: Number(e.target.value) }] : [])])} />)}
    </EditDrawer>}
  </>;
}
