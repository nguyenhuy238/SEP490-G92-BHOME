import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { DoorOpen, Layers3, Users, TriangleAlert, Pencil, ArrowUpRight } from 'lucide-react';
import type { RoomConfiguration } from '../../../../../../packages/client-core/src/propertySetup';
import type { SetupDocument } from '../../../../../../packages/client-core/src/propertySetup';
import type { RoomProvenanceData } from '../../../../../../packages/client-core/src/locationSetup';
import { useRoomOperations } from './useRoomOperations';
import { roomStatusColors } from '../../../theme/theme';

const states = [
  { label: 'Trống khai thác', ...roomStatusColors.available },
  { label: 'Đang giữ chỗ', ...roomStatusColors.onHold },
  { label: 'Đang có khách thuê', ...roomStatusColors.occupied },
  { label: 'Ngừng khai thác', ...roomStatusColors.unavailable },
];
const unknownState = { label: 'Chưa xác định', ...roomStatusColors.unavailable };

export function RoomFloorCards({
  rooms,
  locationId,
  edit,
  inspect,
  provenance,
}: {
  rooms: RoomConfiguration[];
  locationId: string;
  edit?: (room: RoomConfiguration) => void;
  inspect: (id: string) => void;
  provenance?: SetupDocument<RoomProvenanceData>[];
}) {
  const [floor, setFloor] = useState('');
  const { occupancy, incidents } = useRoomOperations(
    locationId,
    rooms.map((room) => room.id),
  );
  const floors = [...new Set(rooms.map((room) => room.floor ?? 'Chưa phân tầng'))].sort((a, b) =>
    a.localeCompare(b, 'vi', { numeric: true }),
  );
  const currentFloor = floors.includes(floor) ? floor : '';
  const visibleFloors = floors.filter((value) => !currentFloor || value === currentFloor);
  const visibleRooms = rooms.filter(
    (room) => !currentFloor || (room.floor ?? 'Chưa phân tầng') === currentFloor,
  );
  const unknownCount = visibleRooms.filter((room) => !states[room.status]).length;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { md: 'center' }, mb: 2 }}
      >
        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Layers3 size={22} color="#255dde" />
            <Typography component="h2" variant="h2">
              Sơ đồ phòng theo tầng
            </Typography>
          </Stack>
        </Box>
        <TextField
          select
          label="Tầng trên trang hiện tại"
          value={floors.includes(floor) ? floor : ''}
          onChange={(e) => setFloor(e.target.value)}
          size="small"
          sx={{ width: { xs: '100%', md: 230 } }}
        >
          <MenuItem value="">Tất cả tầng</MenuItem>
          {floors.map((value) => (
            <MenuItem key={value} value={value}>
              {value === 'Chưa phân tầng' ? value : `Tầng ${value}`}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Trạng thái các phòng đang hiển thị
      </Typography>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, mb: 2.5 }}>
        {[...states, ...(unknownCount ? [unknownState] : [])].map(({ label, fill }, index) => (
          <Box
            key={label}
            sx={{
              display: 'flex',
              gap: 1,
              alignItems: 'center',
              py: 0.5,
            }}
          >
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: fill }} />
            <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>{label}</Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>
              {index === states.length
                ? unknownCount
                : visibleRooms.filter((room) => room.status === index).length}
            </Typography>
          </Box>
        ))}
      </Stack>
      {(occupancy.isFetching || incidents.isFetching) && (
        <LinearProgress sx={{ mb: 2 }} aria-label="Đang tải tình trạng vận hành" />
      )}
      {occupancy.error && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={<Button onClick={() => void occupancy.refetch()}>Thử lại</Button>}
        >
          Chưa tải được số người ở. Trạng thái và sức chứa phòng vẫn hiển thị theo dữ liệu đã lưu.
        </Alert>
      )}
      {incidents.error && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={<Button onClick={() => void incidents.refetch()}>Thử lại</Button>}
        >
          Chưa tải được báo cáo sự cố. Chưa thể kết luận phòng không có sự cố.
        </Alert>
      )}
      {incidents.data && !incidents.data.complete && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Danh sách sự cố vượt giới hạn tải. Các cảnh báo dưới đây có thể chưa đầy đủ.
        </Alert>
      )}
      {visibleFloors.map((value) => (
        <Box key={value} sx={{ mb: 3 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.75 }}>
            <Typography
              sx={{
                fontSize: 16,
                color: 'text.primary',
                fontWeight: 800,
              }}
            >
              {value === 'Chưa phân tầng' ? value : `Tầng ${value}`}
            </Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              {rooms.filter((room) => (room.floor ?? 'Chưa phân tầng') === value).length} phòng
            </Typography>
            <Box sx={{ flex: 1, borderBottom: '1px solid', borderColor: 'divider' }} />
          </Stack>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
              gap: 1.5,
            }}
          >
            {rooms
              .filter((room) => (room.floor ?? 'Chưa phân tầng') === value)
              .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, 'vi', { numeric: true }))
              .map((room) => {
                const state = states[room.status] ?? unknownState;
                const source = provenance?.find((item) => item.data.roomId === room.id)?.data;
                const occupied = occupancy.data?.items.find((item) => item.roomId === room.id);
                const reports =
                  incidents.data?.items.filter(
                    (item) =>
                      item.roomId === room.id && ['Submitted', 'InProgress'].includes(item.status),
                  ) ?? [];
                const emergency = reports.some((item) => item.severity === 'Emergency');
                return (
                  <Paper
                    key={room.id}
                    variant="outlined"
                    sx={{
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      borderRadius: '12px',
                      borderColor: 'divider',
                      transition: 'border-color .15s',
                      '&:hover': { borderColor: 'primary.main' },
                    }}
                  >
                    <ButtonBase
                      onClick={() => inspect(room.id)}
                      aria-label={`Xem phòng ${room.roomNumber}`}
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        justifyContent: 'flex-start',
                        flex: 1,
                        width: '100%',
                        textAlign: 'left',
                        p: 1.75,
                        '&.Mui-focusVisible': {
                          outline: '2px solid',
                          outlineColor: 'primary.main',
                          outlineOffset: -2,
                        },
                      }}
                    >
                      <Stack spacing={1.25}>
                        <Stack
                          direction="row"
                          sx={{
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 1,
                          }}
                        >
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                            <DoorOpen size={20} color={state.foreground} />
                            <Typography
                              sx={{
                                fontSize: 23,
                                fontWeight: 800,
                                lineHeight: 1.2,
                                overflowWrap: 'anywhere',
                              }}
                            >
                              {room.roomNumber}
                            </Typography>
                          </Stack>
                          <Chip
                            size="small"
                            label={state.label}
                            sx={{
                              bgcolor: state.surface,
                              color: state.foreground,
                              fontWeight: 650,
                              borderRadius: '10px',
                              fontSize: 12,
                            }}
                          />
                        </Stack>
                        <Typography
                          sx={{ fontSize: 14, color: 'text.secondary', overflowWrap: 'anywhere' }}
                        >
                          {source
                            ? source.name
                            : provenance
                              ? 'Chưa ghi nhận gợi ý'
                              : 'Chưa có thông tin gợi ý'}
                        </Typography>
                        <Stack
                          direction="row"
                          sx={{
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            py: 1,
                            borderTop: '1px solid',
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                          }}
                        >
                          <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
                            Người ở / Sức chứa
                          </Typography>
                          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                            <Users size={17} color="#63738b" />
                            <Typography
                              sx={{
                                fontWeight: 750,
                                fontSize: 18,
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {occupied
                                ? `${occupied.occupants.length}/${room.capacity}`
                                : `—/${room.capacity}`}
                            </Typography>
                          </Stack>
                        </Stack>
                        <Stack
                          direction="row"
                          spacing={0.75}
                          sx={{
                            alignItems: 'center',
                            minHeight: 24,
                            color: emergency
                              ? 'error.main'
                              : reports.length
                                ? 'warning.dark'
                                : 'text.secondary',
                          }}
                        >
                          {reports.length > 0 && <TriangleAlert size={16} />}
                          <Typography
                            sx={{
                              fontSize: 13,
                              fontWeight: reports.length ? 700 : 400,
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {reports.length
                              ? `${emergency ? 'Có sự cố khẩn cấp' : 'Có báo cáo sự cố'} · ${reports.length} đang mở`
                              : incidents.data?.complete
                                ? 'Không có báo cáo sự cố đang mở'
                                : 'Chưa đủ dữ liệu báo cáo sự cố'}
                          </Typography>
                        </Stack>
                        {!occupied && (
                          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                            Chưa có số liệu người ở.
                          </Typography>
                        )}
                      </Stack>
                    </ButtonBase>
                    <Stack
                      direction="row"
                      sx={{
                        px: 1,
                        py: 0.5,
                        bgcolor: 'background.default',
                        borderTop: '1px solid',
                        borderColor: 'divider',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 0.5,
                        mt: 'auto',
                      }}
                    >
                      <Button
                        size="small"
                        endIcon={<ArrowUpRight size={15} />}
                        onClick={() => inspect(room.id)}
                        sx={{
                          minHeight: { xs: 44, sm: 36 },
                          '@media (pointer:coarse)': { minHeight: 44 },
                        }}
                      >
                        Xem chi tiết
                      </Button>
                      {edit && (
                        <Button
                          size="small"
                          startIcon={<Pencil size={14} />}
                          onClick={() => edit(room)}
                          sx={{
                            minHeight: { xs: 44, sm: 36 },
                            '@media (pointer:coarse)': { minHeight: 44 },
                          }}
                        >
                          Chỉnh sửa
                        </Button>
                      )}
                    </Stack>
                  </Paper>
                );
              })}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
