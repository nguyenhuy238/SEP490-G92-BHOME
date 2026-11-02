import {
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  BadgeDollarSign,
  CheckCircle2,
  Copy,
  DoorOpen,
  Layers3,
  Package,
  ScrollText,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { Link } from 'react-router';
import type { DemoDatabase, PortalRecord } from '../../../../types/portal';
import { roomStatus, roomStatuses } from '../../../property/model';
import { currency } from '../../../property/propertyUtils';
import { MOCK_OCCUPANCY_TREND } from '../../mock/locationConfigMock';

interface LocationOverviewTabProps {
  db: DemoDatabase;
  location: PortalRecord;
  onLaunchSetupWizard: () => void;
  onLaunchCopyWizard: () => void;
}

export function LocationOverviewTab({
  db,
  location,
  onLaunchSetupWizard,
  onLaunchCopyWizard,
}: LocationOverviewTabProps) {
  const rooms = db.records.rooms.filter((r) => r.locationId === location.id);
  const occupiedCount = rooms.filter(
    (r) => roomStatus(r) === 'OCCUPIED' || r.status.includes('thuê'),
  ).length;
  const onHoldCount = rooms.filter(
    (r) => roomStatus(r) === 'ON_HOLD' || r.status.includes('giữ chỗ'),
  ).length;
  const availableCount = rooms.filter(
    (r) => roomStatus(r) === 'AVAILABLE' || r.status.includes('Trống'),
  ).length;
  const unavailableCount = rooms.length - (occupiedCount + onHoldCount + availableCount);
  const occupancyRate = rooms.length ? Math.round((occupiedCount / rooms.length) * 100) : 88;

  const roomTypesCount =
    db.records['room-types'].filter((t) => t.locationId === location.id).length || 3;
  const manager =
    db.records.staff.find((s) => s.id === location.staffId)?.name ||
    db.records.staff.find((s) => s.locationId === location.id)?.name ||
    'Chưa phân công';

  const floors = [...new Set(rooms.map((room) => room.attributes.floor || '1'))].sort(
    (a, b) => Number(b) - Number(a),
  );

  return (
    <Box>
      {/* Top Banner with Quick Actions */}
      <Paper
        sx={{
          p: 3,
          mb: 3,
          borderRadius: 3,
          background: 'linear-gradient(135deg, #1e40af 0%, #255dde 100%)',
          color: '#ffffff',
        }}
      >
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={8}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
              <Chip
                size="small"
                label={location.code}
                sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: '#ffffff', fontWeight: 800 }}
              />
              <Chip
                size="small"
                label="Đã hoàn tất cấu hình"
                sx={{ bgcolor: '#10b981', color: '#ffffff', fontWeight: 800 }}
              />
            </Stack>
            <Typography variant="h5" sx={{ fontWeight: 850, letterSpacing: '-0.02em' }}>
              {location.name}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.9, mt: 0.5 }}>
              {location.attributes.address || 'Chưa cập nhật địa chỉ'} ·{' '}
              {location.attributes.floors || 4} tầng · Phụ trách: {manager}
            </Typography>
          </Grid>
          <Grid item xs={12} md={4}>
            <Stack
              direction="row"
              spacing={1.5}
              justifyContent={{ xs: 'flex-start', md: 'flex-end' }}
            >
              <Button
                variant="contained"
                onClick={onLaunchSetupWizard}
                startIcon={<Sparkles size={16} />}
                sx={{
                  bgcolor: '#ffffff',
                  color: 'primary.dark',
                  fontWeight: 800,
                  '&:hover': { bgcolor: '#f1f5f9' },
                }}
              >
                Cấu hình cơ sở
              </Button>
              <Button
                variant="outlined"
                onClick={onLaunchCopyWizard}
                startIcon={<Copy size={16} />}
                sx={{
                  borderColor: 'rgba(255,255,255,0.5)',
                  color: '#ffffff',
                  '&:hover': { borderColor: '#ffffff', bgcolor: 'rgba(255,255,255,0.1)' },
                }}
              >
                Sao chép cấu hình
              </Button>
            </Stack>
          </Grid>
        </Grid>
      </Paper>

      {/* KPI Metric Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={4} md={2}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 750 }}>
              TỔNG SỐ PHÒNG
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 850, mt: 0.5, color: '#1e293b' }}>
              {rooms.length || 24}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Quy mô {location.attributes.floors || 4} tầng
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={6} sm={4} md={2}>
          <Paper
            variant="outlined"
            sx={{ p: 2, borderRadius: 2.5, textAlign: 'center', bgcolor: '#f0fdf4' }}
          >
            <Typography variant="caption" sx={{ fontWeight: 750, color: '#166534' }}>
              ĐANG THUÊ
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 850, mt: 0.5, color: '#15803d' }}>
              {occupiedCount}
            </Typography>
            <Typography variant="caption" sx={{ color: '#166534' }}>
              Hợp đồng hiệu lực
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={6} sm={4} md={2}>
          <Paper
            variant="outlined"
            sx={{ p: 2, borderRadius: 2.5, textAlign: 'center', bgcolor: '#eff6ff' }}
          >
            <Typography variant="caption" sx={{ fontWeight: 750, color: '#1e40af' }}>
              TRỐNG KHAI THÁC
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 850, mt: 0.5, color: '#255dde' }}>
              {availableCount}
            </Typography>
            <Typography variant="caption" sx={{ color: '#1e40af' }}>
              Sẵn sàng đón khách
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={6} sm={4} md={2}>
          <Paper
            variant="outlined"
            sx={{ p: 2, borderRadius: 2.5, textAlign: 'center', bgcolor: '#fffbeb' }}
          >
            <Typography variant="caption" sx={{ fontWeight: 750, color: '#92400e' }}>
              ĐANG GIỮ CHỖ
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 850, mt: 0.5, color: '#b45309' }}>
              {onHoldCount}
            </Typography>
            <Typography variant="caption" sx={{ color: '#92400e' }}>
              Đã xác nhận cọc
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={6} sm={4} md={2}>
          <Paper
            variant="outlined"
            sx={{ p: 2, borderRadius: 2.5, textAlign: 'center', bgcolor: '#f8fafc' }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 750 }}>
              TẠM NGỪNG
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 850, mt: 0.5, color: '#64748b' }}>
              {Math.max(0, unavailableCount)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Bảo trì / Setup
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={6} sm={4} md={2}>
          <Paper
            variant="outlined"
            sx={{ p: 2, borderRadius: 2.5, textAlign: 'center', bgcolor: '#faf5ff' }}
          >
            <Typography variant="caption" sx={{ fontWeight: 750, color: '#6b21a8' }}>
              TỶ LỆ LẤP ĐẦY
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 850, mt: 0.5, color: '#7e22ce' }}>
              {occupancyRate}%
            </Typography>
            <LinearProgress
              variant="determinate"
              value={occupancyRate}
              sx={{ height: 6, borderRadius: 3, mt: 1, bgcolor: '#f3e8ff' }}
              color="secondary"
            />
          </Paper>
        </Grid>
      </Grid>

      {/* Main Grid: Occupancy Trend & Setup Health */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {/* Occupancy Trend Chart */}
        <Grid item xs={12} md={7}>
          <Paper variant="outlined" sx={{ p: 3, borderRadius: 2.5, height: '100%' }}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 2 }}
            >
              <Box>
                <Typography
                  variant="subtitle1"
                  sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}
                >
                  <TrendingUp size={20} color="#255dde" /> Biến động tỷ lệ lấp đầy (6 tháng gần
                  nhất)
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Biểu đồ theo dõi công suất khai thác và xu hướng cư trú thực tế
                </Typography>
              </Box>
              <Chip size="small" label="Trung bình 87%" color="success" sx={{ fontWeight: 800 }} />
            </Stack>

            {/* SVG Visual Trend Chart */}
            <Box sx={{ mt: 2, pt: 1, pb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-end', height: 160, gap: 2, px: 2 }}>
                {MOCK_OCCUPANCY_TREND.map((item) => {
                  const barHeight = (item.occupancyRate / 100) * 140;
                  return (
                    <Box
                      key={item.month}
                      sx={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 1,
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{ fontWeight: 800, fontSize: 11, color: '#1e40af' }}
                      >
                        {item.occupancyRate}%
                      </Typography>
                      <Box
                        sx={{
                          width: '100%',
                          maxWidth: 42,
                          height: barHeight,
                          bgcolor: '#255dde',
                          borderRadius: '6px 6px 0 0',
                          transition: 'height 0.4s ease',
                          '&:hover': { bgcolor: '#1d4ed8' },
                        }}
                      />
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                        {item.month}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>

            <Divider sx={{ my: 2 }} />

            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="caption" color="text.secondary">
                Dữ liệu tổng hợp từ hợp đồng thuê phòng và biên bản bàn giao nhận phòng.
              </Typography>
              <Typography variant="caption" sx={{ fontWeight: 750, color: 'primary.main' }}>
                Mục tiêu lấp đầy an toàn: ≥ 85%
              </Typography>
            </Stack>
          </Paper>
        </Grid>

        {/* Configuration Completeness Checklist */}
        <Grid item xs={12} md={5}>
          <Paper variant="outlined" sx={{ p: 3, borderRadius: 2.5, height: '100%' }}>
            <Typography
              variant="subtitle1"
              sx={{ fontWeight: 800, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <CheckCircle2 size={20} color="#15803d" /> Tình trạng sẵn sàng vận hành
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
              Danh mục kiểm tra cấu hình ban đầu trước khi tiếp nhận khách thuê.
            </Typography>

            <Stack spacing={1.5}>
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: '#f8fafc' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Layers3 size={16} color="#255dde" />
                    <Typography variant="body2" sx={{ fontWeight: 750 }}>
                      Loại phòng
                    </Typography>
                  </Stack>
                  <Chip
                    size="small"
                    label={`${roomTypesCount} loại phòng đã tạo`}
                    color="success"
                    sx={{ fontSize: 11 }}
                  />
                </Stack>
              </Paper>

              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: '#f8fafc' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Stack direction="row" spacing={1} alignItems="center">
                    <DoorOpen size={16} color="#255dde" />
                    <Typography variant="body2" sx={{ fontWeight: 750 }}>
                      Sơ đồ phòng
                    </Typography>
                  </Stack>
                  <Chip
                    size="small"
                    label={`${rooms.length || 24} phòng đã sinh mã`}
                    color="success"
                    sx={{ fontSize: 11 }}
                  />
                </Stack>
              </Paper>

              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: '#f8fafc' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Package size={16} color="#255dde" />
                    <Typography variant="body2" sx={{ fontWeight: 750 }}>
                      Định mức tài sản
                    </Typography>
                  </Stack>
                  <Chip
                    size="small"
                    label="10 thiết bị danh mục"
                    color="success"
                    sx={{ fontSize: 11 }}
                  />
                </Stack>
              </Paper>

              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: '#f8fafc' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Stack direction="row" spacing={1} alignItems="center">
                    <BadgeDollarSign size={16} color="#255dde" />
                    <Typography variant="body2" sx={{ fontWeight: 750 }}>
                      Giá thuê & Biểu phí
                    </Typography>
                  </Stack>
                  <Chip
                    size="small"
                    label="6 biểu phí đang áp dụng"
                    color="success"
                    sx={{ fontSize: 11 }}
                  />
                </Stack>
              </Paper>

              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: '#f8fafc' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Stack direction="row" spacing={1} alignItems="center">
                    <ScrollText size={16} color="#255dde" />
                    <Typography variant="body2" sx={{ fontWeight: 750 }}>
                      Nội quy & Quy định
                    </Typography>
                  </Stack>
                  <Chip
                    size="small"
                    label="Phiên bản V1 hiệu lực"
                    color="info"
                    sx={{ fontSize: 11 }}
                  />
                </Stack>
              </Paper>
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      {/* Floor Room Layout Section (Provides room card link access) */}
      <Box sx={{ mb: 3 }}>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2 }}
        >
          <Box>
            <Typography
              component="h2"
              aria-label="Không gian phòng theo tầng"
              sx={{ fontSize: 18, fontWeight: 850 }}
            >
              Không gian phòng theo tầng
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Chọn Room Card để xem chi tiết phòng, hiện trạng tài sản và thông tin hợp đồng đang
              thuê.
            </Typography>
          </Box>
        </Stack>

        {floors.map((floor) => {
          const floorRooms = rooms.filter((r) => (r.attributes.floor || '1') === floor);
          if (!floorRooms.length) return null;

          return (
            <Box key={floor} sx={{ mb: 2.5 }}>
              <Stack
                direction="row"
                sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
              >
                <Typography sx={{ fontSize: 13, fontWeight: 850 }}>Sơ đồ tầng {floor}</Typography>
                <Chip
                  size="small"
                  label={`${floorRooms.length} phòng`}
                  sx={{ bgcolor: '#f1f4f9', color: 'text.secondary', fontSize: 11 }}
                />
              </Stack>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: 'repeat(2, minmax(0, 1fr))',
                    sm: 'repeat(3, minmax(0, 1fr))',
                    lg: 'repeat(6, minmax(0, 1fr))',
                  },
                  gap: 1.5,
                }}
              >
                {floorRooms.map((room) => {
                  const status = roomStatus(room);
                  const config = roomStatuses[status];
                  const type = db.records['room-types'].find((item) => item.id === room.category);

                  return (
                    <Box
                      key={room.id}
                      component={Link}
                      to={`/rooms/${room.id}`}
                      aria-label={`Mở phòng ${room.code}`}
                      sx={{
                        display: 'block',
                        minWidth: 0,
                        p: 1.75,
                        color: 'inherit',
                        textDecoration: 'none',
                        bgcolor: config.background,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 2,
                        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                        '&:hover': {
                          transform: 'translateY(-2px)',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                        },
                      }}
                    >
                      <Stack
                        direction="row"
                        sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}
                      >
                        <Typography sx={{ fontWeight: 850, fontSize: 15 }}>{room.code}</Typography>
                        <Chip
                          size="small"
                          label={config.label}
                          sx={{
                            bgcolor: '#ffffff',
                            color: config.color,
                            fontWeight: 800,
                            fontSize: 10,
                            height: 20,
                          }}
                        />
                      </Stack>

                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', mt: 0.5 }}
                        noWrap
                      >
                        {type?.name || 'Studio'}
                      </Typography>

                      <Typography
                        variant="caption"
                        sx={{ display: 'block', mt: 0.5, fontWeight: 750, color: 'primary.main' }}
                      >
                        {currency(room.amount)} / tháng
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
