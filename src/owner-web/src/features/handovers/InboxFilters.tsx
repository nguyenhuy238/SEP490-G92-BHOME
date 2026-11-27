import { Alert, Button, MenuItem } from '@mui/material';
import { TextField } from '../../components/common/ValidatedForm';
import type { useInboxRooms } from './useInboxFilters';

export function InboxRoomFilter({
  location,
  room,
  rooms,
  onChange,
}: {
  location: string;
  room: string;
  rooms: ReturnType<typeof useInboxRooms>;
  onChange: (room: string) => void;
}) {
  return (
    <TextField
      select
      size="small"
      label="Phòng"
      value={room}
      disabled={!location || rooms.isPending || !!rooms.error}
      onChange={(event) => onChange(event.target.value)}
      sx={{ maxWidth: { sm: 240 } }}
      slotProps={{ select: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 320 } } } } } }}
    >
      <MenuItem value="">Tất cả phòng</MenuItem>
      {location && rooms.data?.length === 0 && <MenuItem disabled>Không có phòng phù hợp</MenuItem>}
      {(rooms.data ?? []).map((option) => (
        <MenuItem key={option.id} value={option.id}>
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

export function InboxRoomError({ rooms }: { rooms: ReturnType<typeof useInboxRooms> }) {
  if (!rooms.error) return null;
  return (
    <Alert severity="warning">
      Không tải được danh sách phòng. <Button onClick={() => void rooms.refetch()}>Thử lại</Button>
    </Alert>
  );
}
