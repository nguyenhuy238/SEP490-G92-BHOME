import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  TablePagination,
  TextField,
  Typography,
} from '@mui/material';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import {
  formatBillingDecimal,
  type Policy,
  type Page,
} from '../../../../../../packages/client-core/src/invoices';
import { useInvoiceApi } from '../../invoices/useInvoiceApi';
import { PolicyForm, ScheduleForm } from '../../invoices/BillingConfigurationPage';
import { ErrorState, LoadingState } from '../../../components/common/PortalUI';
import { LocationSection, LocationEmpty } from '../components/LocationSection';
import { todayVietnam } from '../../staff/staffContracts';
import { EndPolicyDialog } from '../components/EndPolicyDialog';

export function LocationPricingWorkspace({ locationId }: { locationId: string }) {
  const api = useInvoiceApi();
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Policy | null | undefined>();
  const [editMode, setEditMode] = useState<'replace' | 'update'>('replace');
  const [detail, setDetail] = useState<Policy | null>(null);
  const [ending, setEnding] = useState<Policy | null>(null);
  const [notice, setNotice] = useState('');
  const policies = useQuery({
    queryKey: ['billing-policies', session?.userId, locationId, page, search, tab],
    queryFn: ({ signal }) =>
      api.request<Page<Policy>>(
        `/api/v1/billing-policies?${new URLSearchParams({ locationId, page: String(page + 1), pageSize: '20', ...(search ? { search } : {}), ...(tab === 0 ? { chargeCategory: '0' } : {}) })}`,
        { signal },
      ),
    enabled: tab !== 2,
  });
  const schedule = useQuery({
    queryKey: ['billing-schedule', session?.userId, locationId],
    queryFn: ({ signal }) => api.schedule(locationId, signal),
    enabled: tab === 2 && owner,
  });
  const rooms = useQuery({
    queryKey: ['property-setup', 'pricing-rooms', session?.userId, locationId],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>(
        `/api/v1/capture/locations/${encodeURIComponent(locationId)}/rooms`,
        { signal },
      ),
  });
  return (
    <LocationSection
      title="Giá thuê & biểu phí"
      description="Quản lý từng khoản thu theo phạm vi và ngày hiệu lực. Giá riêng của phòng được ưu tiên theo quy tắc backend; hợp đồng và hóa đơn đã chốt giữ nguyên lịch sử."
      actions={
        owner && tab !== 2 ? (
          <Button
            variant="contained"
            onClick={() => {
              setNotice('');
              setEditMode('replace');
              setEditing(null);
            }}
          >
            Thêm khoản thu
          </Button>
        ) : undefined
      }
    >
      {notice && (
        <Alert severity="success" onClose={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      <Paper variant="outlined">
        <Tabs
          value={tab}
          onChange={(_, value: number) => {
            setTab(value);
            setPage(0);
          }}
        >
          <Tab label="Giá thuê" />
          <Tab label="Tất cả khoản thu" />
          <Tab label="Lịch & quy tắc hóa đơn" />
        </Tabs>
      </Paper>
      {tab === 2 ? (
        !owner ? (
          <Alert severity="info">Chỉ Owner được quản lý lịch và quy tắc hóa đơn.</Alert>
        ) : schedule.isPending ? (
          <LoadingState />
        ) : schedule.error ? (
          <ErrorState error={schedule.error} retry={() => void schedule.refetch()} />
        ) : (
          <ScheduleForm
            key={schedule.data?.version ?? 0}
            location={locationId}
            current={schedule.data ?? undefined}
            onSaved={() => void schedule.refetch()}
          />
        )
      ) : (
        <>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" spacing={2}>
              <TextField
                fullWidth
                label="Tìm khoản thu"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
              <Button disabled={policies.isFetching} onClick={() => void policies.refetch()}>
                Làm mới
              </Button>
            </Stack>
          </Paper>
          {policies.isPending ? (
            <LoadingState />
          ) : policies.error ? (
            <ErrorState error={policies.error} retry={() => void policies.refetch()} />
          ) : (
            <Paper variant="outlined">
              {!policies.data.items.length ? (
                <LocationEmpty
                  title="Chưa có khoản thu phù hợp"
                  description="Thêm giá thuê hoặc các khoản phí có ngày hiệu lực rõ ràng."
                  action={owner ? 'Thêm khoản thu' : undefined}
                  onAction={() => {
                    setEditMode('replace');
                    setEditing(null);
                  }}
                />
              ) : (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        {['Khoản thu', 'Phạm vi', 'Đơn giá', 'Hiệu lực', 'Thao tác'].map(
                          (label) => (
                            <TableCell key={label}>{label}</TableCell>
                          ),
                        )}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {policies.data.items.map((policy) => (
                        <TableRow key={policy.id} hover>
                          <TableCell>
                            <Typography sx={{ fontWeight: 700 }}>{policy.name}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {policy.chargeCode}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              variant="outlined"
                              label={
                                policy.roomId
                                  ? (rooms.data?.find((room) => room.id === policy.roomId)?.label ??
                                    'Phòng riêng')
                                  : 'Toàn cơ sở'
                              }
                            />
                          </TableCell>
                          <TableCell>{formatBillingDecimal(policy.rate)} đ</TableCell>
                          <TableCell>
                            {policy.effectiveFrom.split('-').reverse().join('/')} →{' '}
                            {policy.effectiveTo?.split('-').reverse().join('/') ?? 'Không thời hạn'}
                          </TableCell>
                          <TableCell>
                            <Stack direction="row">
                              <Button onClick={() => setDetail(policy)}>Chi tiết</Button>
                              {owner && (
                                <>
                                  <Button
                                    onClick={() => {
                                      setEditMode('replace');
                                      setEditing(policy);
                                    }}
                                  >
                                    Tạo giá kế tiếp
                                  </Button>
                                  {policy.effectiveFrom > todayVietnam() && (
                                    <Button
                                      onClick={() => {
                                        setEditMode('update');
                                        setEditing(policy);
                                      }}
                                    >
                                      Sửa giá tương lai
                                    </Button>
                                  )}
                                </>
                              )}
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
              <TablePagination
                component="div"
                count={policies.data.totalCount}
                page={page}
                rowsPerPage={20}
                rowsPerPageOptions={[20]}
                onPageChange={(_, value) => setPage(value)}
              />
            </Paper>
          )}
        </>
      )}
      <Dialog
        open={editing !== undefined}
        onClose={() => {
          /* Explicit close inside the form protects an in-flight save. */
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {editing
            ? editMode === 'update'
              ? 'Chỉnh sửa giá tương lai'
              : 'Tạo phiên bản giá kế tiếp'
            : 'Thêm khoản thu'}
        </DialogTitle>
        <DialogContent>
          {editing !== undefined && (
            <PolicyForm
              key={editing?.id ?? 'new'}
              location={locationId}
              previous={editing}
              mode={editMode}
              defaultCategory={tab === 0 ? 0 : 1}
              onSaved={() => {
                setEditing(undefined);
                setNotice('Đã lưu khoản thu.');
                void policies.refetch();
              }}
              onCancel={() => setEditing(undefined)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!detail} onClose={() => setDetail(null)} fullWidth maxWidth="sm">
        <DialogTitle>{detail?.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography>Mã khoản thu: {detail?.chargeCode}</Typography>
            <Typography>Đơn giá: {detail && formatBillingDecimal(detail.rate)} đ</Typography>
            <Typography>Phiên bản: {detail?.version}</Typography>
            <Typography>
              Ngày hiệu lực: {detail?.effectiveFrom} – {detail?.effectiveTo ?? 'Không thời hạn'}
            </Typography>
            <Alert severity="info">
              Khi thay đổi giá, tạo phiên bản kế tiếp để bảo toàn lịch sử áp dụng.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          {owner && detail && (
            <Button
              color="warning"
              onClick={() => {
                setEnding(detail);
                setDetail(null);
              }}
            >
              Kết thúc áp dụng
            </Button>
          )}
          <Button onClick={() => setDetail(null)}>Đóng</Button>
        </DialogActions>
      </Dialog>
      {ending && <EndPolicyDialog policy={ending} close={() => setEnding(null)} />}
    </LocationSection>
  );
}
