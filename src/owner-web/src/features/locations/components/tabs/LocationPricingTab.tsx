import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  FormControlLabel,
  Grid,
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
  Switch,
} from '@mui/material';
import { AlertTriangle, BadgeDollarSign, Coins, Edit2, Plus, Scale } from 'lucide-react';
import type { DemoDatabase, PortalRecord } from '../../../../types/portal';
import { INITIAL_FEE_POLICIES, INITIAL_ROOM_TYPES } from '../../mock/locationConfigMock';
import type { FeePolicyItem } from '../../types/locationConfig';
import { isMockMode } from '../../../../services/config';
import { usePortal } from '../../../../app/PortalProvider';
import { propertyError } from '../../../property-api/propertyApi';
import {
  useLocationConfigurationApi,
  type BillingPolicyDto,
  type BillingPolicyWrite,
} from '../../api/locationConfigurationApi';

const currentBusinessDate = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

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

const EMPTY_FEE: FeePolicyItem = {
  id: '',
  name: '',
  type: 'OTHER',
  calculationMethod: 'PER_ROOM',
  unitPrice: 0,
  unit: 'VND / phòng / tháng',
  applicationScope: 'LOCATION_WIDE',
  effectiveDate: '2026-11-03',
  description: '',
  isRegulatoryControlled: false,
};

const enumValue = (value: number | string) =>
  typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : value;

const policyCategory = (policy: BillingPolicyDto) => enumValue(policy.category);

const toFee = (policy: BillingPolicyDto): FeePolicyItem => {
  const category = policyCategory(policy);
  const type: FeePolicyItem['type'] =
    category === 1 || category === 'Electricity'
      ? 'ELECTRICITY'
      : category === 2 || category === 'Water'
        ? 'WATER'
        : policy.chargeCode.includes('INTERNET')
          ? 'INTERNET'
          : policy.chargeCode.includes('PARKING')
            ? 'PARKING'
            : 'OTHER';
  return {
    id: policy.id,
    name: policy.name,
    type,
    calculationMethod:
      type === 'ELECTRICITY' ? 'PER_KWH' : type === 'WATER' ? 'PER_M3' : 'PER_ROOM',
    unitPrice: Number(policy.rate),
    unit:
      type === 'ELECTRICITY' ? 'VND / kWh' : type === 'WATER' ? 'VND / m³' : 'VND / phòng / tháng',
    applicationScope: policy.roomId ? 'PER_ROOM' : 'LOCATION_WIDE',
    effectiveDate: policy.effectiveFrom,
    description: '',
    isRegulatoryControlled: type === 'ELECTRICITY' || type === 'WATER',
  };
};

const feeWrite = (locationId: string, fee: FeePolicyItem): BillingPolicyWrite => {
  const category = fee.type === 'ELECTRICITY' ? 1 : fee.type === 'WATER' ? 2 : 3;
  return {
    locationId,
    roomId: null,
    category,
    chargeCode:
      fee.type === 'ELECTRICITY'
        ? 'ELECTRICITY'
        : fee.type === 'WATER'
          ? 'WATER'
          : `SERVICE_${fee.type}`,
    name: fee.name.trim(),
    method: fee.type === 'ELECTRICITY' || fee.type === 'WATER' ? 1 : 0,
    rate: String(fee.unitPrice),
    effectiveFrom: fee.effectiveDate,
    effectiveTo: null,
    reason: fee.description.trim() || 'Cập nhật biểu phí từ Owner Web',
  };
};

export function LocationPricingTab({ db, location }: LocationPricingTabProps) {
  const portal = usePortal();
  const api = useLocationConfigurationApi();
  const queryClient = useQueryClient();
  const [activeSubTab, setActiveSubTab] = useState<'rates' | 'fees'>('rates');

  // Room rates state
  const rooms = db.records.rooms.filter((r) => r.locationId === location.id);
  const roomList = rooms.length
    ? rooms.map((room) => ({
        id: room.id,
        code: room.code,
        floor: room.attributes.floor || '1',
        category: room.category,
      }))
    : isMockMode
      ? [
          { id: 'r-1', code: 'P.101', floor: '1', category: 'type-studio' },
          { id: 'r-2', code: 'P.102', floor: '1', category: 'type-studio' },
          { id: 'r-3', code: 'P.201', floor: '2', category: 'type-mezzanine' },
          { id: 'r-4', code: 'P.202', floor: '2', category: 'type-mezzanine' },
          { id: 'r-5', code: 'P.301', floor: '3', category: 'type-1br' },
        ]
      : [];

  const [rateOverrides, setRateOverrides] = useState<Record<string, number>>(
    isMockMode ? { 'P.202': 7200000 } : {},
  );

  // Fee Policies
  const [mockFeePolicies, setMockFeePolicies] = useState<FeePolicyItem[]>(INITIAL_FEE_POLICIES);
  const [editingFee, setEditingFee] = useState<FeePolicyItem | null>(null);

  const policyQuery = useQuery({
    queryKey: ['billing-policies', location.id],
    queryFn: ({ signal }) => api.billingPolicies(location.id, signal),
    enabled: !isMockMode && Boolean(location.id),
  });
  const policyMutation = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['billing-policies', location.id] });
      portal.notify('Đã lưu biểu phí vào Backend.');
    },
    onError: (error) => portal.notify(propertyError(error), true),
  });
  const apiPolicies = policyQuery.data?.items ?? [];
  const feePolicies = isMockMode
    ? mockFeePolicies
    : apiPolicies.filter((policy) => ![0, 'Rent'].includes(policyCategory(policy))).map(toFee);

  // Estimator preview
  const [previewKwh, setPreviewKwh] = useState<number>(140);
  const [previewM3, setPreviewM3] = useState<number>(10);

  // Override Dialog
  const [overrideTargetRoom, setOverrideTargetRoom] = useState<string | null>(null);
  const [overrideValue, setOverrideValue] = useState<number>(6000000);

  const handleSaveOverride = () => {
    if (overrideTargetRoom) {
      if (!isMockMode) {
        const room = rooms.find((item) => item.code === overrideTargetRoom);
        if (!room) {
          portal.notify('Không tìm thấy phòng trong dữ liệu Backend.', true);
          return;
        }
        const existing = apiPolicies.find(
          (policy) => policy.roomId === room.id && [0, 'Rent'].includes(policyCategory(policy)),
        );
        const input: BillingPolicyWrite = {
          locationId: location.id,
          roomId: room.id,
          category: 0,
          chargeCode: 'RENT',
          name: `Giá thuê phòng ${room.code}`,
          method: 0,
          rate: String(overrideValue),
          effectiveFrom: currentBusinessDate(),
          effectiveTo: null,
          reason: 'Điều chỉnh giá thuê riêng từ Owner Web',
        };
        policyMutation.mutate(() =>
          existing
            ? api.replaceBillingPolicy(existing.id, input, existing.version)
            : api.createBillingPolicy(input),
        );
        setOverrideTargetRoom(null);
        return;
      }
      setRateOverrides((prev) => ({ ...prev, [overrideTargetRoom]: overrideValue }));
      setOverrideTargetRoom(null);
    }
  };

  const handleSaveFee = () => {
    if (!editingFee || !editingFee.name.trim() || editingFee.unitPrice < 0) return;
    if (!isMockMode) {
      const existing = apiPolicies.find((policy) => policy.id === editingFee.id);
      const input = feeWrite(location.id, editingFee);
      policyMutation.mutate(
        () =>
          existing
            ? api.replaceBillingPolicy(existing.id, input, existing.version)
            : api.createBillingPolicy(input),
        { onSuccess: () => setEditingFee(null) },
      );
      return;
    }
    const savedFee = {
      ...editingFee,
      id: editingFee.id || `fee-${Date.now()}`,
      name: editingFee.name.trim(),
    };
    setMockFeePolicies((current) => {
      const exists = current.some((fee) => fee.id === savedFee.id);
      return exists
        ? current.map((fee) => (fee.id === savedFee.id ? savedFee : fee))
        : [...current, savedFee];
    });
    setEditingFee(null);
  };

  const electricityFee = feePolicies.find((fee) => fee.type === 'ELECTRICITY');
  const waterFee = feePolicies.find((fee) => fee.type === 'WATER');
  const fixedServiceTotal = feePolicies
    .filter(
      (fee) =>
        !['ELECTRICITY', 'WATER'].includes(fee.type) &&
        ['FIXED_AMOUNT', 'PER_ROOM', 'PER_BILLING_PERIOD'].includes(fee.calculationMethod),
    )
    .reduce((sum, fee) => sum + fee.unitPrice, 0);
  const locationRentEstimate = isMockMode
    ? 5_500_000
    : Number(
        apiPolicies.find(
          (policy) => [0, 'Rent'].includes(policyCategory(policy)) && policy.roomId === null,
        )?.rate ?? 0,
      );

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}
      >
        <Tabs
          value={activeSubTab}
          onChange={(_, val) => setActiveSubTab(val)}
          sx={{ borderBottom: '1px solid #e2e8f0' }}
        >
          <Tab
            value="rates"
            label="Giá thuê phòng & Điều chỉnh cá nhân"
            icon={<Scale size={16} />}
            iconPosition="start"
          />
          <Tab
            value="fees"
            label="Biểu phí điện, nước & Dịch vụ"
            icon={<Coins size={16} />}
            iconPosition="start"
          />
        </Tabs>
        {activeSubTab === 'fees' && (
          <Button
            variant="contained"
            startIcon={<Plus size={16} />}
            onClick={() => setEditingFee({ ...EMPTY_FEE })}
          >
            Thêm khoản phí
          </Button>
        )}
      </Stack>

      {/* VIEW 1: Rental Rates Hierarchy */}
      {activeSubTab === 'rates' && (
        <Box>
          {!isMockMode && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Backend chưa có API loại phòng, vì vậy cột loại phòng chỉ hiển thị khi dữ liệu thật có
              RoomTypeId. Giá thuê được đọc từ Billing Policy thực tế.
            </Alert>
          )}
          <Alert severity="info" icon={<Scale size={18} />} sx={{ mb: 2.5, borderRadius: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              Cơ chế phân cấp định giá phòng
            </Typography>
            <Typography variant="body2">
              Các phòng tự động thừa hưởng đơn giá thuê từ <strong>Mẫu loại phòng</strong> đã cấu
              hình. Chủ cơ sở có thể đặt giá thuê riêng cho từng phòng đặc thù (phòng góc, view
              thoáng, có ban công lớn) mà không làm thay đổi giá chuẩn của loại phòng chung.
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
                  const rType = INITIAL_ROOM_TYPES.find(
                    (t) => t.id === (room.category || 'type-studio'),
                  );
                  const locationRent = apiPolicies.find(
                    (policy) =>
                      [0, 'Rent'].includes(policyCategory(policy)) && policy.roomId === null,
                  );
                  const roomRent = apiPolicies.find(
                    (policy) =>
                      [0, 'Rent'].includes(policyCategory(policy)) && policy.roomId === room.id,
                  );
                  const defaultRate = isMockMode
                    ? rType?.defaultRate || 5500000
                    : Number(locationRent?.rate ?? 0);
                  const localOverride = rateOverrides[room.code];
                  const override = isMockMode
                    ? localOverride
                    : roomRent
                      ? Number(roomRent.rate)
                      : undefined;
                  const isOverridden = override !== undefined;
                  const appliedRate = isOverridden ? override : defaultRate;

                  return (
                    <TableRow key={room.code} hover>
                      <TableCell sx={{ fontWeight: 800 }}>{room.code}</TableCell>
                      <TableCell>Tầng {room.floor || 1}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={
                            rType?.name || (room.category ? room.category : 'Chưa có loại phòng')
                          }
                          sx={{ fontWeight: 700 }}
                        />
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>
                        {defaultRate.toLocaleString()} VND
                      </TableCell>
                      <TableCell
                        sx={{ fontWeight: 850, color: isOverridden ? '#b45309' : 'primary.main' }}
                      >
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
                        {roomRent?.effectiveFrom || locationRent?.effectiveFrom || '—'}
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
          {!isMockMode && policyQuery.isPending && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Đang tải biểu phí từ Backend...
            </Alert>
          )}
          {!isMockMode && policyQuery.isError && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              action={<Button onClick={() => void policyQuery.refetch()}>Thử lại</Button>}
            >
              {propertyError(policyQuery.error)}
            </Alert>
          )}
          {!isMockMode && (
            <Alert severity="info" sx={{ mb: 2 }}>
              API Billing Policy hiện hỗ trợ phạm vi toàn cơ sở hoặc từng phòng; chưa hỗ trợ mẫu phí
              cấp chuỗi và phạm vi theo loại phòng.
            </Alert>
          )}
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
              Đơn giá bán lẻ điện cho người thuê nhà để ở tuân thủ theo biểu giá của EVN và hướng
              dẫn của Bộ Công Thương. Đơn giá nước sinh hoạt căn cứ theo quy định của Ủy ban Nhân
              dân cấp tỉnh/thành phố. Vui lòng kiểm tra kỹ khung giá hiện hành trước khi chốt biểu
              phí.
            </Typography>
          </Alert>

          <Grid container spacing={3}>
            {/* Fee Policies Table */}
            <Grid size={{ xs: 12, md: 7 }}>
              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2.5 }}>
                <Table size="small">
                  <TableHead sx={{ bgcolor: '#f8fafc' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 800 }}>Tên khoản phí</TableCell>
                      <TableCell sx={{ fontWeight: 800 }}>Phương thức tính</TableCell>
                      <TableCell sx={{ fontWeight: 800 }}>Đơn giá</TableCell>
                      <TableCell sx={{ fontWeight: 800 }}>Phạm vi áp dụng</TableCell>
                      <TableCell sx={{ fontWeight: 800 }}>Ngày hiệu lực</TableCell>
                      <TableCell sx={{ fontWeight: 800 }}>Thao tác</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {feePolicies.map((fee) => (
                      <TableRow key={fee.id}>
                        <TableCell sx={{ fontWeight: 750 }}>
                          {fee.name}
                          {fee.isRegulatoryControlled && (
                            <Chip
                              size="small"
                              label="Khung giá nhà nước"
                              color="warning"
                              sx={{ ml: 1, fontSize: 10 }}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={METHOD_LABELS[fee.calculationMethod] || fee.calculationMethod}
                          />
                        </TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>
                          {fee.unitPrice.toLocaleString()} {fee.unit}
                        </TableCell>
                        <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                          {fee.applicationScope === 'LOCATION_WIDE'
                            ? 'Toàn cơ sở'
                            : fee.applicationScope === 'PER_ROOM_TYPE'
                              ? 'Theo loại phòng'
                              : 'Từng phòng'}
                        </TableCell>
                        <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                          {fee.effectiveDate}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<Edit2 size={13} />}
                            onClick={() => setEditingFee({ ...fee })}
                          >
                            Cấu hình
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Grid>

            {/* Estimated Monthly Charge Preview Calculator */}
            <Grid size={{ xs: 12, md: 5 }}>
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, bgcolor: '#f8fafc' }}>
                <Typography
                  variant="subtitle2"
                  sx={{ fontWeight: 800, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}
                >
                  <BadgeDollarSign size={18} /> Mô phỏng chi phí hàng tháng của phòng
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 2 }}
                >
                  Mô phỏng bảng kê hóa đơn dự kiến của một khách thuê dựa trên mức tiêu thụ điện
                  nước giả định.
                </Typography>

                <Grid container spacing={1.5} sx={{ mb: 2 }}>
                  <Grid size={{ xs: 6 }}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      label="Số điện giả định (kWh)"
                      value={previewKwh}
                      onChange={(e) => setPreviewKwh(parseInt(e.target.value, 10) || 0)}
                    />
                  </Grid>
                  <Grid size={{ xs: 6 }}>
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
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      Tiền thuê phòng Studio:
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {locationRentEstimate.toLocaleString()} VND
                    </Typography>
                  </Stack>
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      Tiền điện ({previewKwh} kWh ×{' '}
                      {(electricityFee?.unitPrice || 0).toLocaleString()}):
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {(previewKwh * (electricityFee?.unitPrice || 0)).toLocaleString()} VND
                    </Typography>
                  </Stack>
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      Tiền nước ({previewM3} m³ × {(waterFee?.unitPrice || 0).toLocaleString()}):
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {(previewM3 * (waterFee?.unitPrice || 0)).toLocaleString()} VND
                    </Typography>
                  </Stack>
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      Phí dịch vụ cố định:
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {fixedServiceTotal.toLocaleString()} VND
                    </Typography>
                  </Stack>

                  <Divider sx={{ my: 0.5 }} />

                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                      Tổng tiền dự kiến trên hóa đơn:
                    </Typography>
                    <Typography variant="subtitle1" sx={{ fontWeight: 850, color: 'primary.main' }}>
                      {(
                        locationRentEstimate +
                        previewKwh * (electricityFee?.unitPrice || 0) +
                        previewM3 * (waterFee?.unitPrice || 0) +
                        fixedServiceTotal
                      ).toLocaleString()}{' '}
                      VND
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
        <Dialog
          open={!!overrideTargetRoom}
          onClose={() => setOverrideTargetRoom(null)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle sx={{ fontWeight: 800 }}>
            Đặt giá thuê riêng cho phòng {overrideTargetRoom}
          </DialogTitle>
          <DialogContent sx={{ py: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Nhập giá thuê áp dụng riêng cho phòng này. Mức giá này sẽ ưu tiên áp dụng khi lập hợp
              đồng thuê mới.
            </Typography>
            <TextField
              fullWidth
              type="number"
              size="small"
              label="Giá thuê mới (VND/tháng)"
              value={overrideValue}
              onChange={(e) => setOverrideValue(parseInt(e.target.value, 10) || 0)}
              slotProps={{
                input: {
                  endAdornment: <InputAdornment position="end">VND</InputAdornment>,
                },
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

      <Dialog open={!!editingFee} onClose={() => setEditingFee(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>
          {editingFee?.id ? 'Cấu hình khoản phí' : 'Thêm khoản phí'}
        </DialogTitle>
        {editingFee && (
          <>
            <DialogContent sx={{ py: 2 }}>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12 }}>
                  <TextField
                    fullWidth
                    label="Tên khoản phí"
                    value={editingFee.name}
                    onChange={(event) => setEditingFee({ ...editingFee, name: event.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    select
                    label="Nhóm phí"
                    value={editingFee.type}
                    onChange={(event) =>
                      setEditingFee({
                        ...editingFee,
                        type: event.target.value as FeePolicyItem['type'],
                      })
                    }
                  >
                    <MenuItem value="ELECTRICITY">Tiền điện</MenuItem>
                    <MenuItem value="WATER">Tiền nước</MenuItem>
                    <MenuItem value="ENVIRONMENTAL_CLEANING">Vệ sinh & môi trường</MenuItem>
                    <MenuItem value="SECURITY">An ninh</MenuItem>
                    <MenuItem value="INTERNET">Internet</MenuItem>
                    <MenuItem value="PARKING">Giữ xe</MenuItem>
                    <MenuItem value="OTHER">Khác</MenuItem>
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    select
                    label="Phương thức tính"
                    value={editingFee.calculationMethod}
                    onChange={(event) =>
                      setEditingFee({
                        ...editingFee,
                        calculationMethod: event.target.value as FeePolicyItem['calculationMethod'],
                      })
                    }
                  >
                    {Object.entries(METHOD_LABELS).map(([value, label]) => (
                      <MenuItem key={value} value={value}>
                        {label}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    type="number"
                    label="Đơn giá"
                    value={editingFee.unitPrice}
                    onChange={(event) =>
                      setEditingFee({
                        ...editingFee,
                        unitPrice: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="Đơn vị hiển thị"
                    value={editingFee.unit}
                    onChange={(event) => setEditingFee({ ...editingFee, unit: event.target.value })}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    select
                    label="Phạm vi áp dụng"
                    value={editingFee.applicationScope}
                    disabled={!isMockMode}
                    onChange={(event) =>
                      setEditingFee({
                        ...editingFee,
                        applicationScope: event.target.value as FeePolicyItem['applicationScope'],
                      })
                    }
                  >
                    <MenuItem value="LOCATION_WIDE">Toàn cơ sở</MenuItem>
                    <MenuItem value="PER_ROOM_TYPE">Theo loại phòng</MenuItem>
                    <MenuItem value="PER_ROOM">Từng phòng</MenuItem>
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    type="date"
                    label="Ngày hiệu lực"
                    value={editingFee.effectiveDate}
                    onChange={(event) =>
                      setEditingFee({ ...editingFee, effectiveDate: event.target.value })
                    }
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    label="Mô tả / căn cứ áp dụng"
                    value={editingFee.description}
                    onChange={(event) =>
                      setEditingFee({ ...editingFee, description: event.target.value })
                    }
                  />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={!!editingFee.isRegulatoryControlled}
                        onChange={(event) =>
                          setEditingFee({
                            ...editingFee,
                            isRegulatoryControlled: event.target.checked,
                          })
                        }
                      />
                    }
                    label="Khoản phí chịu kiểm soát theo khung giá Nhà nước"
                  />
                </Grid>
              </Grid>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2 }}>
              <Button variant="outlined" onClick={() => setEditingFee(null)}>
                Hủy
              </Button>
              <Button
                variant="contained"
                disabled={
                  !editingFee.name.trim() || !editingFee.effectiveDate || policyMutation.isPending
                }
                onClick={handleSaveFee}
              >
                Lưu cấu hình
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
