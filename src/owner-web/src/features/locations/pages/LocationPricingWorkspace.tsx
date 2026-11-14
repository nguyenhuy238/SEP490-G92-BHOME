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
import { OwnerTable } from '../../../components/common/OwnerWorkspace';
import { LocationEmpty } from '../components/LocationSection';
import { todayVietnam } from '../../staff/staffContracts';
import { EndPolicyDialog } from '../components/EndPolicyDialog';
import { UtilityWorkspace } from '../../property/UtilityWorkspace';

type ScopedPolicy = Policy & { firstUsedAt?: string | null; roomTypeId?: string | null };

// Only the known corrupted reserved RENT label is normalized for presentation.
// User-defined names and the API record itself remain untouched.
function policyName(policy: Policy) {
  return policy.category === 0 && policy.chargeCode === 'RENT' && policy.name === 'Gi? thu? ph?ng'
    ? 'Giá thuê phòng'
    : policy.name;
}

function withDisplayName(policy: ScopedPolicy) {
  const name = policyName(policy);
  return name === policy.name ? policy : { ...policy, name };
}

function policyUnit(policy: Policy) {
  if (policy.method === 2) return 'người/tháng';
  if (policy.method === 1) return policy.category === 2 ? 'm³' : 'kWh';
  return 'phòng/tháng';
}

function policyStatus(policy: Policy, today: string) {
  if (policy.effectiveTo && policy.effectiveTo < today) return 'Đã kết thúc';
  if (policy.effectiveFrom > today) return 'Sắp áp dụng';
  return 'Đang hiệu lực';
}

function dateLabel(date: string | null | undefined) {
  return date?.split('-').reverse().join('/') ?? 'Không thời hạn';
}

function policySearch(search: string, category: number) {
  const value = search.trim();
  if (category !== 0) return value;
  // The server stores generated room names as "Rent <number>" and searches
  // the stored name/code. Searching the Vietnamese display label must still
  // find these records before server-side pagination.
  const match = /^giá thuê(?:\s+(.*))?$/iu.exec(value);
  if (!match) return value;
  return !match[1] || match[1].toLocaleLowerCase('vi') === 'phòng' ? 'RENT' : match[1];
}

export function LocationPricingWorkspace({
  locationId,
  initialTab = 0,
}: {
  locationId: string;
  initialTab?: number;
}) {
  const api = useInvoiceApi();
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const [tab, setTab] = useState(initialTab);
  const [utilityMode, setUtilityMode] = useState('workspace');
  const [effectiveOnly, setEffectiveOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<ScopedPolicy | null | undefined>();
  const [editMode, setEditMode] = useState<'replace' | 'update'>('replace');
  const [detail, setDetail] = useState<ScopedPolicy | null>(null);
  const [ending, setEnding] = useState<Policy | null>(null);
  const [notice, setNotice] = useState('');
  const today = todayVietnam();
  const showPolicies = tab === 0 || tab === 1 || (tab === 3 && utilityMode !== 'workspace');
  const category = tab === 0 ? 0 : tab === 1 ? 3 : utilityMode === 'water' ? 2 : 1;
  const searchValue = policySearch(search, category);
  const policies = useQuery({
    queryKey: [
      'billing-policies',
      session?.userId,
      locationId,
      page,
      search,
      category,
      effectiveOnly,
      today,
    ],
    queryFn: ({ signal }) =>
      api.request<Page<ScopedPolicy>>(
        `/api/v1/billing-policies?${new URLSearchParams({ locationId, page: String(page + 1), pageSize: '20', chargeCategory: String(category), ...(searchValue ? { search: searchValue } : {}), ...(effectiveOnly ? { effectiveOn: today } : {}) })}`,
        { signal },
      ),
    enabled: showPolicies,
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
    enabled: showPolicies,
  });
  function scopeLabel(policy: ScopedPolicy) {
    if (policy.roomId)
      return rooms.data?.find((room) => room.id === policy.roomId)?.label ?? 'Phòng riêng';
    if (policy.roomTypeId) return 'Loại phòng (cấu hình cũ)';
    return 'Toàn cơ sở';
  }
  function listPolicyName(policy: ScopedPolicy) {
    // Translate the exact generated room-rent label only. Keep custom names and
    // the persisted name used by the editor, including historical room labels.
    const roomLabel = policy.roomId && rooms.data?.find((room) => room.id === policy.roomId)?.label;
    if (
      policy.category === 0 &&
      policy.chargeCode === 'RENT' &&
      roomLabel &&
      policy.name === `Rent ${roomLabel}`
    )
      return `Giá thuê ${roomLabel}`;
    return policyName(policy);
  }
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Typography component="h2" variant="h2">
          Giá thuê & biểu phí
        </Typography>
        {owner && showPolicies && (
          <Button
            variant="contained"
            sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'center' } }}
            onClick={() => {
              setNotice('');
              setEditMode('replace');
              setEditing(null);
            }}
          >
            Thêm khoản thu
          </Button>
        )}
      </Stack>
      {notice && (
        <Alert severity="success" onClose={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      <Tabs
        aria-label="Nhóm cấu hình giá phí"
        value={tab}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{
          borderBottom: '1px solid',
          borderColor: 'divider',
          '& .MuiTab-root': { minHeight: 44 },
        }}
        onChange={(_, value: number) => {
          setTab(value);
          setPage(0);
          setSearch('');
          setEffectiveOnly(false);
        }}
      >
        <Tab label="Giá thuê" />
        <Tab label="Phí dịch vụ" />
        <Tab label="Lịch & quy tắc hóa đơn" />
        <Tab label="Điện & nước" />
      </Tabs>
      {tab === 3 && (
        <Tabs
          aria-label="Nhóm điện nước"
          value={utilityMode}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
          onChange={(_, value: string) => {
            setUtilityMode(value);
            setPage(0);
            setSearch('');
            setEffectiveOnly(false);
          }}
        >
          <Tab value="workspace" label="Thiết lập & vận hành" />
          <Tab value="electricity" label="Đơn giá điện trực tiếp" />
          <Tab value="water" label="Đơn giá nước trực tiếp" />
        </Tabs>
      )}
      {tab === 3 && utilityMode === 'workspace' ? (
        <UtilityWorkspace locationId={locationId} />
      ) : tab === 2 ? (
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
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1.5}
              sx={{ alignItems: { md: 'center' }, minWidth: 0 }}
            >
              <TextField
                size="small"
                label="Tìm khoản thu"
                sx={{
                  width: { xs: '100%', md: 360 },
                  maxWidth: '100%',
                  flex: { md: '0 1 360px' },
                  minWidth: 0,
                }}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
              <TextField
                select
                size="small"
                label="Hiệu lực"
                value={effectiveOnly ? 'current' : 'all'}
                onChange={(e) => {
                  setEffectiveOnly(e.target.value === 'current');
                  setPage(0);
                }}
                sx={{ width: { xs: '100%', md: 180 }, flexShrink: 0 }}
                slotProps={{ select: { native: true } }}
              >
                <option value="all">Tất cả</option>
                <option value="current">Đang hiệu lực</option>
              </TextField>
              <Button
                sx={{
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  alignSelf: { xs: 'flex-start', md: 'center' },
                }}
                disabled={policies.isFetching}
                onClick={() => void policies.refetch()}
              >
                Làm mới
              </Button>
            </Stack>
          </Paper>
          {rooms.error && (
            <Alert
              severity="warning"
              action={<Button onClick={() => void rooms.refetch()}>Thử lại</Button>}
            >
              Chưa tải được tên phòng. Đơn giá vẫn được hiển thị theo phạm vi đã lưu.
            </Alert>
          )}
          {policies.isPending ? (
            <LoadingState />
          ) : policies.error ? (
            <ErrorState error={policies.error} retry={() => void policies.refetch()} />
          ) : (
            <Paper
              variant="outlined"
              sx={{
                '& .MuiTableBody-root .MuiTableCell-root': {
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  py: 1.25,
                },
                '& .MuiTableBody-root > .MuiTableRow-root:last-child .MuiTableCell-root': {
                  borderBottom: 0,
                },
              }}
            >
              {!policies.data.items.length ? (
                <LocationEmpty
                  title="Chưa có khoản thu phù hợp"
                  description={
                    search || effectiveOnly
                      ? 'Thử thay đổi bộ lọc hoặc chọn Tất cả.'
                      : 'Thêm khoản thu có ngày hiệu lực rõ ràng.'
                  }
                />
              ) : (
                <OwnerTable
                  label="Biểu phí theo cơ sở"
                  rows={policies.data.items}
                  id={(policy) => policy.id}
                  columns={[
                    {
                      label: 'Khoản thu',
                      render: (policy) => (
                        <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                          {listPolicyName(policy)}
                        </Typography>
                      ),
                    },
                    {
                      label: 'Phạm vi',
                      render: (policy) => (
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
                        >
                          {scopeLabel(policy)}
                        </Typography>
                      ),
                    },
                    {
                      label: 'Đơn giá',
                      render: (policy) => (
                        <>
                          <Typography
                            sx={{
                              fontWeight: 750,
                              fontSize: 16,
                              fontVariantNumeric: 'tabular-nums',
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {formatBillingDecimal(policy.rate)} đ
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block' }}
                          >
                            /{policyUnit(policy)}
                          </Typography>
                        </>
                      ),
                    },
                    {
                      label: 'Hiệu lực',
                      render: (policy) => (
                        <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                          <Chip
                            size="small"
                            variant="outlined"
                            color={
                              policyStatus(policy, today) === 'Đang hiệu lực'
                                ? 'success'
                                : 'default'
                            }
                            label={policyStatus(policy, today)}
                          />
                          <Typography
                            variant="body2"
                            sx={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}
                          >
                            {dateLabel(policy.effectiveFrom)} → {dateLabel(policy.effectiveTo)}
                          </Typography>
                        </Stack>
                      ),
                    },
                    {
                      label: 'Thao tác',
                      render: (policy) => (
                        <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                          <Button onClick={() => setDetail(policy)}>Chi tiết</Button>
                          {owner &&
                            !policy.roomTypeId &&
                            policyStatus(policy, today) !== 'Đã kết thúc' && (
                              <>
                                <Button
                                  onClick={() => {
                                    setEditMode('replace');
                                    setEditing(policy);
                                  }}
                                >
                                  Tạo giá kế tiếp
                                </Button>
                                {policy.effectiveFrom > today && !policy.firstUsedAt && (
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
                      ),
                    },
                  ]}
                />
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
          <Alert severity="info" sx={{ mb: 1.5 }}>
            {editing
              ? editMode === 'update'
                ? 'Chỉ sửa được giá tương lai chưa sử dụng. Hợp đồng và hóa đơn đã chốt giữ nguyên lịch sử.'
                : 'Giá kế tiếp áp dụng từ ngày đã chọn. Hợp đồng và hóa đơn đã chốt giữ nguyên lịch sử.'
              : 'Giá thuê dùng để tham khảo cho thỏa thuận mới. Hợp đồng và hóa đơn đã chốt giữ nguyên lịch sử.'}
          </Alert>
          {editing !== undefined && (
            <PolicyForm
              key={editing?.id ?? 'new'}
              location={locationId}
              previous={editing ? withDisplayName(editing) : null}
              mode={editMode}
              defaultCategory={category}
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
        <DialogTitle>{detail && policyName(detail)}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography>Mã khoản thu: {detail?.chargeCode}</Typography>
            <Typography>Phạm vi: {detail && scopeLabel(detail)}</Typography>
            <Typography>
              Đơn giá: {detail && formatBillingDecimal(detail.rate)} đ/
              {detail && policyUnit(detail)}
            </Typography>
            <Typography>Phiên bản: {detail?.version}</Typography>
            <Typography>
              Ngày hiệu lực: {dateLabel(detail?.effectiveFrom)} – {dateLabel(detail?.effectiveTo)}
            </Typography>
            {detail && <Typography>Trạng thái: {policyStatus(detail, today)}</Typography>}
            {detail?.firstUsedAt && (
              <Typography variant="body2" color="text.secondary">
                Đã được sử dụng; không thể sửa trực tiếp phiên bản này.
              </Typography>
            )}
            {detail?.roomTypeId && (
              <Alert severity="info">
                Đây là giá thuộc loại phòng cũ. Không thể sửa hoặc tạo giá kế tiếp bằng biểu mẫu chỉ
                hỗ trợ phạm vi cơ sở/phòng.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          {owner &&
            detail &&
            !detail.roomTypeId &&
            policyStatus(detail, today) !== 'Đã kết thúc' && (
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
      {ending && <EndPolicyDialog policy={withDisplayName(ending)} close={() => setEnding(null)} />}
    </Stack>
  );
}
