import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Step,
  StepLabel,
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
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Layers3,
  Package,
  RefreshCw,
  Scale,
  ScrollText,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import type { DemoDatabase, PortalRecord } from '../../../types/portal';
import type {
  CopyActionChoice,
  CopyConfigurationGroup,
  CopyConflictStatus,
  CopyGroupPreview,
} from '../types/locationConfig';

interface CopyConfigurationWizardProps {
  open: boolean;
  onClose: () => void;
  db: DemoDatabase;
  initialSourceLocationId?: string;
  initialDestinationLocationId?: string;
  onCopySuccess: (result: {
    sourceId: string;
    destinationId: string;
    copiedGroups: CopyConfigurationGroup[];
    actionSummary: string;
  }) => void;
}

interface GroupMeta {
  group: CopyConfigurationGroup;
  title: string;
  description: string;
  count: number;
  icon: typeof Building2;
}

const AVAILABLE_GROUPS: Omit<GroupMeta, 'count'>[] = [
  {
    group: 'ROOM_TYPES',
    title: 'Mẫu loại phòng & Tiện nghi',
    description: 'Diện tích chuẩn, sức chứa tối đa, đơn giá thuê cơ sở và danh mục tiện ích.',
    icon: Layers3,
  },
  {
    group: 'ASSET_TEMPLATES',
    title: 'Định mức trang bị tài sản',
    description: 'Định mức số lượng và chủng loại nội thất, điện máy bàn giao theo từng loại phòng.',
    icon: Package,
  },
  {
    group: 'RENTAL_RATES',
    title: 'Biểu mẫu giá thuê phòng',
    description: 'Mẫu định giá thuê cơ sở và khung giá chuẩn theo từng phân khúc.',
    icon: Scale,
  },
  {
    group: 'FEE_POLICIES',
    title: 'Biểu phí điện, nước & Dịch vụ',
    description: 'Đơn giá điện kWh, nước sinh hoạt m³, phí vệ sinh, an ninh và giữ xe.',
    icon: RefreshCw,
  },
  {
    group: 'HOUSE_RULES',
    title: 'Nội quy & Quy định vận hành',
    description: 'Quy định giờ giấc ra vào, khách qua đêm, an toàn PCCC và giữ gìn vệ sinh chung.',
    icon: ScrollText,
  },
  {
    group: 'OPERATING_POLICIES',
    title: 'Quy trình bàn giao & Vận hành',
    description: 'Quy trình kiểm tra bàn giao nhận phòng, xử lý sự cố kỹ thuật và trực ca.',
    icon: Building2,
  },
  {
    group: 'BILLING_SETTINGS',
    title: 'Cài đặt chu kỳ thanh toán',
    description: 'Ngày chốt số điện nước, ngày phát hành hóa đơn và hạn nộp tiền phòng.',
    icon: Scale,
  },
  {
    group: 'ROOM_STRUCTURE_TEMPLATES',
    title: 'Mẫu cấu trúc sơ đồ tầng',
    description: 'Quy tắc đánh số phòng theo tầng và sơ đồ phân bổ các loại phòng.',
    icon: Layers3,
  },
];

const CONFLICT_CONFIG: Record<
  CopyConflictStatus,
  { label: string; color: 'success' | 'info' | 'warning' | 'secondary'; bg: string }
> = {
  NEW: { label: 'Mới hoàn toàn', color: 'success', bg: '#f0fdf4' },
  ALREADY_EXISTS: { label: 'Đã tồn tại', color: 'info', bg: '#eff6ff' },
  DIFFERENT: { label: 'Khác cấu hình', color: 'warning', bg: '#fffbeb' },
  REQUIRES_REVIEW: { label: 'Cần xem xét', color: 'secondary', bg: '#fbf0ff' },
};

export function CopyConfigurationWizard({
  open,
  onClose,
  db,
  initialSourceLocationId,
  initialDestinationLocationId,
  onCopySuccess,
}: CopyConfigurationWizardProps) {
  const [activeStep, setActiveStep] = useState(0);

  // Locations list
  const locations = db.records.locations;

  // Step 1: Source & Destination
  const [sourceId, setSourceId] = useState(
    initialSourceLocationId || locations[0]?.id || '',
  );
  const [destinationId, setDestinationId] = useState(
    initialDestinationLocationId || locations[1]?.id || 'new-loc-draft',
  );
  const [newTargetName, setNewTargetName] = useState('Cơ sở mới (Bản sao cấu hình)');

  // Step 2: Selected Groups
  const [selectedGroups, setSelectedGroups] = useState<CopyConfigurationGroup[]>([
    'ROOM_TYPES',
    'ASSET_TEMPLATES',
    'RENTAL_RATES',
    'FEE_POLICIES',
    'HOUSE_RULES',
  ]);

  // Step 3: Action Choices per group
  const [actionChoices, setActionChoices] = useState<Record<string, CopyActionChoice>>({
    ROOM_TYPES: 'COPY',
    ASSET_TEMPLATES: 'COPY',
    RENTAL_RATES: 'COPY',
    FEE_POLICIES: 'CREATE_NEW_VERSION',
    HOUSE_RULES: 'COPY',
    OPERATING_POLICIES: 'COPY',
    BILLING_SETTINGS: 'COPY',
    ROOM_STRUCTURE_TEMPLATES: 'COPY',
  });

  const sourceLocation = locations.find((l) => l.id === sourceId) || locations[0];
  const destLocation = locations.find((l) => l.id === destinationId);

  // Calculate items count for source location
  const sourceRoomTypes = db.records['room-types'].filter((t) => t.locationId === sourceLocation?.id);
  const sourceRooms = db.records.rooms.filter((r) => r.locationId === sourceLocation?.id);

  const getGroupCount = (group: CopyConfigurationGroup): number => {
    switch (group) {
      case 'ROOM_TYPES':
        return Math.max(3, sourceRoomTypes.length);
      case 'ASSET_TEMPLATES':
        return 4;
      case 'RENTAL_RATES':
        return Math.max(3, sourceRoomTypes.length);
      case 'FEE_POLICIES':
        return 6;
      case 'HOUSE_RULES':
        return 5;
      case 'OPERATING_POLICIES':
        return 3;
      case 'BILLING_SETTINGS':
        return 2;
      case 'ROOM_STRUCTURE_TEMPLATES':
        return sourceRooms.length ? Math.min(10, sourceRooms.length) : 4;
      default:
        return 0;
    }
  };

  const handleToggleGroup = (group: CopyConfigurationGroup) => {
    setSelectedGroups((prev) =>
      prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group],
    );
  };

  const handleSelectAll = (select: boolean) => {
    setSelectedGroups(select ? AVAILABLE_GROUPS.map((g) => g.group) : []);
  };

  // Generate preview items based on selection
  const previewData: CopyGroupPreview[] = selectedGroups.map((group) => {
    const meta = AVAILABLE_GROUPS.find((g) => g.group === group)!;
    const count = getGroupCount(group);

    const items = [
      {
        id: `${group}-1`,
        name:
          group === 'ROOM_TYPES'
            ? 'Căn hộ Studio Ban công'
            : group === 'FEE_POLICIES'
            ? 'Tiền điện (3.800 VND/kWh)'
            : group === 'ASSET_TEMPLATES'
            ? 'Định mức Studio tiêu chuẩn'
            : group === 'HOUSE_RULES'
            ? 'Giờ giấc & Giờ yên tĩnh'
            : `${meta.title} — Mục mẫu A`,
        sourceValue: 'Đang áp dụng tại cơ sở nguồn',
        destinationValue: destLocation ? 'Đã có cấu hình khác' : 'Chưa thiết lập',
        conflictStatus: destLocation ? ('DIFFERENT' as CopyConflictStatus) : ('NEW' as CopyConflictStatus),
        action: actionChoices[group] || 'COPY',
      },
      {
        id: `${group}-2`,
        name:
          group === 'ROOM_TYPES'
            ? 'Phòng Gác lửng Cao cấp'
            : group === 'FEE_POLICIES'
            ? 'Tiền nước (22.000 VND/m³)'
            : group === 'ASSET_TEMPLATES'
            ? 'Định mức Căn hộ 1PN'
            : group === 'HOUSE_RULES'
            ? 'Quy định khách thăm & qua đêm'
            : `${meta.title} — Mục mẫu B`,
        sourceValue: 'Đang áp dụng tại cơ sở nguồn',
        destinationValue: 'Chưa thiết lập',
        conflictStatus: 'NEW' as CopyConflictStatus,
        action: actionChoices[group] || 'COPY',
      },
    ];

    return {
      group,
      title: meta.title,
      count,
      items,
    };
  });

  const handleConfirmCopy = () => {
    onCopySuccess({
      sourceId,
      destinationId: destLocation ? destLocation.id : 'target-copied-loc',
      copiedGroups: selectedGroups,
      actionSummary: `Đã sao chép ${selectedGroups.length} nhóm cấu hình từ cơ sở ${sourceLocation?.name || 'nguồn'}.`,
    });
    onClose();
  };

  const steps = [
    'Chọn cơ sở nguồn & đích',
    'Chọn nội dung sao chép',
    'Xem trước & Xử lý xung đột',
    'Xác nhận sao chép',
  ];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ pb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: 2,
              bgcolor: '#ebf2ff',
              color: 'primary.main',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Copy size={20} />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              Công cụ sao chép cấu hình cơ sở (Copy Configuration Wizard)
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Tái sử dụng mẫu loại phòng, định mức trang bị, biểu phí điện nước và nội quy giữa các cơ sở
            </Typography>
          </Box>
        </Stack>
        <Button size="small" onClick={onClose} sx={{ minWidth: 'auto', p: 0.5 }}>
          <X size={18} />
        </Button>
      </DialogTitle>

      <Box sx={{ px: 3, pt: 1, pb: 2, bgcolor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
        <Stepper activeStep={activeStep} alternativeLabel>
          {steps.map((label, index) => (
            <Step key={label} completed={activeStep > index}>
              <StepLabel>
                <Typography sx={{ fontSize: 13, fontWeight: activeStep === index ? 800 : 500 }}>
                  {label}
                </Typography>
              </StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      <DialogContent sx={{ p: 3, minHeight: 460 }}>
        {/* STEP 1: Select Source Location */}
        {activeStep === 0 && (
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>
              Bước 1: Chọn cơ sở nguồn & Cơ sở đích tiếp nhận
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Chọn một cơ sở đã thiết lập hoàn chỉnh để kế thừa cấu hình mẫu. Các dữ liệu hợp đồng khách thuê,
              giao dịch thanh toán và hồ sơ cá nhân sẽ không bị sao chép.
            </Typography>

            <Typography variant="subtitle2" sx={{ fontWeight: 750, mb: 1.5, color: 'text.secondary' }}>
              Chọn cơ sở nguồn (Sao chép từ):
            </Typography>

            <Grid container spacing={2}>
              {locations.map((loc) => {
                const isSelected = loc.id === sourceId;
                const locRooms = db.records.rooms.filter((r) => r.locationId === loc.id);
                const occupiedRooms = locRooms.filter((r) => r.status.includes('thuê') || r.status === 'OCCUPIED');
                const occRate = locRooms.length ? Math.round((occupiedRooms.length / locRooms.length) * 100) : 85;

                return (
                  <Grid item xs={12} md={4} key={loc.id}>
                    <Card
                      variant="outlined"
                      sx={{
                        borderRadius: 2.5,
                        borderColor: isSelected ? 'primary.main' : '#e2e8f0',
                        bgcolor: isSelected ? '#f0f7ff' : '#ffffff',
                        borderWidth: isSelected ? 2 : 1,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <CardActionArea onClick={() => setSourceId(loc.id)} sx={{ p: 2 }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Chip
                            size="small"
                            label={loc.code}
                            color={isSelected ? 'primary' : 'default'}
                            sx={{ fontWeight: 800 }}
                          />
                          {isSelected && <CheckCircle2 size={18} color="#255dde" />}
                        </Stack>
                        <Typography variant="subtitle1" sx={{ fontWeight: 800, mt: 1 }}>
                          {loc.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                          {loc.attributes.address || 'Chưa cập nhật địa chỉ'}
                        </Typography>

                        <Stack direction="row" spacing={2} sx={{ pt: 1, borderTop: '1px dashed #e2e8f0' }}>
                          <Box>
                            <Typography variant="caption" color="text.secondary">
                              Số phòng
                            </Typography>
                            <Typography variant="body2" sx={{ fontWeight: 750 }}>
                              {locRooms.length || 18} phòng
                            </Typography>
                          </Box>
                          <Box>
                            <Typography variant="caption" color="text.secondary">
                              Lấp đầy
                            </Typography>
                            <Typography variant="body2" sx={{ fontWeight: 750, color: 'success.main' }}>
                              {occRate}%
                            </Typography>
                          </Box>
                          <Box>
                            <Typography variant="caption" color="text.secondary">
                              Loại phòng
                            </Typography>
                            <Typography variant="body2" sx={{ fontWeight: 750 }}>
                              3 loại
                            </Typography>
                          </Box>
                        </Stack>
                      </CardActionArea>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>

            <Divider sx={{ my: 3 }} />

            <Typography variant="subtitle2" sx={{ fontWeight: 750, mb: 1.5, color: 'text.secondary' }}>
              Chọn cơ sở đích (Sao chép đến):
            </Typography>

            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  select
                  size="small"
                  label="Cơ sở đích tiếp nhận"
                  value={destinationId}
                  onChange={(e) => setDestinationId(e.target.value)}
                >
                  <MenuItem value="new-loc-draft">
                    <em>+ Tạo thành cơ sở mới (Bản nháp)</em>
                  </MenuItem>
                  {locations
                    .filter((l) => l.id !== sourceId)
                    .map((l) => (
                      <MenuItem key={l.id} value={l.id}>
                        {l.name} ({l.code})
                      </MenuItem>
                    ))}
                </TextField>
              </Grid>
              {destinationId === 'new-loc-draft' && (
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Tên cơ sở mới dự kiến"
                    value={newTargetName}
                    onChange={(e) => setNewTargetName(e.target.value)}
                    placeholder="Ví dụ: BHOME Riverside Tower 4"
                  />
                </Grid>
              )}
            </Grid>
          </Box>
        )}

        {/* STEP 2: Choose What to Copy */}
        {activeStep === 1 && (
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  Bước 2: Chọn các nhóm cấu hình cần sao chép
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Cơ sở nguồn: <strong>{sourceLocation?.name}</strong> · Tích chọn các thành phần bạn muốn nhân bản.
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => handleSelectAll(true)}>
                  Chọn tất cả
                </Button>
                <Button size="small" onClick={() => handleSelectAll(false)}>
                  Bỏ chọn tất cả
                </Button>
              </Stack>
            </Stack>

            <Grid container spacing={2}>
              {AVAILABLE_GROUPS.map((meta) => {
                const isChecked = selectedGroups.includes(meta.group);
                const count = getGroupCount(meta.group);
                const IconComponent = meta.icon;

                return (
                  <Grid item xs={12} sm={6} md={3} key={meta.group}>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2,
                        borderRadius: 2.5,
                        borderColor: isChecked ? 'primary.main' : '#e2e8f0',
                        bgcolor: isChecked ? '#f8faff' : '#ffffff',
                        borderWidth: isChecked ? 2 : 1,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      onClick={() => handleToggleGroup(meta.group)}
                    >
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                        <Box
                          sx={{
                            width: 36,
                            height: 36,
                            borderRadius: 1.5,
                            bgcolor: isChecked ? '#e0edff' : '#f1f5f9',
                            color: isChecked ? 'primary.main' : '#64748b',
                            display: 'grid',
                            placeItems: 'center',
                          }}
                        >
                          <IconComponent size={18} />
                        </Box>
                        <Checkbox
                          checked={isChecked}
                          onChange={() => handleToggleGroup(meta.group)}
                          onClick={(e) => e.stopPropagation()}
                          size="small"
                        />
                      </Stack>

                      <Typography variant="subtitle2" sx={{ fontWeight: 800, mt: 1.5 }}>
                        {meta.title}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          height: 32,
                          my: 0.5,
                        }}
                      >
                        {meta.description}
                      </Typography>

                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
                        <Chip
                          size="small"
                          label={`${count} mục`}
                          sx={{
                            fontWeight: 750,
                            fontSize: 11,
                            bgcolor: isChecked ? '#ebf2ff' : '#f1f5f9',
                            color: isChecked ? 'primary.main' : '#475569',
                          }}
                        />
                        {isChecked && (
                          <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 750 }}>
                            Đã chọn
                          </Typography>
                        )}
                      </Stack>
                    </Paper>
                  </Grid>
                );
              })}
            </Grid>

            {selectedGroups.length === 0 && (
              <Alert severity="warning" sx={{ mt: 2.5 }}>
                Vui lòng chọn ít nhất một nhóm cấu hình để tiếp tục.
              </Alert>
            )}
          </Box>
        )}

        {/* STEP 3: Preview Configuration & Conflict Detection */}
        {activeStep === 2 && (
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
              Bước 3: Xem trước & Xử lý kiểm tra xung đột
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              So sánh dữ liệu giữa cơ sở nguồn <strong>{sourceLocation?.name}</strong> và cơ sở đích{' '}
              <strong>{destLocation ? destLocation.name : newTargetName}</strong>.
            </Typography>

            <Alert severity="info" icon={<Scale size={18} />} sx={{ mb: 2.5, borderRadius: 2 }}>
              Mô phỏng kiểm tra xung đột: Các mục được đánh dấu <strong>Khác cấu hình</strong> hoặc{' '}
              <strong>Đã tồn tại</strong> có thể được tạo thành phiên bản mới hoặc bỏ qua để giữ nguyên đặc thù của cơ sở đích.
            </Alert>

            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2.5 }}>
              <Table size="small">
                <TableHead sx={{ bgcolor: '#f8fafc' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 800 }}>Nhóm cấu hình</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Hạng mục mẫu</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Dữ liệu nguồn</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Hiện trạng cơ sở đích</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Kiểm tra xung đột</TableCell>
                    <TableCell sx={{ fontWeight: 800, width: 190 }}>Hành động xử lý</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {previewData.map((groupPreview) => (
                    groupPreview.items.map((item, itemIdx) => {
                      const conflictBadge = CONFLICT_CONFIG[item.conflictStatus];
                      const currentAction = actionChoices[groupPreview.group] || 'COPY';

                      return (
                        <TableRow key={item.id} hover>
                          {itemIdx === 0 && (
                            <TableCell
                              rowSpan={groupPreview.items.length}
                              sx={{
                                fontWeight: 800,
                                verticalAlign: 'top',
                                borderRight: '1px solid #e2e8f0',
                                bgcolor: '#ffffff',
                              }}
                            >
                              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                                {groupPreview.title}
                              </Typography>
                              <Chip
                                size="small"
                                label={`${groupPreview.count} mục khả dụng`}
                                sx={{ mt: 0.5, fontSize: 11 }}
                              />
                            </TableCell>
                          )}
                          <TableCell sx={{ fontWeight: 700, fontSize: 13 }}>
                            {item.name}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                            {item.sourceValue}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                            {item.destinationValue}
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={conflictBadge.label}
                              color={conflictBadge.color}
                              sx={{ fontWeight: 750, fontSize: 11 }}
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              size="small"
                              value={currentAction}
                              onChange={(e) =>
                                setActionChoices((prev) => ({
                                  ...prev,
                                  [groupPreview.group]: e.target.value as CopyActionChoice,
                                }))
                              }
                              sx={{ fontSize: 12, minWidth: 160 }}
                            >
                              <MenuItem value="COPY">Sao chép (Áp dụng)</MenuItem>
                              <MenuItem value="SKIP">Bỏ qua mục này</MenuItem>
                              <MenuItem value="CREATE_NEW_VERSION">Tạo phiên bản mới</MenuItem>
                            </Select>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {/* STEP 4: Confirm Copy */}
        {activeStep === 3 && (
          <Box>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2.5 }}>
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
                <Sparkles size={24} />
              </Box>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  Sẵn sàng áp dụng sao chép cấu hình
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Kiểm tra lại bản tóm tắt trước khi hệ thống tiến hành nhân bản các nhóm cấu hình.
                </Typography>
              </Box>
            </Stack>

            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, mb: 3, bgcolor: '#f8fafc' }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="text.secondary">
                    Cơ sở nguồn
                  </Typography>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                    {sourceLocation?.name} ({sourceLocation?.code})
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="text.secondary">
                    Cơ sở đích tiếp nhận
                  </Typography>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, color: 'primary.main' }}>
                    {destLocation ? destLocation.name : newTargetName}
                  </Typography>
                </Grid>
                <Grid item xs={12}>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Các nhóm cấu hình đã chọn ({selectedGroups.length} nhóm):
                  </Typography>
                  <Stack direction="row" flexWrap="wrap" gap={1}>
                    {selectedGroups.map((group) => {
                      const meta = AVAILABLE_GROUPS.find((g) => g.group === group)!;
                      return (
                        <Chip
                          key={group}
                          label={`${meta.title} (${getGroupCount(group)})`}
                          color="primary"
                          variant="outlined"
                          sx={{ fontWeight: 700 }}
                        />
                      );
                    })}
                  </Stack>
                </Grid>
              </Grid>
            </Paper>

            <Alert severity="success" icon={<CheckCircle2 size={20} />} sx={{ borderRadius: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                Nguyên tắc phân lập cấu hình độc lập
              </Typography>
              <Typography variant="body2">
                Sau khi sao chép hoàn tất, cơ sở đích hoạt động hoàn toàn độc lập. Mọi chỉnh sửa giá phòng hoặc nội quy
                tại <strong>{destLocation ? destLocation.name : newTargetName}</strong> sẽ không gây ảnh hưởng đến dữ liệu
                của cơ sở nguồn <strong>{sourceLocation?.name}</strong>.
              </Typography>
            </Alert>
          </Box>
        )}
      </DialogContent>

      <Divider />

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
            Hủy
          </Button>
          {activeStep < 3 ? (
            <Button
              variant="contained"
              disabled={activeStep === 1 && selectedGroups.length === 0}
              onClick={() => setActiveStep((prev) => Math.min(3, prev + 1))}
              endIcon={<ArrowRight size={16} />}
            >
              Tiếp tục
            </Button>
          ) : (
            <Button
              variant="contained"
              color="primary"
              onClick={handleConfirmCopy}
              startIcon={<Check size={16} />}
            >
              Áp dụng sao chép cấu hình
            </Button>
          )}
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
