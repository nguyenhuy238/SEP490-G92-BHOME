import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
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
  Radio,
  Stack,
  Step,
  StepButton,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeDollarSign,
  Building2,
  CheckCircle2,
  Copy,
  Layers3,
  Package,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { makeRecord } from '../../../services/mock/seed';
import type { DemoDatabase, PortalRecord } from '../../../types/portal';
import {
  INITIAL_ASSET_CATALOG,
  INITIAL_FEE_POLICIES,
  INITIAL_HOUSE_RULES,
  INITIAL_ROOM_TYPE_REQUIREMENTS,
  INITIAL_ROOM_TYPES,
} from '../mock/locationConfigMock';
import type {
  AssetCatalogItem,
  FeePolicyItem,
  GeneratedRoomDraft,
  HouseRuleItem,
  RoomAssetAssignmentDraft,
  RoomTypeDraft,
} from '../types/locationConfig';

export interface InitialLocationSetupResult {
  roomTypes: RoomTypeDraft[];
  rooms: GeneratedRoomDraft[];
  feePolicies: FeePolicyItem[];
  houseRules: HouseRuleItem[];
  rateOverrides: Record<string, number>;
}

interface InitialLocationSetupWizardProps {
  open: boolean;
  onClose: () => void;
  db: DemoDatabase;
  onComplete: (newLocationRecord: PortalRecord, wizardData: InitialLocationSetupResult) => void;
}

const WIZARD_STEPS = [
  'Thông tin cơ sở',
  'Loại phòng',
  'Tạo phòng',
  'Tài sản & Tiện nghi',
  'Giá thuê phòng',
  'Biểu phí dịch vụ',
  'Nội quy cơ sở',
  'Xem lại & Hoàn tất',
];

export function InitialLocationSetupWizard({
  open,
  onClose,
  db,
  onComplete,
}: InitialLocationSetupWizardProps) {
  const [activeStep, setActiveStep] = useState(0);

  // Step 1: Setup Mode & Location Information
  const [setupMode, setSetupMode] = useState<'SCRATCH' | 'COPY'>('SCRATCH');
  const [sourceLocationId, setSourceLocationId] = useState(db.records.locations[0]?.id || '');
  const [locationName, setLocationName] = useState('BHOME Sky View - Nguyễn Thị Thập');
  const [locationCode, setLocationCode] = useState('CS-04');
  const [address, setAddress] = useState('250 Nguyễn Thị Thập, P. Tân Quy, Quận 7, TP.HCM');
  const [floors, setFloors] = useState<number>(4);
  const [contactPhone, setContactPhone] = useState('0908 123 456');
  const [contactEmail, setContactEmail] = useState('contact.skyview@bhome.vn');
  const [description, setDescription] = useState(
    'Cơ sở thông minh với thang máy thẻ từ, khóa vân tay và sân thượng chill',
  );
  const [operationalStatus, setOperationalStatus] = useState<'ACTIVE' | 'PREPARING'>('PREPARING');

  // Step 2: Room Types
  const [roomTypes, setRoomTypes] = useState<RoomTypeDraft[]>(INITIAL_ROOM_TYPES);

  // Step 3: Rooms
  const [rooms, setRooms] = useState<GeneratedRoomDraft[]>([
    { code: 'P.101', floor: 1, roomTypeId: 'type-studio', status: 'AVAILABLE' },
    { code: 'P.102', floor: 1, roomTypeId: 'type-studio', status: 'AVAILABLE' },
    { code: 'P.201', floor: 2, roomTypeId: 'type-mezzanine', status: 'AVAILABLE' },
    { code: 'P.202', floor: 2, roomTypeId: 'type-mezzanine', status: 'AVAILABLE' },
    { code: 'P.301', floor: 3, roomTypeId: 'type-1br', status: 'AVAILABLE' },
    { code: 'P.302', floor: 3, roomTypeId: 'type-1br', status: 'AVAILABLE' },
  ]);
  // Bulk room generator state
  const [bulkFloor, setBulkFloor] = useState<number>(2);
  const [bulkRoomTypeId, setBulkRoomTypeId] = useState<string>('type-studio');
  const [bulkPrefix, setBulkPrefix] = useState<string>('P.');
  const [bulkStartNumber] = useState<number>(1);
  const [bulkQuantity, setBulkQuantity] = useState<number>(4);

  // Step 4: Asset Configuration
  const [assetCatalog] = useState<AssetCatalogItem[]>(INITIAL_ASSET_CATALOG);
  const [roomTypeTemplates] = useState(INITIAL_ROOM_TYPE_REQUIREMENTS);
  const [selectedTemplateRoomType, setSelectedTemplateRoomType] = useState<string>('type-studio');
  const [, setRoomAssetAssignments] = useState<RoomAssetAssignmentDraft[]>([]);
  const [templateAppliedNotice, setTemplateAppliedNotice] = useState<string | null>(null);

  // Step 5: Rental Rates
  const [rateOverrides, setRateOverrides] = useState<Record<string, number>>({});

  // Step 6: Fee Policies
  const [feePolicies] = useState<FeePolicyItem[]>(INITIAL_FEE_POLICIES);
  const [previewKwh, setPreviewKwh] = useState<number>(150);
  const [previewM3, setPreviewM3] = useState<number>(12);

  // Step 7: House Rules
  const [houseRules, setHouseRules] = useState<HouseRuleItem[]>(INITIAL_HOUSE_RULES);

  // Handle Copy Mode selection
  const handleCopyFromSource = (sourceId: string) => {
    setSourceLocationId(sourceId);
    const sourceLoc = db.records.locations.find((l) => l.id === sourceId);
    if (sourceLoc) {
      setLocationName(`${sourceLoc.name} (Bản sao)`);
      setLocationCode(`${sourceLoc.code}-B`);
    }
  };

  // Bulk generate rooms
  const handleGenerateRooms = () => {
    const generated: GeneratedRoomDraft[] = [];
    for (let i = 0; i < bulkQuantity; i++) {
      const roomNum = bulkFloor * 100 + bulkStartNumber + i;
      const code = `${bulkPrefix}${roomNum}`;
      if (!rooms.some((r) => r.code === code)) {
        generated.push({
          code,
          floor: bulkFloor,
          roomTypeId: bulkRoomTypeId,
          status: 'AVAILABLE',
        });
      }
    }
    setRooms((prev) => [...prev, ...generated]);
  };

  const handleRemoveRoom = (code: string) => {
    setRooms((prev) => prev.filter((r) => r.code !== code));
  };

  // Apply Asset Template to all rooms of selected Room Type
  const handleApplyAssetTemplate = (typeId: string) => {
    const targetRooms = rooms.filter((r) => r.roomTypeId === typeId);
    const requirements = roomTypeTemplates[typeId] || [];
    const newAssignments: RoomAssetAssignmentDraft[] = [];

    targetRooms.forEach((room) => {
      requirements.forEach((req) => {
        newAssignments.push({
          roomCode: room.code,
          catalogId: req.catalogId,
          quantity: req.quantity,
          condition: 'Active',
          source: 'TEMPLATE',
        });
      });
    });

    setRoomAssetAssignments((prev) => [
      ...prev.filter((a) => !targetRooms.some((r) => r.code === a.roomCode)),
      ...newAssignments,
    ]);

    const typeName = roomTypes.find((t) => t.id === typeId)?.name || 'Loại phòng';
    setTemplateAppliedNotice(
      `Đã áp dụng định mức gồm ${requirements.length} hạng mục từ loại phòng "${typeName}" cho ${targetRooms.length} phòng.`,
    );
  };

  // Complete wizard
  const handleFinish = () => {
    const newId = `loc-${Date.now()}`;
    const newLocRecord = makeRecord('locations', {
      id: newId,
      code: locationCode,
      name: locationName,
      status: operationalStatus === 'ACTIVE' ? 'Đang vận hành' : 'Chuẩn bị vận hành',
      amount: 0,
      attributes: {
        address,
        floors: String(floors),
        phone: contactPhone,
        email: contactEmail,
        description,
        amenities: 'Thang máy · Khóa vân tay · Camera 24/7 · Wi-Fi Mesh',
        setupStatus: 'FULLY_CONFIGURED',
      },
    });

    onComplete(newLocRecord, {
      roomTypes,
      rooms,
      feePolicies,
      houseRules,
      rateOverrides,
    });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      {/* Wizard Header */}
      <DialogTitle
        sx={{ pb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2,
              bgcolor: '#ebf2ff',
              color: 'primary.main',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Building2 size={22} />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              Thiết lập cấu hình cơ sở ban đầu (Setup Wizard)
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Quy trình từng bước hướng dẫn thiết lập loại phòng, tạo phòng, tài sản, giá và nội quy
              cho cơ sở mới
            </Typography>
          </Box>
        </Stack>
        <Button size="small" onClick={onClose} sx={{ minWidth: 'auto', p: 0.5 }}>
          <X size={18} />
        </Button>
      </DialogTitle>

      {/* Stepper Progress Bar */}
      <Box sx={{ px: 3, pt: 1, pb: 2, bgcolor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
        <Stepper activeStep={activeStep} alternativeLabel nonLinear>
          {WIZARD_STEPS.map((label, index) => {
            const isCompleted = activeStep > index;
            return (
              <Step key={label} completed={isCompleted}>
                <StepButton onClick={() => setActiveStep(index)}>
                  <Typography
                    sx={{
                      fontSize: 12,
                      fontWeight: activeStep === index ? 800 : 500,
                      color: activeStep === index ? 'primary.main' : 'inherit',
                    }}
                  >
                    {label}
                  </Typography>
                </StepButton>
              </Step>
            );
          })}
        </Stepper>
      </Box>

      {/* Step Content */}
      <DialogContent
        sx={{ p: 3, minHeight: 520, maxHeight: 'calc(85vh - 160px)', overflowY: 'auto' }}
      >
        {/* STEP 1: Location Information */}
        {activeStep === 0 && (
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>
              Bước 1: Thông tin cơ sở & Phương thức thiết lập
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Nhập các thuộc tính cơ bản của cơ sở và lựa chọn tạo mới hoàn toàn hoặc sao chép mẫu
              từ một cơ sở đang hoạt động.
            </Typography>

            {/* Setup Mode Selection Cards */}
            <Grid container spacing={2} sx={{ mb: 3.5 }}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2.5,
                    borderRadius: 2.5,
                    borderColor: setupMode === 'SCRATCH' ? 'primary.main' : '#e2e8f0',
                    bgcolor: setupMode === 'SCRATCH' ? '#f0f7ff' : '#ffffff',
                    borderWidth: setupMode === 'SCRATCH' ? 2 : 1,
                    cursor: 'pointer',
                  }}
                  onClick={() => setSetupMode('SCRATCH')}
                >
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    <Radio checked={setupMode === 'SCRATCH'} />
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                        Tạo mới hoàn toàn (Create from Scratch)
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Tự cấu hình thủ công các loại phòng, tài sản, biểu phí và nội quy riêng.
                      </Typography>
                    </Box>
                  </Stack>
                </Paper>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2.5,
                    borderRadius: 2.5,
                    borderColor: setupMode === 'COPY' ? 'primary.main' : '#e2e8f0',
                    bgcolor: setupMode === 'COPY' ? '#f0f7ff' : '#ffffff',
                    borderWidth: setupMode === 'COPY' ? 2 : 1,
                    cursor: 'pointer',
                  }}
                  onClick={() => setSetupMode('COPY')}
                >
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    <Radio checked={setupMode === 'COPY'} />
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                        Sao chép từ cơ sở có sẵn (Copy Configuration)
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Thừa hưởng toàn bộ mẫu loại phòng, định mức trang bị và biểu phí từ một cơ
                        sở đang vận hành tốt.
                      </Typography>
                    </Box>
                  </Stack>
                </Paper>
              </Grid>
            </Grid>

            {setupMode === 'COPY' && (
              <Alert severity="info" icon={<Copy size={18} />} sx={{ mb: 3, borderRadius: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                  Chọn cơ sở mẫu để sao chép
                </Typography>
                <Typography variant="body2" sx={{ mb: 1.5 }}>
                  Chọn cơ sở có quy mô và phân khúc tương đồng làm mẫu:
                </Typography>
                <TextField
                  select
                  size="small"
                  label="Cơ sở mẫu nguồn"
                  value={sourceLocationId}
                  onChange={(e) => handleCopyFromSource(e.target.value)}
                  sx={{ bgcolor: '#ffffff', minWidth: 280 }}
                >
                  {db.records.locations.map((loc) => (
                    <MenuItem key={loc.id} value={loc.id}>
                      {loc.name} ({loc.code})
                    </MenuItem>
                  ))}
                </TextField>
              </Alert>
            )}

            {/* Location Form Fields */}
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 8 }}>
                <TextField
                  fullWidth
                  required
                  size="small"
                  label="Tên cơ sở"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  required
                  size="small"
                  label="Mã cơ sở"
                  value={locationCode}
                  onChange={(e) => setLocationCode(e.target.value)}
                  placeholder="CS-04"
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  required
                  size="small"
                  label="Địa chỉ chi tiết"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  required
                  size="small"
                  type="number"
                  label="Số tầng"
                  value={floors}
                  onChange={(e) => setFloors(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  slotProps={{ htmlInput: { min: 1, max: 20 } }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Số điện thoại liên hệ"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Email quản lý"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  multiline
                  rows={2}
                  size="small"
                  label="Mô tả cơ sở & Tiện ích chung"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  select
                  size="small"
                  label="Trạng thái vận hành ban đầu"
                  value={operationalStatus}
                  onChange={(e) => setOperationalStatus(e.target.value as 'ACTIVE' | 'PREPARING')}
                >
                  <MenuItem value="PREPARING">Chuẩn bị vận hành (Bản nháp setup)</MenuItem>
                  <MenuItem value="ACTIVE">Đang vận hành (Sẵn sàng nhận khách)</MenuItem>
                </TextField>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* STEP 2: Room Type Configuration */}
        {activeStep === 1 && (
          <Box>
            <Stack
              direction="row"
              sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  Bước 2: Cấu hình các mẫu loại phòng
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Định nghĩa các phân khúc phòng (diện tích chuẩn, sức chứa, giá thuê mặc định và
                  tiện nghi).
                </Typography>
              </Box>
              <Button
                variant="contained"
                size="small"
                startIcon={<Plus size={16} />}
                onClick={() => {
                  setRoomTypes((current) => [
                    ...current,
                    {
                      id: `type-${Date.now()}`,
                      name: 'Studio Sang trọng',
                      code: 'DLX-STD',
                      area: 28,
                      maxOccupants: 2,
                      defaultRate: 6000000,
                      description: 'Phòng studio tiện nghi cao cấp có ban công riêng',
                      facilities: ['Máy lạnh', 'Máy nước nóng', 'Smart TV', 'Ban công riêng'],
                      status: 'ACTIVE',
                    },
                  ]);
                }}
              >
                Thêm loại phòng
              </Button>
            </Stack>

            <Grid container spacing={2}>
              {roomTypes.map((rt) => (
                <Grid key={rt.id} size={{ xs: 12, md: 4 }}>
                  <Card
                    variant="outlined"
                    sx={{
                      borderRadius: 2.5,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <CardContent sx={{ flex: 1, p: 2.5 }}>
                      <Stack
                        direction="row"
                        sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                      >
                        <Chip
                          size="small"
                          label={rt.code}
                          color="primary"
                          sx={{ fontWeight: 800 }}
                        />
                        <Chip
                          size="small"
                          label={rt.status === 'ACTIVE' ? 'Đang áp dụng' : 'Bản nháp'}
                          color={rt.status === 'ACTIVE' ? 'success' : 'default'}
                          sx={{ fontSize: 11 }}
                        />
                      </Stack>

                      <Typography variant="h6" sx={{ fontWeight: 800, mt: 1.5 }}>
                        {rt.name}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 2, minHeight: 40 }}
                      >
                        {rt.description}
                      </Typography>

                      <Divider sx={{ my: 1.5 }} />

                      <Stack spacing={1}>
                        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                          <Typography variant="caption" color="text.secondary">
                            Diện tích chuẩn:
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 750 }}>
                            {rt.area} m²
                          </Typography>
                        </Stack>
                        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                          <Typography variant="caption" color="text.secondary">
                            Sức chứa tối đa:
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 750 }}>
                            {rt.maxOccupants} người
                          </Typography>
                        </Stack>
                        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                          <Typography variant="caption" color="text.secondary">
                            Giá thuê mặc định:
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: 800, color: 'primary.main' }}
                          >
                            {rt.defaultRate.toLocaleString()} VND/tháng
                          </Typography>
                        </Stack>
                      </Stack>

                      <Box sx={{ mt: 2 }}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block', mb: 0.5 }}
                        >
                          Trang bị tiêu chuẩn:
                        </Typography>
                        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                          {rt.facilities.map((fac) => (
                            <Chip key={fac} label={fac} size="small" sx={{ fontSize: 11 }} />
                          ))}
                        </Stack>
                      </Box>
                    </CardContent>

                    <Divider />
                    <Stack
                      direction="row"
                      sx={{ justifyContent: 'flex-end', p: 1, gap: 1, bgcolor: '#f8fafc' }}
                    >
                      <Button
                        size="small"
                        startIcon={<Copy size={14} />}
                        onClick={() => {
                          const dup: RoomTypeDraft = {
                            ...rt,
                            id: `type-${Date.now()}`,
                            code: `${rt.code}-CP`,
                            name: `${rt.name} (Bản sao)`,
                          };
                          setRoomTypes((prev) => [...prev, dup]);
                        }}
                      >
                        Nhân bản
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        disabled={roomTypes.length <= 1}
                        onClick={() =>
                          setRoomTypes((prev) => prev.filter((item) => item.id !== rt.id))
                        }
                      >
                        Xóa
                      </Button>
                    </Stack>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}

        {/* STEP 3: Room Configuration */}
        {activeStep === 2 && (
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
              Bước 3: Danh sách phòng & Tạo phòng hàng loạt
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              Tạo phòng theo sơ đồ tầng. Các phòng sẽ tự động thừa hưởng diện tích và giá thuê mặc
              định từ Loại phòng được gán.
            </Typography>

            {/* Bulk Creator Form */}
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, mb: 3, bgcolor: '#f8fafc' }}>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <Layers3 size={18} /> Công cụ tạo phòng hàng loạt theo tầng
              </Typography>
              <Grid container spacing={2} sx={{ alignItems: 'center' }}>
                <Grid size={{ xs: 12, sm: 3 }}>
                  <TextField
                    fullWidth
                    select
                    size="small"
                    label="Tầng bố trí"
                    value={bulkFloor}
                    onChange={(e) => setBulkFloor(parseInt(e.target.value, 10))}
                  >
                    {Array.from({ length: floors }, (_, i) => i + 1).map((fl) => (
                      <MenuItem key={fl} value={fl}>
                        Tầng {fl}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 3 }}>
                  <TextField
                    fullWidth
                    select
                    size="small"
                    label="Loại phòng gán"
                    value={bulkRoomTypeId}
                    onChange={(e) => setBulkRoomTypeId(e.target.value)}
                  >
                    {roomTypes.map((rt) => (
                      <MenuItem key={rt.id} value={rt.id}>
                        {rt.name} ({rt.code})
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 6, sm: 2 }}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Tiền tố"
                    value={bulkPrefix}
                    onChange={(e) => setBulkPrefix(e.target.value)}
                  />
                </Grid>
                <Grid size={{ xs: 6, sm: 2 }}>
                  <TextField
                    fullWidth
                    type="number"
                    size="small"
                    label="Số lượng phòng"
                    value={bulkQuantity}
                    onChange={(e) =>
                      setBulkQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))
                    }
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 2 }}>
                  <Button
                    fullWidth
                    variant="contained"
                    onClick={handleGenerateRooms}
                    startIcon={<Sparkles size={16} />}
                  >
                    Sinh phòng
                  </Button>
                </Grid>
              </Grid>
            </Paper>

            {/* Generated Rooms Table */}
            <Stack
              direction="row"
              sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                Danh sách phòng đã cấu hình ({rooms.length} phòng)
              </Typography>
              <Chip size="small" label={`Thừa hưởng từ ${roomTypes.length} loại phòng`} />
            </Stack>

            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2.5 }}>
              <Table size="small">
                <TableHead sx={{ bgcolor: '#f8fafc' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 800 }}>Mã phòng</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Tầng</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Loại phòng</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Diện tích</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Giá thuê mặc định</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Trạng thái</TableCell>
                    <TableCell sx={{ fontWeight: 800, width: 80 }}>Xóa</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rooms.map((room) => {
                    const rType = roomTypes.find((t) => t.id === room.roomTypeId);
                    return (
                      <TableRow key={room.code} hover>
                        <TableCell sx={{ fontWeight: 800 }}>{room.code}</TableCell>
                        <TableCell>Tầng {room.floor}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={rType?.name || 'Tiêu chuẩn'}
                            sx={{ fontWeight: 700 }}
                          />
                        </TableCell>
                        <TableCell>{rType?.area || 25} m² (Thừa hưởng)</TableCell>
                        <TableCell sx={{ fontWeight: 750, color: 'primary.main' }}>
                          {(rType?.defaultRate || 5500000).toLocaleString()} VND
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label="Sẵn sàng"
                            color="success"
                            sx={{ fontSize: 11 }}
                          />
                        </TableCell>
                        <TableCell>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleRemoveRoom(room.code)}
                          >
                            <Trash2 size={16} />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {/* STEP 4: Asset Configuration */}
        {activeStep === 3 && (
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
              Bước 4: Danh mục tài sản, Định mức & Phân bổ vào phòng
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              Cấu trúc 3 cấp độ: Danh mục tài sản (Cấp 1), Định mức theo loại phòng (Cấp 2), Phân bổ
              tài sản vào từng phòng (Cấp 3).
            </Typography>

            {templateAppliedNotice && (
              <Alert
                severity="success"
                onClose={() => setTemplateAppliedNotice(null)}
                sx={{ mb: 2.5, borderRadius: 2 }}
              >
                {templateAppliedNotice}
              </Alert>
            )}

            <Grid container spacing={2.5}>
              {/* Asset Catalog Column */}
              <Grid size={{ xs: 12, md: 4 }}>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, height: '100%' }}>
                  <Typography
                    variant="subtitle2"
                    sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}
                  >
                    <Package size={18} /> Danh mục tài sản mẫu (Cấp 1)
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mb: 2 }}
                  >
                    Các trang thiết bị nội thất & điện máy tiêu chuẩn của BHOME.
                  </Typography>

                  <Stack spacing={1} sx={{ maxHeight: 380, overflowY: 'auto', pr: 0.5 }}>
                    {assetCatalog.map((item) => (
                      <Box
                        key={item.id}
                        sx={{
                          p: 1.25,
                          borderRadius: 1.5,
                          border: '1px solid #e2e8f0',
                          bgcolor: '#f8fafc',
                        }}
                      >
                        <Stack
                          direction="row"
                          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 750 }}>
                            {item.name}
                          </Typography>
                          <Chip size="small" label={item.category} sx={{ fontSize: 10 }} />
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          Đơn giá dự kiến: {item.defaultCost.toLocaleString()} VND
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Paper>
              </Grid>

              {/* Room Type Template Column */}
              <Grid size={{ xs: 12, md: 8 }}>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, height: '100%' }}>
                  <Stack
                    direction="row"
                    sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}
                  >
                    <Box>
                      <Typography
                        variant="subtitle2"
                        sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}
                      >
                        <Layers3 size={18} /> Định mức theo loại phòng (Cấp 2)
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Định mức thiết bị tiêu chuẩn cho loại phòng được chọn.
                      </Typography>
                    </Box>

                    <TextField
                      select
                      size="small"
                      value={selectedTemplateRoomType}
                      onChange={(e) => setSelectedTemplateRoomType(e.target.value)}
                      sx={{ minWidth: 200 }}
                    >
                      {roomTypes.map((rt) => (
                        <MenuItem key={rt.id} value={rt.id}>
                          {rt.name}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>

                  <TableContainer sx={{ border: '1px solid #e2e8f0', borderRadius: 2, mb: 2 }}>
                    <Table size="small">
                      <TableHead sx={{ bgcolor: '#f8fafc' }}>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 800 }}>Tên thiết bị</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Số lượng chuẩn</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Yêu cầu bắt buộc</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(roomTypeTemplates[selectedTemplateRoomType] || []).map((req) => {
                          const catalogItem = assetCatalog.find((c) => c.id === req.catalogId);
                          return (
                            <TableRow key={req.catalogId}>
                              <TableCell sx={{ fontWeight: 700 }}>
                                {catalogItem?.name || req.catalogId}
                              </TableCell>
                              <TableCell>{req.quantity} cái</TableCell>
                              <TableCell>
                                <Chip
                                  size="small"
                                  label={req.isMandatory ? 'Bắt buộc bàn giao' : 'Tùy chọn'}
                                  color={req.isMandatory ? 'primary' : 'default'}
                                  sx={{ fontSize: 11 }}
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  <Stack
                    direction="row"
                    sx={{ alignItems: 'center', justifyContent: 'space-between', pt: 1 }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      Áp dụng định mức này cho toàn bộ{' '}
                      {rooms.filter((r) => r.roomTypeId === selectedTemplateRoomType).length} phòng
                      thuộc loại này.
                    </Typography>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<Sparkles size={16} />}
                      onClick={() => handleApplyAssetTemplate(selectedTemplateRoomType)}
                    >
                      Áp dụng cho tất cả phòng
                    </Button>
                  </Stack>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* STEP 5: Rental Rate Configuration */}
        {activeStep === 4 && (
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
              Bước 5: Giá thuê phòng & Phân cấp định giá
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              Phân cấp định giá:{' '}
              <strong>Giá chuẩn loại phòng → Giá áp dụng → Giá điều chỉnh riêng từng phòng</strong>.
            </Typography>

            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2.5 }}>
              <Table size="small">
                <TableHead sx={{ bgcolor: '#f8fafc' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 800 }}>Mã phòng</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Tầng</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Loại phòng</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Giá chuẩn</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Giá áp dụng</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Nguồn định giá</TableCell>
                    <TableCell sx={{ fontWeight: 800, width: 220 }}>Giá riêng (VND)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rooms.map((room) => {
                    const rType = roomTypes.find((t) => t.id === room.roomTypeId);
                    const defaultRate = rType?.defaultRate || 5500000;
                    const override = rateOverrides[room.code];
                    const isOverridden = override !== undefined && override !== defaultRate;
                    const appliedRate = isOverridden ? override : defaultRate;

                    return (
                      <TableRow key={room.code} hover>
                        <TableCell sx={{ fontWeight: 800 }}>{room.code}</TableCell>
                        <TableCell>Tầng {room.floor}</TableCell>
                        <TableCell>{rType?.name}</TableCell>
                        <TableCell sx={{ color: 'text.secondary' }}>
                          {defaultRate.toLocaleString()} VND
                        </TableCell>
                        <TableCell
                          sx={{ fontWeight: 800, color: isOverridden ? '#b45309' : 'primary.main' }}
                        >
                          {appliedRate.toLocaleString()} VND
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={isOverridden ? 'Giá chỉnh sửa riêng' : 'Chuẩn theo loại phòng'}
                            color={isOverridden ? 'warning' : 'default'}
                            sx={{ fontWeight: 750, fontSize: 11 }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            type="number"
                            placeholder="Nhập giá riêng"
                            value={override !== undefined ? override : ''}
                            onChange={(e) => {
                              const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                              setRateOverrides((prev) => {
                                const next = { ...prev };
                                if (val) next[room.code] = val;
                                else delete next[room.code];
                                return next;
                              });
                            }}
                            slotProps={{
                              input: {
                                endAdornment: <InputAdornment position="end">VND</InputAdornment>,
                              },
                            }}
                            sx={{ width: 190 }}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {/* STEP 6: Fee Policy Configuration */}
        {activeStep === 5 && (
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
              Bước 6: Biểu phí điện nước & Dịch vụ đi kèm
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Cấu hình biểu phí điện nước và các khoản phí dịch vụ định kỳ.
            </Typography>

            {/* Regulatory Notice Banner */}
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
                Cảnh báo khung giá điện & nước sinh hoạt theo quy định pháp luật
              </Typography>
              <Typography variant="body2">
                Giá điện nước cho người thuê nhà để ở tuân thủ theo biểu giá của EVN và Quyết định
                của UBND tỉnh/thành phố. Vui lòng đảm bảo đơn giá cấu hình không vượt quá trần quy
                định hiện hành.
              </Typography>
            </Alert>

            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12, md: 7 }}>
                <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2.5 }}>
                  <Table size="small">
                    <TableHead sx={{ bgcolor: '#f8fafc' }}>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 800 }}>Khoản phí</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>Cách tính</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>Đơn giá</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>Phạm vi</TableCell>
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
                              label={
                                fee.calculationMethod === 'PER_KWH'
                                  ? 'Theo kWh'
                                  : fee.calculationMethod === 'PER_M3'
                                    ? 'Theo m³'
                                    : 'Theo phòng'
                              }
                            />
                          </TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>
                            {fee.unitPrice.toLocaleString()} {fee.unit}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                            {fee.applicationScope === 'LOCATION_WIDE' ? 'Toàn cơ sở' : 'Từng phòng'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Grid>

              {/* Occupied Room Monthly Charge Preview */}
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
                        5.500.000 VND
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Tiền điện ({previewKwh} kWh × 3.800):
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {(previewKwh * 3800).toLocaleString()} VND
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Tiền nước ({previewM3} m³ × 22.000):
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {(previewM3 * 22000).toLocaleString()} VND
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Phí rác, an ninh & Wi-Fi:
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        300.000 VND
                      </Typography>
                    </Stack>

                    <Divider sx={{ my: 0.5 }} />

                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        Tổng tiền dự kiến trên hóa đơn:
                      </Typography>
                      <Typography
                        variant="subtitle1"
                        sx={{ fontWeight: 850, color: 'primary.main' }}
                      >
                        {(
                          5500000 +
                          previewKwh * 3800 +
                          previewM3 * 22000 +
                          300000
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

        {/* STEP 7: House Rules & Policies */}
        {activeStep === 6 && (
          <Box>
            <Stack
              direction="row"
              sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  Bước 7: Nội quy & Quy định vận hành cơ sở
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Cấu hình các quy định về giờ giấc, người thăm, an toàn PCCC, và chính sách tiền
                  cọc.
                </Typography>
              </Box>
              <Button
                variant="outlined"
                size="small"
                startIcon={<Plus size={16} />}
                onClick={() => {
                  const newRule: HouseRuleItem = {
                    id: `rule-${Date.now()}`,
                    name: 'Văn hóa sinh hoạt chung',
                    category: 'OTHER_OPERATIONS',
                    content: 'Tôn trọng không gian chung và giữ gìn văn minh trong khu nhà trọ.',
                    effectiveDate: '2026-12-01',
                    status: 'DRAFT',
                    version: 'V1',
                    isAppliedToContracts: false,
                  };
                  setHouseRules((prev) => [...prev, newRule]);
                }}
              >
                Thêm quy định riêng
              </Button>
            </Stack>

            <Grid container spacing={2}>
              {houseRules.map((rule) => (
                <Grid key={rule.id} size={{ xs: 12, md: 6 }}>
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      borderRadius: 2.5,
                      bgcolor: '#ffffff',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <Stack
                      direction="row"
                      sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
                    >
                      <Chip
                        size="small"
                        label={rule.name}
                        color="primary"
                        variant="outlined"
                        sx={{ fontWeight: 700, fontSize: 11 }}
                      />
                      <Chip
                        size="small"
                        label={`Phiên bản ${rule.version}`}
                        sx={{ fontWeight: 800 }}
                      />
                    </Stack>

                    <Typography variant="subtitle2" sx={{ fontWeight: 800, mt: 0.5 }}>
                      {rule.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, flex: 1 }}>
                      {rule.content}
                    </Typography>

                    <Divider sx={{ my: 1.5 }} />

                    <Stack
                      direction="row"
                      sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        Hiệu lực: {rule.effectiveDate}
                      </Typography>
                      <Chip
                        size="small"
                        label={rule.status === 'ACTIVE' ? 'Đang áp dụng' : 'Bản nháp'}
                        color={rule.status === 'ACTIVE' ? 'success' : 'default'}
                        sx={{ fontSize: 11 }}
                      />
                    </Stack>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}

        {/* STEP 8: Review & Finish */}
        {activeStep === 7 && (
          <Box>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 3 }}>
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  bgcolor: '#dcfce7',
                  color: '#15803d',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <CheckCircle2 size={26} />
              </Box>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  Đã hoàn tất cấu hình — Sẵn sàng đưa vào vận hành
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Kiểm tra lại toàn bộ danh mục thông tin đã thiết lập trước khi lưu và chuyển vào
                  không gian quản lý chi tiết.
                </Typography>
              </Box>
            </Stack>

            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, bgcolor: '#f8fafc' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.5 }}>
                    Thông tin cơ sở & Quy mô
                  </Typography>
                  <Stack spacing={1}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Tên & Mã cơ sở:
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 750 }}>
                        {locationName} ({locationCode})
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Quy mô phòng:
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 750 }}>
                        {floors} tầng · {rooms.length} phòng đã tạo
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Địa chỉ:
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, textAlign: 'right' }}>
                        {address}
                      </Typography>
                    </Stack>
                  </Stack>
                </Paper>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, bgcolor: '#f8fafc' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.5 }}>
                    Danh mục cấu hình đã sẵn sàng
                  </Typography>
                  <Stack spacing={1}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Loại phòng:
                      </Typography>
                      <Chip
                        size="small"
                        label={`${roomTypes.length} loại phòng sẵn sàng`}
                        color="primary"
                      />
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Tài sản & Tiện nghi:
                      </Typography>
                      <Chip size="small" label="10 thiết bị danh mục đã gán" color="success" />
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Biểu phí điện nước:
                      </Typography>
                      <Chip
                        size="small"
                        label={`${feePolicies.length} khoản phí đã cấu hình`}
                        color="info"
                      />
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Nội quy cơ sở:
                      </Typography>
                      <Chip
                        size="small"
                        label={`${houseRules.length} quy định hiệu lực`}
                        color="default"
                      />
                    </Stack>
                  </Stack>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}
      </DialogContent>

      <Divider />

      {/* Navigation Actions */}
      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
        <Button
          variant="outlined"
          disabled={activeStep === 0}
          onClick={() => setActiveStep((prev) => Math.max(0, prev - 1))}
          startIcon={<ArrowLeft size={16} />}
        >
          Quay lại
        </Button>

        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" onClick={onClose}>
            Hủy thiết lập
          </Button>
          {activeStep < WIZARD_STEPS.length - 1 ? (
            <Button
              variant="contained"
              onClick={() => setActiveStep((prev) => Math.min(WIZARD_STEPS.length - 1, prev + 1))}
              endIcon={<ArrowRight size={16} />}
            >
              Tiếp tục ({WIZARD_STEPS[activeStep + 1]})
            </Button>
          ) : (
            <Button
              variant="contained"
              color="primary"
              onClick={handleFinish}
              startIcon={<Sparkles size={16} />}
            >
              Hoàn tất & Kích hoạt cơ sở
            </Button>
          )}
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
