import { useState } from 'react';
import {
  Box,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import type {
  FinancialReport,
  FinanceTotals,
} from '../../../../../packages/client-core/src/finance';
import { managementMoney } from '../finance/managementMoney';

import { compareDecimal } from '../finance/compareDecimal';
const columns: {
  id: string;
  label: string;
  value: (t: FinanceTotals) => string | null | undefined;
  format?: (v: string) => string;
}[] = [
  { id: 'rooms', label: 'Số phòng', value: (t) => String(t.totalRooms), format: (v) => v },
  {
    id: 'occupancy',
    label: 'Lấp đầy hiện tại',
    value: (t) => t.management?.currentOccupancyPercent,
    format: (v) => v + '%',
  },
  { id: 'revenue', label: 'Doanh thu', value: (t) => t.management?.revenue },
  { id: 'receipts', label: 'Thực thu', value: (t) => t.management?.actualBusinessCollections },
  { id: 'opex', label: 'Chi phí vận hành', value: (t) => t.operatingExpenses },
  { id: 'profit', label: 'Lợi nhuận vận hành', value: (t) => t.operatingProfit },
  {
    id: 'margin',
    label: 'Biên lợi nhuận',
    value: (t) => t.management?.operatingMarginPercent,
    format: (v) => v + '%',
  },
  { id: 'perRoom', label: 'Chi phí/phòng', value: (t) => t.management?.operatingCostPerRoom },
  { id: 'depreciation', label: 'Khấu hao', value: (t) => t.management?.depreciation },
  { id: 'investment', label: 'Vốn đầu tư lũy kế', value: (t) => t.initialInvestment },
  { id: 'cash', label: 'Dòng tiền vận hành', value: (t) => t.management?.operatingCashFlow },
  {
    id: 'netCash',
    label: 'Dòng tiền sau đầu tư',
    value: (t) => t.management?.netCashAfterInvestment,
  },
  {
    id: 'recovery',
    label: 'Tỷ lệ thu hồi vốn',
    value: (t) => t.management?.cashCapital?.recoveryPercent,
    format: (v) => v + '%',
  },
];
export function LocationPerformanceTable({ report }: { report: FinancialReport }) {
  const [sort, setSort] = useState('profit');
  const [direction, setDirection] = useState('desc');
  const [search, setSearch] = useState('');
  const selected = columns.find((c) => c.id === sort)!;
  const rows = report.locations
    .filter((l) =>
      l.locationName.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi')),
    )
    .slice()
    .sort((a, b) => {
      const x = selected.value(a.totals),
        y = selected.value(b.totals);
      if (x == null || y == null)
        return x == null && y == null
          ? a.locationName.localeCompare(b.locationName, 'vi')
          : x == null
            ? 1
            : -1;
      return (
        compareDecimal(x, y) * (direction === 'desc' ? -1 : 1) ||
        a.locationName.localeCompare(b.locationName, 'vi')
      );
    });
  const renderCells = (totals: FinanceTotals) =>
    columns.map((c) => {
      const value = c.value(totals);
      return (
        <TableCell
          key={c.id}
          align="right"
          sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
        >
          {value == null ? 'Chưa xác định' : c.format ? c.format(value) : managementMoney(value)}
        </TableCell>
      );
    });
  return (
    <Stack spacing={1.5} sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2">So sánh hiệu quả cơ sở</Typography>
      <Typography variant="caption" color="text.secondary">
        Các chỉ tiêu do máy chủ tính; hàng toàn phạm vi không đổi khi lọc tên cơ sở. Cuộn ngang
        trong bảng để xem thêm chỉ tiêu.
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          size="small"
          label="Tìm cơ sở"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <TextField
          size="small"
          select
          label="Sắp xếp theo"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          {columns.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          select
          label="Thứ tự"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        >
          <MenuItem value="desc">Giảm dần</MenuItem>
          <MenuItem value="asc">Tăng dần</MenuItem>
        </TextField>
      </Stack>
      <Box sx={{ minWidth: 0, maxWidth: '100%' }}>
        <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
          <Table size="small" aria-label="So sánh hiệu quả cơ sở">
            <TableHead>
              <TableRow>
                <TableCell>Cơ sở</TableCell>
                {columns.map((c) => (
                  <TableCell key={c.id} align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {c.label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow sx={{ bgcolor: 'action.hover', '& td': { fontWeight: 600 } }}>
                <TableCell>Toàn phạm vi báo cáo</TableCell>
                {renderCells(report.total)}
              </TableRow>
              {rows.map((l) => (
                <TableRow key={l.locationId}>
                  <TableCell>{l.locationName}</TableCell>
                  {renderCells(l.totals)}
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={columns.length + 1}>Không có cơ sở phù hợp.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Stack>
  );
}
