import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Copy,
  DoorOpen,
  Edit2,
  Plus,
  Search,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePortal } from '../../../app/PortalProvider';
import { ErrorState, LoadingState, PageHeader } from '../../../components/common/PortalUI';
import { usePortalAction, usePortalData } from '../../../hooks/usePortalData';
import { makeRecord } from '../../../services/mock/seed';
import type { PortalRecord } from '../../../types/portal';
import { CopyConfigurationWizard } from '../components/CopyConfigurationWizard';
import {
  InitialLocationSetupWizard,
  type InitialLocationSetupResult,
} from '../components/InitialLocationSetupWizard';
import type { CopyConfigurationGroup } from '../types/locationConfig';
import { isMockMode } from '../../../services/config';
import { propertyError, usePropertyApi, type LocationDto } from '../../property-api/propertyApi';
import { LocationSetupWizard } from '../setup/LocationSetupWizard';
import type { LocationSetupResult } from '../../../../../../packages/client-core/src/locationSetup';
import { NativeLocationsListPage } from './NativeLocationsListPage';

export function LocationsListPage() {
  return isMockMode ? <MockLocationsListPage /> : <NativeLocationsListPage />;
}

function MockLocationsListPage() {
  const portal = usePortal();
  const query = usePortalData();
  const action = usePortalAction();
  const propertyApi = usePropertyApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const apiAction = useMutation({
    mutationFn: (run: () => Promise<LocationDto>) => run(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal', 'api'] }),
    onError: (error) => portal.notify(propertyError(error), true),
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Wizard state
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState(false);
  const [isCopyWizardOpen, setIsCopyWizardOpen] = useState(false);
  const [selectedSourceForCopy, setSelectedSourceForCopy] = useState<string>('');

  // Quick edit dialog state
  const [editingLocation, setEditingLocation] = useState<PortalRecord | null>(null);

  // Success toast/alert
  const [successToast, setSuccessToast] = useState<string | null>(null);

  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const db = query.data;
  const locations = db.records.locations;

  // Filter locations
  const filteredLocations = locations.filter((loc) => {
    const textMatch =
      loc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      loc.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (loc.attributes.address || '').toLowerCase().includes(searchTerm.toLowerCase());
    if (!textMatch) return false;
    if (statusFilter !== 'ALL' && loc.status !== statusFilter) return false;
    return true;
  });

  // Global KPIs across chain
  const totalRoomsAll = db.records.rooms.length;
  const occupiedRoomsAll = db.records.rooms.filter(
    (r) => r.status === 'OCCUPIED' || r.status.includes('thuê'),
  ).length;
  const availableRoomsAll = db.records.rooms.filter(
    (r) => r.status === 'AVAILABLE' || r.status.includes('Trống'),
  ).length;
  const overallOccupancy = totalRoomsAll
    ? Math.round((occupiedRoomsAll / totalRoomsAll) * 100)
    : isMockMode
      ? 85
      : 0;

  // Handlers
  const handleOpenCopyWizard = (sourceLocId?: string) => {
    if (!isMockMode) {
      const source = sourceLocId || locations[0]?.id;
      if (source) {
        setSelectedSourceForCopy(source);
        setIsSetupWizardOpen(true);
      } else portal.notify('Chưa có cơ sở nguồn để sao chép.');
      return;
    }
    setSelectedSourceForCopy(sourceLocId || locations[0]?.id || '');
    setIsCopyWizardOpen(true);
  };

  const handleSetupComplete = async (
    newLocationRecord: PortalRecord,
    wizardData: InitialLocationSetupResult,
  ) => {
    const roomTypes = wizardData.roomTypes.map((roomType) =>
      makeRecord('room-types', {
        id: `${roomType.id}-${newLocationRecord.id}`,
        code: `${newLocationRecord.code}-${roomType.code}`,
        name: roomType.name,
        locationId: newLocationRecord.id,
        status: 'Đang áp dụng',
        amount: roomType.defaultRate,
        attributes: {
          area: String(roomType.area),
          maxOccupants: String(roomType.maxOccupants),
          amenities: roomType.facilities?.join(' · ') || 'Wifi',
        },
      }),
    );
    const rooms = wizardData.rooms.map((room) =>
      makeRecord('rooms', {
        id: `room-${newLocationRecord.id}-${room.code}`,
        code: room.code,
        name: `Phòng ${room.code}`,
        locationId: newLocationRecord.id,
        category: `${room.roomTypeId}-${newLocationRecord.id}`,
        amount: 5500000,
        status: 'Trống khai thác',
        attributes: {
          floor: String(room.floor),
          area: '25',
          maxOccupants: '2',
          setupStatus: 'READY',
        },
      }),
    );

    action.mutate(
      async () => {
        await portal.repository.save('locations', newLocationRecord);
        await Promise.all([
          ...roomTypes.map((roomType) => portal.repository.save('room-types', roomType)),
          ...rooms.map((room) => portal.repository.save('rooms', room)),
        ]);
      },
      {
        onSuccess: () => {
          setSuccessToast(`Đã tạo và kích hoạt thành công cơ sở "${newLocationRecord.name}".`);
          navigate(`/locations/${newLocationRecord.id}/overview`);
        },
      },
    );
    return true;
  };

  const handleNativeSetupComplete = async (result: LocationSetupResult) => {
    await queryClient.invalidateQueries({ queryKey: ['portal', 'api'] });
    await queryClient.invalidateQueries({ queryKey: ['property-setup'] });
    await queryClient.invalidateQueries({ queryKey: ['billing-policies'] });
    setIsSetupWizardOpen(false);
    setSelectedSourceForCopy('');
    setSuccessToast(`Đã lưu cấu hình cơ sở "${result.location.name}".`);
    navigate(`/locations/${result.location.id}/overview`);
  };

  const handleCopySuccess = (result: {
    sourceId: string;
    destinationId: string;
    copiedGroups: CopyConfigurationGroup[];
    actionSummary: string;
  }) => {
    const src = locations.find((l) => l.id === result.sourceId);
    setSuccessToast(
      `Đã sao chép thành công ${result.copiedGroups.length} nhóm cấu hình từ cơ sở ${src?.name || 'nguồn'}.`,
    );
  };

  const handleSaveQuickEdit = () => {
    if (editingLocation) {
      const updatedLocation = structuredClone(editingLocation);
      if (!isMockMode) {
        apiAction.mutate(
          () =>
            propertyApi.saveLocation(
              {
                name: updatedLocation.name,
                address: updatedLocation.attributes.address || '',
                isActive: updatedLocation.status !== 'Tạm ngừng',
                version: Number(updatedLocation.attributes.version || 0),
                reason: 'Cập nhật thông tin cơ sở từ Owner Web',
              },
              updatedLocation.id,
            ),
          {
            onSuccess: () => {
              setEditingLocation(null);
              setSuccessToast(`Đã lưu thay đổi cho cơ sở "${updatedLocation.name}".`);
            },
          },
        );
        return;
      }
      action.mutate(() => portal.repository.save('locations', updatedLocation), {
        onSuccess: () => {
          setEditingLocation(null);
          setSuccessToast(`Đã lưu thay đổi cho cơ sở "${updatedLocation.name}".`);
        },
      });
    }
  };

  return (
    <Box>
      <PageHeader
        group="QUẢN LÝ CƠ SỞ"
        title="Danh sách cơ sở"
        subtitle="Chọn cơ sở để vào không gian quản lý chi tiết. Phòng, loại phòng, tài sản, giá và nội quy được phân lập theo từng cơ sở."
        actions={
          <Stack direction="row" spacing={1.5}>
            <Button
              variant="outlined"
              startIcon={<Copy size={16} />}
              onClick={() => handleOpenCopyWizard()}
            >
              Sao chép cấu hình
            </Button>
            <Button
              variant="contained"
              startIcon={<Plus size={16} />}
              onClick={() => { setSelectedSourceForCopy(''); setIsSetupWizardOpen(true); }}
            >
              Thêm cơ sở
            </Button>
          </Stack>
        }
      />

      {successToast && (
        <Paper
          sx={{
            p: 2,
            mb: 3,
            bgcolor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#166534',
            borderRadius: 2,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <CheckCircle2 size={18} />
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {successToast}
            </Typography>
          </Stack>
          <Button size="small" onClick={() => setSuccessToast(null)} sx={{ color: '#166534' }}>
            Đóng
          </Button>
        </Paper>
      )}

      {/* Chain Metric KPI Bar */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 750 }}>
                  TỔNG SỐ CƠ SỞ
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 850, mt: 0.5 }}>
                  {locations.length}
                </Typography>
              </Box>
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: 2,
                  bgcolor: '#ebf2ff',
                  color: 'primary.main',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Building2 size={22} />
              </Box>
            </Stack>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 750 }}>
                  TỔNG SỐ PHÒNG
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 850, mt: 0.5 }}>
                  {isMockMode ? totalRoomsAll || 48 : totalRoomsAll}
                </Typography>
              </Box>
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: 2,
                  bgcolor: '#f0fdf4',
                  color: '#15803d',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <DoorOpen size={22} />
              </Box>
            </Stack>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 750 }}>
                  ĐANG THUÊ / TRỐNG
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 850, mt: 0.5 }}>
                  {occupiedRoomsAll} / {availableRoomsAll}
                </Typography>
              </Box>
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: 2,
                  bgcolor: '#fffbeb',
                  color: '#b45309',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <TrendingUp size={22} />
              </Box>
            </Stack>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ width: '100%' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 750 }}>
                  TỶ LỆ LẤP ĐẦY TOÀN CHUỖI
                </Typography>
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}
                >
                  <Typography variant="h4" sx={{ fontWeight: 850, color: 'primary.main' }}>
                    {overallOccupancy}%
                  </Typography>
                  <Chip size="small" label="Tốt" color="success" sx={{ fontWeight: 750 }} />
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={overallOccupancy}
                  sx={{ height: 6, borderRadius: 3, mt: 1 }}
                />
              </Box>
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      {/* Filter and Search Bar */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 2.5, bgcolor: '#f8fafc' }}>
        <Grid container spacing={2} sx={{ alignItems: 'center' }}>
          <Grid size={{ xs: 12, sm: 7 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Tìm kiếm theo tên cơ sở, mã cơ sở hoặc địa chỉ..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search size={18} color="#64748b" />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ bgcolor: '#ffffff' }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 5 }}>
            <TextField
              fullWidth
              select
              size="small"
              label="Trạng thái vận hành"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              sx={{ bgcolor: '#ffffff' }}
            >
              <MenuItem value="ALL">Tất cả trạng thái</MenuItem>
              <MenuItem value="Đang vận hành">Đang vận hành</MenuItem>
              <MenuItem value="Tạm ngừng">Tạm ngừng</MenuItem>
            </TextField>
          </Grid>
        </Grid>
      </Paper>

      {/* Location Cards Grid */}
      <Grid container spacing={2.5}>
        {filteredLocations.map((loc) => {
          const locRooms = db.records.rooms.filter((r) => r.locationId === loc.id);
          const occupied = locRooms.filter(
            (r) => r.status === 'OCCUPIED' || r.status.includes('thuê'),
          ).length;
          const available = locRooms.filter(
            (r) => r.status === 'AVAILABLE' || r.status.includes('Trống'),
          ).length;
          const occupancyRate = locRooms.length
            ? Math.round((occupied / locRooms.length) * 100)
            : isMockMode
              ? 85
              : 0;

          const manager =
            db.records.staff.find((s) => s.id === loc.staffId)?.name ||
            db.records.staff.find((s) => s.locationId === loc.id)?.name ||
            'Chưa phân công';

          return (
            <Grid key={loc.id} size={{ xs: 12, md: 6, lg: 4 }}>
              <Paper
                variant="outlined"
                sx={{
                  p: 2.75,
                  borderRadius: 3,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
                  '&:hover': {
                    boxShadow: '0 8px 24px rgba(37,93,222,0.08)',
                    borderColor: 'primary.light',
                  },
                }}
              >
                {/* Header with Badges */}
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Box
                      sx={{
                        width: 38,
                        height: 38,
                        borderRadius: 1.5,
                        bgcolor: '#ebf2ff',
                        color: 'primary.main',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <Building2 size={20} />
                    </Box>
                    <Chip size="small" label={loc.code} color="primary" sx={{ fontWeight: 800 }} />
                  </Stack>

                  <Chip
                    size="small"
                    label={loc.status.includes('Đang') ? 'Đang vận hành' : loc.status}
                    sx={{
                      bgcolor: '#ecfdf5',
                      color: '#047857',
                      fontWeight: 800,
                      fontSize: 11,
                    }}
                  />
                </Stack>

                {/* Location Name & Address */}
                <Typography
                  component={Link}
                  to={`/locations/${loc.id}/overview`}
                  aria-label={loc.name}
                  sx={{
                    variant: 'h6',
                    fontWeight: 800,
                    mt: 0.5,
                    lineHeight: 1.3,
                    color: 'text.primary',
                    textDecoration: 'none',
                    display: 'block',
                    fontSize: 17,
                    '&:hover': { color: 'primary.main' },
                  }}
                >
                  {loc.name}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: 'block',
                    mt: 0.5,
                    mb: 2,
                    minHeight: 32,
                    lineHeight: 1.4,
                  }}
                >
                  {loc.attributes.address || 'Chưa cập nhật địa chỉ'}
                </Typography>

                <Divider sx={{ mb: 2 }} />

                {/* Occupancy and Room Metrics */}
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {occupied}/{locRooms.length || 24} phòng đang thuê ({available} phòng trống)
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 850, color: 'primary.main' }}>
                    {occupancyRate}%
                  </Typography>
                </Stack>

                <LinearProgress
                  variant="determinate"
                  value={occupancyRate}
                  color={occupancyRate >= 80 ? 'success' : 'primary'}
                  sx={{ height: 7, borderRadius: 4, bgcolor: '#f1f5f9', mb: 2 }}
                />

                {/* Manager & Configuration Status */}
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}
                >
                  <Stack
                    direction="row"
                    spacing={0.75}
                    sx={{ alignItems: 'center', color: 'text.secondary' }}
                  >
                    <UserRound size={14} />
                    <Typography variant="caption" sx={{ fontWeight: 700 }} noWrap>
                      {manager}
                    </Typography>
                  </Stack>

                  <Chip
                    size="small"
                    label="Đã cấu hình xong"
                    sx={{
                      bgcolor: '#f0fdf4',
                      color: '#15803d',
                      fontSize: 11,
                      fontWeight: 750,
                    }}
                  />
                </Stack>

                {/* Action Buttons */}
                <Box sx={{ mt: 'auto', pt: 1.5, borderTop: '1px solid #f1f5f9' }}>
                  <Grid container spacing={1}>
                    <Grid size={{ xs: 6 }}>
                      <Button
                        fullWidth
                        size="small"
                        variant="outlined"
                        startIcon={<Copy size={13} />}
                        onClick={() => handleOpenCopyWizard(loc.id)}
                      >
                        Sao chép
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 6 }}>
                      <Button
                        fullWidth
                        size="small"
                        variant="outlined"
                        startIcon={<Edit2 size={13} />}
                        onClick={() => setEditingLocation(structuredClone(loc))}
                      >
                        Sửa
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <Button
                        fullWidth
                        component={Link}
                        to={`/locations/${loc.id}/overview`}
                        variant="contained"
                        endIcon={<ArrowRight size={14} />}
                      >
                        Xem cơ sở
                      </Button>
                    </Grid>
                  </Grid>
                </Box>
              </Paper>
            </Grid>
          );
        })}
      </Grid>

      {/* Initial Location Setup Wizard Modal */}
      {isMockMode ? <InitialLocationSetupWizard
        open={isSetupWizardOpen}
        onClose={() => setIsSetupWizardOpen(false)}
        db={db}
        onComplete={handleSetupComplete}
      /> : isSetupWizardOpen && <LocationSetupWizard
        locations={locations}
        initialSource={selectedSourceForCopy || undefined}
        onClose={() => { setIsSetupWizardOpen(false); setSelectedSourceForCopy(''); }}
        onComplete={handleNativeSetupComplete}
      />}

      {/* Copy Configuration Wizard Modal */}
      <CopyConfigurationWizard
        open={isCopyWizardOpen}
        onClose={() => setIsCopyWizardOpen(false)}
        db={db}
        initialSourceLocationId={selectedSourceForCopy}
        onCopySuccess={handleCopySuccess}
      />

      {/* Quick Edit Dialog */}
      {editingLocation && (
        <Dialog
          open={!!editingLocation}
          onClose={() => setEditingLocation(null)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle sx={{ fontWeight: 800 }}>
            Chỉnh sửa thông tin cơ sở: {editingLocation.name}
          </DialogTitle>
          <DialogContent sx={{ py: 2 }}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 8 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Tên cơ sở"
                  value={editingLocation.name}
                  onChange={(e) => setEditingLocation({ ...editingLocation, name: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 4 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Mã cơ sở"
                  value={editingLocation.code}
                  onChange={(e) => setEditingLocation({ ...editingLocation, code: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Địa chỉ"
                  value={editingLocation.attributes.address || ''}
                  onChange={(e) =>
                    setEditingLocation({
                      ...editingLocation,
                      attributes: { ...editingLocation.attributes, address: e.target.value },
                    })
                  }
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <TextField
                  fullWidth
                  type="number"
                  size="small"
                  label="Số tầng"
                  value={editingLocation.attributes.floors || '4'}
                  onChange={(e) =>
                    setEditingLocation({
                      ...editingLocation,
                      attributes: { ...editingLocation.attributes, floors: e.target.value },
                    })
                  }
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <TextField
                  fullWidth
                  select
                  size="small"
                  label="Trạng thái vận hành"
                  value={editingLocation.status}
                  onChange={(e) =>
                    setEditingLocation({ ...editingLocation, status: e.target.value })
                  }
                >
                  <MenuItem value="Đang vận hành">Đang vận hành</MenuItem>
                  <MenuItem value="Tạm ngừng">Tạm ngừng</MenuItem>
                </TextField>
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button variant="outlined" onClick={() => setEditingLocation(null)}>
              Hủy
            </Button>
            <Button variant="contained" onClick={handleSaveQuickEdit}>
              Lưu thay đổi
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
