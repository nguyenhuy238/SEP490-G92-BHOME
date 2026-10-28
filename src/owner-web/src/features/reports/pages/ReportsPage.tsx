import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Link } from 'react-router';
import { usePortalData } from '../../../hooks/usePortalData';
import { usePortal } from '../../../app/PortalProvider';
import {
  ChartCard,
  EmptyState,
  ErrorState,
  KPIGrid,
  LoadingState,
  PageHeader,
} from '../../../components/common/PortalUI';
import { CollectionChart, FinanceChart } from '../../../components/charts/FinanceCharts';
import { financeSummary } from '../../../utils/finance';
import { compactMoney, exportCsv, money } from '../../../utils/format';
export default function ReportsPage() {
  const query = usePortalData(),
    portal = usePortal();
  const [month, setMonth] = useState('2024-10'),
    [compare, setCompare] = useState(false);
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const db = query.data,
    f = financeSummary(db, portal.locationId, month),
    locations = db.records.locations.filter(
      (row) => portal.locationId === 'all' || row.id === portal.locationId,
    );
  return (
    <>
      <PageHeader
        title="Báo cáo hiệu quả kinh doanh & Dòng tiền chuỗi trọ"
        group="Báo cáo & Phân tích"
        subtitle="Tổng hợp doanh thu đã phân bổ, chi phí và hiệu quả vận hành. Số liệu quản trị nội bộ từ bộ dữ liệu demo."
        actions={
          <>
            <TextField select size="small" value={month} onChange={(e) => setMonth(e.target.value)}>
              <MenuItem value="2024-10">Kỳ T10/2024</MenuItem>
              <MenuItem value="2024-09">Kỳ T09/2024</MenuItem>
            </TextField>
            <Button variant="outlined" onClick={() => setCompare(!compare)}>
              So sánh chu kỳ
            </Button>
            <Button
              variant="contained"
              onClick={() =>
                exportCsv(
                  'bao-cao-kinh-doanh',
                  ['Cơ sở', 'Doanh thu', 'Chi phí', 'Lợi nhuận'],
                  locations.map((location) => {
                    const v = financeSummary(db, location.id, month);
                    return [location.name, String(v.revenue), String(v.expenses), String(v.profit)];
                  }),
                )
              }
            >
              Xuất báo cáo
            </Button>
          </>
        }
      />
      {compare && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Biểu đồ 6 tháng là chuỗi mô phỏng. Bộ dữ liệu giao dịch chi tiết hiện có kỳ T10/2024;
          không khẳng định số liệu kỳ trước là thực tế.
        </Alert>
      )}
      {f.invoices.length === 0 ? (
        <EmptyState message="Chưa có dữ liệu trong kỳ được chọn." />
      ) : (
        <>
          <KPIGrid
            items={[
              { label: 'Doanh thu thực thu', value: compactMoney(f.revenue) },
              { label: 'Lợi nhuận thuần (NOI)', value: compactMoney(f.profit) },
              { label: 'Tỷ lệ lấp đầy', value: `${f.occupancy.toFixed(1)}%` },
              { label: 'Phòng đang khai thác', value: f.occupied },
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
              title="Đối sánh Doanh thu – Chi phí – Lợi nhuận"
              subtitle="Chuỗi 6 tháng mô phỏng"
            >
              <FinanceChart data={f.chart} />
            </ChartCard>
            <ChartCard title="Cơ cấu nguồn thu">
              <CollectionChart
                data={[
                  {
                    name: 'Tiền phòng',
                    value: f.invoices.reduce(
                      (sum, row) => sum + Number(row.attributes.rent || 0),
                      0,
                    ),
                  },
                  {
                    name: 'Điện nước',
                    value: f.invoices.reduce(
                      (sum, row) => sum + Number(row.attributes.utilities || 0),
                      0,
                    ),
                  },
                  {
                    name: 'Dịch vụ',
                    value: f.invoices.reduce(
                      (sum, row) => sum + Number(row.attributes.service || 0),
                      0,
                    ),
                  },
                ]}
              />
            </ChartCard>
          </Box>
          <ChartCard title="Báo cáo kết quả hoạt động kinh doanh (P&L) theo từng cơ sở">
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {[
                      'Cơ sở vận hành',
                      'Quy mô',
                      'Doanh thu',
                      'Chi phí vận hành',
                      'Lợi nhuận thuần',
                      'Tỷ lệ lấp đầy',
                    ].map((label) => (
                      <TableCell
                        key={label}
                        sx={{ bgcolor: '#f2f3ff', fontSize: 11, whiteSpace: 'nowrap' }}
                      >
                        {label}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {locations.map((location) => {
                    const v = financeSummary(db, location.id, month);
                    return (
                      <TableRow key={location.id}>
                        <TableCell sx={{ fontSize: 12, fontWeight: 600 }}>
                          {location.name}
                        </TableCell>
                        <TableCell>{v.rooms.length} phòng</TableCell>
                        <TableCell>{money(v.revenue)}</TableCell>
                        <TableCell>{money(v.expenses)}</TableCell>
                        <TableCell sx={{ color: 'success.main', fontWeight: 600 }}>
                          {money(v.profit)}
                        </TableCell>
                        <TableCell>{v.occupancy.toFixed(1)}%</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </ChartCard>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' },
              gap: 2.5,
              mt: 3,
            }}
          >
            <ChartCard title="Chỉ số hiệu quả thương mại trên từng đơn vị (RevPAR)">
              <KPIGrid
                items={[
                  {
                    label: 'Doanh thu / phòng',
                    value: money(Math.round(f.revenue / Math.max(1, f.rooms.length))),
                  },
                  {
                    label: 'Chi phí / phòng',
                    value: money(Math.round(f.expenses / Math.max(1, f.rooms.length))),
                  },
                  {
                    label: 'Biên lợi nhuận',
                    value: `${((f.profit / Math.max(1, f.revenue)) * 100).toFixed(1)}%`,
                  },
                ]}
              />
            </ChartCard>
            <Paper sx={{ p: 3, bgcolor: '#e2e7ff' }}>
              <Typography component="h2" sx={{ fontWeight: 600, mb: 1 }}>
                Dòng tiền & Hoàn vốn
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                Thay đổi giả định độc lập với sổ dữ liệu hiện tại. Kết quả là ước tính quản trị.
              </Typography>
              <Button component={Link} to="/what-if" variant="contained">
                Mở phòng kịch bản What-if
              </Button>
            </Paper>
          </Box>
        </>
      )}
    </>
  );
}
