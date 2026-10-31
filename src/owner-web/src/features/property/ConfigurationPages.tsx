import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowRight, Building2, Copy, Plus, Trash2, UserRound } from 'lucide-react';
import { Link } from 'react-router';
import { usePortal } from '../../app/PortalProvider';
import { PageHeader } from '../../components/common/PortalUI';
import { makeRecord } from '../../services/mock/seed';
import type { DemoDatabase, PortalRecord } from '../../types/portal';
import {
  DataList,
  EditDrawer,
  ListView,
  Panel,
  PropertyBoundary,
  type FormField,
} from './PropertyUI';
import { currency, matches } from './propertyUtils';
import { roomStatus, type Requirement } from './model';
import { usePropertyMutation } from './usePropertyMutation';

export function Locations() {
  return <PropertyBoundary>{(db) => <LocationContent db={db} />}</PropertyBoundary>;
}
function LocationContent({ db }: { db: DemoDatabase }) {
  const { locationId, search } = usePortal(),
    save = usePropertyMutation();
  const [editing, setEditing] = useState<{ record: PortalRecord; source?: string } | null>(null);
  const rows = db.records.locations.filter(
    (l) =>
      (locationId === 'all' || locationId === l.id) &&
      matches(l.name + l.attributes.address, search),
  );
  return (
    <>
      <PageHeader
        group="QUẢN LÝ CƠ SỞ"
        title="Danh sách cơ sở"
        subtitle="Chọn cơ sở để vào không gian quản lý. Phòng, loại phòng, tài sản, giá và tài chính được giới hạn theo cơ sở."
        actions={
          <Button
            variant="contained"
            startIcon={<Plus size={16} />}
            onClick={() =>
              setEditing({
                record: makeRecord('locations', { code: '', attributes: { floors: '3' } }),
              })
            }
          >
            Thêm cơ sở
          </Button>
        }
      />
      <ListView rows={rows} noun="cơ sở" searchText={(l) => l.name + l.code + l.attributes.address}>
        {(page) => (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)', xl: 'repeat(3,1fr)' },
              gap: 2,
            }}
          >
            {page.map((l) => {
              const rooms = db.records.rooms.filter((r) => r.locationId === l.id),
                count = (s: string) => rooms.filter((r) => roomStatus(r) === s).length;
              const occupied = count('OCCUPIED');
              const occupancy = rooms.length ? Math.round((occupied / rooms.length) * 100) : 0;
              const manager =
                db.records.staff.find((s) => s.id === l.staffId)?.name ||
                db.records.staff.find((s) => s.locationId === l.id)?.name ||
                'Chưa phân công';
              return (
                <Paper key={l.id} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
                  <Stack
                    direction="row"
                    sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                  >
                    <Box
                      sx={{
                        width: 38,
                        height: 38,
                        display: 'grid',
                        placeItems: 'center',
                        bgcolor: '#eef4ff',
                        color: 'primary.main',
                        borderRadius: 1.25,
                      }}
                    >
                      <Building2 size={20} />
                    </Box>
                    <Chip
                      size="small"
                      label={l.status.includes('Đang') ? 'Hoạt động' : l.status}
                      sx={{ bgcolor: '#ebf2ff', color: 'primary.main', fontWeight: 750 }}
                    />
                  </Stack>
                  <Typography component="h2" sx={{ mt: 2, fontSize: 15, fontWeight: 850 }}>
                    {l.name}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 0.5, mb: 2 }}
                  >
                    {l.attributes.address}
                  </Typography>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1, mb: 0.75 }}>
                    <Typography variant="caption">
                      {occupied}/{rooms.length} phòng đang thuê
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 850 }}>
                      {occupancy}%
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={occupancy}
                    color="success"
                    sx={{ height: 7, borderRadius: 10, bgcolor: '#e9edf4' }}
                  />
                  <Stack
                    direction="row"
                    sx={{ mt: 2.5, alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                  >
                    <Stack
                      direction="row"
                      sx={{ alignItems: 'center', gap: 0.65, color: 'text.secondary', minWidth: 0 }}
                    >
                      <UserRound size={14} />
                      <Typography variant="caption" noWrap>
                        {manager}
                      </Typography>
                    </Stack>
                    <Button
                      component={Link}
                      to={`/locations/${l.id}/overview`}
                      endIcon={<ArrowRight size={13} />}
                    >
                      Xem cơ sở
                    </Button>
                  </Stack>
                  <Stack
                    direction="row"
                    sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider', gap: 0.5 }}
                  >
                    <Button onClick={() => setEditing({ record: structuredClone(l) })}>
                      Chỉnh sửa
                    </Button>
                    <Button
                      startIcon={<Copy size={14} />}
                      onClick={() =>
                        setEditing({
                          record: makeRecord('locations', {
                            name: `${l.name} — bản sao`,
                            code: '',
                            attributes: { floors: l.attributes.floors, address: '' },
                          }),
                          source: l.id,
                        })
                      }
                    >
                      Sao chép cấu hình
                    </Button>
                  </Stack>
                </Paper>
              );
            })}
          </Box>
        )}
      </ListView>
      {editing && (
        <EditDrawer
          title={editing.source ? 'Sao chép cấu hình cơ sở' : 'Thông tin cơ sở'}
          initial={{
            name: editing.record.name,
            code: editing.record.code,
            address: editing.record.attributes.address || '',
            floors: editing.record.attributes.floors || '1',
            status: editing.record.status,
            staff: editing.record.staffId,
            copySource: editing.source || '',
          }}
          fields={[
            { key: 'name', label: 'Tên cơ sở', required: true },
            { key: 'code', label: 'Mã cơ sở', required: true },
            { key: 'address', label: 'Địa chỉ', required: true },
            { key: 'floors', label: 'Số tầng', type: 'number', required: true },
            {
              key: 'status',
              label: 'Trạng thái vận hành',
              options: ['Đang vận hành', 'Tạm ngừng'].map((id) => ({ id, name: id })),
            },
            {
              key: 'staff',
              label: 'Nhân viên phụ trách đã được phân công',
              options: [
                { id: '', name: 'Chưa phân công' },
                ...db.records.staff
                  .filter((s) => s.locationId === editing.record.id)
                  .map((s) => ({ id: s.id, name: s.name })),
              ],
            },
            ...(!db.records.locations.some((location) => location.id === editing.record.id)
              ? [
                  {
                    key: 'copySource',
                    label: 'Sao chép cấu hình từ cơ sở',
                    options: [
                      { id: '', name: 'Không sao chép — tạo cấu hình mới' },
                      ...db.records.locations.map((location) => ({
                        id: location.id,
                        name: location.name,
                      })),
                    ],
                    helper:
                      'Chỉ sao chép loại phòng, định mức tài sản và chính sách giá/phí; không sao chép dữ liệu vận hành.',
                  } satisfies FormField,
                ]
              : []),
          ]}
          description={
            editing.source || !db.records.locations.some((location) => location.id === editing.record.id)
              ? 'Chỉ sao chép mẫu loại phòng, yêu cầu trang bị và chính sách giá cấp cơ sở/loại phòng. Không sao chép phòng, cư dân, hợp đồng, giao dịch hoặc kho tài sản.'
              : undefined
          }
          onClose={() => setEditing(null)}
          onSave={(v) =>
            save({
              kind: 'location',
              record: {
                ...editing.record,
                name: v.name.trim(),
                code: v.code.trim(),
                status: v.status,
                staffId: v.staff,
                attributes: { ...editing.record.attributes, address: v.address, floors: v.floors },
              },
              copyFrom: v.copySource || editing.source,
            })
          }
        />
      )}
    </>
  );
}
export function RoomTypes() {
  return <PropertyBoundary>{(db) => <TypeContent db={db} />}</PropertyBoundary>;
}
function TypeContent({ db }: { db: DemoDatabase }) {
  const { locationId, search } = usePortal(),
    save = usePropertyMutation();
  const [editing, setEditing] = useState<PortalRecord | null>(null),
    [requirements, setRequirements] = useState<Requirement[]>([]);
  const edit = (r: PortalRecord) => {
    setEditing(structuredClone(r));
    setRequirements(structuredClone(db.property!.requirements[r.id] || []));
  };
  const rows = db.records['room-types'].filter(
    (t) => (locationId === 'all' || t.locationId === locationId) && matches(t.name, search),
  );
  const fields: FormField[] = [
    {
      key: 'locationId',
      label: 'Cơ sở',
      options: db.records.locations.map((l) => ({ id: l.id, name: l.name })),
      required: true,
    },
    { key: 'name', label: 'Tên loại phòng', required: true },
    { key: 'code', label: 'Mã loại phòng', required: true },
    { key: 'description', label: 'Mô tả' },
    { key: 'area', label: 'Diện tích mặc định (m²)', type: 'number', required: true },
    { key: 'capacity', label: 'Sức chứa tối đa', type: 'number', required: true },
    { key: 'rent', label: 'Giá thuê mặc định (VND/tháng)', type: 'number', required: true },
    { key: 'amenities', label: 'Tiện ích' },
    {
      key: 'status',
      label: 'Trạng thái',
      options: ['Đang áp dụng', 'Ngừng áp dụng'].map((id) => ({ id, name: id })),
    },
  ];
  return (
    <>
      <PageHeader
        title="Loại phòng & Trang bị tiêu chuẩn"
        subtitle="Mẫu cấu hình cho phòng mới. Thay đổi mẫu không làm thay đổi hợp đồng hoặc tài sản đã mua."
        actions={
          <Button
            variant="contained"
            startIcon={<Plus size={16} />}
            onClick={() =>
              edit(
                makeRecord('room-types', {
                  code: '',
                  locationId: locationId === 'all' ? db.records.locations[0]?.id || '' : locationId,
                  status: 'Đang áp dụng',
                  attributes: { area: '28', maxOccupants: '2' },
                }),
              )
            }
          >
            Thêm loại phòng
          </Button>
        }
      />
      <Panel title="Danh mục loại phòng">
        <DataList
          rows={rows}
          noun="loại phòng"
          searchText={(r) => r.name + r.code}
          columns={[
            {
              label: 'Loại phòng',
              value: (t) => (
                <>
                  <Typography sx={{ fontWeight: 650 }}>{t.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t.description}
                  </Typography>
                </>
              ),
            },
            {
              label: 'Cơ sở',
              value: (t) => db.records.locations.find((l) => l.id === t.locationId)?.name,
            },
            {
              label: 'Cấu hình',
              value: (t) => `${t.attributes.area} m² • ${t.attributes.maxOccupants} người`,
            },
            { label: 'Giá mặc định', value: (t) => currency(t.amount) },
            { label: 'Tiện ích', value: (t) => t.attributes.amenities || '—' },
            {
              label: 'Trang bị yêu cầu',
              value: (t) =>
                (db.property!.requirements[t.id] || [])
                  .map(
                    (r) =>
                      `${db.property!.catalog.find((c) => c.id === r.catalogId)?.name} × ${r.quantity}`,
                  )
                  .join(', ') || 'Chưa cấu hình',
            },
            {
              label: 'Số phòng',
              value: (t) => db.records.rooms.filter((r) => r.category === t.id).length,
            },
            { label: 'Trạng thái', value: (t) => <Chip size="small" label={t.status} /> },
            { label: 'Thao tác', value: (t) => <Button onClick={() => edit(t)}>Chỉnh sửa</Button> },
          ]}
        />
      </Panel>
      {editing && (
        <EditDrawer
          title="Cấu hình loại phòng"
          fields={fields}
          initial={{
            locationId: editing.locationId,
            name: editing.name,
            code: editing.code,
            description: editing.description,
            area: editing.attributes.area,
            capacity: editing.attributes.maxOccupants,
            rent: String(editing.amount),
            amenities: editing.attributes.amenities || '',
            status: editing.status,
          }}
          description="Phòng đã tạo giữ cấu hình kế thừa tại thời điểm tạo. Checklist dưới đây chỉ là nhu cầu, không tạo tài sản thực tế."
          onClose={() => setEditing(null)}
          onSave={(v) =>
            save({
              kind: 'roomType',
              record: {
                ...editing,
                locationId: v.locationId,
                name: v.name,
                code: v.code,
                description: v.description,
                amount: Number(v.rent),
                status: v.status,
                attributes: {
                  area: v.area,
                  maxOccupants: v.capacity,
                  capacity: `${v.area} m² • ${v.capacity} người`,
                  amenities: v.amenities,
                },
              },
              requirements,
            })
          }
        >
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography sx={{ fontWeight: 750 }}>Định mức tài sản tiêu chuẩn</Typography>
              <Typography variant="caption" color="text.secondary">
                Cấu hình mẫu này không tạo tài sản thực tế trong kho.
              </Typography>
            </Box>
            <Button
              variant="outlined"
              startIcon={<Plus size={15} />}
              disabled={requirements.length >= db.property!.catalog.length}
              onClick={() => {
                const next = db.property!.catalog.find(
                  (catalog) => !requirements.some((item) => item.catalogId === catalog.id),
                );
                if (next) setRequirements([...requirements, { catalogId: next.id, quantity: 1 }]);
              }}
            >
              Thêm tài sản
            </Button>
          </Stack>
          {requirements.length === 0 && (
            <Typography sx={{ p: 2, borderRadius: 1.5, bgcolor: '#f8fafc', color: 'text.secondary' }}>
              Chưa có định mức tài sản.
            </Typography>
          )}
          {requirements.map((requirement, index) => (
            <Stack
              key={`${requirement.catalogId}-${index}`}
              direction="row"
              sx={{ gap: 1, alignItems: 'center' }}
            >
              <TextField
                select
                label="Loại tài sản"
                value={requirement.catalogId}
                onChange={(event) =>
                  setRequirements(
                    requirements.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, catalogId: event.target.value } : item,
                    ),
                  )
                }
                sx={{ flex: 1 }}
              >
                {db.property!.catalog.map((catalog) => (
                  <MenuItem
                    key={catalog.id}
                    value={catalog.id}
                    disabled={requirements.some(
                      (item, itemIndex) => itemIndex !== index && item.catalogId === catalog.id,
                    )}
                  >
                    {catalog.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Số lượng"
                type="number"
                value={requirement.quantity}
                onChange={(event) =>
                  setRequirements(
                    requirements.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, quantity: Math.max(1, Number(event.target.value)) }
                        : item,
                    ),
                  )
                }
                slotProps={{ htmlInput: { min: 1, step: 1 } }}
                sx={{ width: 130 }}
              />
              <IconButton
                aria-label="Xóa định mức tài sản"
                onClick={() =>
                  setRequirements(requirements.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                <Trash2 size={18} />
              </IconButton>
            </Stack>
          ))}
        </EditDrawer>
      )}
    </>
  );
}
