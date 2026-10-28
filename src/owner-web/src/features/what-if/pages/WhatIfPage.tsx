import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Paper,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePortal } from '../../../app/PortalProvider';
import { usePortalAction, usePortalData } from '../../../hooks/usePortalData';
import {
  ChartCard,
  ErrorState,
  KPIGrid,
  LoadingState,
  PageHeader,
} from '../../../components/common/PortalUI';
import { compactMoney } from '../../../utils/format';
import { financeSummary } from '../../../utils/finance';
import type { Scenario } from '../../../types/portal';
import { baselineScenario, projectScenario } from '../../../utils/scenario';
export default function WhatIfPage() {
  const query = usePortalData(),
    portal = usePortal(),
    action = usePortalAction();
  const [scenario, setScenario] = useState<Scenario>({ ...baselineScenario });
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const db = query.data,
    base = financeSummary(db, portal.locationId),
    projection = projectScenario(
      base.revenue,
      base.expenses,
      base.occupancy,
      base.rooms.length,
      scenario,
    );
  const points = Array.from({ length: 12 }, (_, i) => ({
    name: `T+${i + 1}`,
    baseline: base.profit * (i + 1) - 1200000000,
    scenario: projection.profit * (i + 1) - projection.capital,
  }));
  const set = <K extends keyof Scenario>(key: K, value: Scenario[K]) =>
    setScenario((old) => ({ ...old, [key]: value }));
  return (
    <>
      <PageHeader
        title="Không gian mô phỏng & Kịch bản tài chính"
        group="Báo cáo & Phân tích • Sandbox"
        subtitle="Giả lập giá thuê, tỷ lệ lấp đầy và chi phí. Mọi kịch bản độc lập với giá thuê, hóa đơn và sổ tài chính hiện có."
        actions={
          <>
            <Button
              variant="outlined"
              onClick={() =>
                action.mutate(() =>
                  portal.repository.saveScenario({
                    ...scenario,
                    id: scenario.id || crypto.randomUUID(),
                  }),
                )
              }
              disabled={!scenario.name.trim() || action.isPending}
            >
              Lưu kịch bản
            </Button>
            <Button
              variant="contained"
              onClick={() => setScenario({ ...baselineScenario, name: 'Kịch bản mới' })}
            >
              Tạo kịch bản mới
            </Button>
          </>
        }
      />
      <Alert severity="info" sx={{ mb: 3 }}>
        Môi trường mô phỏng an toàn • Tính toán quản trị theo giả định do bạn nhập. Không có dự báo
        AI, dữ liệu cạnh tranh hay cam kết lợi nhuận.
      </Alert>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '340px minmax(0,1fr)' },
          gap: 3,
        }}
      >
        <ChartCard title="Bảng thiết lập giả định">
          <Stack spacing={2}>
            <TextField
              size="small"
              label="Tên kịch bản"
              value={scenario.name}
              onChange={(e) => set('name', e.target.value)}
            />
            {db.scenarios.length > 0 && (
              <TextField
                select
                size="small"
                label="Kịch bản đã lưu"
                value={db.scenarios.some((row) => row.id === scenario.id) ? scenario.id : ''}
                onChange={(e) => {
                  const saved = db.scenarios.find((row) => row.id === e.target.value);
                  if (saved) setScenario({ ...saved });
                }}
              >
                <MenuItem value="">Chọn kịch bản</MenuItem>
                {db.scenarios.map((row) => (
                  <MenuItem key={row.id} value={row.id}>
                    {row.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <Typography variant="subtitle2" color="primary">
              1. Doanh thu & Giá phòng
            </Typography>
            <Parameter
              label="Tỷ lệ lấp đầy mục tiêu"
              value={scenario.occupancy}
              min={0}
              max={100}
              unit="%"
              onChange={(value) => set('occupancy', value)}
            />
            <Parameter
              label="Điều chỉnh giá thuê trung bình"
              value={scenario.priceDelta}
              min={-15}
              max={25}
              unit="%"
              onChange={(value) => set('priceDelta', value)}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={scenario.serviceFee}
                  onChange={(e) => set('serviceFee', e.target.checked)}
                />
              }
              label={
                <Typography variant="caption">Tăng phí dịch vụ giả định 30.000 ₫/phòng</Typography>
              }
            />
            <Typography variant="subtitle2" color="primary">
              2. Chi phí vận hành (OPEX)
            </Typography>
            <Parameter
              label="Chi phí nhân sự (triệu VND)"
              value={scenario.staffCost / 1000000}
              min={15}
              max={30}
              unit="M ₫"
              onChange={(value) => set('staffCost', Math.round(value * 1000000))}
            />
            <Parameter
              label="Biến động dự phòng bảo trì"
              value={scenario.maintenanceDelta}
              min={0}
              max={30}
              unit="%"
              onChange={(value) => set('maintenanceDelta', value)}
            />
            <Typography variant="subtitle2" color="primary">
              3. Đầu tư mở rộng (CAPEX)
            </Typography>
            <FormControlLabel
              control={
                <Checkbox
                  checked={scenario.expansion}
                  onChange={(e) => set('expansion', e.target.checked)}
                />
              }
              label={<Typography variant="caption">Thêm vốn đầu tư giả định 1.200M ₫</Typography>}
            />
            <Typography variant="caption" color="text.secondary">
              Mở rộng chỉ điều chỉnh vốn đầu tư; doanh thu cơ sở mới chưa được giả định.
            </Typography>
            <Button
              variant="contained"
              onClick={() =>
                portal.notify(
                  'Đã tính lại theo các giả định đang hiển thị. Không sửa dữ liệu tài chính.',
                )
              }
            >
              Tính toán kịch bản tức thì
            </Button>
            <Button
              onClick={() =>
                setScenario({
                  ...baselineScenario,
                  occupancy: base.occupancy,
                  priceDelta: 0,
                  staffCost: 20250000,
                  maintenanceDelta: 0,
                  serviceFee: false,
                  expansion: false,
                })
              }
            >
              Khôi phục gốc
            </Button>
          </Stack>
        </ChartCard>
        <Box sx={{ minWidth: 0 }}>
          <KPIGrid
            items={[
              { label: 'Doanh thu dự kiến / tháng', value: compactMoney(projection.revenue) },
              { label: 'Chi phí vận hành (OPEX)', value: compactMoney(projection.expenses) },
              { label: 'Lợi nhuận dự kiến / tháng', value: compactMoney(projection.profit) },
              {
                label: 'Thời gian hoàn vốn ước tính',
                value: projection.payback
                  ? `${projection.payback.toFixed(1)} tháng`
                  : 'Không hoàn vốn',
              },
            ]}
          />
          <ChartCard
            title="Dự phóng dòng tiền lũy kế 12 tháng tới"
            subtitle="So sánh kịch bản cơ sở và giả định; không chiết khấu, không tính thuế hay chi phí vay"
          >
            <Box sx={{ height: 350, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points}>
                  <CartesianGrid stroke="#eaedff" strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis
                    tickFormatter={(value) => `${Math.round(Number(value) / 1000000)}M`}
                    tick={{ fontSize: 10 }}
                    width={55}
                  />
                  <Tooltip formatter={(value) => compactMoney(Number(value))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    dataKey="baseline"
                    name="Kịch bản cơ sở"
                    stroke="#8ba0c0"
                    strokeDasharray="4 4"
                    dot={false}
                  />
                  <Line
                    dataKey="scenario"
                    name="Kịch bản mô phỏng"
                    stroke="#004ac6"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </ChartCard>
          <Paper sx={{ p: 2.5, mt: 3, bgcolor: '#e2e7ff' }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Độ nhạy theo giả định
            </Typography>
            <Typography variant="body2">
              Chênh lệch lợi nhuận tháng: {compactMoney(projection.profit - base.profit)}. Doanh thu
              thay đổi theo giá và tỷ lệ lấp đầy bạn nhập. Kết quả không phản ánh phản ứng thị
              trường thực tế.
            </Typography>
          </Paper>
        </Box>
      </Box>
    </>
  );
}
function Parameter({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <Box sx={{ bgcolor: '#f2f3ff', p: 1.5, borderRadius: 1 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="caption">{label}</Typography>
        <Typography variant="caption" color="primary" sx={{ fontWeight: 650 }}>
          {value.toFixed(1)}
          {unit}
        </Typography>
      </Stack>
      <Slider
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={0.1}
        valueLabelDisplay="auto"
        onChange={(_, value) => onChange(value as number)}
        size="small"
      />
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        <Typography variant="caption" color="text.secondary">
          {min}
          {unit}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {max}
          {unit}
        </Typography>
      </Stack>
    </Box>
  );
}
