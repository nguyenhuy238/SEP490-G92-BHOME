import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Drawer,
  LinearProgress,
  MenuItem,
  Pagination,
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
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import {
  contractError,
  contractStates,
  displayContractDate,
  formatContractMoney,
  guid,
  text,
} from '../../../../../../packages/client-core/src/contracts';
import { ResourcePage } from '../../../components/common/ResourcePage';
import { PageHeader, StatusChip } from '../../../components/common/PortalUI';
import { isMockMode } from '../../../services/config';
import { useContractsApi } from '../useContractsApi';
import { ContractDraftDialog } from '../ContractDraftDialog';
import { ContractDetailPanel } from '../ContractDetailPanel';

export default function ContractsPage() {
  return isMockMode ? (
    <>
      <Alert severity="info" sx={{ mb: 2 }}>
        Dữ liệu minh họa. Luồng ký, kích hoạt và trả phòng được kết nối trong chế độ API.
      </Alert>
      <ResourcePage kind="contracts" variant="table" />
    </>
  ) : (
    <LiveContractsPage />
  );
}
function LiveContractsPage() {
  const api = useContractsApi();
  const { session } = useAuth();
  const actorId = session?.userId ?? '';
  const [page, setPage] = useState(1),
    [status, setStatus] = useState(''),
    [location, setLocation] = useState('');
  const [selected, setSelected] = useState(''),
    [selectedLocation, setSelectedLocation] = useState('');
  const [draft, setDraft] = useState(false),
    [lookup, setLookup] = useState(''),
    [lookupError, setLookupError] = useState('');
  const locations = useQuery({
    queryKey: ['contract-locations', actorId],
    queryFn: ({ signal }) => api.locations(signal),
  });
  const list = useQuery({
    queryKey: ['contracts', actorId, page, status, location],
    queryFn: ({ signal }) => api.list(page, status, location, signal),
  });
  return (
    <>
      <PageHeader
        title="Hợp đồng thuê & Vòng đời"
        subtitle="UC-15 / UC-16 / UC-19 · Nháp → Ký điện tử → Xác minh cọc → Kích hoạt → Gia hạn / Trả phòng"
        actions={
          <Button variant="contained" onClick={() => setDraft(true)}>
            Tạo hợp đồng thuê
          </Button>
        }
      />
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label="Cơ sở của hợp đồng"
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              setPage(1);
            }}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="">Tất cả cơ sở</MenuItem>
            {(locations.data ?? []).map((o) => (
              <MenuItem key={o.id} value={o.id}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Trạng thái hợp đồng"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">Tất cả trạng thái</MenuItem>
            {contractStates.map((s) => (
              <MenuItem key={s} value={s}>
                {text(s)}
              </MenuItem>
            ))}
          </TextField>
          <Button disabled={list.isFetching} onClick={() => void list.refetch()}>
            Tải lại danh sách
          </Button>
        </Stack>
        {locations.error && (
          <Alert severity="warning">
            Chưa tải được bộ lọc cơ sở.{' '}
            <Button onClick={() => void locations.refetch()}>Thử lại</Button>
          </Alert>
        )}
        {list.isFetching && <LinearProgress aria-label="Đang tải danh sách hợp đồng" />}
        {list.error ? (
          <Alert severity="error">{contractError(list.error)}</Alert>
        ) : (
          <Paper variant="outlined">
            <TableContainer>
              <Table aria-label="Danh sách hợp đồng">
                <TableHead>
                  <TableRow>
                    {[
                      'Phòng / Cơ sở',
                      'Loại / Trạng thái',
                      'Kỳ thuê',
                      'Tiền thuê tháng',
                      'Thao tác',
                    ].map((h) => (
                      <TableCell key={h}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(list.data?.items ?? []).map((c) => (
                    <TableRow key={c.id} hover>
                      <TableCell>
                        <Typography sx={{ fontWeight: 600 }}>Phòng {c.roomNumber}</Typography>
                        <Typography variant="caption">{c.locationName}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption">{text(c.kind)}</Typography>
                        <br />
                        <StatusChip label={text(c.status)} />
                      </TableCell>
                      <TableCell>
                        {displayContractDate(c.startDate)} – {displayContractDate(c.endDate)}
                      </TableCell>
                      <TableCell>{formatContractMoney(c.monthlyRent)}</TableCell>
                      <TableCell>
                        <Button
                          disabled={list.isFetching}
                          onClick={() => {
                            setSelected(c.id);
                            setSelectedLocation(c.locationId);
                          }}
                        >
                          Chi tiết
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {!list.isFetching && !list.data?.items.length && (
              <Typography role="status" sx={{ p: 3, textAlign: 'center' }}>
                Chưa có hợp đồng phù hợp. Tạo bản nháp hoặc đổi bộ lọc.
              </Typography>
            )}
          </Paper>
        )}
        {list.data && (
          <Stack direction="row" sx={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="body2">
              {list.data.totalCount} hợp đồng trong phạm vi truy cập
            </Typography>
            <Pagination
              count={Math.max(1, Math.ceil(list.data.totalCount / 20))}
              page={page}
              disabled={list.isFetching}
              onChange={(_, p) => setPage(p)}
            />
          </Stack>
        )}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            label="Mở bằng UUID hợp đồng"
            value={lookup}
            onChange={(e) => setLookup(e.target.value.trim())}
            size="small"
            sx={{ minWidth: 320 }}
          />
          <Button
            onClick={() => {
              try {
                guid(lookup);
                setLookupError('');
                setSelected(lookup);
                setSelectedLocation('');
              } catch (e) {
                setLookupError((e as Error).message);
              }
            }}
          >
            Mở hợp đồng
          </Button>
        </Stack>
        {!!lookupError && <Alert severity="error">{lookupError}</Alert>}
      </Stack>
      <Drawer
        anchor="right"
        open={!!selected}
        onClose={() => setSelected('')}
        slotProps={{ paper: { sx: { width: { xs: '100%', md: 760 }, maxWidth: '100%' } } }}
      >
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 2 }}>
            <Typography component="h2" variant="h5">
              Chi tiết hợp đồng
            </Typography>
            <Button onClick={() => setSelected('')}>Đóng</Button>
          </Stack>
          {selected && (
            <ContractDetailPanel
              key={selected}
              api={api}
              id={selected}
              actorId={actorId}
              locationId={selectedLocation}
              onChanged={(next) => {
                void list.refetch();
                if (next) {
                  setSelected(next);
                  setSelectedLocation('');
                }
              }}
            />
          )}
        </Box>
      </Drawer>
      {draft && (
        <ContractDraftDialog
          api={api}
          ownerId={actorId}
          onClose={() => setDraft(false)}
          onCreated={(id) => {
            setDraft(false);
            setSelected(id);
            setSelectedLocation('');
            void list.refetch();
          }}
        />
      )}
    </>
  );
}
