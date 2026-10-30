import { useState } from 'react';
import { Alert, Box, Button, Chip, Stack, Tab, Tabs, Typography } from '@mui/material';
import { Link } from 'react-router';
import { usePortal } from '../../app/PortalProvider';
import { KPIGrid, PageHeader } from '../../components/common/PortalUI';
import { makeRecord, DEMO_DATE } from '../../services/mock/seed';
import type { DemoDatabase } from '../../types/portal';
import { investmentSummary } from './model';
import { DataList, EditDrawer, Panel, PropertyBoundary, Select } from './PropertyUI';
import { currency, dateLabel, matches } from './propertyUtils';
import { usePropertyMutation } from './usePropertyMutation';

export function Pricing() {
  return <PropertyBoundary>{(db) => <PricingContent db={db} />}</PropertyBoundary>;
}
function PricingContent({ db }: { db: DemoDatabase }) {
  const portal = usePortal(),
    save = usePropertyMutation();
  const [editing, setEditing] = useState<{ location: string; scope: string } | null>(null);
  const [scope, setScope] = useState(''),
    [tab, setTab] = useState(0),
    [newPrice, setNewPrice] = useState(false),
    [location, setLocation] = useState(
      portal.locationId === 'all' ? db.records.locations[0]?.id || '' : portal.locationId,
    ),
    [newScope, setNewScope] = useState('location');
  const labels: Record<string, string> = {
    location: 'Cơ sở',
    type: 'Loại phòng',
    room: 'Phòng riêng lẻ',
  };
  const rows = db.records.pricing.filter(
    (r) =>
      (portal.locationId === 'all' || r.locationId === portal.locationId) &&
      (!scope || r.attributes.scope === scope) &&
      matches(r.name + r.code, portal.search) &&
      (tab === 1 || (r.date <= DEMO_DATE && (!r.endDate || r.endDate >= DEMO_DATE))),
  );
  return (
    <>
      <PageHeader
        title="Giá thuê & Chính sách phí"
        subtitle="Lưu các phiên bản theo ngày hiệu lực. Giá cấu hình không tự thay đổi nghĩa vụ hợp đồng hoặc hóa đơn đã chốt."
        actions={
          <Button variant="contained" onClick={() => setNewPrice(true)}>
            Thêm phiên bản giá
          </Button>
        }
      />
      <Alert severity="info" sx={{ mb: 2 }}>
        Đây là cấu hình minh họa. Thứ tự áp dụng và tính tiền chính thức do backend quyết định; giao
        diện chưa thực hiện tính hóa đơn.
      </Alert>
      <Panel title="Chính sách giá">
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2 }}
        >
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab label="Hiệu lực ngày demo" />
            <Tab label="Tất cả phiên bản / Lịch sử" />
          </Tabs>
          <Select
            label="Phạm vi áp dụng"
            value={scope}
            all="Tất cả"
            options={Object.entries(labels).map(([id, name]) => ({ id, name }))}
            onChange={setScope}
          />
        </Stack>
        <DataList
          rows={rows}
          noun="chính sách"
          searchText={(r) => r.name + r.code}
          columns={[
            {
              label: 'Chính sách',
              value: (r) => (
                <>
                  <Typography sx={{ fontWeight: 650 }}>{r.name}</Typography>
                  <Typography variant="caption">{r.code}</Typography>
                </>
              ),
            },
            {
              label: 'Phạm vi',
              value: (r) => (
                <>
                  {labels[r.attributes.scope]}
                  <Typography variant="caption" sx={{ display: 'block' }}>
                    {
                      (r.attributes.scope === 'room'
                        ? db.records.rooms
                        : r.attributes.scope === 'type'
                          ? db.records['room-types']
                          : db.records.locations
                      ).find((t) => t.id === r.attributes.targetId)?.name
                    }
                  </Typography>
                  {r.attributes.scope === 'room' && <Chip size="small" label="Giá riêng phòng" />}
                </>
              ),
            },
            { label: 'Giá thuê / tháng', value: (r) => currency(r.amount) },
            {
              label: 'Điện / kWh',
              value: (r) => currency(Number(r.attributes.electricityRate || 0)),
            },
            { label: 'Nước / m³', value: (r) => currency(Number(r.attributes.waterRate || 0)) },
            {
              label: 'Phí dịch vụ / tháng',
              value: (r) => currency(Number(r.attributes.serviceRate || 0)),
            },
            { label: 'Hiệu lực', value: (r) => `${dateLabel(r.date)} → ${dateLabel(r.endDate)}` },
          ]}
        />
      </Panel>
      {newPrice && (
        <Panel
          title="Chọn phạm vi phiên bản mới"
          actions={<Button onClick={() => setNewPrice(false)}>Hủy</Button>}
        >
          <Stack direction="row" sx={{ gap: 2 }}>
            <Select
              label="Cơ sở áp dụng"
              value={location}
              options={db.records.locations}
              onChange={setLocation}
            />
            <Select
              label="Cấp cấu hình"
              value={newScope}
              options={Object.entries(labels).map(([id, name]) => ({ id, name }))}
              onChange={setNewScope}
            />
            <Button
              variant="contained"
              onClick={() => {
                setNewPrice(false);
                setEditing({ location, scope: newScope });
              }}
            >
              Nhập mức giá
            </Button>
          </Stack>
        </Panel>
      )}
      {editing && (
        <PriceEditor
          key={`${editing.location}-${editing.scope}`}
          location={editing.location}
          scope={editing.scope}
          db={db}
          onClose={() => setEditing(null)}
          save={save}
        />
      )}
    </>
  );
}

function PriceEditor({
  location,
  scope,
  db,
  onClose,
  save,
}: {
  location: string;
  scope: string;
  db: DemoDatabase;
  onClose: () => void;
  save: ReturnType<typeof usePropertyMutation>;
}) {
  const targets =
    scope === 'location'
      ? db.records.locations.filter((l) => l.id === location)
      : scope === 'type'
        ? db.records['room-types'].filter((t) => t.locationId === location)
        : db.records.rooms
            .filter((r) => r.locationId === location)
            .map((r) => ({ id: r.id, name: r.code }));
  return (
    <EditDrawer
      title="Phiên bản giá & Phí"
      initial={{
        target: targets[0]?.id || '',
        name: '',
        rent: '0',
        electricityRate: '0',
        waterRate: '0',
        serviceRate: '0',
        start: DEMO_DATE,
        end: '',
      }}
      fields={[
        { key: 'target', label: 'Áp dụng cho', options: targets, required: true },
        { key: 'name', label: 'Tên phiên bản', required: true },
        { key: 'rent', label: 'Giá thuê (VND/tháng)', type: 'number', required: true },
        { key: 'electricityRate', label: 'Điện (VND/kWh)', type: 'number' },
        { key: 'waterRate', label: 'Nước (VND/m³)', type: 'number' },
        { key: 'serviceRate', label: 'Dịch vụ (VND/tháng)', type: 'number' },
        { key: 'start', label: 'Hiệu lực từ', type: 'date', required: true },
        { key: 'end', label: 'Hiệu lực đến (để trống nếu chưa xác định)', type: 'date' },
      ]}
      onClose={onClose}
      onSave={(v) =>
        save({
          kind: 'price',
          record: makeRecord('pricing', {
            name: v.name,
            code: `GIA-${crypto.randomUUID().slice(0, 8)}`,
            locationId: location,
            amount: Number(v.rent),
            date: v.start,
            endDate: v.end,
            attributes: {
              scope,
              targetId: v.target,
              electricityRate: v.electricityRate,
              waterRate: v.waterRate,
              serviceRate: v.serviceRate,
            },
          }),
        })
      }
    />
  );
}

export function Investments() {
  return <PropertyBoundary>{(db) => <InvestmentContent db={db} />}</PropertyBoundary>;
}
function InvestmentContent({ db }: { db: DemoDatabase }) {
  const portal = usePortal(),
    save = usePropertyMutation();
  const [tab, setTab] = useState(0),
    [adding, setAdding] = useState(false),
    [location, setLocation] = useState(
      portal.locationId === 'all' ? db.records.locations[0]?.id || '' : portal.locationId,
    ),
    [editor, setEditor] = useState(false);
  const summary = investmentSummary(db, portal.locationId);
  const locations = db.records.locations.filter(
    (l) => portal.locationId === 'all' || l.id === portal.locationId,
  );
  const expenses = db.records.expenses.filter(
    (e) =>
      (portal.locationId === 'all' || e.locationId === portal.locationId) &&
      matches(e.name + e.code, portal.search),
  );
  return (
    <>
      <PageHeader
        title="Đầu tư ban đầu & Chi phí"
        subtitle="Nguyên giá được ghi một lần tại phiếu mua; cấp phát chỉ phân bổ nơi sử dụng vốn."
        actions={
          <>
            <Button component={Link} to="/assets" variant="outlined">
              Nhập mua tài sản
            </Button>
            <Button variant="contained" onClick={() => setAdding(true)}>
              Ghi khoản đầu tư / chi phí khác
            </Button>
          </>
        }
      />
      <KPIGrid
        items={[
          { label: 'Tổng đầu tư ban đầu', value: currency(summary.total) },
          { label: 'Đầu tư tài sản', value: currency(summary.assetValue) },
          { label: 'Đầu tư khác', value: currency(summary.other) },
        ]}
      />
      <KPIGrid
        items={[
          { label: 'Tài sản cấp cho phòng', value: currency(summary.roomValue) },
          { label: 'Tài sản khu vực chung', value: currency(summary.commonValue) },
          { label: 'Giá trị chưa phân bổ', value: currency(summary.unallocated) },
        ]}
      />
      <Alert severity="info" sx={{ mb: 2 }}>
        Giá trị phân bổ là nguyên giá, không phải giá trị còn lại sau khấu hao. Tổng vốn = mua tài
        sản + đầu tư khác; không cộng lại giá trị đã cấp phát. Bảo trì là một phần của chi phí vận
        hành.
      </Alert>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Theo cơ sở" />
        <Tab label="Giá trị theo phòng" />
        <Tab label="Đầu tư khác & Chi phí" />
      </Tabs>
      {tab === 0 && (
        <Panel title="Vốn & Chi phí theo cơ sở">
          <DataList
            rows={locations}
            noun="cơ sở"
            searchText={(l) => l.name}
            columns={[
              { label: 'Cơ sở', value: (l) => l.name },
              { label: 'Tổng đầu tư', value: (l) => currency(investmentSummary(db, l.id).total) },
              { label: 'Tài sản', value: (l) => currency(investmentSummary(db, l.id).assetValue) },
              { label: 'Đầu tư khác', value: (l) => currency(investmentSummary(db, l.id).other) },
              {
                label: 'Chi phí vận hành',
                value: (l) => currency(investmentSummary(db, l.id).operating),
              },
              {
                label: 'Trong đó: bảo trì',
                value: (l) => currency(investmentSummary(db, l.id).maintenance),
              },
            ]}
          />
        </Panel>
      )}
      {tab === 1 && (
        <Panel title="Nguyên giá tài sản đang phân bổ theo phòng">
          <DataList
            rows={db.records.rooms.filter((r) => locations.some((l) => l.id === r.locationId))}
            noun="phòng"
            searchText={(r) => r.code + r.name}
            columns={[
              {
                label: 'Phòng',
                value: (r) => (
                  <Button component={Link} to={`/rooms/${r.id}`}>
                    {r.code}
                  </Button>
                ),
              },
              {
                label: 'Cơ sở',
                value: (r) => db.records.locations.find((l) => l.id === r.locationId)?.name,
              },
              {
                label: 'Tài sản được cấp',
                value: (r) => currency(investmentSummary(db, r.locationId, r.id).roomValue),
              },
              {
                label: 'Đầu tư khác cho phòng',
                value: (r) => currency(investmentSummary(db, r.locationId, r.id).other),
              },
            ]}
          />
        </Panel>
      )}
      {tab === 2 && (
        <Panel title="Sổ đầu tư khác & Chi phí minh họa">
          <DataList
            rows={expenses}
            noun="khoản chi"
            searchText={(e) => e.name + e.code + e.category}
            columns={[
              {
                label: 'Mã / Nội dung',
                value: (e) => (
                  <>
                    {e.code}
                    <Typography>{e.name}</Typography>
                  </>
                ),
              },
              {
                label: 'Cơ sở',
                value: (e) => db.records.locations.find((l) => l.id === e.locationId)?.name,
              },
              { label: 'Nhóm', value: (e) => e.category },
              {
                label: 'Phòng',
                value: (e) => db.records.rooms.find((r) => r.id === e.roomId)?.code || 'Toàn cơ sở',
              },
              { label: 'Ngày ghi nhận', value: (e) => dateLabel(e.date) },
              { label: 'Số tiền', value: (e) => currency(e.amount) },
              { label: 'Chứng từ / ghi chú', value: (e) => e.description },
            ]}
          />
        </Panel>
      )}
      <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
        <Button component={Link} to="/reports" variant="outlined">
          Báo cáo kinh doanh
        </Button>
        <Button component={Link} to="/what-if" variant="outlined">
          Phân tích What-if
        </Button>
      </Box>
      {adding && (
        <Panel title="Chọn cơ sở ghi nhận">
          <Stack direction="row" sx={{ gap: 2 }}>
            <Select
              label="Cơ sở"
              value={location}
              options={db.records.locations}
              onChange={setLocation}
            />
            <Button onClick={() => setAdding(false)}>Hủy</Button>
            <Button
              variant="contained"
              onClick={() => {
                setAdding(false);
                setEditor(true);
              }}
            >
              Tiếp tục
            </Button>
          </Stack>
        </Panel>
      )}
      {editor && (
        <EditDrawer
          title="Ghi đầu tư / chi phí khác"
          description="Mua thiết bị cần ghi tại Kho tài sản, không ghi lại ở đây. Bản ghi này chỉ phục vụ demo, không phải chứng từ tài chính đã xác minh."
          initial={{
            name: '',
            code: '',
            category: 'Đầu tư ban đầu',
            amount: '0',
            roomId: '',
            date: DEMO_DATE,
            description: '',
          }}
          fields={[
            { key: 'name', label: 'Nội dung', required: true },
            { key: 'code', label: 'Mã tham chiếu duy nhất', required: true },
            {
              key: 'category',
              label: 'Nhóm ghi nhận',
              options: ['Đầu tư ban đầu', 'Vận hành', 'Bảo trì'].map((id) => ({ id, name: id })),
            },
            { key: 'amount', label: 'Số tiền (VND)', type: 'number', required: true },
            {
              key: 'roomId',
              label: 'Phòng liên quan',
              options: [
                { id: '', name: 'Toàn cơ sở / khu vực chung' },
                ...db.records.rooms
                  .filter((r) => r.locationId === location)
                  .map((r) => ({ id: r.id, name: r.code })),
              ],
            },
            { key: 'date', label: 'Ngày ghi nhận', type: 'date', required: true },
            { key: 'description', label: 'Chứng từ / ghi chú', required: true },
          ]}
          onClose={() => setEditor(false)}
          onSave={(v) =>
            save({
              kind: 'investment',
              record: makeRecord('expenses', {
                code: v.code,
                name: v.name,
                category: v.category,
                amount: Number(v.amount),
                date: v.date,
                locationId: location,
                roomId: v.roomId,
                description: v.description,
              }),
            })
          }
        />
      )}
    </>
  );
}
