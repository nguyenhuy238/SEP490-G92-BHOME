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
  FormControlLabel,
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
  Switch,
} from '@mui/material';
import {
  Bath,
  DoorClosed,
  Flame,
  Layers3,
  Package,
  Plus,
  Refrigerator,
  ShowerHead,
  Sparkles,
  Trash2,
  Tv,
  WashingMachine,
  Wind,
  Zap,
} from 'lucide-react';
import type { DemoDatabase, PortalRecord } from '../../../../types/portal';
import { isMockMode } from '../../../../services/config';
import {
  INITIAL_ASSET_CATALOG,
  INITIAL_ROOM_TYPE_REQUIREMENTS,
  INITIAL_ROOM_TYPES,
} from '../../mock/locationConfigMock';
import type {
  AssetCatalogItem,
  RoomAssetAssignmentDraft,
  RoomTypeAssetRequirement,
} from '../../types/locationConfig';

interface LocationAssetsTabProps {
  db: DemoDatabase;
  location: PortalRecord;
}

export function LocationAssetsTab({ db, location }: LocationAssetsTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<'catalog' | 'templates' | 'assignment'>(
    'assignment',
  );

  const locationAssets = db.records.assets.filter((item) => item.locationId === location.id);
  const [assetCatalog] = useState<AssetCatalogItem[]>(() =>
    isMockMode
      ? INITIAL_ASSET_CATALOG
      : locationAssets.map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category as AssetCatalogItem['category'],
          defaultCost: 0,
          iconName: 'package',
          description: item.description || item.category,
        })),
  );
  const roomTypes = db.records['room-types'].filter((item) => item.locationId === location.id);
  const selectableRoomTypes = roomTypes.length ? roomTypes : isMockMode ? INITIAL_ROOM_TYPES : [];
  const [selectedRoomType, setSelectedRoomType] = useState<string>(
    selectableRoomTypes[0]?.id || 'type-studio',
  );
  const [roomTypeTemplates, setRoomTypeTemplates] = useState<
    Record<string, RoomTypeAssetRequirement[]>
  >(() => {
    const templates = isMockMode ? structuredClone(INITIAL_ROOM_TYPE_REQUIREMENTS) : {};
    roomTypes.forEach((roomType, index) => {
      if (templates[roomType.id]) return;
      const sampleType = INITIAL_ROOM_TYPES[index % INITIAL_ROOM_TYPES.length];
      templates[roomType.id] = structuredClone((sampleType && templates[sampleType.id]) || []);
    });
    return templates;
  });
  const [newRequirement, setNewRequirement] = useState<RoomTypeAssetRequirement | null>(null);

  // Mock initial room assignments
  const rooms = db.records.rooms.filter((r) => r.locationId === location.id);
  const roomCodes = rooms.length
    ? rooms.map((r) => r.code)
    : isMockMode
      ? ['P.101', 'P.102', 'P.201']
      : [];

  const [assignments, setAssignments] = useState<RoomAssetAssignmentDraft[]>(() =>
    !isMockMode
      ? locationAssets.map((asset) => ({
          roomCode:
            rooms.find((room) => room.id === asset.roomId)?.code ||
            asset.attributes.commonArea ||
            'Khu vá»±c chung',
          catalogId: asset.id,
          quantity: 1,
          condition: asset.status === '0' ? 'Active' : 'Needs Repair',
          source: 'OVERRIDE',
        }))
      : [
          {
            roomCode: 'P.101',
            catalogId: 'cat-ac',
            quantity: 1,
            condition: 'Active',
            source: 'TEMPLATE',
          },
          {
            roomCode: 'P.101',
            catalogId: 'cat-fridge',
            quantity: 1,
            condition: 'Active',
            source: 'TEMPLATE',
          },
          {
            roomCode: 'P.101',
            catalogId: 'cat-bed',
            quantity: 1,
            condition: 'Active',
            source: 'TEMPLATE',
          },
          {
            roomCode: 'P.101',
            catalogId: 'cat-heater',
            quantity: 1,
            condition: 'Active',
            source: 'TEMPLATE',
          },
          {
            roomCode: 'P.102',
            catalogId: 'cat-ac',
            quantity: 1,
            condition: 'Active',
            source: 'TEMPLATE',
          },
          {
            roomCode: 'P.102',
            catalogId: 'cat-fridge',
            quantity: 1,
            condition: 'Active',
            source: 'TEMPLATE',
          },
          {
            roomCode: 'P.201',
            catalogId: 'cat-ac',
            quantity: 1,
            condition: 'Active',
            source: 'TEMPLATE',
          },
          {
            roomCode: 'P.201',
            catalogId: 'cat-tv',
            quantity: 1,
            condition: 'Active',
            source: 'OVERRIDE',
          },
        ],
  );

  const [filterRoom, setFilterRoom] = useState<string>('ALL');
  const [applyNotification, setApplyNotification] = useState<string | null>(null);

  // Apply template to all rooms of selected room type
  const handleApplyTemplate = (typeId: string) => {
    if (!isMockMode) return;
    const templateReqs = roomTypeTemplates[typeId] || [];
    const targetRoomCodes = rooms
      .filter((room) => room.category === typeId)
      .map((room) => room.code);
    const newItems: RoomAssetAssignmentDraft[] = [];

    targetRoomCodes.forEach((code) => {
      templateReqs.forEach((req) => {
        newItems.push({
          roomCode: code,
          catalogId: req.catalogId,
          quantity: req.quantity,
          condition: 'Active',
          source: 'TEMPLATE',
        });
      });
    });

    setAssignments((current) => [
      ...current.filter(
        (item) => !targetRoomCodes.includes(item.roomCode) || item.source === 'OVERRIDE',
      ),
      ...newItems,
    ]);
    const roomTypeName = selectableRoomTypes.find((type) => type.id === typeId)?.name || typeId;
    setApplyNotification(
      `Đã áp dụng ${templateReqs.length} hạng mục cho ${targetRoomCodes.length} phòng thuộc loại ${roomTypeName}.`,
    );
  };

  const handleAddRequirement = () => {
    if (!isMockMode) return;
    if (!newRequirement) return;
    setRoomTypeTemplates((current) => {
      const requirements = current[selectedRoomType] || [];
      const exists = requirements.some((item) => item.catalogId === newRequirement.catalogId);
      return {
        ...current,
        [selectedRoomType]: exists
          ? requirements.map((item) =>
              item.catalogId === newRequirement.catalogId ? newRequirement : item,
            )
          : [...requirements, newRequirement],
      };
    });
    setNewRequirement(null);
  };

  const getAssetIcon = (id: string) => {
    switch (id) {
      case 'cat-ac':
        return <Wind size={18} />;
      case 'cat-fridge':
        return <Refrigerator size={18} />;
      case 'cat-tv':
        return <Tv size={18} />;
      case 'cat-washer':
        return <WashingMachine size={18} />;
      case 'cat-cooker':
        return <Flame size={18} />;
      case 'cat-heater':
        return <Zap size={18} />;
      case 'cat-shower':
        return <ShowerHead size={18} />;
      case 'cat-toilet':
        return <Bath size={18} />;
      case 'cat-wardrobe':
        return <DoorClosed size={18} />;
      default:
        return <Package size={18} />;
    }
  };

  const filteredAssignments =
    filterRoom === 'ALL' ? assignments : assignments.filter((a) => a.roomCode === filterRoom);

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
            value="assignment"
            label="Phân bổ tài sản vào phòng (Cấp 3)"
            icon={<Package size={16} />}
            iconPosition="start"
          />
          <Tab
            value="templates"
            label="Định mức theo loại phòng (Cấp 2)"
            icon={<Layers3 size={16} />}
            iconPosition="start"
          />
          <Tab
            value="catalog"
            label="Danh mục tài sản mẫu (Cấp 1)"
            icon={<DoorClosed size={16} />}
            iconPosition="start"
          />
        </Tabs>

        {activeSubTab === 'assignment' && (
          <Stack direction="row" spacing={1}>
            <TextField
              select
              size="small"
              label="Loại phòng áp dụng"
              value={selectedRoomType}
              onChange={(event) => setSelectedRoomType(event.target.value)}
              disabled={!isMockMode}
              sx={{ minWidth: 230, bgcolor: '#fff' }}
            >
              {selectableRoomTypes.map((roomType) => (
                <MenuItem key={roomType.id} value={roomType.id}>
                  {roomType.name}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              startIcon={<Sparkles size={16} />}
              onClick={() => handleApplyTemplate(selectedRoomType)}
              disabled={!isMockMode}
            >
              Áp dụng cho phòng cùng loại
            </Button>
          </Stack>
        )}
      </Stack>

      {!isMockMode && (
        <Alert severity="warning" sx={{ mb: 2.5, borderRadius: 2 }}>
          Backend hiện chỉ có tài sản thực tế theo phòng/khu vực và mẫu tài sản theo cơ sở, chưa có
          quan hệ định mức theo loại phòng như giao diện này. Danh sách phân bổ bên dưới lấy từ API
          thực; các thao tác định mức và áp dụng hàng loạt tạm thời bị khóa để tránh ghi sai dữ
          liệu.
        </Alert>
      )}

      {applyNotification && (
        <Alert
          severity="success"
          onClose={() => setApplyNotification(null)}
          sx={{ mb: 2.5, borderRadius: 2 }}
        >
          {applyNotification}
        </Alert>
      )}

      {/* LEVEL 3: Room Asset Assignment */}
      {activeSubTab === 'assignment' && (
        <Box>
          <Paper variant="outlined" sx={{ p: 2, mb: 2.5, borderRadius: 2, bgcolor: '#f8fafc' }}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField
                select
                size="small"
                label="Lọc theo phòng"
                value={filterRoom}
                onChange={(e) => setFilterRoom(e.target.value)}
                sx={{ minWidth: 200, bgcolor: '#ffffff' }}
              >
                <MenuItem value="ALL">Tất cả các phòng ({roomCodes.length} phòng)</MenuItem>
                {roomCodes.map((code) => (
                  <MenuItem key={code} value={code}>
                    Phòng {code}
                  </MenuItem>
                ))}
              </TextField>

              <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                Tổng tài sản đã phân bổ:{' '}
                <strong>{assignments.reduce((s, a) => s + a.quantity, 0)} thiết bị</strong>
              </Typography>
            </Stack>
          </Paper>

          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2.5 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: '#f8fafc' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 800 }}>Phòng</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Tên tài sản / Thiết bị</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Nhóm tài sản</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Số lượng</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Nguồn định mức</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Hiện trạng vận hành</TableCell>
                  <TableCell sx={{ fontWeight: 800, width: 80 }}>Thao tác</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredAssignments.map((item, idx) => {
                  const catalogItem = assetCatalog.find((c) => c.id === item.catalogId);
                  return (
                    <TableRow key={idx} hover>
                      <TableCell sx={{ fontWeight: 800 }}>{item.roomCode}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          {getAssetIcon(item.catalogId)}
                          <span>{catalogItem?.name || item.catalogId}</span>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                        {catalogItem?.category}
                      </TableCell>
                      <TableCell sx={{ fontWeight: 750 }}>{item.quantity} cái</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={item.source === 'OVERRIDE' ? 'Gán thủ công' : 'Định mức mẫu'}
                          color={item.source === 'OVERRIDE' ? 'warning' : 'default'}
                          sx={{ fontWeight: 700, fontSize: 11 }}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={item.condition === 'Active' ? 'Hoạt động tốt' : 'Cần kiểm tra'}
                          color={item.condition === 'Active' ? 'success' : 'default'}
                          sx={{ fontSize: 11 }}
                        />
                      </TableCell>
                      <TableCell>
                        <IconButton
                          size="small"
                          color="error"
                          disabled={!isMockMode}
                          onClick={() => setAssignments((prev) => prev.filter((_, i) => i !== idx))}
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

      {/* LEVEL 2: Room Type Asset Templates */}
      {activeSubTab === 'templates' && (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 2.5 }}>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}
          >
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                Định mức trang bị tiêu chuẩn cho từng loại phòng
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Quy định số lượng và chủng loại thiết bị bàn giao tối thiểu cho từng phân khúc
                phòng.
              </Typography>
            </Box>

            <TextField
              select
              size="small"
              value={selectedRoomType}
              onChange={(e) => setSelectedRoomType(e.target.value)}
              disabled={!isMockMode}
              sx={{ minWidth: 240 }}
            >
              {selectableRoomTypes.map((rt) => (
                <MenuItem key={rt.id} value={rt.id}>
                  {rt.name}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              startIcon={<Plus size={16} />}
              onClick={() =>
                setNewRequirement({
                  catalogId: assetCatalog[0]?.id || '',
                  quantity: 1,
                  isMandatory: true,
                })
              }
              disabled={!isMockMode}
            >
              Thêm thiết bị vào định mức
            </Button>
          </Stack>

          <TableContainer sx={{ border: '1px solid #e2e8f0', borderRadius: 2 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: '#f8fafc' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 800 }}>Thiết bị tiêu chuẩn</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Nhóm tài sản</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Số lượng định mức</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Yêu cầu bắt buộc</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Thao tác</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(roomTypeTemplates[selectedRoomType] || []).map((req) => {
                  const catItem = assetCatalog.find((c) => c.id === req.catalogId);
                  return (
                    <TableRow key={req.catalogId}>
                      <TableCell sx={{ fontWeight: 700 }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          {getAssetIcon(req.catalogId)}
                          <span>{catItem?.name}</span>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                        {catItem?.category}
                      </TableCell>
                      <TableCell sx={{ width: 160 }}>
                        <TextField
                          size="small"
                          type="number"
                          disabled={!isMockMode}
                          value={req.quantity}
                          onChange={(event) =>
                            setRoomTypeTemplates((current) => ({
                              ...current,
                              [selectedRoomType]: (current[selectedRoomType] || []).map((item) =>
                                item.catalogId === req.catalogId
                                  ? {
                                      ...item,
                                      quantity: Math.max(1, Number(event.target.value) || 1),
                                    }
                                  : item,
                              ),
                            }))
                          }
                          slotProps={{ htmlInput: { min: 1 } }}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={req.isMandatory ? 'Bắt buộc khi bàn giao' : 'Trang bị tùy chọn'}
                          color={req.isMandatory ? 'primary' : 'default'}
                          sx={{ fontSize: 11 }}
                        />
                      </TableCell>
                      <TableCell>
                        <IconButton
                          size="small"
                          color="error"
                          aria-label={`Xóa ${catItem?.name || req.catalogId} khỏi định mức`}
                          onClick={() =>
                            setRoomTypeTemplates((current) => ({
                              ...current,
                              [selectedRoomType]: (current[selectedRoomType] || []).filter(
                                (item) => item.catalogId !== req.catalogId,
                              ),
                            }))
                          }
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
        </Paper>
      )}

      {/* LEVEL 1: Asset Catalog */}
      {activeSubTab === 'catalog' && (
        <Grid container spacing={2}>
          {assetCatalog.map((item) => (
            <Grid key={item.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, height: '100%' }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                  <Box
                    sx={{
                      width: 42,
                      height: 42,
                      borderRadius: 2,
                      bgcolor: '#ebf2ff',
                      color: 'primary.main',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    {getAssetIcon(item.id)}
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Stack
                      direction="row"
                      sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                    >
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        {item.name}
                      </Typography>
                      <Chip size="small" label={item.category} sx={{ fontSize: 10 }} />
                    </Stack>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mt: 0.5, mb: 1 }}
                    >
                      {item.description}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 800, color: 'primary.main' }}>
                      Đơn giá dự kiến: {item.defaultCost.toLocaleString()} VND
                    </Typography>
                  </Box>
                </Stack>
              </Paper>
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog
        open={!!newRequirement}
        onClose={() => setNewRequirement(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Thêm thiết bị vào định mức loại phòng</DialogTitle>
        {newRequirement && (
          <>
            <DialogContent sx={{ display: 'grid', gap: 2, pt: '12px !important' }}>
              <TextField
                select
                label="Thiết bị"
                value={newRequirement.catalogId}
                onChange={(event) =>
                  setNewRequirement({ ...newRequirement, catalogId: event.target.value })
                }
              >
                {assetCatalog.map((asset) => (
                  <MenuItem key={asset.id} value={asset.id}>
                    {asset.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                type="number"
                label="Số lượng định mức"
                value={newRequirement.quantity}
                onChange={(event) =>
                  setNewRequirement({
                    ...newRequirement,
                    quantity: Math.max(1, Number(event.target.value) || 1),
                  })
                }
                slotProps={{ htmlInput: { min: 1 } }}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={newRequirement.isMandatory}
                    onChange={(event) =>
                      setNewRequirement({
                        ...newRequirement,
                        isMandatory: event.target.checked,
                      })
                    }
                  />
                }
                label="Bắt buộc khi bàn giao phòng"
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setNewRequirement(null)}>Hủy</Button>
              <Button variant="contained" onClick={handleAddRequirement}>
                Lưu vào định mức
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
