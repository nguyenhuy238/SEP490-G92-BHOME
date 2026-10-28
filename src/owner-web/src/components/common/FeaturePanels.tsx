import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router';
import { usePortal } from '../../app/PortalProvider';
import { usePortalAction, usePortalData } from '../../hooks/usePortalData';
import { ChartCard, ConfirmDialog } from './PortalUI';
import { CollectionChart, FinanceChart } from '../charts/FinanceCharts';
import { financeSummary } from '../../utils/finance';
import { compactMoney, money } from '../../utils/format';

export function PricingPanel() {
  const { data } = usePortalData(),
    portal = usePortal(),
    action = usePortalAction();
  const [tab, setTab] = useState(0),
    [open, setOpen] = useState(false),
    [electricity, setElectricity] = useState(3800),
    [water, setWater] = useState(25000),
    [service, setService] = useState(150000),
    [effectiveDate, setEffectiveDate] = useState('2024-11-01');
  const row = data?.records.pricing[0];
  return (
    <Box sx={{ mb: 3 }}>
      <Tabs
        variant="scrollable"
        value={tab}
        onChange={(_, value) => setTab(value)}
        sx={{ bgcolor: 'white', mb: 2, '& .MuiTab-root': { textTransform: 'none', fontSize: 11 } }}
      >
        {[
          'Giá thuê phòng',
          'Biểu phí Điện & Nước',
          'Phí dịch vụ cố định',
          'Chu kỳ hóa đơn',
          'Lịch sử thay đổi',
        ].map((label) => (
          <Tab key={label} label={label} />
        ))}
      </Tabs>
      {tab === 4 ? (
        <ChartCard title="Lịch sử thay đổi biểu phí">
          {data?.audit
            .filter((row) => row.kind === 'pricing')
            .map((row) => (
              <Typography key={row.id} variant="body2" sx={{ mb: 1 }}>
                {dayjs(row.at).format('DD/MM/YYYY HH:mm')} • {row.action}
              </Typography>
            ))}
          {!data?.audit.some((row) => row.kind === 'pricing') && (
            <Typography variant="body2">
              Biểu phí gốc từ bộ dữ liệu minh họa. Chưa có phiên bản chỉnh sửa.
            </Typography>
          )}
        </ChartCard>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: 2 }}>
          <ChartCard
            title={
              tab === 3 ? 'Chu kỳ hóa đơn & Quy định áp dụng' : 'Đơn giá Điện & Nước Sinh hoạt'
            }
            action={
              <Button
                size="small"
                onClick={() => {
                  setElectricity(Number(row?.attributes.electricityRate || 3800));
                  setWater(Number(row?.attributes.waterRate || 25000));
                  setService(Number(row?.attributes.serviceRate || 150000));
                  setOpen(true);
                }}
              >
                Cập nhật đơn giá
              </Button>
            }
          >
            {tab === 3 ? (
              <Alert severity="info">
                Chu kỳ và ngày đến hạn phải được xác nhận theo hợp đồng. Không tự tính phí phạt, giữ
                cọc hay tăng lãi trong demo.
              </Alert>
            ) : (
              <Stack direction="row" spacing={2}>
                {[
                  ['Điện sinh hoạt', row?.attributes.electricityRate || 3800, '₫/kWh'],
                  ['Nước sinh hoạt', row?.attributes.waterRate || 25000, '₫/m³'],
                ].map(([label, value, unit]) => (
                  <Paper key={label} sx={{ p: 2, bgcolor: '#f2f3ff', flex: 1 }}>
                    <Typography variant="caption">{label}</Typography>
                    <Typography sx={{ fontSize: 22, fontWeight: 650, my: 1 }}>
                      {money(Number(value))}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {unit} • Hiệu lực {row?.attributes.effectiveDate || '01/10/2024'}
                    </Typography>
                  </Paper>
                ))}
              </Stack>
            )}
          </ChartCard>
          <ChartCard title="Dịch vụ cố định">
            <Typography variant="body2">
              Internet / Wifi: {money(Number(row?.attributes.serviceRate || 150000))}/phòng/tháng
            </Typography>
            <Typography variant="body2" sx={{ my: 1 }}>
              Phí vệ sinh chung: 100.000 ₫
            </Typography>
            <Typography variant="body2">Phí giữ xe: 120.000 ₫</Typography>
            <Typography variant="caption" color="text.secondary">
              Đơn giá minh họa; không sửa lại hóa đơn lịch sử.
            </Typography>
          </ChartCard>
        </Box>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            if (row)
              action.mutate(
                () =>
                  portal.repository.save('pricing', {
                    ...row,
                    attributes: {
                      ...row.attributes,
                      electricityRate: String(electricity),
                      waterRate: String(water),
                      serviceRate: String(service),
                      effectiveDate,
                      previousPolicy: JSON.stringify({
                        electricityRate: row.attributes.electricityRate || '3800',
                        waterRate: row.attributes.waterRate || '25000',
                        effectiveDate: row.attributes.effectiveDate || '2024-10-01',
                      }),
                    },
                  }),
                { onSuccess: () => setOpen(false) },
              );
          }}
        >
          <DialogTitle>Phiên bản đơn giá demo mới</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Alert severity="info">
                Chỉ cấu hình cho kỳ hiệu lực mới; hóa đơn đã phát hành được giữ nguyên.
              </Alert>
              <TextField
                required
                type="number"
                label="Điện (VND/kWh)"
                value={electricity}
                onChange={(e) => setElectricity(Number(e.target.value))}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
              />
              <TextField
                required
                type="number"
                label="Nước (VND/m³)"
                value={water}
                onChange={(e) => setWater(Number(e.target.value))}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
              />
              <TextField
                required
                type="number"
                label="Internet (VND/phòng)"
                value={service}
                onChange={(e) => setService(Number(e.target.value))}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
              />
              <TextField
                required
                type="date"
                label="Hiệu lực từ"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Hủy</Button>
            <Button type="submit" disabled={!row || action.isPending}>
              Lưu phiên bản demo
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
}
export function ExpenseCharts() {
  const { data } = usePortalData(),
    { locationId } = usePortal();
  if (!data) return null;
  const f = financeSummary(data, locationId),
    rows = data.records.expenses.filter(
      (row) => locationId === 'all' || row.locationId === locationId,
    );
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, gap: 2, mb: 3 }}>
      <ChartCard
        title="Biến động chi phí 6 tháng (T5–T10/2024)"
        subtitle="Chuỗi minh họa; chi tiết giao dịch kỳ T10"
      >
        <FinanceChart data={f.chart} />
      </ChartCard>
      <ChartCard title="Cơ cấu chi phí">
        <CollectionChart
          data={Array.from(new Set(rows.map((row) => row.category))).map((category) => ({
            name: category.slice(0, 25),
            value: rows
              .filter((row) => row.category === category)
              .reduce((sum, row) => sum + row.amount, 0),
          }))}
        />
      </ChartCard>
    </Box>
  );
}
export function DebtAging() {
  const { data } = usePortalData(),
    { locationId } = usePortal();
  if (!data) return null;
  const rows = data.records.debts.filter(
    (row) => locationId === 'all' || row.locationId === locationId,
  );
  return (
    <Box sx={{ mb: 3 }}>
      <ChartCard title="Phân bổ tuổi nợ (Debt Aging Breakdown)">
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4,1fr)' },
            gap: 2,
          }}
        >
          {[
            [0, 3],
            [4, 7],
            [8, 15],
            [16, 999],
          ].map(([min, max]) => {
            const debts = rows.filter((row) => {
              const days = dayjs('2024-10-18').diff(dayjs(row.date), 'day');
              return days >= min && days <= max;
            });
            return (
              <Paper
                key={min}
                sx={{
                  p: 2,
                  bgcolor: '#f2f3ff',
                  borderTop: '3px solid',
                  borderColor: min > 7 ? 'error.main' : 'primary.main',
                }}
              >
                <Typography variant="caption">
                  {max === 999 ? 'Trên 15 ngày' : `${min}–${max} ngày`}
                </Typography>
                <Typography sx={{ fontSize: 20, fontWeight: 650, my: 0.5 }}>
                  {compactMoney(debts.reduce((sum, row) => sum + row.amount - row.paid, 0))}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {debts.length} hóa đơn • không tự cộng phạt
                </Typography>
              </Paper>
            );
          })}
        </Box>
      </ChartCard>
    </Box>
  );
}
export function ScheduleTools() {
  const { data } = usePortalData(),
    portal = usePortal(),
    action = usePortalAction();
  const [confirm, setConfirm] = useState('');
  const [params, setParams] = useSearchParams();
  const week = params.get('week') || '2024-10-14';
  return (
    <Paper sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          select
          size="small"
          label="Tuần thao tác"
          value={week}
          onChange={(e) => setParams({ week: e.target.value })}
        >
          <MenuItem value="2024-10-14">14/10–20/10/2024</MenuItem>
          <MenuItem value="2024-10-21">21/10–27/10/2024</MenuItem>
        </TextField>
        <Button variant="outlined" disabled={action.isPending} onClick={() => setConfirm('copy')}>
          Sao chép sang tuần kế tiếp
        </Button>
        <Button
          variant="contained"
          disabled={action.isPending}
          onClick={() => setConfirm('publish')}
        >
          Xuất bản lịch demo
        </Button>
        <Typography variant="caption" color="text.secondary">
          Lịch chỉ lưu cục bộ; không gửi Zalo/SMS.
        </Typography>
      </Stack>
      <ConfirmDialog
        open={!!confirm}
        title={confirm === 'copy' ? 'Sao chép lịch tuần?' : 'Xuất bản lịch demo?'}
        onClose={() => setConfirm('')}
        busy={action.isPending}
        onConfirm={() =>
          action.mutate(
            async () => {
              const rows =
                data?.records.schedules.filter(
                  (row) =>
                    row.date === week &&
                    (portal.locationId === 'all' || row.locationId === portal.locationId),
                ) || [];
              if (!rows.length) throw new Error('Chưa có lịch trong tuần đã chọn.');
              for (const row of rows) {
                if (confirm === 'copy')
                  await portal.repository.save('schedules', {
                    ...row,
                    id: crypto.randomUUID(),
                    code: `${row.code}-${dayjs(week).add(7, 'day').format('MMDD')}`,
                    date: dayjs(row.date).add(7, 'day').format('YYYY-MM-DD'),
                    endDate: dayjs(row.endDate).add(7, 'day').format('YYYY-MM-DD'),
                    status: 'Bản nháp',
                  });
                else await portal.repository.transition('schedules', row.id, 'Đã xuất bản');
              }
            },
            { onSuccess: () => setConfirm('') },
          )
        }
      >
        Chỉ thay đổi bảng ca minh họa; kiểm tra nhân viên và tuần trước khi xác nhận.
      </ConfirmDialog>
    </Paper>
  );
}
