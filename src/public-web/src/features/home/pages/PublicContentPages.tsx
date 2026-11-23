import { paginationLabel, vacancyLabel } from './publicPresentation';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  MenuItem,
  Pagination,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../../../../../packages/client-core/src/api';
import { publicInformation, publicPhotoUrl } from '../../../services/publicInformation';
import type { PublicLocation, PublicPhoto, PublicRoom } from '../../../services/publicInformation';

function usePublicMeta(title: string, description: string) {
  useEffect(() => {
    document.title = `${title} | BHOME`;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.append(meta);
    }
    meta.content = description.slice(0, 160);
  }, [title, description]);
}
export function Status({
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
      <Stack role="status" sx={{ py: 3 }}>
        <Typography>Đang tải thông tin…</Typography>
        <Skeleton variant="rounded" height={180} />
        <Skeleton width="60%" />
      </Stack>
    );
  if (activeError)
    return (
      <Alert
        severity={activeError instanceof ApiError && activeError.status === 404 ? 'info' : 'error'}
        action={
          <Button
            color="inherit"
            disabled={fetching}
            onClick={() => {
              setRetryError(activeError);
              void retry().finally(() => setRetryError(null));
            }}
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
      sx={{
        width: '100%',
        aspectRatio: '16/10',
        objectFit: 'cover',
        display: 'block',
        borderRadius: 2,
      }}
    />
  );
}
export function Photos({ photos, name }: { photos: PublicPhoto[]; name: string }) {
  if (!photos.length)
    return (
      <Box sx={{ p: 4, my: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
        <Typography color="text.secondary">Chưa có ảnh được công bố.</Typography>
      </Box>
    );
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: photos.length > 1 ? 'repeat(2, minmax(0, 1fr))' : '1fr',
        },
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
export function Amenities({ items }: { items: string[] }) {
  return items.length ? (
    <Stack direction="row" useFlexGap sx={{ my: 2, flexWrap: 'wrap', gap: 1 }}>
      {items.map((item, index) => (
        <Chip key={`${index}-${item}`} label={item} variant="outlined" />
      ))}
    </Stack>
  ) : null;
}
export function Price({ value }: { value: number | null }) {
  return (
    <Typography sx={{ fontWeight: 700, my: 1 }}>
      {value == null
        ? 'Liên hệ để biết giá'
        : `${new Intl.NumberFormat('vi-VN').format(value)} ₫ / tháng (tham khảo)`}
    </Typography>
  );
}
function RoomSummary({ room, detail = false }: { room: PublicRoom; detail?: boolean }) {
  return (
    <Box component="article" sx={{ py: 2, minWidth: 0 }}>
      {!detail && (
        <>
          <Photos photos={room.photos.slice(0, 1)} name={`Phòng ${room.roomNumber}`} />
          <Typography variant="h6" component="h3">
            <Link to={`/rooms/${room.roomId}`}>Phòng {room.roomNumber}</Link>
          </Typography>
        </>
      )}
      <Price value={room.indicativePrice} />
      <Typography>
        {room.capacity} người · {vacancyLabel(room.vacancy)}
      </Typography>
      <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{room.description}</Typography>
      <Amenities items={room.amenities} />
    </Box>
  );
}
function Contact({ location }: { location: PublicLocation }) {
  return (
    <Box sx={{ my: 3 }}>
      <Typography variant="h6" component="h2">
        Thông tin liên hệ
      </Typography>
      {!location.contactPhone && !location.contactEmail && (
        <Typography>Chưa có thông tin liên hệ được công bố.</Typography>
      )}
      {location.contactPhone && (
        <Typography>
          <a href={`tel:${location.contactPhone}`}>{location.contactPhone}</a>
        </Typography>
      )}
      {location.contactEmail && (
        <Typography sx={{ overflowWrap: 'anywhere' }}>
          <a href={`mailto:${location.contactEmail}`}>{location.contactEmail}</a>
        </Typography>
      )}
    </Box>
  );
}
export function LocationsPage({ home = false }: { home?: boolean }) {
  const query = useQuery({
    queryKey: ['public', 'locations'],
    queryFn: ({ signal }) => publicInformation.locations(signal),
  });
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '',
    amenity = params.get('amenity') ?? '';
  const [page, setPage] = useState(1);
  usePublicMeta(
    home ? 'Tìm nơi ở phù hợp' : 'Khám phá cơ sở',
    'Khám phá cơ sở, tiện ích và phòng trọ được chủ cơ sở công bố trên BHOME.',
  );
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  };
  const all = query.data ?? [];
  const filtered = all.filter(
    (l) =>
      `${l.name} ${l.address}`
        .toLocaleLowerCase('vi')
        .includes(search.trim().toLocaleLowerCase('vi')) &&
      (!amenity || l.amenities.includes(amenity)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 9)),
    current = Math.min(page, pages);
  return (
    <>
      <Typography
        variant={home ? 'h4' : 'h3'}
        component={home ? 'h2' : 'h1'}
        sx={{ fontSize: { xs: '1.8rem', md: home ? '2rem' : '3rem' }, mb: 2 }}
      >
        {home ? 'Cơ sở được công bố' : 'Khám phá cơ sở'}
      </Typography>
      <Typography sx={{ mb: 3 }}>
        Thông tin cơ sở và phòng trọ được công bố bởi chủ cơ sở.
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField
          type="search"
          label="Tìm tên cơ sở hoặc địa chỉ"
          value={search}
          onChange={(e) => filter('q', e.target.value)}
          fullWidth
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
        <TextField
          select
          label="Tiện ích cơ sở"
          value={amenity}
          onChange={(e) => filter('amenity', e.target.value)}
          sx={{ minWidth: { sm: 220 } }}
        >
          <MenuItem value="">Tất cả tiện ích</MenuItem>
          {[...new Set(all.flatMap((l) => l.amenities))].sort().map((a) => (
            <MenuItem key={a} value={a}>
              {a}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Status
        loading={query.isPending}
        fetching={query.isFetching}
        error={query.error}
        retry={() => query.refetch()}
      />
      {!query.error && all.length === 0 && !query.isPending && (
        <Alert severity="info">Hiện chưa có cơ sở được công bố. Vui lòng quay lại sau.</Alert>
      )}
      {!!all.length && !filtered.length && (
        <Alert
          severity="info"
          action={
            <Button
              onClick={() => {
                setParams({});
                setPage(1);
              }}
            >
              Xóa bộ lọc
            </Button>
          }
        >
          Không có cơ sở phù hợp. Thử tên hoặc khu vực khác.
        </Alert>
      )}
      {!query.error && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, minmax(0,1fr))',
              md: 'repeat(3, minmax(0,1fr))',
            },
            gap: 3,
          }}
        >
          {filtered.slice((current - 1) * 9, current * 9).map((location) => (
            <Card
              component="article"
              variant="outlined"
              key={location.locationId}
              sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}
            >
              <Box sx={{ px: 2 }}>
                <Photos photos={location.photos.slice(0, 1)} name={location.name} />
              </Box>
              <CardContent sx={{ flex: 1, pt: 0 }}>
                <Typography
                  variant="h5"
                  component={home ? 'h3' : 'h2'}
                  sx={{ overflowWrap: 'anywhere' }}
                >
                  <Link to={`/locations/${location.locationId}`}>{location.name}</Link>
                </Typography>
                <Typography color="text.secondary" sx={{ my: 1 }}>
                  {location.address}
                </Typography>
                <Typography
                  sx={{
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {location.summary}
                </Typography>
                <Amenities items={location.amenities.slice(0, 3)} />
              </CardContent>
              <Box sx={{ p: 2, pt: 0 }}>
                <Button
                  component={Link}
                  to={`/locations/${location.locationId}`}
                  variant="outlined"
                >
                  Xem cơ sở và phòng
                </Button>
              </Box>
            </Card>
          ))}
        </Box>
      )}
      {pages > 1 && (
        <Pagination
          getItemAriaLabel={paginationLabel}
          aria-label="Trang cơ sở"
          count={pages}
          page={current}
          onChange={(_, value) => setPage(value)}
          sx={{ mt: 3 }}
        />
      )}
    </>
  );
}
function RoomList({ rooms }: { rooms: PublicRoom[] }) {
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    price: '',
    capacity: '',
    amenity: '',
  });
  const [page, setPage] = useState(1);
  const change = (key: keyof typeof filters, value: string) => {
    setFilters({ ...filters, [key]: value });
    setPage(1);
  };
  const filtered = rooms.filter(
    (r) =>
      (!filters.search ||
        `${r.roomNumber} ${r.description}`
          .toLocaleLowerCase('vi')
          .includes(filters.search.toLocaleLowerCase('vi'))) &&
      (!filters.status || r.vacancy === filters.status) &&
      (!filters.price ||
        (r.indicativePrice != null && r.indicativePrice <= Number(filters.price))) &&
      (!filters.capacity || r.capacity >= Number(filters.capacity)) &&
      (!filters.amenity || r.amenities.includes(filters.amenity)),
  );
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 6)));
  return (
    <>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2,minmax(0,1fr))',
            md: 'repeat(3,minmax(0,1fr))',
          },
          gap: 2,
          my: 3,
        }}
      >
        <TextField
          type="search"
          label="Tìm phòng"
          value={filters.search}
          onChange={(e) => change('search', e.target.value)}
        />
        <TextField
          select
          label="Tình trạng phòng"
          value={filters.status}
          onChange={(e) => change('status', e.target.value)}
        >
          <MenuItem value="">Tất cả tình trạng</MenuItem>
          {['Available', 'OnHold', 'Occupied', 'Unavailable'].map((s) => (
            <MenuItem key={s} value={s}>
              {vacancyLabel(s)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          type="number"
          label="Giá tối đa (VND)"
          value={filters.price}
          onChange={(e) => change('price', e.target.value)}
          slotProps={{ htmlInput: { min: 0, step: 1 } }}
        />
        <TextField
          select
          label="Sức chứa tối thiểu"
          value={filters.capacity}
          onChange={(e) => change('capacity', e.target.value)}
        >
          <MenuItem value="">Mọi sức chứa</MenuItem>
          {[...new Set(rooms.map((r) => r.capacity))]
            .sort((a, b) => a - b)
            .map((c) => (
              <MenuItem key={c} value={String(c)}>
                {c} người
              </MenuItem>
            ))}
        </TextField>
        <TextField
          select
          label="Tiện ích phòng"
          value={filters.amenity}
          onChange={(e) => change('amenity', e.target.value)}
        >
          <MenuItem value="">Tất cả tiện ích</MenuItem>
          {[...new Set(rooms.flatMap((r) => r.amenities))].sort().map((a) => (
            <MenuItem key={a} value={a}>
              {a}
            </MenuItem>
          ))}
        </TextField>
        <Button
          onClick={() => {
            setFilters({ search: '', status: '', price: '', capacity: '', amenity: '' });
            setPage(1);
          }}
        >
          Xóa bộ lọc phòng
        </Button>
      </Box>
      {!rooms.length ? (
        <Alert severity="info">Cơ sở chưa công bố phòng.</Alert>
      ) : !filtered.length ? (
        <Alert severity="info">Không có phòng phù hợp với bộ lọc.</Alert>
      ) : (
        <Typography color="text.secondary">{filtered.length} phòng phù hợp</Typography>
      )}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,minmax(0,1fr))' },
          gap: 3,
        }}
      >
        {filtered.slice((currentPage - 1) * 6, currentPage * 6).map((room) => (
          <RoomSummary key={room.roomId} room={room} />
        ))}
      </Box>
      {filtered.length > 6 && (
        <Pagination
          aria-label="Trang phòng"
          getItemAriaLabel={paginationLabel}
          page={currentPage}
          count={Math.ceil(filtered.length / 6)}
          onChange={(_, value) => setPage(value)}
        />
      )}
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
  usePublicMeta(
    location?.name ?? 'Thông tin cơ sở',
    location?.summary ?? 'Thông tin cơ sở được công bố trên BHOME.',
  );
  return (
    <>
      <Breadcrumbs sx={{ mb: 3 }}>
        <Link to="/">Trang chủ</Link>
        <Link to="/locations">Tất cả cơ sở</Link>
        <Typography>{location?.name ?? 'Chi tiết cơ sở'}</Typography>
      </Breadcrumbs>
      <Status
        loading={query.isPending}
        fetching={query.isFetching}
        error={query.error}
        retry={() => query.refetch()}
      />
      {!query.error && location && (
        <>
          <Typography
            variant="h3"
            component="h1"
            sx={{ overflowWrap: 'anywhere', fontSize: { xs: '2rem', md: '3rem' } }}
          >
            {location.name}
          </Typography>
          <Typography sx={{ my: 2 }}>{location.address}</Typography>
          <Photos photos={location.photos} name={location.name} />
          <Typography sx={{ whiteSpace: 'pre-wrap', maxWidth: '75ch' }}>
            {location.summary}
          </Typography>
          <Amenities items={location.amenities} />
          <Contact location={location} />
          {location.address && (
            <Button
              component="a"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Xem địa chỉ trên bản đồ
            </Button>
          )}
          <Divider sx={{ my: 4 }} />
          <Typography variant="h5" component="h2">
            Phòng được công bố
          </Typography>
          <Status
            loading={rooms.isPending}
            fetching={rooms.isFetching}
            error={rooms.error}
            retry={() => rooms.refetch()}
          />
          {rooms.data && !rooms.error && <RoomList key={id} rooms={rooms.data} />}
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
  const location = useQuery({
    queryKey: ['public', 'location', room?.locationId],
    queryFn: ({ signal }) => publicInformation.location(room!.locationId, signal),
    enabled: !!room,
  });
  usePublicMeta(
    room ? `Phòng ${room.roomNumber}` : 'Thông tin phòng',
    room?.description ?? 'Thông tin phòng được công bố trên BHOME.',
  );
  return (
    <>
      <Status
        loading={query.isPending}
        fetching={query.isFetching}
        error={query.error}
        retry={() => query.refetch()}
      />
      {!query.error && room && (
        <>
          <Breadcrumbs sx={{ mb: 3 }}>
            <Link to="/locations">Tất cả cơ sở</Link>
            <Link to={`/locations/${room.locationId}`}>Xem cơ sở</Link>
            <Typography>Phòng {room.roomNumber}</Typography>
          </Breadcrumbs>
          <Typography variant="h3" component="h1" sx={{ fontSize: { xs: '2rem', md: '3rem' } }}>
            Phòng {room.roomNumber}
          </Typography>
          {room.floor && <Typography sx={{ mt: 2 }}>Tầng {room.floor}</Typography>}
          <Photos photos={room.photos} name={`Phòng ${room.roomNumber}`} />
          <RoomSummary room={room} detail />
          <Status
            loading={location.isPending}
            fetching={location.isFetching}
            error={location.error}
            retry={() => location.refetch()}
          />
          {location.data && !location.error && (
            <>
              <Typography>
                {location.data.name} · {location.data.address}
              </Typography>
              <Contact location={location.data} />
            </>
          )}
          <Typography color="text.secondary">
            Giá và tình trạng phòng là thông tin tham khảo. Vui lòng liên hệ cơ sở để biết chi tiết.
          </Typography>
        </>
      )}
    </>
  );
}
export function NotFoundPage() {
  usePublicMeta('Không tìm thấy trang', 'Trang bạn yêu cầu không tồn tại trên BHOME.');
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
