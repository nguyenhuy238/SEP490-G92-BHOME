import { ScheduleBoard } from './ScheduleBoard';
import { useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CardMedia,
  Chip,
  Drawer,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { Building2, CheckCheck, Download, LayoutGrid, List, Plus, RefreshCw } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { usePortal } from '../../app/PortalProvider';
import { featureDefinitions } from '../../app/featureDefinitions';
import { usePortalAction, usePortalData } from '../../hooks/usePortalData';
import type { DemoDatabase, PortalRecord, ResourceKind } from '../../types/portal';
import { compactMoney, exportCsv, money } from '../../utils/format';
import { recordDisplay } from '../../utils/recordDisplay';
import { invoiceBalance } from '../../services/repositories/mockPortalRepository';
import {
  ChartCard,
  EmptyState,
  ErrorState,
  KPIGrid,
  LoadingState,
  PageHeader,
  StatusChip,
} from './PortalUI';
import { DataTable } from '../tables/DataTable';
import { RecordEditor } from '../dialogs/RecordEditor';
import { DetailPanel } from './DetailPanel';
export type ResourceVariant =
  'table' | 'cards' | 'rooms' | 'schedule' | 'notifications' | 'handover';
const docked: ResourceKind[] = [
  'assets',
  'tasks',
  'tenants',
  'meters',
  'invoices',
  'payments',
  'debts',
  'incidents',
  'maintenance',
  'handovers',
];
export function ResourcePage({
  kind,
  variant = 'table',
  before,
}: {
  kind: ResourceKind;
  variant?: ResourceVariant;
  before?: ReactNode;
}) {
  const query = usePortalData(),
    action = usePortalAction(),
    portal = usePortal(),
    navigate = useNavigate();
  const [params] = useSearchParams();
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('Tất cả'),
    [category, setCategory] = useState(params.get('type') || 'all'),
    [view, setView] = useState<string>(variant),
    [selectedId, setSelectedId] = useState<string | null>(params.get('selected')),
    [editor, setEditor] = useState<PortalRecord | null | undefined>(),
    [dateFrom, setDateFrom] = useState(''),
    [dateTo, setDateTo] = useState('');
  const def = featureDefinitions.find((def) => def.kind === kind)!;
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const db = query.data,
    all = db.records[kind];
  const filtered = all.filter(
    (row) =>
      (portal.locationId === 'all' ||
        row.locationId === portal.locationId ||
        (kind === 'locations' && row.id === portal.locationId)) &&
      (status === 'Tất cả' || row.status === status) &&
      (category === 'all' || row.category === category) &&
      (!dateFrom || row.date >= dateFrom) &&
      (!dateTo || row.date <= dateTo) &&
      `${row.name} ${row.code} ${row.description} ${recordDisplay(row, 'room', db, kind)} ${recordDisplay(row, 'tenant', db, kind)} ${JSON.stringify(row.attributes)}`
        .toLocaleLowerCase('vi')
        .includes(`${search} ${portal.search}`.trim().toLocaleLowerCase('vi')),
  );
  const scoped = all.filter(
    (row) =>
      portal.locationId === 'all' ||
      row.locationId === portal.locationId ||
      row.id === portal.locationId,
  );
  const selected =
    selectedId === null && docked.includes(kind)
      ? filtered[0]
      : filtered.find((row) => row.id === selectedId);
  const categories = Array.from(new Set(scoped.map((row) => row.category).filter(Boolean)));
  const amount = scoped.reduce((sum, row) => sum + row.amount, 0);
  const paid = scoped.reduce((sum, row) => sum + row.paid, 0);
  const kpiValues: (string | number)[] =
    kind === 'invoices'
      ? [
          compactMoney(amount),
          compactMoney(paid),
          compactMoney(scoped.reduce((sum, row) => sum + invoiceBalance(row), 0)),
          scoped.filter((row) => row.status.includes('điều chỉnh')).length,
        ]
      : kind === 'payments'
        ? [
            compactMoney(amount),
            scoped.filter((row) => row.status === 'Đã đối soát').length,
            scoped.filter((row) => row.status === 'Chờ đối soát').length,
            `${Math.round((scoped.filter((row) => row.status === 'Đã đối soát').length / Math.max(1, scoped.length)) * 100)}%`,
          ]
        : kind === 'locations'
          ? [
              scoped.length,
              db.records.rooms.length,
              `${((db.records.rooms.filter((row) => row.status === 'Đang thuê').length / Math.max(1, db.records.rooms.length)) * 100).toFixed(1)}%`,
              compactMoney(db.records.invoices.reduce((sum, row) => sum + row.paid, 0)),
            ]
          : kind === 'expenses'
            ? [
                compactMoney(amount),
                compactMoney(
                  scoped
                    .filter((row) => row.category.includes('Lương'))
                    .reduce((sum, row) => sum + row.amount, 0),
                ),
                compactMoney(
                  scoped
                    .filter((row) => row.category.includes('CAPEX'))
                    .reduce((sum, row) => sum + row.amount, 0),
                ),
                `${scoped.length} khoản chi`,
              ]
            : [
                scoped.length,
                scoped.filter((row) => /Đang|Vận hành tốt/.test(row.status)).length,
                scoped.filter((row) => /Chờ|Khẩn/.test(row.status) || row.category === 'Khẩn cấp')
                  .length,
                scoped.filter((row) => /Hoàn|Đã /.test(row.status)).length,
              ];
  const showDetail = (row: PortalRecord) => setSelectedId(row.id);
  function exportData() {
    exportCsv(
      kind,
      def.columns.map((column) => column.label),
      filtered.map((row) =>
        def.columns.map((column) => recordDisplay(row, column.field, db, kind)),
      ),
    );
    portal.notify(`Đã xuất ${filtered.length} bản ghi demo (CSV).`);
  }
  const modes =
    variant === 'cards'
      ? [
          ['cards', 'Lưới'],
          ['table', 'Danh sách'],
        ]
      : variant === 'rooms'
        ? [
            ['rooms', 'Ma trận tầng'],
            ['table', 'Bảng chi tiết'],
          ]
        : kind === 'tasks'
          ? [
              ['table', 'Bảng'],
              ['kanban', 'Kanban'],
            ]
          : variant === 'schedule'
            ? [
                ['schedule', 'Theo tuần'],
                ['month', 'Theo tháng'],
                ['table', 'Theo nhân viên'],
              ]
            : [];
  const controls = (
    <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
      <TextField
        size="small"
        placeholder="Tìm mã, tên, phòng, nội dung..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ minWidth: 220, flex: 1 }}
        slotProps={{ htmlInput: { 'aria-label': `Tìm kiếm ${def.title}` } }}
      />
      {categories.length > 0 && (
        <TextField
          select
          size="small"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          sx={{ minWidth: 160 }}
          aria-label="Lọc danh mục"
        >
          <MenuItem value="all">Tất cả phân loại</MenuItem>
          {categories.map((category) => (
            <MenuItem key={category} value={category}>
              {kind === 'rooms'
                ? db.records['room-types'].find((row) => row.id === category)?.name || category
                : category}
            </MenuItem>
          ))}
        </TextField>
      )}
      <TextField
        size="small"
        label="Từ ngày"
        type="date"
        value={dateFrom}
        onChange={(e) => setDateFrom(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ width: 150 }}
      />
      <TextField
        size="small"
        label="Đến ngày"
        type="date"
        value={dateTo}
        onChange={(e) => setDateTo(e.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ width: 150 }}
      />
      <Button
        size="small"
        startIcon={<RefreshCw size={14} />}
        onClick={() => {
          setSearch('');
          setStatus('Tất cả');
          setCategory('all');
          setDateFrom('');
          setDateTo('');
          portal.setSearch('');
        }}
      >
        Đặt lại
      </Button>
      {modes.length > 0 && (
        <ToggleButtonGroup
          size="small"
          exclusive
          value={view}
          onChange={(_, value) => {
            if (value) setView(value);
          }}
        >
          {modes.map(([mode, label], i) => (
            <ToggleButton value={mode} key={mode} sx={{ fontSize: 10, gap: 0.5 }}>
              {i === 0 ? <LayoutGrid size={13} /> : <List size={13} />} {label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      )}
    </Stack>
  );
  return (
    <>
      <PageHeader
        title={def.title}
        subtitle={def.subtitle}
        group={def.group}
        actions={
          <>
            <Button variant="outlined" startIcon={<Download size={14} />} onClick={exportData}>
              Xuất dữ liệu
            </Button>
            {kind === 'notifications' ? (
              <Button
                variant="contained"
                startIcon={<CheckCheck size={14} />}
                disabled={action.isPending}
                onClick={() => action.mutate(() => portal.repository.markAllRead())}
              >
                Đánh dấu tất cả đã đọc
              </Button>
            ) : (
              <Button
                variant="contained"
                startIcon={<Plus size={15} />}
                onClick={() => {
                  if (kind === 'debts') {
                    if (filtered[0]) showDetail(filtered[0]);
                    else portal.notify('Không còn dư nợ trong bộ lọc hiện tại.');
                  } else setEditor(null);
                }}
              >
                {def.action}
              </Button>
            )}
          </>
        }
      />
      <KPIGrid
        items={def.kpis.map((label, i) => ({
          label,
          value: kpiValues[i] ?? 0,
          hint:
            i === 0
              ? 'Bộ dữ liệu minh họa kỳ T10/2024'
              : i === 2
                ? 'Theo dõi và xử lý trong chuỗi'
                : 'Đồng bộ dữ liệu cục bộ',
          danger: i === 2 && Number(kpiValues[i]) > 0,
        }))}
      />
      {before}
      <Paper sx={{ p: 1.5, mb: 2, border: '1px solid', borderColor: 'divider' }}>{controls}</Paper>
      <Paper sx={{ mb: 2, border: '1px solid', borderColor: 'divider' }}>
        <Tabs
          value={status}
          onChange={(_, value) => setStatus(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            minHeight: 42,
            '& .MuiTab-root': { minHeight: 42, textTransform: 'none', fontSize: 11, minWidth: 80 },
          }}
        >
          {def.tabs.map((label) => (
            <Tab
              key={label}
              value={label}
              label={`${label} (${label === 'Tất cả' ? scoped.length : scoped.filter((row) => row.status === label).length})`}
            />
          ))}
        </Tabs>
      </Paper>
      {filtered.length === 0 ? (
        <Paper>
          <EmptyState
            action={
              <Button
                onClick={() => {
                  setSearch('');
                  setStatus('Tất cả');
                  setCategory('all');
                  setDateFrom('');
                  setDateTo('');
                  portal.setSearch('');
                  portal.setLocationId('all');
                }}
              >
                Xóa bộ lọc
              </Button>
            }
          />
        </Paper>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'minmax(0,1fr)',
              xl: selected && docked.includes(kind) ? 'minmax(0,1fr) 310px' : 'minmax(0,1fr)',
            },
            gap: 2,
            alignItems: 'start',
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            {view === 'cards' ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    md: 'repeat(2,minmax(0,1fr))',
                    xl:
                      kind === 'locations' ? 'repeat(3,minmax(0,1fr))' : 'repeat(2,minmax(0,1fr))',
                  },
                  gap: 2,
                }}
              >
                {filtered.map((row, i) => (
                  <Card
                    key={row.id}
                    sx={{ border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}
                  >
                    {kind === 'locations' && (
                      <Box sx={{ height: 170, bgcolor: '#dbe1ff', position: 'relative' }}>
                        {def.images[i % Math.max(1, def.images.length)] ? (
                          <CardMedia
                            component="img"
                            height={170}
                            image={def.images[i % def.images.length]}
                            alt={row.name}
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : (
                          <Building2 size={70} />
                        )}
                        <Chip
                          label={row.code}
                          size="small"
                          sx={{ position: 'absolute', top: 10, left: 10, bgcolor: 'white' }}
                        />
                      </Box>
                    )}
                    <CardContent>
                      <Stack
                        direction="row"
                        sx={{ justifyContent: 'space-between', gap: 1, mb: 1 }}
                      >
                        <Typography variant="caption" color="primary">
                          {row.code}
                        </Typography>
                        <StatusChip label={row.status} />
                      </Stack>
                      <Typography component="h2" sx={{ fontWeight: 650, fontSize: 15, mb: 1 }}>
                        {row.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.attributes.address || row.attributes.capacity}
                      </Typography>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', my: 2 }}>
                        <Typography variant="caption">
                          {kind === 'locations' ? 'Quy mô cơ sở' : 'Giá thuê niêm yết'}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 650 }}>
                          {kind === 'locations'
                            ? recordDisplay(row, 'capacity', db, kind)
                            : money(row.amount)}
                        </Typography>
                      </Stack>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="caption">Tỷ lệ lấp đầy</Typography>
                        <Typography variant="caption" color="success.main">
                          {recordDisplay(row, 'occupancy', db, kind)}
                        </Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={Number(
                          recordDisplay(row, 'occupancy', db, kind).match(/([\d.]+)%/)?.[1] || 0,
                        )}
                        color="success"
                      />
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', my: 2 }}
                      >
                        Quản lý: {row.attributes.manager || 'Ban quản lý BHOME'}
                      </Typography>
                      <Box sx={{ bgcolor: '#f2f3ff', p: 1, borderRadius: 0.5 }}>
                        <Typography variant="caption">
                          {row.attributes.amenities || 'Điều hòa • Bếp riêng • Wifi • An ninh'}
                        </Typography>
                      </Box>
                    </CardContent>
                    <CardActions
                      sx={{
                        justifyContent: 'space-between',
                        p: 2,
                        borderTop: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      <Button size="small" onClick={() => setEditor(row)}>
                        Chỉnh sửa
                      </Button>
                      <Button
                        size="small"
                        component={Link}
                        to={kind === 'room-types' ? `/rooms?type=${row.id}` : '/rooms'}
                        onClick={() => {
                          if (kind === 'locations') portal.setLocationId(row.id);
                        }}
                      >
                        Danh sách phòng
                      </Button>
                      <Button size="small" variant="contained" onClick={() => showDetail(row)}>
                        Chi tiết
                      </Button>
                    </CardActions>
                  </Card>
                ))}
              </Box>
            ) : view === 'rooms' ? (
              <RoomMatrix rows={filtered} database={db} onSelect={showDetail} />
            ) : view === 'schedule' || view === 'month' ? (
              <ScheduleBoard
                rows={filtered}
                monthly={view === 'month'}
                weekStart={params.get('week') || '2024-10-14'}
                onEdit={(row) => setEditor(row)}
              />
            ) : view === 'kanban' ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3,minmax(220px,1fr))',
                  gap: 2,
                  overflowX: 'auto',
                }}
              >
                {['Chờ tiếp nhận', 'Đang thực hiện', 'Chờ nghiệm thu'].map((status) => (
                  <ChartCard key={status} title={status}>
                    {filtered
                      .filter((row) => row.status === status)
                      .map((row) => (
                        <Paper key={row.id} variant="outlined" sx={{ p: 1.5, mb: 1 }}>
                          <Typography variant="caption" color="primary">
                            {row.code}
                          </Typography>
                          <Typography sx={{ fontSize: 12, my: 1 }}>{row.name}</Typography>
                          <Button size="small" onClick={() => showDetail(row)}>
                            Xử lý công việc
                          </Button>
                        </Paper>
                      ))}
                  </ChartCard>
                ))}
              </Box>
            ) : view === 'notifications' ? (
              <Stack spacing={1.5}>
                {filtered.map((row) => (
                  <Paper
                    key={row.id}
                    sx={{
                      p: 2,
                      borderLeft: '3px solid',
                      borderColor:
                        row.category === 'Khẩn cấp'
                          ? 'error.main'
                          : row.status === 'Chưa đọc'
                            ? 'primary.main'
                            : 'divider',
                    }}
                  >
                    <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1 }}>
                      <Chip size="small" label={row.category} />
                      <StatusChip label={row.status} />
                    </Stack>
                    <Typography component="h2" sx={{ fontSize: 15, fontWeight: 650, mb: 1 }}>
                      {row.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {row.description}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Button variant="outlined" size="small" onClick={() => showDetail(row)}>
                        Xem chi tiết
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          action.mutate(() => portal.repository.transition(kind, row.id, 'Đã đọc'));
                          navigate(`/${row.attributes.target || 'dashboard'}`);
                        }}
                      >
                        Mở hồ sơ liên quan
                      </Button>
                      {row.status === 'Chưa đọc' && (
                        <Button
                          size="small"
                          onClick={() =>
                            action.mutate(() =>
                              portal.repository.transition(kind, row.id, 'Đã đọc'),
                            )
                          }
                        >
                          Đánh dấu đã đọc
                        </Button>
                      )}
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            ) : view === 'handover' ? (
              <Stack spacing={1}>
                {filtered.map((row) => (
                  <Paper
                    key={row.id}
                    sx={{
                      p: 2,
                      border: '1px solid',
                      borderColor: selected?.id === row.id ? 'primary.main' : 'divider',
                    }}
                  >
                    <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="caption" color="primary">
                        {row.code}
                      </Typography>
                      <StatusChip label={row.status} />
                    </Stack>
                    <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{row.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {recordDisplay(row, 'tenant', db, kind)} •{' '}
                      {recordDisplay(row, 'location', db, kind)}
                    </Typography>
                    <Typography variant="body2" sx={{ my: 1 }}>
                      Tiền cọc đối chiếu: {money(row.amount)}
                    </Typography>
                    <Button variant="outlined" size="small" onClick={() => showDetail(row)}>
                      Kiểm tra biên bản & Xác nhận
                    </Button>
                  </Paper>
                ))}
              </Stack>
            ) : (
              <Paper sx={{ border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
                <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="subtitle2">
                    Danh sách {def.title.toLowerCase()}{' '}
                    <Typography component="span" variant="caption" color="text.secondary">
                      ({filtered.length} bản ghi)
                    </Typography>
                  </Typography>
                </Box>
                <DataTable
                  definition={def}
                  rows={filtered}
                  database={db}
                  onView={showDetail}
                  onEdit={
                    ['payments', 'debts'].includes(kind) ? undefined : (row) => setEditor(row)
                  }
                />
              </Paper>
            )}
          </Box>
          {selected && docked.includes(kind) && (
            <Box sx={{ display: { xs: 'none', xl: 'block' } }}>
              <DetailPanel
                key={selected.id}
                definition={def}
                row={selected}
                database={db}
                onClose={() => setSelectedId('')}
                onEdit={() => setEditor(selected)}
              />
            </Box>
          )}
        </Box>
      )}
      <Drawer
        anchor="right"
        open={!!selected && selectedId !== null}
        onClose={() => setSelectedId('')}
        sx={{
          display: docked.includes(kind) ? { xl: 'none' } : undefined,
          '& .MuiDrawer-paper': { width: { xs: '100%', sm: 420 }, p: 1.5 },
        }}
      >
        {selected && (
          <DetailPanel
            key={selected.id}
            definition={def}
            row={selected}
            database={db}
            onClose={() => setSelectedId('')}
            onEdit={() => setEditor(selected)}
          />
        )}
      </Drawer>
      {editor !== undefined && (
        <RecordEditor
          key={editor?.id || 'new'}
          definition={def}
          database={db}
          record={editor}
          onClose={() => setEditor(undefined)}
        />
      )}
    </>
  );
}
function RoomMatrix({
  rows,
  database,
  onSelect,
}: {
  rows: PortalRecord[];
  database: DemoDatabase;
  onSelect: (row: PortalRecord) => void;
}) {
  return (
    <Stack spacing={2}>
      {database.records.locations
        .filter((location) => rows.some((row) => row.locationId === location.id))
        .map((location) => (
          <ChartCard key={location.id} title={location.name}>
            {Array.from(
              new Set(
                rows
                  .filter((row) => row.locationId === location.id)
                  .map((row) => row.attributes.floor || '1'),
              ),
            )
              .sort()
              .reverse()
              .map((floor) => (
                <Box key={floor} sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{ fontWeight: 650, display: 'block', mb: 1 }}>
                    Tầng {floor}
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit,minmax(84px,1fr))',
                      gap: 1,
                    }}
                  >
                    {rows
                      .filter(
                        (row) =>
                          row.locationId === location.id && (row.attributes.floor || '1') === floor,
                      )
                      .map((row) => (
                        <Button
                          key={row.id}
                          onClick={() => onSelect(row)}
                          sx={{
                            display: 'block',
                            p: 1.25,
                            border: '1px solid',
                            borderColor:
                              row.status === 'Đang thuê'
                                ? '#b5ddc4'
                                : row.status === 'Bảo trì'
                                  ? '#ffbab3'
                                  : '#c3c6d7',
                            bgcolor: row.status === 'Đang thuê' ? '#f4fbf5' : '#ffffff',
                            textAlign: 'left',
                            minHeight: 100,
                          }}
                        >
                          <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'text.primary' }}>
                            {row.code}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', fontSize: 10, my: 1 }}
                          >
                            {money(row.amount)}
                          </Typography>
                          <Typography
                            sx={{
                              fontSize: 10,
                              color: row.status === 'Đang thuê' ? 'success.main' : 'text.secondary',
                            }}
                          >
                            {row.status}
                          </Typography>
                        </Button>
                      ))}
                  </Box>
                </Box>
              ))}
          </ChartCard>
        ))}
    </Stack>
  );
}
