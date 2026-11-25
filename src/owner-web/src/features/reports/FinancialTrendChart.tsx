import { useState } from 'react';
import {
  Alert,
  Box,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  Typography,
  useTheme,
} from '@mui/material';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { FinancialTrendPoint } from '../../../../../packages/client-core/src/finance';
import { displayContractDate } from '../../../../../packages/client-core/src/contracts';
import { managementMoney } from '../finance/managementMoney';

const business = [
  { key: 'revenue', label: 'Doanh thu' },
  { key: 'operatingExpenses', label: 'Chi phí vận hành' },
  { key: 'operatingProfit', label: 'Lợi nhuận vận hành' },
] as const;
const cash = [
  { key: 'actualBusinessCollections', label: 'Tiền kinh doanh thực thu' },
  { key: 'operatingPaymentsConfirmed', label: 'Tiền vận hành đã chi xác nhận' },
] as const;

export function FinancialTrendChart({
  points,
  unavailableReason,
}: {
  points?: FinancialTrendPoint[] | null;
  unavailableReason?: string | null;
}) {
  const [mode, setMode] = useState('business');
  const theme = useTheme();
  if (unavailableReason)
    return (
      <Alert severity="info">
        {unavailableReason === 'period_too_long'
          ? 'Chọn khoảng không quá 120 tháng để xem xu hướng theo tháng.'
          : 'Máy chủ chưa đủ dữ liệu để dựng xu hướng trong kỳ này.'}
      </Alert>
    );
  if (points == null)
    return (
      <Alert severity="info">
        Máy chủ chưa cung cấp dữ liệu xu hướng theo tháng cho báo cáo này.
      </Alert>
    );
  if (points.length === 0)
    return (
      <Typography color="text.secondary">Chưa có dữ liệu xu hướng trong kỳ đã chọn.</Typography>
    );
  const metrics = mode === 'business' ? business : cash;
  // Only chart geometry uses scaled Numbers. Labels, tooltips and tables preserve server decimals.
  const data = points.map((point) => ({
    name: point.from.slice(5, 7) + '/' + point.from.slice(0, 4),
    exact: point,
    ...Object.fromEntries(
      metrics.map(({ key }) => [key, point[key] == null ? null : Number(point[key]) / 1_000_000]),
    ),
  }));
  const colors = [
    theme.palette.primary.main,
    theme.palette.text.secondary,
    theme.palette.success.main,
  ];
  return (
    <Stack spacing={1.5} sx={{ minWidth: 0 }}>
      <Typography variant="h3">Xu hướng theo tháng</Typography>
      <Tabs
        value={mode}
        onChange={(_, value: string) => setMode(value)}
        variant="scrollable"
        scrollButtons="auto"
        aria-label="Chọn chỉ tiêu xu hướng"
      >
        <Tab value="business" label="Kết quả kinh doanh" />
        <Tab value="cash" label="Thu chi thực tế" />
      </Tabs>
      <Typography variant="caption" color="text.secondary">
        Biểu đồ theo triệu đồng; bảng và thông tin khi trỏ giữ số tiền chính xác. Kỳ chưa trọn tháng
        được đánh dấu riêng.
        {mode === 'cash' &&
          ' Chỉ gồm tiền kinh doanh và chi vận hành đã xác nhận; tiền cọc, đầu tư và khoản chưa rõ tình trạng chi được theo dõi riêng.'}
      </Typography>
      <Box
        sx={{ width: '100%', height: 280, minWidth: 0 }}
        role="img"
        aria-label={
          mode === 'business'
            ? 'Xu hướng doanh thu, chi phí và lợi nhuận theo tháng; số liệu chi tiết trong bảng bên dưới'
            : 'Xu hướng tiền thực thu và thực chi vận hành theo tháng; số liệu chi tiết trong bảng bên dưới'
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: 0, right: 12, top: 12, bottom: 8 }}>
            <CartesianGrid stroke={theme.palette.divider} vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis
              width={65}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) =>
                value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })
              }
            />
            <ReferenceLine y={0} stroke={theme.palette.divider} />
            <Tooltip
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload?.exact as FinancialTrendPoint | undefined;
                if (!active || !point) return null;
                return (
                  <Box
                    sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', p: 1.5 }}
                  >
                    <Typography variant="body2">
                      {displayContractDate(point.from)} – {displayContractDate(point.to)}
                    </Typography>
                    {metrics.map(({ key, label }) => (
                      <Typography variant="body2" key={key}>
                        {label}: {managementMoney(point[key])}
                      </Typography>
                    ))}
                  </Box>
                );
              }}
            />
            <Legend />
            {metrics.map(({ key, label }, index) => (
              <Line
                key={key}
                dataKey={key}
                name={label}
                stroke={colors[index]}
                strokeDasharray={index === 1 ? '6 3' : undefined}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Box>
      <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Table
          size="small"
          aria-label={
            mode === 'business'
              ? 'Số liệu xu hướng kinh doanh chính xác'
              : 'Số liệu xu hướng thu chi chính xác'
          }
        >
          <TableHead>
            <TableRow>
              <TableCell>Kỳ ghi nhận</TableCell>
              {metrics.map(({ key, label }) => (
                <TableCell key={key} align="right">
                  {label} (đ)
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {points.map((point) => (
              <TableRow key={point.from}>
                <TableCell sx={{ minWidth: 160 }}>
                  {displayContractDate(point.from)} – {displayContractDate(point.to)}
                  {!point.isComplete && (
                    <Typography variant="caption" component="div" color="text.secondary">
                      Kỳ chưa trọn tháng
                    </Typography>
                  )}
                </TableCell>
                {metrics.map(({ key }) => (
                  <TableCell
                    key={key}
                    align="right"
                    sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {managementMoney(point[key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
