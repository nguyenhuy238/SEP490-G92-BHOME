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

const states = [
  { label: 'Trống khai thác', color: '#159a60', background: '#eaf7ef' },
  { label: 'Đang giữ chỗ', color: '#b97913', background: '#fff6e5' },
  { label: 'Đang có khách thuê', color: '#255dde', background: '#eaf1ff' },
  { label: 'Ngừng khai thác', color: '#718198', background: '#f0f2f5' },
];

export function RoomFloorCards({
  rooms,
  locationId,
  total,
  edit,
  inspect,
  provenance,
}: {
  rooms: RoomConfiguration[];
  locationId: string;
  total: number;
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
  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { md: 'center' }, mb: 2.5 }}
      >
        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Layers3 size={22} color="#255dde" />
            <Typography component="h2" sx={{ fontSize: 19, fontWeight: 800 }}>
              Sơ đồ phòng theo tầng
            </Typography>
          </Stack>
          <Typography sx={{ mt: 0.75, color: 'text.secondary', fontSize: 13 }}>
            Đang xem {rooms.length} / {total} phòng phù hợp · Chọn ô phòng để xem thông tin và xử
            lý.
          </Typography>
        </Box>
        <TextField
          select
          label="Tầng trên trang hiện tại"
          value={floors.includes(floor) ? floor : ''}
          onChange={(e) => setFloor(e.target.value)}
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
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, mb: 3 }}>
        {states.map(({ label, color, background }, index) => (
          <Box
            key={label}
            sx={{
              display: 'flex',
              gap: 1,
              alignItems: 'center',
              px: 1.5,
              py: 1,
              bgcolor: background,
              borderRadius: '6px',
            }}
          >
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
            <Typography sx={{ fontSize: 13, color, fontWeight: 650 }}>{label}</Typography>
            <Typography sx={{ color, fontSize: 13, fontWeight: 800 }}>
              {rooms.filter((room) => room.status === index).length}
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
        <Box key={value} sx={{ mb: 3.5 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.75 }}>
            <Typography
              sx={{
                fontSize: 14,
                color: 'text.secondary',
                fontWeight: 800,
                textTransform: 'uppercase',
              }}
            >
              {value === 'Chưa phân tầng' ? value : `Tầng ${value}`}
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {rooms.filter((room) => (room.floor ?? 'Chưa phân tầng') === value).length} phòng
            </Typography>
            <Box sx={{ flex: 1, borderBottom: '1px solid', borderColor: 'divider' }} />
          </Stack>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
                xl: 'repeat(3, minmax(0, 1fr))',
              },
              gap: 2,
            }}
          >
            {rooms
              .filter((room) => (room.floor ?? 'Chưa phân tầng') === value)
              .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, 'vi', { numeric: true }))
              .map((room) => {
                const state = states[room.status] ?? states[3];
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
                      borderRadius: '10px',
                      borderColor: '#dce4ef',
                      borderTop: `4px solid ${state.color}`,
                      transition: 'box-shadow .15s',
                      '&:hover': { boxShadow: '0 6px 20px #15243e14', borderColor: state.color },
                    }}
                  >
                    <ButtonBase
                      onClick={() => inspect(room.id)}
                      aria-label={`Xem phòng ${room.roomNumber}`}
                      sx={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        p: 2.5,
                        '&.Mui-focusVisible': { outline: '3px solid #93c5fd', outlineOffset: -3 },
                      }}
                    >
                      <Stack spacing={2}>
                        <Stack
                          direction="row"
                          sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                        >
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                            <DoorOpen size={20} color={state.color} />
                            <Typography sx={{ fontSize: 22, fontWeight: 800 }}>
                              {room.roomNumber}
                            </Typography>
                          </Stack>
                          <Chip
                            size="small"
                            label={state.label}
                            sx={{
                              bgcolor: state.background,
                              color: state.color,
                              fontWeight: 650,
                              borderRadius: '6px',
                              fontSize: 12,
                            }}
                          />
                        </Stack>
                        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                          {provenance?.find(item => item.data.roomId === room.id)?.data.name ? `${provenance.find(item => item.data.roomId === room.id)!.data.name} · ` : ''}
                          Tầng {room.floor ?? 'chưa phân tầng'} · Sức chứa {room.capacity} người
                        </Typography>
                        <Stack
                          direction="row"
                          sx={{
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            py: 1.5,
                            borderTop: '1px solid',
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                          }}
                        >
                          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                            Người ở / Sức chứa
                          </Typography>
                          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                            <Users size={17} color="#63738b" />
                            <Typography sx={{ fontWeight: 800, fontSize: 16 }}>
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
                          <Typography sx={{ fontSize: 13, fontWeight: reports.length ? 700 : 400 }}>
                            {reports.length
                              ? `${emergency ? 'Có sự cố khẩn cấp' : 'Có báo cáo sự cố'} · ${reports.length} đang mở`
                              : incidents.data?.complete
                                ? 'Không có báo cáo sự cố đang mở'
                                : 'Chưa đủ dữ liệu báo cáo sự cố'}
                          </Typography>
                        </Stack>
                        {!occupied && (
                          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                            Chưa có dữ liệu số người ở.
                          </Typography>
                        )}
                      </Stack>
                    </ButtonBase>
                    <Stack
                      direction="row"
                      sx={{
                        px: 2,
                        py: 1,
                        bgcolor: '#fafbfd',
                        borderTop: '1px solid',
                        borderColor: 'divider',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Button endIcon={<ArrowUpRight size={15} />} onClick={() => inspect(room.id)}>
                        Xem chi tiết
                      </Button>
                      {edit && (
                        <Button startIcon={<Pencil size={14} />} onClick={() => edit(room)}>
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
