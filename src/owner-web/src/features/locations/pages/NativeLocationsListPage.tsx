import { useId, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { Copy, MoreHorizontal, Plus } from 'lucide-react';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { locationSetupClient } from '../../../../../../packages/client-core/src/locationSetup';
import type { LocationConfiguration } from '../../../../../../packages/client-core/src/propertySetup';
import type { Page } from '../../../../../../packages/client-core/src/invoices';
import type { OccupancySummary } from '../../property-api/propertyApi';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { ErrorState, PageHeader } from '../../../components/common/PortalUI';
import { roomStatusColors } from '../../../theme/theme';
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
  const [choosingSource, setChoosingSource] = useState(false);
  const [selectedSource, setSelectedSource] = useState('');
  const locations = useQuery({
    queryKey: ['property-setup', 'native-locations', session?.userId, page, search, status],
    queryFn: ({ signal }) =>
      api.request<Page<LocationConfiguration>>(
        '/api/v1/locations?' +
          new URLSearchParams({
            page: String(page),
            pageSize: '20',
            ...(search.trim() ? { search: search.trim() } : {}),
            ...(status ? { isActive: status } : {}),
          }),
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
    enabled: owner && (wizard !== null || choosingSource),
  });
  const sourceLocations = sources.data ?? locations.data?.items ?? [];
  return (
    <Stack spacing={1.5} sx={{ minWidth: 0 }}>
      <PageHeader
        title="Danh sách cơ sở"
        actions={
          owner ? (
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                startIcon={<Copy size={16} />}
                onClick={() => {
                  setSelectedSource('');
                  setChoosingSource(true);
                }}
              >
                Sao chép cấu hình
              </Button>
              <Button
                variant="contained"
                startIcon={<Plus size={16} />}
                onClick={() => setWizard('')}
              >
                Thêm cơ sở
              </Button>
            </Stack>
          ) : undefined
        }
      />
      <Paper variant="outlined" sx={{ minWidth: 0 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          useFlexGap
          spacing={1}
          sx={{ px: 1.5, py: 1.5, alignItems: { sm: 'center' }, flexWrap: 'wrap' }}
        >
          <TextField
            fullWidth
            size="small"
            label="Tìm theo tên hoặc địa chỉ"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            sx={{
              flex: { sm: '1 1 220px' },
              width: { sm: 'auto' },
              maxWidth: { sm: 360 },
              minWidth: 0,
            }}
          />
          <TextField
            select
            size="small"
            label="Trạng thái vận hành"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            sx={{ width: { xs: '100%', sm: 200 } }}
          >
            <MenuItem value="">Tất cả trạng thái</MenuItem>
            <MenuItem value="true">Đang hoạt động</MenuItem>
            <MenuItem value="false">Ngừng hoạt động</MenuItem>
          </TextField>
          {(search || status) && (
            <Button
              onClick={() => {
                setSearch('');
                setStatus('');
                setPage(1);
              }}
            >
              Xóa bộ lọc
            </Button>
          )}
          {locations.data && !locations.error && (
            <Typography
              variant="body2"
              color="text.secondary"
              role="status"
              sx={{ ml: { sm: 'auto' }, whiteSpace: 'nowrap' }}
            >
              {locations.data.totalCount} {search || status ? 'cơ sở phù hợp' : 'cơ sở'}
              {locations.isFetching && ' · Đang cập nhật…'}
            </Typography>
          )}
        </Stack>
        {locations.isPending ? (
          <Box role="status" aria-label="Đang tải danh sách cơ sở" sx={{ p: 1.5 }}>
            <LinearProgress />
            <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
              Đang tải danh sách cơ sở…
            </Typography>
          </Box>
        ) : locations.error ? (
          <Box sx={{ p: 1.5 }}>
            <ErrorState error={locations.error} retry={() => void locations.refetch()} />
          </Box>
        ) : (
          <>
            {!locations.data.items.length ? (
              <Box sx={{ p: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                <Alert severity="info">Chưa có cơ sở phù hợp.</Alert>
              </Box>
            ) : (
              <TableContainer>
                <Table
                  size="small"
                  role="table"
                  aria-label="Danh sách cơ sở"
                  sx={{
                    display: { xs: 'block', lg: 'table' },
                    '& .MuiTableCell-root': {
                      px: { xs: 2, lg: 2 },
                      py: { xs: 0, lg: 1.75 },
                      verticalAlign: 'middle',
                      borderColor: 'divider',
                      overflowWrap: 'anywhere',
                    },
                    '& .MuiTableCell-head': { py: 1.25, fontSize: 13 },
                    '& .MuiTableBody-root': { display: { xs: 'block', lg: 'table-row-group' } },
                    '& .MuiTableBody-root > .MuiTableRow-root': {
                      display: { xs: 'grid', lg: 'table-row' },
                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                      rowGap: 1.5,
                      py: { xs: 2, lg: 0 },
                      borderBottomWidth: { xs: '1px', lg: 0 },
                      borderBottomStyle: 'solid',
                      borderBottomColor: 'divider',
                    },
                    '& .MuiTableBody-root .MuiTableCell-root': {
                      display: { xs: 'block', lg: 'table-cell' },
                      minWidth: 0,
                      borderBottomWidth: { xs: 0, lg: '1px' },
                      borderBottomStyle: 'solid',
                      borderBottomColor: 'divider',
                    },
                    '& .MuiTableBody-root > .MuiTableRow-root:last-child, & .MuiTableBody-root > .MuiTableRow-root:last-child > .MuiTableCell-root':
                      {
                        borderBottomWidth: 0,
                      },
                  }}
                >
                  <TableHead
                    role="rowgroup"
                    sx={{
                      position: { xs: 'absolute', lg: 'static' },
                      width: { xs: '1px', lg: 'auto' },
                      height: { xs: '1px', lg: 'auto' },
                      clipPath: { xs: 'inset(50%)', lg: 'none' },
                      overflow: 'hidden',
                    }}
                  >
                    <TableRow role="row">
                      <TableCell role="columnheader" scope="col">
                        Cơ sở
                      </TableCell>
                      <TableCell role="columnheader" scope="col">
                        Trạng thái
                      </TableCell>
                      <TableCell role="columnheader" scope="col">
                        Phòng
                      </TableCell>
                      {owner && (
                        <TableCell role="columnheader" scope="col">
                          Thiết lập
                        </TableCell>
                      )}
                      <TableCell role="columnheader" scope="col" align="right">
                        Thao tác
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody role="rowgroup">
                    {locations.data.items.map((location) => (
                      <LocationRow
                        key={location.id}
                        location={location}
                        owner={owner}
                        copy={() => setWizard(location.id)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            <Stack
              direction="row"
              spacing={1}
              sx={{
                px: 1.5,
                py: 0.75,
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                borderTop: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {locations.data.items.length
                  ? `${(page - 1) * 20 + 1}–${(page - 1) * 20 + locations.data.items.length} / ${locations.data.totalCount} cơ sở`
                  : '0 cơ sở trên trang'}
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
                  Trang trước
                </Button>
                <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
                  Trang {page}
                </Typography>
                <Button
                  disabled={page * 20 >= locations.data.totalCount}
                  onClick={() => setPage(page + 1)}
                >
                  Trang sau
                </Button>
              </Stack>
            </Stack>
          </>
        )}
      </Paper>
      <Dialog
        open={choosingSource}
        onClose={() => setChoosingSource(false)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="location-copy-source-title"
      >
        <DialogTitle id="location-copy-source-title">Chọn cơ sở nguồn</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Chọn cơ sở có cấu hình bạn muốn dùng cho cơ sở mới. Sau đó chọn các phần cần sao chép
              trong trình thiết lập.
            </Typography>
            {sources.isFetching && <LinearProgress aria-label="Đang tải cơ sở nguồn" />}
            {sources.isError && (
              <Alert
                severity="warning"
                action={<Button onClick={() => void sources.refetch()}>Thử lại</Button>}
              >
                Chưa tải đầy đủ danh sách nguồn; có thể dùng các cơ sở trên trang hiện tại.
              </Alert>
            )}
            <TextField
              select
              label="Cơ sở nguồn"
              value={selectedSource}
              onChange={(event) => setSelectedSource(event.target.value)}
              disabled={!sourceLocations.length}
            >
              <MenuItem value="">Chọn cơ sở</MenuItem>
              {sourceLocations.map((location) => (
                <MenuItem key={location.id} value={location.id}>
                  {location.name}
                </MenuItem>
              ))}
            </TextField>
            {!sources.isFetching && !sources.isError && !sourceLocations.length && (
              <Typography variant="body2" color="text.secondary">
                Chưa có cơ sở nào để sao chép cấu hình.
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChoosingSource(false)}>Hủy</Button>
          <Button
            variant="contained"
            disabled={!sourceLocations.some((location) => location.id === selectedSource)}
            onClick={() => {
              setChoosingSource(false);
              setWizard(selectedSource);
            }}
          >
            Tiếp tục
          </Button>
        </DialogActions>
      </Dialog>
      {wizard !== null && (
        <LocationSetupWizard
          locations={sourceLocations}
          initialSource={wizard || undefined}
          onClose={() => setWizard(null)}
          onComplete={async (result) => {
            await cache.invalidateQueries({ queryKey: ['property-setup'] });
            await cache.invalidateQueries({ queryKey: ['portal', 'api'] });
            await cache.invalidateQueries({ queryKey: ['billing-policies'] });
            setWizard(null);
            navigate(`/locations/${result.location.id}/overview`);
          }}
        />
      )}
      {wizard !== null && sources.error && (
        <Alert
          severity="warning"
          action={<Button onClick={() => void sources.refetch()}>Thử lại</Button>}
        >
          Chưa tải đầy đủ danh sách nguồn; có thể dùng các cơ sở trên trang hiện tại.
        </Alert>
      )}
    </Stack>
  );
}

const fullRowCell = { gridColumn: { xs: '1 / -1', lg: 'auto' } } as const;

function LocationRow({
  location,
  owner,
  copy,
}: {
  location: LocationConfiguration;
  owner: boolean;
  copy: () => void;
}) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const metadata = useQuery({
    queryKey: ['property-setup', 'setup-metadata', session?.userId, location.id],
    queryFn: ({ signal }) => locationSetupClient(api.request).metadata(location.id, signal),
    enabled: owner,
  });
  const occupancy = useQuery({
    queryKey: ['property-setup', 'location-occupancy', session?.userId, location.id],
    queryFn: ({ signal }) =>
      api.request<OccupancySummary>(
        `/api/v1/locations/${encodeURIComponent(location.id)}/occupancy-summary`,
        { signal },
      ),
  });
  const info = metadata.data?.data;
  const snapshot = occupancy.data?.snapshot;
  const status = (
    <Chip
      size="small"
      label={location.isActive ? 'Đang hoạt động' : 'Ngừng hoạt động'}
      sx={{
        bgcolor: location.isActive
          ? roomStatusColors.available.surface
          : roomStatusColors.unavailable.surface,
        color: location.isActive
          ? roomStatusColors.available.foreground
          : roomStatusColors.unavailable.foreground,
        fontSize: 12,
        height: 'auto',
        minHeight: 24,
        maxWidth: '100%',
        fontWeight: 600,
        '& .MuiChip-label': { whiteSpace: 'normal', py: 0.25 },
      }}
    />
  );
  const roomDetails = occupancy.isError ? (
    <Stack spacing={0.25} sx={{ alignItems: 'flex-start' }}>
      <Typography variant="caption" color="error.dark">
        Chưa tải được số liệu phòng.
      </Typography>
      <Button size="small" onClick={() => void occupancy.refetch()}>
        Thử lại
      </Button>
    </Stack>
  ) : snapshot ? (
    <Stack spacing={0.5} sx={{ fontVariantNumeric: 'tabular-nums' }}>
      <Typography
        variant="body2"
        component="div"
        sx={{ fontWeight: 750, lineHeight: 1.4, fontSize: 16 }}
      >
        <Box
          component={Link}
          to={`/locations/${location.id}/rooms`}
          sx={{
            color: 'text.primary',
            textDecoration: 'none',
            '&:hover': { textDecoration: 'underline' },
          }}
        >
          {snapshot.totalRooms} phòng
        </Box>
      </Typography>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          columnGap: 1.5,
          rowGap: 0.25,
        }}
      >
        {[
          { count: snapshot.occupiedRooms, label: 'thuê', color: roomStatusColors.occupied.fill },
          {
            count: snapshot.availableRooms,
            label: 'trống',
            color: roomStatusColors.available.fill,
          },
          {
            count: snapshot.onHoldRooms,
            label: 'giữ chỗ',
            color: roomStatusColors.onHold.foreground,
          },
          {
            count: snapshot.unavailableRooms,
            label: 'ngừng KT',
            color: roomStatusColors.unavailable.foreground,
          },
        ].map(({ count, label, color }) => (
          <Typography
            key={label}
            variant="caption"
            component="span"
            sx={{
              color: count ? color : roomStatusColors.unavailable.fill,
              whiteSpace: 'nowrap',
              fontWeight: count ? 650 : 400,
            }}
          >
            {count}{' '}
            {label === 'ngừng KT' ? (
              <Box component="abbr" title="ngừng khai thác" sx={{ textDecoration: 'none' }}>
                {label}
              </Box>
            ) : (
              label
            )}
          </Typography>
        ))}
      </Box>
    </Stack>
  ) : (
    <Typography variant="caption" color="text.secondary">
      Đang tải số liệu phòng…
    </Typography>
  );
  const setupDetails = metadata.isError ? (
    <Stack spacing={0.25} sx={{ alignItems: 'flex-start' }}>
      <Typography variant="caption" color="error.dark">
        Chưa tải được thông tin cấu hình.
      </Typography>
      <Button size="small" onClick={() => void metadata.refetch()}>
        Thử lại
      </Button>
    </Stack>
  ) : metadata.isPending ? (
    <Typography variant="caption" color="text.secondary">
      Đang tải thông tin cấu hình…
    </Typography>
  ) : info ? (
    <Box>
      <Typography variant="body2" sx={{ lineHeight: 1.4 }}>
        {info.code ? `${info.code} · ` : ''}
        {info.floors} tầng
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div">
        {info.setupStatus === 'Completed' ? 'Đã lưu thiết lập ban đầu' : 'Đã ghi nhận thông tin'}
      </Typography>
      {info.contactPhone && (
        <Typography variant="caption" color="text.secondary" component="div">
          Liên hệ: {info.contactPhone}
        </Typography>
      )}
    </Box>
  ) : (
    <Typography variant="caption" color="text.secondary">
      Chưa có dữ liệu thiết lập
    </Typography>
  );

  return (
    <TableRow hover role="row">
      <TableCell
        component="th"
        role="rowheader"
        scope="row"
        sx={{ width: { lg: '25%' }, minWidth: 0 }}
      >
        <Typography
          component={Link}
          to={`/locations/${location.id}/overview`}
          variant="body2"
          sx={{
            color: 'primary.dark',
            fontWeight: 750,
            fontSize: 16,
            lineHeight: 1.4,
            textDecoration: 'none',
            overflowWrap: 'anywhere',
            '&:hover': { textDecoration: 'underline' },
            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
          }}
        >
          {location.name}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          component="div"
          sx={{ overflowWrap: 'anywhere', mt: 0.5 }}
        >
          {location.address}
        </Typography>
      </TableCell>
      <TableCell role="cell" sx={{ width: { lg: '14%' }, alignSelf: { xs: 'start', lg: 'auto' } }}>
        {status}
      </TableCell>
      <TableCell role="cell" sx={{ ...fullRowCell, width: { lg: '27%' } }}>
        {roomDetails}
      </TableCell>
      {owner && (
        <TableCell role="cell" sx={{ ...fullRowCell, width: { lg: '18%' } }}>
          {setupDetails}
        </TableCell>
      )}
      <TableCell role="cell" align="right" sx={{ ...fullRowCell, width: { lg: 168 } }}>
        <Stack
          direction="row"
          spacing={0.5}
          sx={{
            justifyContent: 'flex-end',
            alignItems: 'center',
            flexWrap: { xs: 'wrap', lg: 'nowrap' },
          }}
        >
          <Button
            variant="outlined"
            component={Link}
            to={`/locations/${location.id}/overview`}
            sx={{ whiteSpace: 'nowrap', flexShrink: 0, minHeight: { xs: 44, sm: 36 } }}
          >
            Xem cơ sở
          </Button>
          {owner && (
            <>
              <IconButton
                aria-label={`Thao tác cho ${location.name}`}
                aria-haspopup="menu"
                aria-controls={menuAnchor ? menuId : undefined}
                aria-expanded={!!menuAnchor}
                onClick={(event) => setMenuAnchor(event.currentTarget)}
                sx={{
                  flexShrink: 0,
                  minWidth: { xs: 44, sm: 36 },
                  minHeight: { xs: 44, sm: 36 },
                }}
              >
                <MoreHorizontal size={18} />
              </IconButton>
              <Menu
                id={menuId}
                anchorEl={menuAnchor}
                open={!!menuAnchor}
                onClose={() => setMenuAnchor(null)}
              >
                <MenuItem
                  component={Link}
                  to={`/locations/${location.id}/settings`}
                  onClick={() => setMenuAnchor(null)}
                >
                  Sửa thông tin
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setMenuAnchor(null);
                    copy();
                  }}
                >
                  Sao chép cấu hình
                </MenuItem>
              </Menu>
            </>
          )}
        </Stack>
      </TableCell>
    </TableRow>
  );
}
