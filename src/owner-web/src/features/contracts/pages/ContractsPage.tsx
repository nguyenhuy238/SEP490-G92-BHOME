import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Drawer,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  LinearProgress,
  MenuItem,
  Pagination,
  Paper,
  Stack,
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
import {
  PageHeader,
  FilterToolbar,
  StatusChip,
  LoadingState,
  ErrorState,
} from '../../../components/common/PortalUI';
import { OwnerTable } from '../../../components/common/OwnerWorkspace';
import { isMockMode } from '../../../services/config';
import { useContractsApi } from '../useContractsApi';
import { ContractDraftDialog } from '../ContractDraftDialog';
import { ContractDetailPanel } from '../ContractDetailPanel';
import { ContractConfigurationPanel } from '../ContractWorkflowPanel';
import { MainDraftSettingsPanel } from '../MainDraftSettingsPanel';
import { MainDraftDetailPanel } from '../MainDraftDetailPanel';

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
  const [deepParams] = useSearchParams();
  const api = useContractsApi();
  const { session } = useAuth();
  const actorId = session?.userId ?? '';
  const [page, setPage] = useState(1),
    [status, setStatus] = useState(''),
    [location, setLocation] = useState(deepParams.get('locationId') ?? '');
  const [selected, setSelected] = useState(deepParams.get('contractId') ?? ''),
    [selectedLocation, setSelectedLocation] = useState('');
  const [mainDraft, setMainDraft] = useState(false);
  const [holding, setHolding] = useState(false);
  const [settings, setSettings] = useState(false);
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
  const reminders = useQuery({
    queryKey: ['contract-expiry-reminders', actorId],
    queryFn: ({ signal }) => api.expiryReminders(signal),
  });
  return (
    <>
      <PageHeader
        title="Hợp đồng thuê"
        actions={
          <>
            <Button onClick={() => setSettings(true)}>Cấu hình hợp đồng</Button>
            <Button
              variant="contained"
              onClick={() => {
                setHolding(false);
                setDraft(true);
              }}
            >
              Tạo hợp đồng thuê
            </Button>
            <Button
              variant="outlined"
              onClick={() => {
                setHolding(true);
                setDraft(true);
              }}
            >
              Tạo hợp đồng giữ chỗ
            </Button>
          </>
        }
      />
      <Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack
            direction="row"
            useFlexGap
            spacing={1}
            sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
          >
            <Typography variant="h2" component="h2">
              Nhắc gia hạn / trả phòng
            </Typography>
            <Button onClick={() => void reminders.refetch()} disabled={reminders.isFetching}>
              Tải lại nhắc hết hạn
            </Button>
          </Stack>
          {reminders.isPending ? (
            <LinearProgress aria-label="Đang tải nhắc hết hạn" />
          ) : reminders.error ? (
            <Alert severity="error">{contractError(reminders.error)}</Alert>
          ) : reminders.data?.length ? (
            <Stack spacing={0.75} sx={{ mt: 1 }}>
              {reminders.data.map((n) => (
                <Stack
                  key={n.id}
                  direction={{ xs: 'column', sm: 'row' }}
                  useFlexGap
                  spacing={1}
                  sx={{
                    alignItems: { sm: 'center' },
                    justifyContent: 'space-between',
                    borderTop: '1px solid',
                    borderColor: 'divider',
                    pt: 0.75,
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}>
                      Phòng {n.roomNumber} · {n.locationName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {n.stage === 'Expired' ? 'Đã hết hạn' : 'Sắp hết hạn'}{' '}
                      {displayContractDate(n.endDate)} · Cần gia hạn hoặc xử lý trả phòng.
                    </Typography>
                  </Box>
                  <Button
                    onClick={() => {
                      setSelected(n.contractId);
                      setMainDraft(false);
                      setSelectedLocation('');
                    }}
                    sx={{ flexShrink: 0 }}
                  >
                    Mở hợp đồng
                  </Button>
                </Stack>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Chưa có nhắc hết hạn đã được xử lý.
            </Typography>
          )}
        </Paper>
        <FilterToolbar>
          <TextField
            select
            label="Cơ sở của hợp đồng"
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              setPage(1);
            }}
            sx={{ maxWidth: { sm: 220 } }}
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
            sx={{ maxWidth: { sm: 200 } }}
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
        </FilterToolbar>
        {locations.error && (
          <Alert severity="warning">
            Chưa tải được bộ lọc cơ sở.{' '}
            <Button onClick={() => void locations.refetch()}>Thử lại</Button>
          </Alert>
        )}
        {list.error ? (
          <ErrorState
            error={new Error(contractError(list.error))}
            retry={() => void list.refetch()}
          />
        ) : list.isPending ? (
          <LoadingState />
        ) : (
          <Paper variant="outlined" sx={{ minWidth: 0 }}>
            {list.data?.items.length ? (
              <OwnerTable
                label="Danh sách hợp đồng"
                rows={list.data.items}
                id={(c) => c.id}
                loading={list.isFetching}
                selectLabel="Chi tiết"
                select={(c) => {
                  setSelected(c.id);
                  setMainDraft(!!c.onboardingDraft);
                  setSelectedLocation(c.locationId);
                }}
                columns={[
                  {
                    label: 'Phòng / Cơ sở',
                    render: (c) => (
                      <>
                        <Typography sx={{ fontWeight: 650 }}>Phòng {c.roomNumber}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {c.locationName}
                        </Typography>
                      </>
                    ),
                  },
                  {
                    label: 'Loại / Trạng thái',
                    render: (c) => (
                      <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                        <Typography variant="caption">{text(c.kind)}</Typography>
                        <StatusChip label={text(c.status)} />
                      </Stack>
                    ),
                  },
                  {
                    label: 'Kỳ thuê',
                    render: (c) =>
                      `${displayContractDate(c.startDate)} – ${displayContractDate(c.endDate)}`,
                  },
                  {
                    label: 'Tiền thuê tháng',
                    render: (c) => (
                      <Typography sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>
                        {formatContractMoney(c.monthlyRent)}
                      </Typography>
                    ),
                  },
                ]}
              />
            ) : (
              <Typography role="status" sx={{ p: 2, textAlign: 'center' }}>
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
            sx={{ maxWidth: { sm: 360 }, minWidth: 0 }}
          />
          <Button
            onClick={() => {
              try {
                guid(lookup);
                setLookupError('');
                setSelected(lookup);
                setMainDraft(false);
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
      <Dialog
        open={settings}
        onClose={() => setSettings(false)}
        maxWidth="md"
        fullWidth
        aria-labelledby="contract-settings-title"
      >
        <DialogTitle id="contract-settings-title">Cấu hình mẫu và quy trình hợp đồng</DialogTitle>
        <DialogContent>
          {settings && (
            <Stack spacing={2}>
              <MainDraftSettingsPanel api={api} />
              <ContractConfigurationPanel api={api} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettings(false)}>Đóng cấu hình</Button>
        </DialogActions>
      </Dialog>
      <Drawer
        anchor="right"
        open={!!selected}
        onClose={() => {
          setSelected('');
          setMainDraft(false);
        }}
        slotProps={{ paper: { sx: { width: { xs: '100%', md: 760 }, maxWidth: '100%' } } }}
      >
        <Box sx={{ p: { xs: 1.5, sm: 2 }, minWidth: 0, overflowWrap: 'anywhere' }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 2 }}>
            <Typography component="h2" variant="h5">
              Chi tiết hợp đồng
            </Typography>
            <Button
              onClick={() => {
                setSelected('');
                setMainDraft(false);
              }}
            >
              Đóng
            </Button>
          </Stack>
          {selected && mainDraft ? (
            <MainDraftDetailPanel
              key={selected}
              id={selected}
              onChanged={() => void list.refetch()}
              onReleased={() => {
                setMainDraft(false);
                void list.refetch();
              }}
            />
          ) : (
            selected && (
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
            )
          )}
        </Box>
      </Drawer>
      {draft && (
        <ContractDraftDialog
          kind={holding ? 'Holding' : 'Main'}
          api={api}
          ownerId={actorId}
          onClose={() => setDraft(false)}
          onCreated={(id) => {
            setDraft(false);
            setSelected(id);
            setMainDraft(false);
            setSelectedLocation('');
            void list.refetch();
          }}
        />
      )}
    </>
  );
}
