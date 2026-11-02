import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  AlertTriangle,
  BadgeDollarSign,
  CheckCircle2,
  Coins,
  Edit2,
  Info,
  Scale,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { DemoDatabase, PortalRecord } from '../../../../types/portal';
import { INITIAL_FEE_POLICIES, INITIAL_ROOM_TYPES } from '../../mock/locationConfigMock';
import type { FeeCalculationMethod, FeePolicyItem } from '../../types/locationConfig';

interface LocationPricingTabProps {
  db: DemoDatabase;
  location: PortalRecord;
}

const METHOD_LABELS: Record<string, string> = {
  FIXED_AMOUNT: 'Cố định hàng tháng',
  PER_KWH: 'Theo số điện (kWh)',
  PER_M3: 'Theo khối nước (m³)',
  PER_PERSON: 'Theo đầu người',
  PER_ROOM: 'Theo từng phòng',
  PER_BILLING_PERIOD: 'Theo kỳ hóa đơn',
};

export function LocationPricingTab({ db, location }: LocationPricingTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<'rates' | 'fees'>('rates');

  // Room rates state
  const rooms = db.records.rooms.filter((r) => r.locationId === location.id);
  const roomList = rooms.length
    ? rooms
    : [
        { id: 'r-1', code: 'P.101', floor: '1', category: 'type-studio' },
        { id: 'r-2', code: 'P.102', floor: '1', category: 'type-studio' },
        { id: 'r-3', code: 'P.201', floor: '2', category: 'type-mezzanine' },
        { id: 'r-4', code: 'P.202', floor: '2', category: 'type-mezzanine' },
        { id: 'r-5', code: 'P.301', floor: '3', category: 'type-1br' },
      ];

  const [rateOverrides, setRateOverrides] = useState<Record<string, number>>({
    'P.202': 7200000,
  });

  // Fee Policies
  const [feePolicies, setFeePolicies] = useState<FeePolicyItem[]>(INITIAL_FEE_POLICIES);

  // Estimator preview
  const [previewKwh, setPreviewKwh] = useState<number>(140);
  const [previewM3, setPreviewM3] = useState<number>(10);

  // Override Dialog
  const [overrideTargetRoom, setOverrideTargetRoom] = useState<string | null>(null);
  const [overrideValue, setOverrideValue] = useState<number>(6000000);

  const handleSaveOverride = () => {
    if (overrideTargetRoom) {
      setRateOverrides((prev) => ({ ...prev, [overrideTargetRoom]: overrideValue }));
      setOverrideTargetRoom(null);
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2.5 }}>
        <Tabs
          value={activeSubTab}
          onChange={(_, val) => setActiveSubTab(val)}
          sx={{ borderBottom: '1px solid #e2e8f0' }}
        >
          <Tab value="rates" label="Giá thuê phòng & Điều chỉnh cá nhân" icon={<Scale size={16} />} iconPosition="start" />
          <Tab value="fees" label="Biểu phí điện, nước & Dịch vụ" icon={<Coins size={16} />} iconPosition="start" />
        </Tabs>
      </Stack>

      {/* VIEW 1: Rental Rates Hierarchy */}
      {activeSubTab === 'rates' && (
        <Box>
          <Alert severity="info" icon={<Scale size={18} />} sx={{ mb: 2.5, borderRadius: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              Cơ chế phân cấp định giá phòng
            </Typography>
            <Typography variant="body2">
              Các phòng tự động thừa hưởng đơn giá thuê từ <strong>Mẫu loại phòng</strong> đã cấu hình.
              Chủ cơ sở có thể đặt giá thuê riêng cho từng phòng đặc thù (phòng góc, view thoáng, có ban công lớn) mà không làm thay đổi giá chuẩn của loại phòng chung.
            </Typography>
          </Alert>

          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2.5 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: '#f8fafc' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 800 }}>Mã phòng</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Tầng</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Loại phòng</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Giá chuẩn loại phòng</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Giá thuê đang áp dụng</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Nguồn định giá</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Ngày hiệu lực</TableCell>
                  <TableCell sx={{ fontWeight: 800, width: 140 }}>Thao tác</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {roomList.map((room) => {
                  const rType = INITIAL_ROOM_TYPES.find((t) => t.id === (room.category || 'type-studio'));
                  const defaultRate = rType?.defaultRate || 5500000;
                  const override = rateOverrides[room.code];
                  const isOverridden = override !== undefined;
                  const appliedRate = isOverridden ? override : defaultRate;

                  return (
                    <TableRow key={room.code} hover>
                      <TableCell sx={{ fontWeight: 800 }}>{room.code}</TableCell>
                      <TableCell>Tầng {room.floor || 1}</TableCell>
                      <TableCell>
                        <Chip size="small" label={rType?.name || 'Studio'} sx={{ fontWeight: 700 }} />
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>
                        {defaultRate.toLocaleString()} VND
                      </TableCell>
                      <TableCell sx={{ fontWeight: 850, color: isOverridden ? '#b45309' : 'primary.main' }}>
                        {appliedRate.toLocaleString()} VND / tháng
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={isOverridden ? 'Giá chỉnh sửa riêng' : 'Chuẩn theo loại phòng'}
                          color={isOverridden ? 'warning' : 'default'}
                          sx={{ fontWeight: 750, fontSize: 11 }}
                        />
                      </TableCell>
                      <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                        2026-01-01
                      </TableCell>
                      <TableCell>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<Edit2 size={13} />}
                          onClick={() => {
                            setOverrideTargetRoom(room.code);
                            setOverrideValue(appliedRate);
                          }}
                        >
                          {isOverridden ? 'Sửa giá' : 'Đặt giá riêng'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* VIEW 2: Fee Policies */}
      {activeSubTab === 'fees' && (
        <Box>
          {/* Statutory Tariff Alert */}
          <Alert
            severity="warning"
            icon={<AlertTriangle size={20} />}
            sx={{
              mb: 3,
              borderRadius: 2,
              bgcolor: '#fffbeb',
              color: '#92400e',
              border: '1px solid #fde68a',
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              Cảnh báo quy định biểu giá điện & nước sinh hoạt của Nhà nước
            </Typography>
            <Typography variant="body2">
              Đơn giá bán lẻ điện cho người thuê nhà để ở tuân thủ theo biểu giá của EVN và hướng dẫn của Bộ Công Thương.
              Đơn giá nước sinh hoạt căn cứ theo quy định của Ủy ban Nhân dân cấp tỉnh/thành phố. Vui lòng kiểm tra kỹ khung giá hiện hành trước khi chốt biểu phí.
            </Typography>
          </Alert>

          <Grid container spacing={3}>
            {/* Fee Policies Table */}
            <Grid item xs={12} md={7}>
              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2.5 }}>
                <Table size="small">
                  <TableHead sx={{ bgcolor: '#f8fafc' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 800 }}>Tên khoản phí</TableCell>
                      <TableCell sx={{ fontWeight: 800 }}>Phương thức tính</TableCell>
                      <TableCell sx={{ fontWeight: 800 }}>Đơn giá</TableCell>
                      <TableCell sx={{ fontWeight: 800 }}>Phạm vi áp dụng</TableCell>
                      <TableCell sx={{ fontWeight: 800 }}>Ngày hiệu lực</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {feePolicies.map((fee) => (
                      <TableRow key={fee.id}>
                        <TableCell sx={{ fontWeight: 750 }}>
                          {fee.name}
                          {fee.isRegulatoryControlled && (
                            <Chip size="small" label="Khung giá nhà nước" color="warning" sx={{ ml: 1, fontSize: 10 }} />
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={METHOD_LABELS[fee.calculationMethod] || fee.calculationMethod} />
                        </TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>
                          {fee.unitPrice.toLocaleString()} {fee.unit}
                        </TableCell>
                        <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                          {fee.applicationScope === 'LOCATION_WIDE' ? 'Toàn cơ sở' : 'Từng phòng'}
                        </TableCell>
                        <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                          {fee.effectiveDate}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Grid>

            {/* Estimated Monthly Charge Preview Calculator */}
            <Grid item xs={12} md={5}>
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, bgcolor: '#f8fafc' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <BadgeDollarSign size={18} /> Mô phỏng chi phí hàng tháng của phòng
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                  Mô phỏng bảng kê hóa đơn dự kiến của một khách thuê dựa trên mức tiêu thụ điện nước giả định.
                </Typography>

                <Grid container spacing={1.5} sx={{ mb: 2 }}>
                  <Grid item xs={6}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      label="Số điện giả định (kWh)"
                      value={previewKwh}
                      onChange={(e) => setPreviewKwh(parseInt(e.target.value, 10) || 0)}
                    />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      label="Số nước giả định (m³)"
                      value={previewM3}
                      onChange={(e) => setPreviewM3(parseInt(e.target.value, 10) || 0)}
                    />
                  </Grid>
                </Grid>

                <Stack spacing={1} sx={{ pt: 1, borderTop: '1px dashed #cbd5e1' }}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      Tiền thuê phòng Studio:
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      5.500.000 VND
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      Tiền điện ({previewKwh} kWh × 3.800):
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {(previewKwh * 3800).toLocaleString()} VND
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      Tiền nước ({previewM3} m³ × 22.000):
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {(previewM3 * 22000).toLocaleString()} VND
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      Phí rác, an ninh & Wi-Fi:
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      300.000 VND
                    </Typography>
                  </Stack>

                  <Divider sx={{ my: 0.5 }} />

                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                      Tổng tiền dự kiến trên hóa đơn:
                    </Typography>
                    <Typography variant="subtitle1" sx={{ fontWeight: 850, color: 'primary.main' }}>
                      {(5500000 + previewKwh * 3800 + previewM3 * 22000 + 300000).toLocaleString()} VND
                    </Typography>
                  </Stack>
                </Stack>
              </Paper>
            </Grid>
          </Grid>
        </Box>
      )}

      {/* Override Room Rate Dialog */}
      {overrideTargetRoom && (
        <Dialog open={!!overrideTargetRoom} onClose={() => setOverrideTargetRoom(null)} maxWidth="xs" fullWidth>
          <DialogTitle sx={{ fontWeight: 800 }}>
            Đặt giá thuê riêng cho phòng {overrideTargetRoom}
          </DialogTitle>
          <DialogContent sx={{ py: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Nhập giá thuê áp dụng riêng cho phòng này. Mức giá này sẽ ưu tiên áp dụng khi lập hợp đồng thuê mới.
            </Typography>
            <TextField
              fullWidth
              type="number"
              size="small"
              label="Giá thuê mới (VND/tháng)"
              value={overrideValue}
              onChange={(e) => setOverrideValue(parseInt(e.target.value, 10) || 0)}
              InputProps={{
                endAdornment: <InputAdornment position="end">VND</InputAdornment>,
              }}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button variant="outlined" onClick={() => setOverrideTargetRoom(null)}>
              Hủy
            </Button>
            <Button variant="contained" onClick={handleSaveOverride}>
              Lưu giá riêng
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
