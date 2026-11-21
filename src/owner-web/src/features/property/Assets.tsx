import { useState } from 'react';
import { Alert, Box, Button, Chip, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { Link, useSearchParams } from 'react-router';
import { Package, Plus } from 'lucide-react';
import { usePortal } from '../../app/PortalProvider';
import { ConfirmDialog, KPIGrid, PageHeader } from '../../components/common/PortalUI';
import type { DemoDatabase, PortalRecord } from '../../types/portal';
import { makeRecord, DEMO_DATE } from '../../services/mock/seed';
import {
  availableQuantity,
  assignedQuantity,
  conditions,
  requirementsForRoom,
  type AssetCondition,
  type CatalogItem,
} from './model';
import { DataList, EditDrawer, ListView, Panel, PropertyBoundary, Select } from './PropertyUI';
import { currency, dateLabel, matches } from './propertyUtils';
import { usePropertyMutation } from './usePropertyMutation';
import { isMockMode } from '../../services/config';
import { PropertyApiPage } from './PropertyApiPages';

export function Assets() {
  if (!isMockMode) return <PropertyApiPage kind="assets" />;
  return <PropertyBoundary>{(db) => <AssetContent db={db} />}</PropertyBoundary>;
}
function AssetContent({ db }: { db: DemoDatabase }) {
  const portal = usePortal(),
    save = usePropertyMutation(),
    p = db.property!;
  const [tab, setTab] = useState(1),
    [catalogEdit, setCatalogEdit] = useState<CatalogItem | null>(null),
    [purchase, setPurchase] = useState<PortalRecord | null>(null),
    [conditionAsset, setConditionAsset] = useState(''),
    [eventAsset, setEventAsset] = useState(''),
    [condition, setCondition] = useState(''),
    [placement, setPlacement] = useState('');
  const assets = db.records.assets.filter(
    (a) =>
      (portal.locationId === 'all' || a.locationId === portal.locationId) &&
      matches(a.code + a.name, portal.search),
  );
  const rows = assets.filter(
    (a) =>
      (!condition || p.purchases[a.id].condition === condition) &&
      (!placement ||
        (placement === 'retired'
          ? p.purchases[a.id].retired
          : placement === 'assigned'
            ? assignedQuantity(db, a.id) > 0
            : !p.purchases[a.id].retired &&
              p.purchases[a.id].quantity > assignedQuantity(db, a.id))),
  );
  return (
    <>
      <PageHeader
        title="Tài sản & Kho thiết bị"
        subtitle="Theo dõi thiết bị thực tế từ mua sắm, cấp phát đến bảo trì và ngừng sử dụng."
        actions={
          <>
            <Button component={Link} to="/asset-allocation" variant="outlined">
              Cấp phát tài sản
            </Button>
            <Button
              startIcon={<Plus size={16} />}
              variant="contained"
              onClick={() =>
                setPurchase(
                  makeRecord('assets', {
                    code: '',
                    locationId:
                      portal.locationId === 'all'
                        ? db.records.locations[0]?.id || ''
                        : portal.locationId,
                  }),
                )
              }
            >
              Nhập tài sản mua
            </Button>
          </>
        }
      />
      <KPIGrid
        items={[
          {
            label: 'Số lượng đã mua',
            value: assets.reduce((s, a) => s + p.purchases[a.id].quantity, 0),
          },
          {
            label: 'Đã cấp phát',
            value: assets.reduce((s, a) => s + assignedQuantity(db, a.id), 0),
          },
          {
            label: 'Khả dụng trong kho',
            value: assets.reduce((s, a) => s + availableQuantity(db, a.id), 0),
          },
          { label: 'Giá trị mua', value: currency(assets.reduce((s, a) => s + a.amount, 0)) },
        ]}
      />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Danh mục thiết bị" />
        <Tab label="Kho tài sản" />
        <Tab label="Lịch sử tài sản" />
      </Tabs>
      {tab === 0 && (
        <Panel
          title="Định nghĩa thiết bị"
          actions={
            <Button
              onClick={() =>
                setCatalogEdit({
                  id: crypto.randomUUID(),
                  name: '',
                  category: '',
                  description: '',
                  image: '',
                })
              }
            >
              Thêm danh mục
            </Button>
          }
        >
          <ListView
            rows={p.catalog.filter((c) => matches(c.name, portal.search))}
            noun="thiết bị"
            searchText={(c) => c.name + c.category}
          >
            {(page) => (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,1fr)', lg: 'repeat(3,1fr)' },
                  gap: 2,
                }}
              >
                {page.map((c) => (
                  <Box key={c.id} sx={{ border: '1px solid #e2e8f0', borderRadius: 2, p: 2 }}>
                    <Box
                      sx={{
                        bgcolor: '#f1f5f9',
                        height: 110,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        mb: 2,
                      }}
                    >
                      {c.image ? (
                        <Box
                          component="img"
                          src={c.image}
                          alt={c.name}
                          sx={{ height: 100, maxWidth: '100%', objectFit: 'contain' }}
                        />
                      ) : (
                        <Package size={40} color="#64748b" />
                      )}
                    </Box>
                    <Typography sx={{ fontWeight: 650 }}>{c.name}</Typography>
                    <Chip size="small" label={c.category} sx={{ my: 1 }} />
                    <Typography color="text.secondary" variant="body2">
                      {c.description}
                    </Typography>
                    <Button sx={{ mt: 2 }} onClick={() => setCatalogEdit(c)}>
                      Chỉnh sửa danh mục
                    </Button>
                  </Box>
                ))}
              </Box>
            )}
          </ListView>
        </Panel>
      )}
      {tab === 1 && (
        <Panel title="Tài sản mua thực tế">
          <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2, mb: 2 }}>
            <Select
              label="Vị trí vật lý"
              value={placement}
              all="Tất cả"
              options={[
                { id: 'stock', name: 'Còn trong kho' },
                { id: 'assigned', name: 'Đã cấp phát' },
                { id: 'retired', name: 'Ngừng sử dụng' },
              ]}
              onChange={setPlacement}
            />
            <Select
              label="Tình trạng kỹ thuật"
              value={condition}
              all="Tất cả"
              options={Object.entries(conditions).map(([id, name]) => ({ id, name }))}
              onChange={setCondition}
            />
          </Stack>
          <DataList
            rows={rows}
            noun="tài sản"
            searchText={(a) => a.name + a.code + p.purchases[a.id].serial}
            columns={[
              {
                label: 'Tài sản / Phiếu mua',
                value: (a) => (
                  <>
                    <Typography sx={{ fontWeight: 650 }}>{a.name}</Typography>
                    <Typography variant="caption">
                      {a.code} • {p.purchases[a.id].serial || 'Lô số lượng'}
                    </Typography>
                  </>
                ),
              },
              {
                label: 'Cơ sở / Vị trí',
                value: (a) => (
                  <>
                    {db.records.locations.find((l) => l.id === a.locationId)?.name}
                    <Typography variant="caption" sx={{ display: 'block' }}>
                      {p.allocations
                        .filter((x) => x.assetId === a.id && !x.returnedAt)
                        .map(
                          (x) =>
                            `${db.records.rooms.find((r) => r.id === x.roomId)?.code || x.commonArea} (${x.quantity})`,
                        )
                        .join(', ') || 'Kho cơ sở'}
                    </Typography>
                  </>
                ),
              },
              {
                label: 'Mua / Cấp / Khả dụng',
                value: (a) =>
                  `${p.purchases[a.id].quantity} / ${assignedQuantity(db, a.id)} / ${availableQuantity(db, a.id)}`,
              },
              {
                label: 'Vị trí vật lý',
                value: (a) =>
                  p.purchases[a.id].retired
                    ? 'Ngừng sử dụng'
                    : `${assignedQuantity(db, a.id)} đã cấp • ${p.purchases[a.id].quantity - assignedQuantity(db, a.id)} trong kho`,
              },
              {
                label: 'Tình trạng',
                value: (a) => (
                  <Chip
                    size="small"
                    label={conditions[p.purchases[a.id].condition]}
                    sx={{
                      color: p.purchases[a.id].condition === 'Under Repair' ? '#9333ea' : undefined,
                    }}
                  />
                ),
              },
              {
                label: 'Ngày mua / Nhà cung cấp',
                value: (a) => (
                  <>
                    {dateLabel(a.date)}
                    <Typography variant="caption" sx={{ display: 'block' }}>
                      {a.attributes.supplier || 'Nhà cung cấp demo'}
                    </Typography>
                  </>
                ),
              },
              { label: 'Nguyên giá lô', value: (a) => currency(a.amount) },
              {
                label: 'Thao tác',
                value: (a) => (
                  <Stack direction="row" sx={{ gap: 0.5 }}>
                    <Button
                      disabled={p.purchases[a.id].retired}
                      onClick={() => setConditionAsset(a.id)}
                    >
                      Tình trạng
                    </Button>
                    <Button onClick={() => setEventAsset(a.id)}>Ghi vận hành</Button>
                  </Stack>
                ),
              },
            ]}
          />
        </Panel>
      )}
      {tab === 2 && (
        <Panel title="Dòng thời gian vận hành tài sản">
          <DataList
            rows={p.events.filter((e) => assets.some((a) => a.id === e.assetId))}
            noun="lịch sử tài sản"
            searchText={(e) => e.description + e.assetId}
            columns={[
              { label: 'Thời điểm', value: (e) => dateLabel(e.date) },
              {
                label: 'Tài sản',
                value: (e) => db.records.assets.find((a) => a.id === e.assetId)?.code,
              },
              {
                label: 'Phân loại',
                value: (e) => (
                  <Chip
                    size="small"
                    label={
                      {
                        PURCHASE: 'Nhập kho',
                        ALLOCATION: 'Cấp phát',
                        RETURN: 'Thu hồi',
                        CONDITION: 'Tình trạng',
                        REPAIR: 'Sửa chữa',
                        REPLACEMENT: 'Thay mới',
                        DEPRECIATION: 'Khấu hao',
                        INSPECTION: 'Kiểm tra',
                      }[e.kind || 'CONDITION']
                    }
                  />
                ),
              },
              {
                label: 'Phòng tại thời điểm ghi nhận',
                value: (e) =>
                  db.records.rooms.find((room) => room.id === e.roomId)?.code || 'Kho / chung',
              },
              { label: 'Hoạt động', value: (e) => e.description },
              { label: 'Chi phí / khấu hao', value: (e) => (e.amount ? currency(e.amount) : '—') },
            ]}
          />
        </Panel>
      )}
      {catalogEdit && (
        <EditDrawer
          title="Danh mục thiết bị"
          initial={{ ...catalogEdit }}
          fields={[
            { key: 'name', label: 'Tên thiết bị', required: true },
            { key: 'category', label: 'Nhóm thiết bị', required: true },
            { key: 'description', label: 'Mô tả' },
            { key: 'image', label: 'Đường dẫn ảnh HTTPS hoặc ảnh nội bộ' },
          ]}
          onClose={() => setCatalogEdit(null)}
          onSave={(v) =>
            save({
              kind: 'catalog',
              item: {
                ...catalogEdit,
                name: v.name,
                category: v.category,
                description: v.description,
                image: v.image,
              },
            })
          }
        />
      )}
      {purchase && (
        <EditDrawer
          title="Nhập tài sản mua thực tế"
          description="Phiếu mua được ghi nhận một lần. Nhập serial cho từng tài sản riêng lẻ hoặc để trống khi nhập theo lô."
          initial={{
            location: purchase.locationId,
            catalog: p.catalog[0]?.id || '',
            code: '',
            quantity: '1',
            cost: '0',
            serial: '',
            date: purchase.date,
            supplier: '',
            description: '',
          }}
          fields={[
            { key: 'location', label: 'Kho cơ sở', options: db.records.locations },
            { key: 'catalog', label: 'Danh mục thiết bị', options: p.catalog },
            { key: 'code', label: 'Mã phiếu mua / tài sản', required: true },
            { key: 'quantity', label: 'Số lượng mua', type: 'number', required: true },
            { key: 'cost', label: 'Đơn giá mua (VND)', type: 'money', required: true },
            { key: 'serial', label: 'Serial (chỉ cho số lượng 1)' },
            { key: 'date', label: 'Ngày mua', type: 'date', required: true },
            { key: 'supplier', label: 'Nhà cung cấp', required: true },
            { key: 'description', label: 'Thông tin mua / chứng từ' },
          ]}
          onClose={() => setPurchase(null)}
          onSave={(v) =>
            save({
              kind: 'purchase',
              record: {
                ...purchase,
                locationId: v.location,
                code: v.code,
                date: v.date,
                description: v.description,
                attributes: { supplier: v.supplier },
              },
              info: {
                catalogId: v.catalog,
                quantity: Number(v.quantity),
                unitCost: Number(v.cost),
                serial: v.serial.trim(),
                condition: 'Active',
                retired: false,
              },
            })
          }
        />
      )}
      {conditionAsset && (
        <EditDrawer
          title="Cập nhật tình trạng tài sản"
          description="Tình trạng áp dụng cho toàn bộ phiếu/lô này. Tài sản có serial được quản lý riêng. Thay đổi không tự ngừng khai thác phòng."
          initial={{ condition: p.purchases[conditionAsset].condition, reason: '' }}
          fields={[
            {
              key: 'condition',
              label: 'Tình trạng',
              options: Object.entries(conditions).map(([id, name]) => ({ id, name })),
            },
            { key: 'reason', label: 'Lý do / ghi chú thay thế, bảo trì', required: true },
          ]}
          onClose={() => setConditionAsset('')}
          onSave={(v) =>
            save({
              kind: 'condition',
              assetId: conditionAsset,
              condition: v.condition as AssetCondition,
              reason: v.reason,
            })
          }
        />
      )}
      {eventAsset && (
        <EditDrawer
          title="Ghi nhận vận hành tài sản"
          description="Thay mới chỉ ghi nhận quyết định/lịch sử. Tài sản thay thế phải được nhập kho, thu hồi tài sản cũ và cấp phát theo đúng luồng. Khấu hao là số liệu do Owner nhập, UI không tự tính chính thức."
          initial={{ eventKind: 'INSPECTION', date: DEMO_DATE, amount: '0', note: '' }}
          fields={[
            {
              key: 'eventKind',
              label: 'Loại sự kiện',
              options: [
                { id: 'INSPECTION', name: 'Kiểm tra tình trạng' },
                { id: 'REPAIR', name: 'Sửa chữa' },
                { id: 'REPLACEMENT', name: 'Đề xuất / thực hiện thay mới' },
                { id: 'DEPRECIATION', name: 'Ghi nhận khấu hao' },
              ],
            },
            { key: 'date', label: 'Ngày ghi nhận', type: 'date', required: true },
            { key: 'amount', label: 'Chi phí hoặc giá trị khấu hao (VND)', type: 'money' },
            { key: 'note', label: 'Nội dung, lý do và chứng từ tham chiếu', required: true },
          ]}
          onClose={() => setEventAsset('')}
          onSave={(values) =>
            save({
              kind: 'assetEvent',
              assetId: eventAsset,
              eventKind: values.eventKind as
                'REPAIR' | 'REPLACEMENT' | 'DEPRECIATION' | 'INSPECTION',
              date: values.date,
              amount: Number(values.amount || 0),
              note: values.note,
            })
          }
        />
      )}
    </>
  );
}
export function AssetAllocation() {
  if (!isMockMode) return <PropertyApiPage kind="assets" />;
  return <PropertyBoundary>{(db) => <AllocationContent db={db} />}</PropertyBoundary>;
}
function AllocationContent({ db }: { db: DemoDatabase }) {
  const [params] = useSearchParams(),
    portal = usePortal(),
    save = usePropertyMutation(),
    p = db.property!;
  const [location, setLocation] = useState(
      params.get('location') ||
        (portal.locationId !== 'all' ? portal.locationId : db.records.locations[0]?.id || ''),
    ),
    [roomId, setRoomId] = useState(params.get('room') || ''),
    [roomTypeId, setRoomTypeId] = useState(''),
    [target, setTarget] = useState(params.get('room') ? 'room' : 'room'),
    [commonArea, setCommonArea] = useState(''),
    [quantities, setQuantities] = useState<Record<string, number>>({}),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [returnId, setReturnId] = useState('');
  const room = db.records.rooms.find((r) => r.id === roomId && r.locationId === location);
  const targetRooms =
    target === 'roomType'
      ? db.records.rooms.filter(
          (candidate) => candidate.locationId === location && candidate.category === roomTypeId,
        )
      : room
        ? [room]
        : [];
  const inventory = db.records.assets.filter(
    (a) =>
      a.locationId === location &&
      availableQuantity(db, a.id) > 0 &&
      matches(a.code + a.name, portal.search),
  );
  const allocations = p.allocations.filter(
    (a) =>
      a.locationId === location &&
      (target === 'room'
        ? a.roomId === roomId
        : target === 'roomType'
          ? targetRooms.some((candidate) => candidate.id === a.roomId)
          : !a.roomId && a.commonArea === commonArea),
  );
  const picked = Object.entries(quantities).filter(([, q]) => q > 0);
  return (
    <>
      <PageHeader
        title="Cấp phát tài sản"
        subtitle="Chọn thiết bị đã mua từ kho. Cấp phát không tạo phiếu mua hoặc ghi tăng vốn đầu tư."
        actions={
          <Button component={Link} to="/assets">
            Về kho tài sản
          </Button>
        }
      />
      <Panel title="1. Nơi sử dụng">
        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: 2 }}>
          <Select
            label="Cơ sở"
            value={location}
            options={db.records.locations}
            onChange={(v) => {
              setLocation(v);
              setRoomId('');
              setRoomTypeId('');
              setCommonArea('');
              setQuantities({});
            }}
          />
          <Select
            label="Phạm vi"
            value={target}
            options={[
              { id: 'room', name: 'Phòng' },
              { id: 'roomType', name: 'Tất cả phòng cùng loại' },
              { id: 'common', name: 'Khu vực chung' },
            ]}
            onChange={(v) => {
              setTarget(v);
              setQuantities({});
            }}
          />
          {target === 'room' ? (
            <Select
              label="Phòng"
              value={roomId}
              all="Chọn phòng"
              options={db.records.rooms
                .filter((r) => r.locationId === location)
                .map((r) => ({ id: r.id, name: r.code }))}
              onChange={(v) => {
                setRoomId(v);
                setQuantities({});
              }}
            />
          ) : target === 'roomType' ? (
            <Select
              label="Loại phòng"
              value={roomTypeId}
              all="Chọn loại phòng"
              options={db.records['room-types'].filter((type) => type.locationId === location)}
              onChange={(value) => {
                setRoomTypeId(value);
                setQuantities({});
              }}
            />
          ) : (
            <TextField
              size="small"
              label="Tên khu vực chung"
              value={commonArea}
              onChange={(e) => setCommonArea(e.target.value)}
              placeholder="Ví dụ: Sảnh tầng 1"
            />
          )}
        </Stack>
      </Panel>
      {target === 'room' && room && (
        <Panel title="2. Đối chiếu trang bị yêu cầu">
          <DataList
            rows={requirementsForRoom(db, room).map((r) => ({ ...r, id: r.catalogId }))}
            noun="trang bị"
            searchText={(r) => r.name}
            columns={[
              { label: 'Trang bị tiêu chuẩn', value: (r) => r.name },
              { label: 'Yêu cầu', value: (r) => r.quantity },
              { label: 'Thực tế đã cấp', value: (r) => r.assigned },
              {
                label: 'Thiếu',
                value: (r) => (
                  <Chip
                    size="small"
                    label={r.missing ? `Thiếu ${r.missing}` : 'Đủ số lượng'}
                    color={r.missing ? 'warning' : 'success'}
                  />
                ),
              },
            ]}
          />
          <Typography variant="caption">
            Đủ số lượng không đồng nghĩa thiết bị đang hoạt động tốt; xem tình trạng tại kho.
          </Typography>
        </Panel>
      )}
      {target === 'roomType' && roomTypeId && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Sẽ cấp cùng định mức cho {targetRooms.length} phòng thuộc loại{' '}
          {db.records['room-types'].find((type) => type.id === roomTypeId)?.name}. Số lượng nhập bên
          dưới là số lượng cho mỗi phòng; hệ thống kiểm tra tổng tồn kho trước khi lưu.
        </Alert>
      )}
      <Panel title="3. Chọn tài sản khả dụng">
        <DataList
          rows={inventory}
          noun="tài sản khả dụng"
          searchText={(a) => a.name + a.code}
          columns={[
            {
              label: 'Thiết bị / Phiếu mua',
              value: (a) => (
                <>
                  {a.name}
                  <Typography variant="caption" sx={{ display: 'block' }}>
                    {a.code} • {p.purchases[a.id].serial || 'Lô số lượng'}
                  </Typography>
                </>
              ),
            },
            {
              label: 'Khả dụng / Tổng cần',
              value: (a) =>
                `${availableQuantity(db, a.id)} / ${(quantities[a.id] || 0) * Math.max(1, targetRooms.length)}`,
            },
            { label: 'Đơn giá vốn', value: (a) => currency(p.purchases[a.id].unitCost) },
            {
              label: 'Số lượng cấp',
              value: (a) => (
                <TextField
                  label={target === 'roomType' ? `Mỗi phòng` : `Cấp ${a.code}`}
                  size="small"
                  type="number"
                  value={quantities[a.id] || 0}
                  onChange={(e) => setQuantities({ ...quantities, [a.id]: Number(e.target.value) })}
                  sx={{ width: 130 }}
                />
              ),
            },
          ]}
        />
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2 }}
        >
          <Typography>{picked.reduce((s, [, q]) => s + q, 0)} tài sản được chọn</Typography>
          <Button
            variant="contained"
            disabled={
              !picked.length ||
              busy ||
              (target === 'room'
                ? !room
                : target === 'roomType'
                  ? !roomTypeId ||
                    !targetRooms.length ||
                    picked.some(
                      ([assetId, quantity]) =>
                        quantity * targetRooms.length > availableQuantity(db, assetId),
                    )
                  : !commonArea.trim())
            }
            onClick={() => setConfirm(true)}
          >
            Xác nhận cấp phát
          </Button>
        </Stack>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Panel>
      <Panel title="Lịch sử cấp phát tại vị trí">
        <DataList
          rows={allocations}
          noun="lượt cấp phát"
          searchText={(a) => db.records.assets.find((r) => r.id === a.assetId)?.name || ''}
          columns={[
            {
              label: 'Tài sản',
              value: (a) => db.records.assets.find((r) => r.id === a.assetId)?.name,
            },
            { label: 'Số lượng', value: (a) => a.quantity },
            { label: 'Ngày cấp', value: (a) => dateLabel(a.date) },
            {
              label: 'Trạng thái',
              value: (a) => (a.returnedAt ? `Thu hồi ${dateLabel(a.returnedAt)}` : 'Đang được cấp'),
            },
            {
              label: 'Thao tác',
              value: (a) =>
                !a.returnedAt && <Button onClick={() => setReturnId(a.id)}>Thu hồi về kho</Button>,
            },
          ]}
        />
      </Panel>
      <ConfirmDialog
        title="Xác nhận cấp phát từ kho?"
        open={confirm}
        busy={busy}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setBusy(true);
          setError('');
          void save({
            kind: 'allocate',
            allocations:
              target === 'roomType'
                ? targetRooms.flatMap((targetRoom) =>
                    picked.map(([assetId, quantity]) => ({
                      assetId,
                      quantity,
                      locationId: location,
                      roomId: targetRoom.id,
                      commonArea: '',
                    })),
                  )
                : picked.map(([assetId, quantity]) => ({
                    assetId,
                    quantity,
                    locationId: location,
                    roomId: target === 'room' ? roomId : '',
                    commonArea: target === 'common' ? commonArea.trim() : '',
                  })),
          })
            .then(() => {
              setQuantities({});
              setConfirm(false);
            })
            .catch((e) => {
              setError(e.message);
              setConfirm(false);
            })
            .finally(() => setBusy(false));
        }}
      >
        {target === 'roomType'
          ? `Cấp đồng loạt cho ${targetRooms.length} phòng cùng loại.`
          : `Cấp tài sản vào ${target === 'room' ? room?.code : commonArea}.`}{' '}
        Tổng giá trị mua sắm được giữ nguyên.
      </ConfirmDialog>
      {returnId && (
        <EditDrawer
          title="Thu hồi tài sản về kho"
          initial={{ reason: '' }}
          fields={[{ key: 'reason', label: 'Lý do thu hồi / thay thế', required: true }]}
          onClose={() => setReturnId('')}
          onSave={(v) => save({ kind: 'return', allocationId: returnId, reason: v.reason })}
        />
      )}
    </>
  );
}
