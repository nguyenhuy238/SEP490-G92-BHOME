import { useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowRight, Download, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { usePortal } from '../../../app/PortalProvider';
import { usePortalData } from '../../../hooks/usePortalData';
import {
  ChartCard,
  EmptyState,
  ErrorState,
  KPIGrid,
  LoadingState,
  PageHeader,
  StatusChip,
} from '../../../components/common/PortalUI';
import { CollectionChart, FinanceChart } from '../../../components/charts/FinanceCharts';
import { compactMoney, dateLabel, exportCsv, money } from '../../../utils/format';
import { financeSummary } from '../../../utils/finance';
import { RecordEditor } from '../../../components/dialogs/RecordEditor';
import { featureDefinitions } from '../../../app/featureDefinitions';
import { roomStatus } from '../../property/model';
export default function DashboardPage() {
  const query = usePortalData(),
    portal = usePortal(),
    navigate = useNavigate();
  const [month, setMonth] = useState('2024-10'),
    [create, setCreate] = useState(false);
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const db = query.data,
    finance = financeSummary(db, portal.locationId, month);
  const chainRooms = db.records.rooms;
  const chainOccupied = chainRooms.filter((room) => roomStatus(room) === 'OCCUPIED').length;
  const chainAvailable = chainRooms.filter((room) => roomStatus(room) === 'AVAILABLE').length;
  const chainOccupancy = chainRooms.length ? (chainOccupied / chainRooms.length) * 100 : 0;
  const locations = db.records.locations.filter(
    (row) => portal.locationId === 'all' || row.id === portal.locationId,
  );
  const urgent = [
    {
      label: 'Hợp đồng chờ xác nhận cọc',
      count: db.records.contracts.filter((row) => row.status === 'Chờ xác nhận cọc').length,
      path: 'contracts',
      action: 'Kiểm tra',
    },
    {
      label: 'Phòng chưa chốt số điện nước kỳ T10',
      count: db.records.meters.filter((row) => row.status !== 'Đã xác nhận').length,
      path: 'meters',
      action: 'Xem chỉ số',
    },
    {
      label: 'Giao dịch chờ khớp đối soát',
      count: db.records.payments.filter((row) => row.status === 'Chờ đối soát').length,
      path: 'payments',
      action: 'Khớp tay',
    },
    {
      label: 'Sự cố khẩn cấp cần theo dõi',
      count: db.records.incidents.filter(
        (row) => row.category === 'Khẩn cấp' && row.status !== 'Đã giải quyết',
      ).length,
      path: 'incidents',
      action: 'Xem tiến độ',
    },
  ];
  const contracts = db.records.contracts
    .filter(
      (row) =>
        row.endDate <= '2024-11-02' &&
        (portal.locationId === 'all' || row.locationId === portal.locationId),
    )
    .slice(0, 4);
  return (
    <>
      <PageHeader
        title="Tổng quan chuỗi BHOME"
        group="CHAIN DASHBOARD • DỮ LIỆU MÔ PHỎNG"
        subtitle="Theo dõi công suất toàn chuỗi, mở workspace từng cơ sở và xử lý các cảnh báo vận hành quan trọng."
        actions={
          <>
            <TextField
              size="small"
              select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label="Kỳ tổng quan"
            >
              <MenuItem value="2024-10">Tháng 10/2024</MenuItem>
              <MenuItem value="2024-09">Tháng 09/2024</MenuItem>
            </TextField>
            <Button
              variant="outlined"
              startIcon={<Download size={14} />}
              onClick={() =>
                exportCsv(
                  'tong-quan',
                  ['Chỉ tiêu', 'Số tiền VND'],
                  [
                    ['Doanh thu', String(finance.revenue)],
                    ['Chi phí', String(finance.expenses)],
                    ['Lợi nhuận', String(finance.profit)],
                  ],
                )
              }
            >
              Xuất báo cáo
            </Button>
            <Button
              variant="contained"
              startIcon={<Plus size={14} />}
              onClick={() => setCreate(true)}
            >
              Tạo giao dịch
            </Button>
          </>
        }
      />
      <KPIGrid
        items={[
          {
            label: 'Tổng số cơ sở',
            value: db.records.locations.length,
            hint: 'Cơ sở trong chuỗi BHOME',
          },
          { label: 'Tổng số phòng', value: chainRooms.length, hint: 'Tất cả trạng thái khai thác' },
          { label: 'Phòng đang thuê', value: chainOccupied, hint: 'Trạng thái OCCUPIED' },
          { label: 'Phòng trống', value: chainAvailable, hint: 'Trạng thái AVAILABLE' },
          {
            label: 'Tỷ lệ lấp đầy',
            value: `${chainOccupancy.toFixed(1)}%`,
            hint: `${chainOccupied}/${chainRooms.length} phòng`,
          },
        ]}
      />
      <ChartCard
        title="Danh sách cơ sở"
        subtitle="Chọn một cơ sở để mở Location Workspace và giữ nguyên ngữ cảnh qua các tab."
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)', xl: 'repeat(3,1fr)' },
            gap: 1.5,
          }}
        >
          {db.records.locations.map((item) => {
            const rooms = chainRooms.filter((room) => room.locationId === item.id);
            const occupied = rooms.filter((room) => roomStatus(room) === 'OCCUPIED').length;
            const percentage = rooms.length ? (occupied / rooms.length) * 100 : 0;
            return (
              <Box
                key={item.id}
                component={Link}
                to={`/locations/${item.id}/overview`}
                sx={{
                  display: 'block',
                  p: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  color: 'inherit',
                  textDecoration: 'none',
                  '&:hover': { borderColor: 'primary.light', boxShadow: 1 },
                }}
              >
                <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1, mb: 1 }}>
                  <Box>
                    <Typography sx={{ fontWeight: 700 }}>{item.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.attributes.address}
                    </Typography>
                  </Box>
                  <ArrowRight size={17} />
                </Stack>
                <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.75 }}>
                  <Typography variant="caption">
                    {occupied}/{rooms.length} phòng đang thuê
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {percentage.toFixed(1)}%
                  </Typography>
                </Stack>
                <LinearProgress variant="determinate" value={percentage} color="success" />
              </Box>
            );
          })}
        </Box>
      </ChartCard>
      <Box sx={{ height: 24 }} />
      {finance.invoices.length === 0 ? (
        <EmptyState message="Chưa có dữ liệu tài chính trong kỳ đã chọn." />
      ) : (
        <>
          <KPIGrid
            items={[
              {
                label: 'Tổng số phòng',
                value: finance.rooms.length,
                hint: `${locations.length} cơ sở vận hành • ${finance.occupied} có khách`,
              },
              {
                label: 'Tỷ lệ lấp đầy',
                value: `${finance.occupancy.toFixed(1)}%`,
                hint: `Còn trống: ${finance.rooms.length - finance.occupied} phòng`,
              },
              {
                label: 'Doanh thu thực thu',
                value: compactMoney(finance.revenue),
                hint: `Đã thu ${((finance.revenue / Math.max(1, finance.due)) * 100).toFixed(1)}% tổng phải thu`,
              },
              {
                label: 'Công nợ chưa thu',
                value: compactMoney(finance.debt),
                hint: 'Theo các hóa đơn chưa được phân bổ đủ',
                danger: true,
              },
            ]}
          />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' },
              gap: 2.5,
              mb: 3,
            }}
          >
            <ChartCard
              title="Biến động Doanh thu & Chi phí"
              subtitle="Chuỗi dữ liệu mô phỏng 6 tháng gần nhất (T5–T10/2024)"
            >
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3,1fr)',
                  bgcolor: '#f2f3ff',
                  p: 2,
                  mb: 2,
                  gap: 1,
                }}
              >
                {[
                  ['Doanh thu T10', finance.revenue],
                  ['Chi phí vận hành', finance.expenses],
                  ['Lợi nhuận tạm tính', finance.profit],
                ].map(([label, value]) => (
                  <Box key={label}>
                    <Typography variant="caption" color="text.secondary">
                      {label}
                    </Typography>
                    <Typography sx={{ fontSize: 17, fontWeight: 600, mt: 0.5 }}>
                      {compactMoney(Number(value))}
                    </Typography>
                  </Box>
                ))}
              </Box>
              <FinanceChart data={finance.chart} />
              <Typography variant="caption" color="text.secondary">
                Đường xanh lá: Lợi nhuận quản trị mô phỏng; không phải dự báo thị trường.
              </Typography>
            </ChartCard>
            <Stack spacing={2.5}>
              <ChartCard
                title="Lấp đầy theo cơ sở"
                action={
                  <Button component={Link} to="/locations" size="small">
                    Chi tiết
                  </Button>
                }
              >
                {locations.map((location, i) => {
                  const rooms = db.records.rooms.filter((room) => room.locationId === location.id),
                    occupied = rooms.filter((room) => room.status === 'Đang thuê').length;
                  return (
                    <Box key={location.id} sx={{ mb: 2 }}>
                      <Stack
                        direction="row"
                        sx={{ justifyContent: 'space-between', gap: 1, mb: 0.75 }}
                      >
                        <Typography variant="caption">{location.name.split(' - ')[0]}</Typography>
                        <Typography variant="caption" sx={{ fontWeight: 600 }}>
                          {occupied}/{rooms.length} (
                          {((occupied / Math.max(1, rooms.length)) * 100).toFixed(1)}%)
                        </Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={(occupied / Math.max(1, rooms.length)) * 100}
                        color={i === 0 ? 'success' : 'primary'}
                      />
                    </Box>
                  );
                })}
              </ChartCard>
              <ChartCard title="Tiến độ thu tiền T10">
                <CollectionChart
                  data={[
                    { name: 'Đã thu', value: finance.revenue },
                    { name: 'Chưa thu', value: finance.debt },
                  ]}
                />
              </ChartCard>
            </Stack>
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '1.3fr 1fr' },
              gap: 2.5,
              mb: 3,
            }}
          >
            <ChartCard
              title="Cần xử lý ngay"
              action={
                <StatusChip label={`${urgent.reduce((sum, row) => sum + row.count, 0)} đầu việc`} />
              }
            >
              {urgent.map((row) => (
                <Stack
                  key={row.path}
                  direction="row"
                  sx={{
                    py: 2,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    gap: 1,
                    alignItems: 'center',
                  }}
                >
                  <Avatar
                    variant="rounded"
                    sx={{
                      bgcolor: row.path === 'incidents' ? '#ffdad6' : '#e2e7ff',
                      color: row.path === 'incidents' ? 'error.main' : 'primary.main',
                      width: 30,
                      height: 30,
                      fontSize: 13,
                    }}
                  >
                    {row.count}
                  </Avatar>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{row.label}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Bộ dữ liệu demo • Chủ chuỗi theo dõi và xác nhận
                    </Typography>
                  </Box>
                  <Button size="small" onClick={() => navigate(`/${row.path}`)}>
                    {row.action}
                  </Button>
                </Stack>
              ))}
            </ChartCard>
            <ChartCard title="Hiệu quả theo cơ sở" subtitle="T10/2024">
              {locations.map((location) => {
                const f = financeSummary(db, location.id);
                return (
                  <Stack
                    key={location.id}
                    direction="row"
                    sx={{
                      p: 1.5,
                      bgcolor: '#f2f3ff',
                      mb: 1.5,
                      borderRadius: 1,
                      alignItems: 'center',
                      gap: 1.5,
                    }}
                  >
                    <Avatar>{location.code.slice(-2)}</Avatar>
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                        {location.name.split(' - ')[0]}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        QL: {location.attributes.manager} • {f.rooms.length} phòng
                      </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography sx={{ fontSize: 16, fontWeight: 650 }}>
                        {compactMoney(f.revenue)}
                      </Typography>
                      <Typography variant="caption" color="success.main">
                        {((f.revenue / Math.max(1, f.due)) * 100).toFixed(1)}% thu
                      </Typography>
                    </Box>
                  </Stack>
                );
              })}
              <Button component={Link} to="/expenses" size="small">
                Chi tiết chi phí <ArrowRight size={13} />
              </Button>
            </ChartCard>
          </Box>
          <Box
            sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2.5 }}
          >
            <ChartCard title="Hợp đồng sắp đến hạn" subtitle="15 ngày tới • theo kỳ demo">
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      {['Phòng', 'Khách thuê', 'Ngày hết hạn', 'Giá thuê', ''].map((label) => (
                        <TableCell key={label} sx={{ fontSize: 11, bgcolor: '#f2f3ff' }}>
                          {label}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {contracts.map((contract) => (
                      <TableRow key={contract.id}>
                        <TableCell sx={{ fontSize: 12, color: 'primary.main' }}>
                          {db.records.rooms.find((room) => room.id === contract.roomId)?.code}
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>
                          {
                            db.records.tenants.find((tenant) => tenant.id === contract.tenantId)
                              ?.name
                          }
                        </TableCell>
                        <TableCell sx={{ fontSize: 11 }}>{dateLabel(contract.endDate)}</TableCell>
                        <TableCell sx={{ fontSize: 11 }}>{money(contract.amount)}</TableCell>
                        <TableCell>
                          <Button component={Link} to="/contracts" size="small">
                            Tái ký
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </ChartCard>
            <ChartCard
              title="Nhật ký vận hành gần đây"
              subtitle="Minh họa • không có luồng sự kiện thời gian thực"
            >
              {db.audit.length
                ? db.audit.slice(0, 5).map((row) => (
                    <Box
                      key={row.id}
                      sx={{ borderLeft: '2px solid', borderColor: 'primary.light', pl: 2, mb: 2 }}
                    >
                      <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{row.action}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {dateLabel(row.at)} • {row.kind}
                      </Typography>
                    </Box>
                  ))
                : db.records.notifications.slice(0, 4).map((row) => (
                    <Stack key={row.id} direction="row" sx={{ gap: 1.5, mb: 2 }}>
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: row.category === 'Khẩn cấp' ? 'error.main' : 'primary.main',
                          mt: 0.75,
                          flexShrink: 0,
                        }}
                      />
                      <Box>
                        <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{row.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {row.description}
                        </Typography>
                      </Box>
                    </Stack>
                  ))}
              <Button component={Link} to="/notifications" size="small">
                Xem thông báo vận hành
              </Button>
            </ChartCard>
          </Box>
        </>
      )}
      {create && (
        <RecordEditor
          definition={featureDefinitions.find((def) => def.kind === 'payments')!}
          database={db}
          record={null}
          onClose={() => setCreate(false)}
        />
      )}
    </>
  );
}
