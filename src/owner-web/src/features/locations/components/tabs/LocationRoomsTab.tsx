import { useState } from 'react';
import {
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
import { Copy, DoorOpen, Edit2, Filter, Layers3, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { DemoDatabase, PortalRecord } from '../../../../types/portal';
import { INITIAL_ROOM_TYPES } from '../../mock/locationConfigMock';
import type { GeneratedRoomDraft, RoomTypeDraft } from '../../types/locationConfig';

interface LocationRoomsTabProps {
  db: DemoDatabase;
  location: PortalRecord;
}

export function LocationRoomsTab({ db, location }: LocationRoomsTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<'inventory' | 'types'>('inventory');

  // Room Types state
  const [roomTypes, setRoomTypes] = useState<RoomTypeDraft[]>(INITIAL_ROOM_TYPES);
  const [isTypeDialogOpen, setIsTypeDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<RoomTypeDraft | null>(null);

  // Rooms state (combine live rooms with local draft rooms)
  const existingRooms: GeneratedRoomDraft[] = db.records.rooms
    .filter((r) => r.locationId === location.id)
    .map((r) => ({
      code: r.code,
      floor: parseInt(r.attributes.floor || '1', 10),
      roomTypeId: r.category || 'type-studio',
      status: r.status === 'AVAILABLE' || r.status.includes('Trống') ? 'AVAILABLE' : 'UNAVAILABLE',
    }));

  const [localRooms, setLocalRooms] = useState<GeneratedRoomDraft[]>(
    existingRooms.length
      ? existingRooms
      : [
          { code: 'P.101', floor: 1, roomTypeId: 'type-studio', status: 'AVAILABLE' },
          { code: 'P.102', floor: 1, roomTypeId: 'type-studio', status: 'AVAILABLE' },
          { code: 'P.201', floor: 2, roomTypeId: 'type-mezzanine', status: 'AVAILABLE' },
          { code: 'P.202', floor: 2, roomTypeId: 'type-mezzanine', status: 'AVAILABLE' },
          { code: 'P.301', floor: 3, roomTypeId: 'type-1br', status: 'AVAILABLE' },
        ],
  );

  // Filters
  const [selectedFloor, setSelectedFloor] = useState<string>('ALL');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('ALL');

  // Bulk Creator Dialog
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [bulkFloor, setBulkFloor] = useState<number>(2);
  const [bulkTypeId, setBulkTypeId] = useState<string>('type-studio');
  const [bulkPrefix, setBulkPrefix] = useState<string>('P.');
  const [bulkStart] = useState<number>(1);
  const [bulkQty, setBulkQty] = useState<number>(4);

  // Filtered rooms
  const filteredRooms = localRooms.filter((r) => {
    if (selectedFloor !== 'ALL' && String(r.floor) !== selectedFloor) return false;
    if (selectedTypeFilter !== 'ALL' && r.roomTypeId !== selectedTypeFilter) return false;
    return true;
  });

  const totalFloors = parseInt(location.attributes.floors || '4', 10);

  const handleBulkGenerate = () => {
    const generated: GeneratedRoomDraft[] = [];
    for (let i = 0; i < bulkQty; i++) {
      const code = `${bulkPrefix}${bulkFloor}${String(bulkStart + i).padStart(2, '0')}`;
      if (!localRooms.some((r) => r.code === code)) {
        generated.push({
          code,
          floor: bulkFloor,
          roomTypeId: bulkTypeId,
          status: 'AVAILABLE',
        });
      }
    }
    setLocalRooms((prev) => [...prev, ...generated]);
    setIsBulkDialogOpen(false);
  };

  const handleSaveType = () => {
    if (!editingType) return;
    setRoomTypes((prev) => {
      const exists = prev.some((t) => t.id === editingType.id);
      return exists
        ? prev.map((t) => (t.id === editingType.id ? editingType : t))
        : [...prev, editingType];
    });
    setIsTypeDialogOpen(false);
  };

  return (
    <Box>
      {/* Sub navigation tabs */}
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
            value="inventory"
            label={`Danh sách phòng (${localRooms.length})`}
            icon={<DoorOpen size={16} />}
            iconPosition="start"
          />
          <Tab
            value="types"
            label={`Mẫu loại phòng (${roomTypes.length})`}
            icon={<Layers3 size={16} />}
            iconPosition="start"
          />
        </Tabs>

        <Stack direction="row" spacing={1.5}>
          {activeSubTab === 'inventory' ? (
            <Button
              variant="contained"
              startIcon={<Sparkles size={16} />}
              onClick={() => setIsBulkDialogOpen(true)}
            >
              Tạo phòng hàng loạt
            </Button>
          ) : (
            <Button
              variant="contained"
              startIcon={<Plus size={16} />}
              onClick={() => {
                setEditingType({
                  id: `type-${Date.now()}`,
                  name: 'Studio Ban công Sang trọng',
                  code: 'DLX-STD',
                  area: 28,
                  maxOccupants: 2,
                  defaultRate: 6000000,
                  description: 'Căn hộ studio trang bị máy lạnh, máy nước nóng và ban công đón gió',
                  facilities: ['Máy lạnh', 'Máy nước nóng', 'Smart TV', 'Ban công riêng'],
                  status: 'ACTIVE',
                });
                setIsTypeDialogOpen(true);
              }}
            >
              Thêm loại phòng
            </Button>
          )}
        </Stack>
      </Stack>

      {/* VIEW 1: Room Inventory */}
      {activeSubTab === 'inventory' && (
        <Box>
          {/* Filters Bar */}
          <Paper variant="outlined" sx={{ p: 2, mb: 2.5, borderRadius: 2, bgcolor: '#f8fafc' }}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 750,
                  color: 'text.secondary',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                }}
              >
                <Filter size={16} /> Bộ lọc:
              </Typography>

              <TextField
                select
                size="small"
                label="Tầng"
                value={selectedFloor}
                onChange={(e) => setSelectedFloor(e.target.value)}
                sx={{ minWidth: 120, bgcolor: '#ffffff' }}
              >
                <MenuItem value="ALL">Tất cả tầng</MenuItem>
                {Array.from({ length: totalFloors }, (_, i) => i + 1).map((fl) => (
                  <MenuItem key={fl} value={String(fl)}>
                    Tầng {fl}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                select
                size="small"
                label="Loại phòng"
                value={selectedTypeFilter}
                onChange={(e) => setSelectedTypeFilter(e.target.value)}
                sx={{ minWidth: 220, bgcolor: '#ffffff' }}
              >
                <MenuItem value="ALL">Tất cả loại phòng</MenuItem>
                {roomTypes.map((rt) => (
                  <MenuItem key={rt.id} value={rt.id}>
                    {rt.name}
                  </MenuItem>
                ))}
              </TextField>

              <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                Hiển thị {filteredRooms.length} trên {localRooms.length} phòng
              </Typography>
            </Stack>
          </Paper>

          {/* Rooms Table */}
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2.5 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: '#f8fafc' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 800 }}>Mã phòng</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Tầng</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Loại phòng</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Diện tích</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Giá thuê áp dụng</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Nguồn định giá</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Trạng thái</TableCell>
                  <TableCell sx={{ fontWeight: 800, width: 80 }}>Thao tác</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredRooms.map((room) => {
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
                      <TableCell>{rType?.area || 25} m²</TableCell>
                      <TableCell sx={{ fontWeight: 800, color: 'primary.main' }}>
                        {(rType?.defaultRate || 5500000).toLocaleString()} VND/tháng
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label="Thừa hưởng từ loại phòng"
                          sx={{ fontSize: 11, bgcolor: '#f1f5f9', color: '#475569' }}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={room.status === 'AVAILABLE' ? 'Trống khai thác' : 'Tạm ngừng'}
                          color={room.status === 'AVAILABLE' ? 'success' : 'default'}
                          sx={{ fontWeight: 750, fontSize: 11 }}
                        />
                      </TableCell>
                      <TableCell>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() =>
                            setLocalRooms((prev) => prev.filter((r) => r.code !== room.code))
                          }
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredRooms.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      sx={{ textAlign: 'center', py: 3, color: 'text.secondary' }}
                    >
                      Không có phòng nào phù hợp với bộ lọc đã chọn.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* VIEW 2: Room Types */}
      {activeSubTab === 'types' && (
        <Grid container spacing={2}>
          {roomTypes.map((rt) => (
            <Grid key={rt.id} size={{ xs: 12, md: 4 }}>
              <Card
                variant="outlined"
                sx={{ borderRadius: 2.5, height: '100%', display: 'flex', flexDirection: 'column' }}
              >
                <CardContent sx={{ flex: 1, p: 2.5 }}>
                  <Stack
                    direction="row"
                    sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Chip size="small" label={rt.code} color="primary" sx={{ fontWeight: 800 }} />
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
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, minHeight: 40 }}>
                    {rt.description}
                  </Typography>

                  <Divider sx={{ my: 1.5 }} />

                  <Stack spacing={1}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="caption" color="text.secondary">
                        Diện tích tiêu chuẩn:
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
                      <Typography variant="body2" sx={{ fontWeight: 800, color: 'primary.main' }}>
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
                      Tiện ích & Trang bị tiêu chuẩn:
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
                    startIcon={<Edit2 size={14} />}
                    onClick={() => {
                      setEditingType(rt);
                      setIsTypeDialogOpen(true);
                    }}
                  >
                    Chỉnh sửa
                  </Button>
                </Stack>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Bulk Create Rooms Modal */}
      <Dialog
        open={isBulkDialogOpen}
        onClose={() => setIsBulkDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Tạo phòng hàng loạt theo sơ đồ tầng</DialogTitle>
        <DialogContent sx={{ py: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            Tự động sinh mã phòng theo quy tắc đánh số tầng (Ví dụ: Tầng 2 → P.201, P.202, P.203,
            P.204).
          </Typography>

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                select
                size="small"
                label="Chọn tầng bố trí"
                value={bulkFloor}
                onChange={(e) => setBulkFloor(parseInt(e.target.value, 10))}
              >
                {Array.from({ length: totalFloors }, (_, i) => i + 1).map((fl) => (
                  <MenuItem key={fl} value={fl}>
                    Tầng {fl}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                select
                size="small"
                label="Gán loại phòng"
                value={bulkTypeId}
                onChange={(e) => setBulkTypeId(e.target.value)}
              >
                {roomTypes.map((rt) => (
                  <MenuItem key={rt.id} value={rt.id}>
                    {rt.name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField
                fullWidth
                size="small"
                label="Tiền tố mã phòng"
                value={bulkPrefix}
                onChange={(e) => setBulkPrefix(e.target.value)}
                placeholder="P."
              />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField
                fullWidth
                type="number"
                size="small"
                label="Số lượng phòng"
                value={bulkQty}
                onChange={(e) => setBulkQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button variant="outlined" onClick={() => setIsBulkDialogOpen(false)}>
            Hủy
          </Button>
          <Button
            variant="contained"
            onClick={handleBulkGenerate}
            startIcon={<Sparkles size={16} />}
          >
            Sinh danh sách phòng
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Room Type Dialog */}
      {editingType && (
        <Dialog
          open={isTypeDialogOpen}
          onClose={() => setIsTypeDialogOpen(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle sx={{ fontWeight: 800 }}>Cấu hình mẫu loại phòng</DialogTitle>
          <DialogContent sx={{ py: 2 }}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 8 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Tên loại phòng"
                  value={editingType.name}
                  onChange={(e) => setEditingType({ ...editingType, name: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 4 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Mã loại"
                  value={editingType.code}
                  onChange={(e) => setEditingType({ ...editingType, code: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <TextField
                  fullWidth
                  type="number"
                  size="small"
                  label="Diện tích chuẩn (m²)"
                  value={editingType.area}
                  onChange={(e) =>
                    setEditingType({ ...editingType, area: parseInt(e.target.value, 10) || 20 })
                  }
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <TextField
                  fullWidth
                  type="number"
                  size="small"
                  label="Sức chứa tối đa (người)"
                  value={editingType.maxOccupants}
                  onChange={(e) =>
                    setEditingType({
                      ...editingType,
                      maxOccupants: parseInt(e.target.value, 10) || 2,
                    })
                  }
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  type="number"
                  size="small"
                  label="Giá thuê mặc định (VND/tháng)"
                  value={editingType.defaultRate}
                  onChange={(e) =>
                    setEditingType({
                      ...editingType,
                      defaultRate: parseInt(e.target.value, 10) || 5000000,
                    })
                  }
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  multiline
                  rows={2}
                  size="small"
                  label="Mô tả loại phòng"
                  value={editingType.description}
                  onChange={(e) => setEditingType({ ...editingType, description: e.target.value })}
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button variant="outlined" onClick={() => setIsTypeDialogOpen(false)}>
              Hủy
            </Button>
            <Button variant="contained" onClick={handleSaveType}>
              Lưu loại phòng
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
