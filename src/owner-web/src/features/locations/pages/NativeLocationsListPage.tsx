import { useState } from 'react';
import { Alert, Box, Button, Chip, Grid, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { Building2, Copy, Plus } from 'lucide-react';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { locationSetupClient } from '../../../../../../packages/client-core/src/locationSetup';
import type { LocationConfiguration } from '../../../../../../packages/client-core/src/propertySetup';
import type { Page } from '../../../../../../packages/client-core/src/invoices';
import type { OccupancySummary } from '../../property-api/propertyApi';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { ErrorState, LoadingState, PageHeader } from '../../../components/common/PortalUI';
import { LocationSetupWizard } from '../setup/LocationSetupWizard';

export function NativeLocationsListPage() {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [wizard, setWizard] = useState<string | null>(null);
  const locations = useQuery({
    queryKey: ['property-setup', 'native-locations', session?.userId, page, search, status],
    queryFn: ({ signal }) => api.request<Page<LocationConfiguration>>(
      '/api/v1/locations?' + new URLSearchParams({ page: String(page), pageSize: '20', ...(search.trim() ? { search: search.trim() } : {}), ...(status ? { isActive: status } : {}) }),
      { signal },
    ),
  });
  // Source selector uses the full scoped list rather than the current filtered page.
  const sources = useQuery({
    queryKey: ['property-setup', 'location-setup-sources', session?.userId],
    queryFn: async ({ signal }) => {
      const result: LocationConfiguration[] = [];
      for (let current = 1; ; current++) {
        const response = await api.locations(current, '', signal);
        result.push(...response.items);
        if (result.length >= response.totalCount) return result;
        if (!response.items.length) throw new Error('Danh sách cơ sở thay đổi khi tải.');
      }
    },
    enabled: owner && wizard !== null,
  });
  return (
    <Stack spacing={3}>
      <PageHeader group="QUẢN LÝ CƠ SỞ" title="Danh sách cơ sở"
        subtitle="Quản lý cấu hình, phòng và dữ liệu vận hành riêng tại từng cơ sở."
        actions={owner ? <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<Copy size={16} />} disabled={!locations.data?.items.length} onClick={() => setWizard(locations.data!.items[0].id)}>Sao chép cấu hình</Button>
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setWizard('')}>Thêm cơ sở</Button>
        </Stack> : undefined} />
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField fullWidth label="Tìm theo tên hoặc địa chỉ" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          <TextField select label="Trạng thái vận hành" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 220 }}>
            <MenuItem value="">Tất cả trạng thái</MenuItem><MenuItem value="true">Đang hoạt động</MenuItem><MenuItem value="false">Ngừng hoạt động</MenuItem>
          </TextField>
        </Stack>
      </Paper>
      {locations.isPending ? <LoadingState /> : locations.error ? <ErrorState error={locations.error} retry={() => void locations.refetch()} /> : <>
        <Typography color="text.secondary">{locations.data.totalCount} cơ sở phù hợp</Typography>
        {!locations.data.items.length && <Alert severity="info">Chưa có cơ sở phù hợp.</Alert>}
        <Grid container spacing={2.5}>
          {locations.data.items.map(location => <Grid key={location.id} size={{ xs: 12, md: 6, lg: 4 }}><LocationCard location={location} owner={owner} copy={() => setWizard(location.id)} /></Grid>)}
        </Grid>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
          <Button disabled={page === 1} onClick={() => setPage(page - 1)}>Trang trước</Button>
          <Typography variant="body2">Trang {page}</Typography>
          <Button disabled={page * 20 >= locations.data.totalCount} onClick={() => setPage(page + 1)}>Trang sau</Button>
        </Stack>
      </>}
      {wizard !== null && <LocationSetupWizard
        locations={sources.data ?? locations.data?.items ?? []}
        initialSource={wizard || undefined}
        onClose={() => setWizard(null)}
        onComplete={async result => {
          await cache.invalidateQueries({ queryKey: ['property-setup'] });
          await cache.invalidateQueries({ queryKey: ['portal', 'api'] });
          await cache.invalidateQueries({ queryKey: ['billing-policies'] });
          setWizard(null);
          navigate(`/locations/${result.location.id}/overview`);
        }}
      />}
      {wizard !== null && sources.error && <Alert severity="warning" action={<Button onClick={() => void sources.refetch()}>Thử lại</Button>}>Chưa tải đầy đủ danh sách nguồn; có thể dùng các cơ sở trên trang hiện tại.</Alert>}
    </Stack>
  );
}

function LocationCard({ location, owner, copy }: { location: LocationConfiguration; owner: boolean; copy: () => void }) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const metadata = useQuery({
    queryKey: ['property-setup', 'setup-metadata', session?.userId, location.id],
    queryFn: ({ signal }) => locationSetupClient(api.request).metadata(location.id, signal),
    enabled: owner,
  });
  const occupancy = useQuery({
    queryKey: ['property-setup', 'location-occupancy', session?.userId, location.id],
    queryFn: ({ signal }) => api.request<OccupancySummary>(`/api/v1/locations/${encodeURIComponent(location.id)}/occupancy-summary`, { signal }),
  });
  const info = metadata.data?.data;
  const snapshot = occupancy.data?.snapshot;
  return <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Building2 size={22} />
        {info?.code && <Chip size="small" label={info.code} />}
        <Chip size="small" color={location.isActive ? 'success' : 'default'} label={location.isActive ? 'Đang hoạt động' : 'Ngừng hoạt động'} />
      </Stack>
      <Typography component={Link} to={`/locations/${location.id}/overview`} variant="h6" sx={{ color: 'text.primary', fontWeight: 750, textDecoration: 'none' }}>{location.name}</Typography>
      <Typography variant="body2" color="text.secondary">{location.address}</Typography>
      {owner && (metadata.isError ? <Alert severity="warning" action={<Button onClick={() => void metadata.refetch()}>Thử lại</Button>}>Chưa tải được thông tin cấu hình.</Alert> : metadata.isPending ? <Typography variant="caption">Đang tải thông tin cấu hình…</Typography> : info ? <>
        <Typography variant="body2">{info.floors} tầng · {info.setupStatus === 'Completed' ? 'Đã lưu thiết lập ban đầu' : 'Đã ghi nhận thông tin'}</Typography>
        {info.contactPhone && <Typography variant="caption">Liên hệ: {info.contactPhone}</Typography>}
      </> : <Typography variant="caption" color="text.secondary">Chưa có thông tin thiết lập ban đầu.</Typography>)}
      {occupancy.isError ? <Alert severity="warning" action={<Button onClick={() => void occupancy.refetch()}>Thử lại</Button>}>Chưa tải được số liệu phòng.</Alert> : snapshot ? <Typography variant="body2">{snapshot.totalRooms} phòng · {snapshot.occupiedRooms} đang thuê · {snapshot.availableRooms} trống · {snapshot.unavailableRooms} ngừng khai thác</Typography> : <Typography variant="caption">Đang tải số liệu phòng…</Typography>}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 'auto' }}>
        {owner && <><Button variant="outlined" onClick={copy}>Sao chép</Button><Button variant="outlined" component={Link} to={`/locations/${location.id}/settings`}>Sửa</Button></>}
        <Button variant="contained" component={Link} to={`/locations/${location.id}/overview`}>Xem cơ sở</Button>
      </Box>
    </Stack>
  </Paper>;
}
