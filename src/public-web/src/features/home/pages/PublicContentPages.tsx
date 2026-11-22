import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../../../../../packages/client-core/src/api';
import { publicInformation, publicPhotoUrl } from '../../../services/publicInformation';
import type { PublicPhoto, PublicRoom } from '../../../services/publicInformation';

function Status({
  loading,
  fetching,
  error,
  retry,
}: {
  loading: boolean;
  fetching: boolean;
  error: Error | null;
  retry: () => Promise<unknown>;
}) {
  const [retryError, setRetryError] = useState<Error | null>(null);
  const activeError = error ?? retryError;
  if (loading && !retryError)
    return (
      <Stack role="status" direction="row" spacing={2} sx={{ py: 4 }}>
        <CircularProgress size={24} />
        <Typography>Đang tải thông tin…</Typography>
      </Stack>
    );
  if (activeError)
    return (
      <Alert
        severity={activeError instanceof ApiError && activeError.status === 404 ? 'info' : 'error'}
        action={
          <Button
            color="inherit"
            onClick={() => {
              setRetryError(activeError);
              void retry().finally(() => setRetryError(null));
            }}
            disabled={fetching}
          >
            {fetching ? 'Đang thử lại…' : 'Thử lại'}
          </Button>
        }
      >
        {fetching && <span role="status">Đang tải lại thông tin… </span>}
        {activeError instanceof ApiError && activeError.status === 404
          ? 'Thông tin không tồn tại hoặc chưa được công bố.'
          : 'Chưa thể tải thông tin. Vui lòng thử lại.'}
      </Alert>
    );
  return null;
}
function Photo({ photo, name }: { photo: PublicPhoto; name: string }) {
  const [failed, setFailed] = useState(false);
  const url = publicPhotoUrl(photo);
  if (!url) return null;
  if (failed)
    return (
      <Box sx={{ p: 3, bgcolor: 'action.hover', borderRadius: 2 }}>
        <Typography role="status">
          Chưa thể tải ảnh {photo.index + 1} của {name}.
        </Typography>
        <Button onClick={() => setFailed(false)}>Thử tải lại ảnh {photo.index + 1}</Button>
      </Box>
    );
  return (
    <Box
      component="img"
      src={url}
      alt={`${name} — ảnh ${photo.index + 1}`}
      loading="lazy"
      onError={() => setFailed(true)}
      sx={{ width: '100%', maxHeight: 360, objectFit: 'cover', borderRadius: 2 }}
    />
  );
}
function Photos({ photos, name }: { photos: PublicPhoto[]; name: string }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
        gap: 2,
        my: 3,
      }}
    >
      {photos.map((photo) => (
        <Photo key={`${photo.index}-${photo.url}`} photo={photo} name={name} />
      ))}
    </Box>
  );
}
function Amenities({ items }: { items: string[] }) {
  return items.length ? (
    <Stack direction="row" useFlexGap sx={{ my: 2, flexWrap: 'wrap', gap: 1 }}>
      {items.map((item, index) => (
        <Chip key={`${index}-${item}`} label={item} variant="outlined" />
      ))}
    </Stack>
  ) : null;
}
function Price({ value }: { value: number | null }) {
  return (
    <Typography sx={{ fontWeight: 600, my: 1 }}>
      {value === null
        ? 'Chưa công bố giá tham khảo'
        : `${new Intl.NumberFormat('vi-VN').format(value)} ₫ / tháng (tham khảo)`}
    </Typography>
  );
}
function RoomSummary({ room }: { room: PublicRoom }) {
  return (
    <Box component="article" sx={{ py: 3 }}>
      <Typography variant="h6" component="h3">
        <Link to={`/rooms/${room.roomId}`}>Phòng {room.roomNumber}</Link>
      </Typography>
      <Price value={room.indicativePrice} />
      <Typography>
        {room.capacity} người ·{' '}
        {room.vacancy === 'Available'
          ? 'Còn trống'
          : room.vacancy === 'Unavailable'
            ? 'Hiện không còn trống'
            : 'Chưa công bố tình trạng'}
      </Typography>
      <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{room.description}</Typography>
      <Amenities items={room.amenities} />
    </Box>
  );
}
export function LocationsPage() {
  const query = useQuery({
    queryKey: ['public', 'locations'],
    queryFn: ({ signal }) => publicInformation.locations(signal),
  });
  return (
    <>
      <Typography variant="h3" component="h1" sx={{ fontSize: { xs: '2rem', md: '3rem' }, mb: 2 }}>
        Khám phá cơ sở
      </Typography>
      <Typography sx={{ mb: 4 }}>
        Thông tin cơ sở và phòng trọ được công bố bởi chủ cơ sở.
      </Typography>
      <Status
        loading={query.isPending}
        fetching={query.isFetching}
        error={query.error}
        retry={() => query.refetch()}
      />
      {query.data?.length === 0 && (
        <Alert severity="info">Hiện chưa có cơ sở được công bố. Vui lòng quay lại sau.</Alert>
      )}
      {query.data?.map((location) => (
        <Box
          component="article"
          key={location.locationId}
          sx={{ py: 3, borderBottom: 1, borderColor: 'divider' }}
        >
          <Typography variant="h5" component="h2">
            <Link to={`/locations/${location.locationId}`}>{location.name}</Link>
          </Typography>
          <Typography color="text.secondary" sx={{ my: 1 }}>
            {location.address}
          </Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>{location.summary}</Typography>
          <Amenities items={location.amenities} />
          <Photos photos={location.photos.slice(0, 2)} name={location.name} />
          <Button component={Link} to={`/locations/${location.locationId}`} variant="outlined">
            Xem cơ sở và phòng
          </Button>
        </Box>
      ))}
    </>
  );
}
export function LocationPage() {
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: ['public', 'location', id],
    queryFn: ({ signal }) => publicInformation.location(id, signal),
  });
  const rooms = useQuery({
    queryKey: ['public', 'rooms', id],
    queryFn: ({ signal }) => publicInformation.rooms(id, signal),
    enabled: !!query.data,
  });
  const location = query.data;
  return (
    <>
      <Button component={Link} to="/locations" sx={{ mb: 2 }}>
        Tất cả cơ sở
      </Button>
      <Status
        loading={query.isPending}
        fetching={query.isFetching}
        error={query.error}
        retry={() => query.refetch()}
      />
      {location && (
        <>
          <Typography
            variant="h3"
            component="h1"
            sx={{ overflowWrap: 'anywhere', fontSize: { xs: '2rem', md: '3rem' } }}
          >
            {location.name}
          </Typography>
          <Typography sx={{ my: 2 }}>{location.address}</Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap', maxWidth: '75ch' }}>
            {location.summary}
          </Typography>
          <Amenities items={location.amenities} />
          <Photos photos={location.photos} name={location.name} />
          {(location.contactPhone || location.contactEmail) && (
            <Box sx={{ my: 4 }}>
              <Typography variant="h6" component="h2">
                Thông tin liên hệ
              </Typography>
              <Typography>{location.contactPhone}</Typography>
              <Typography sx={{ overflowWrap: 'anywhere' }}>{location.contactEmail}</Typography>
            </Box>
          )}
          <Divider sx={{ my: 3 }} />
          <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
            Phòng được công bố
          </Typography>
          <Status
            loading={rooms.isPending}
            fetching={rooms.isFetching}
            error={rooms.error}
            retry={() => rooms.refetch()}
          />
          {rooms.data?.length === 0 && <Alert severity="info">Cơ sở chưa công bố phòng.</Alert>}
          {rooms.data?.map((room) => (
            <RoomSummary key={room.roomId} room={room} />
          ))}
        </>
      )}
    </>
  );
}
export function RoomPage() {
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: ['public', 'room', id],
    queryFn: ({ signal }) => publicInformation.room(id, signal),
  });
  const room = query.data;
  return (
    <>
      <Status
        loading={query.isPending}
        fetching={query.isFetching}
        error={query.error}
        retry={() => query.refetch()}
      />
      {room && (
        <>
          <Button component={Link} to={`/locations/${room.locationId}`} sx={{ mb: 2 }}>
            Xem cơ sở
          </Button>
          <Typography variant="h3" component="h1" sx={{ fontSize: { xs: '2rem', md: '3rem' } }}>
            Phòng {room.roomNumber}
          </Typography>
          {room.floor && <Typography sx={{ mt: 2 }}>Tầng {room.floor}</Typography>}
          <RoomSummary room={room} />
          <Photos photos={room.photos} name={`Phòng ${room.roomNumber}`} />
          <Typography color="text.secondary">
            Giá và tình trạng phòng là thông tin tham khảo tại thời điểm công bố. Vui lòng liên hệ
            cơ sở để biết chi tiết.
          </Typography>
        </>
      )}
    </>
  );
}
export function NotFoundPage() {
  return (
    <>
      <Typography variant="h4" component="h1" sx={{ mb: 2 }}>
        Không tìm thấy trang
      </Typography>
      <Button component={Link} to="/locations" variant="contained">
        Khám phá cơ sở
      </Button>
    </>
  );
}
