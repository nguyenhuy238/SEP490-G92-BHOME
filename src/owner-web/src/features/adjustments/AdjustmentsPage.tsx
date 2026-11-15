import { MoneyField } from '../../components/common/MoneyField';
import { useRef, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ChevronDown, ClipboardCheck, ListFilter, RefreshCw, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  adjustmentError,
  adjustmentStatus,
  signedVnd,
  type Adjustment,
  type AdjustmentDecisionInput,
  type AdjustmentFinancials,
} from '../../../../../packages/client-core/src/adjustments';
import { formatContractMoney, vnd } from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { PageHeader, FilterToolbar, StatusChip } from '../../components/common/PortalUI';
import { PrivateEvidenceViewer } from '../../components/common/PrivateEvidenceViewer';
import { OwnerTable, OwnerPagination } from '../../components/common/OwnerWorkspace';
import { useAdjustmentApi } from './useAdjustmentApi';
import { isMockMode } from '../../services/config';

export default function AdjustmentsPage() {
  const [params] = useSearchParams();
  return (
    <>
      <PageHeader
        title="Điều chỉnh hóa đơn"
        subtitle="Xem yêu cầu của khách thuê, đối chiếu hóa đơn và bằng chứng trước khi quyết định."
      />
      {isMockMode ? (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{ gap: 1.5, alignItems: { sm: 'center' } }}
        >
          <Alert severity="info" sx={{ flex: 1 }}>
            Chưa có yêu cầu điều chỉnh thực tế trong chế độ demo. Việc duyệt hoặc từ chối yêu cầu
            chỉ thực hiện khi kết nối API.
          </Alert>
          <Button component={RouterLink} to="/invoices" variant="outlined" sx={{ flexShrink: 0 }}>
            Xem danh sách hóa đơn demo
          </Button>
        </Stack>
      ) : (
        <OwnerAdjustmentList
          invoiceId={params.get('invoiceId') ?? ''}
          requestId={params.get('requestId') ?? ''}
        />
      )}
    </>
  );
}
export function OwnerAdjustmentList({
  invoiceId = '',
  requestId = '',
}: {
  invoiceId?: string;
  requestId?: string;
}) {
  const api = useAdjustmentApi(),
    { session } = useAuth();
  const actor = session?.userId ?? '';
  const [location, setLocation] = useState(''),
    [room, setRoom] = useState(''),
    [invoice, setInvoice] = useState(invoiceId),
    [status, setStatus] = useState('Pending'),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(requestId);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const hasAdvancedFilters = Boolean(location || room || (!invoiceId && invoice));
  const hasScopeFilter = hasAdvancedFilters || Boolean(invoiceId);
  const statusOptions = [
    { value: 'Pending', label: 'Chờ duyệt' },
    { value: '', label: 'Tất cả' },
    { value: 'Approved', label: 'Đã duyệt' },
    { value: 'Rejected', label: 'Đã từ chối' },
  ];
  const changeStatus = (next: string) => {
    setStatus(next);
    setPage(1);
  };
  const clearAdvancedFilters = () => {
    setLocation('');
    setRoom('');
    if (!invoiceId) setInvoice('');
    setPage(1);
  };
  const filter = { page, locationId: location, roomId: room, invoiceId: invoice, status };
  const list = useQuery({
    queryKey: ['adjustments', actor, filter],
    queryFn: ({ signal }) => api.list(filter, signal),
  });
  const locations = useQuery({
    queryKey: ['adjustment-locations', actor],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>('/api/v1/capture/locations', { signal }),
  });
  const rooms = useQuery({
    queryKey: ['adjustment-rooms', actor, location],
    enabled: !!location,
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>(`/api/v1/capture/locations/${location}/rooms`, {
        signal,
      }),
  });
  return (
    <Stack spacing={2}>
      <Paper
        component="section"
        variant="outlined"
        aria-label="Hàng đợi điều chỉnh hóa đơn"
        sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2, minWidth: 0 }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          useFlexGap
          sx={{
            alignItems: { sm: 'center' },
            justifyContent: 'space-between',
            gap: 1.5,
            mb: 2,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
              Yêu cầu cần xem xét
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              aria-live="polite"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {list.isPending
                ? 'Đang tải danh sách yêu cầu…'
                : list.error
                  ? 'Chưa tải được số lượng yêu cầu'
                  : `${list.data?.totalCount ?? 0} yêu cầu ${status === 'Pending' ? 'chờ duyệt' : 'theo trạng thái đã chọn'}`}
              {hasScopeFilter ? ' · Đang áp dụng phạm vi lọc' : ' · Tất cả cơ sở'}
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshCw size={16} />}
            disabled={list.isFetching}
            onClick={() => void list.refetch()}
            sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }}
          >
            Làm mới danh sách
          </Button>
        </Stack>
        <Stack
          direction="row"
          useFlexGap
          role="group"
          aria-label="Trạng thái yêu cầu"
          sx={{ gap: 1, flexWrap: 'wrap', mb: 1.5 }}
        >
          {statusOptions.map((option) => (
            <Button
              key={option.value}
              size="small"
              variant={status === option.value ? 'contained' : 'outlined'}
              color={status === option.value ? 'primary' : 'inherit'}
              aria-pressed={status === option.value}
              onClick={() => changeStatus(option.value)}
              sx={{ minHeight: { xs: 44, sm: 36 }, borderRadius: 2, textTransform: 'none' }}
            >
              {option.label}
              {status === option.value && list.data && !list.error
                ? ` · ${list.data.totalCount}`
                : ''}
            </Button>
          ))}
        </Stack>
        <Stack
          direction="row"
          useFlexGap
          sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}
        >
          <Typography variant="caption" color="text.secondary">
            {status === 'Pending'
              ? 'Ưu tiên kiểm tra yêu cầu chưa có quyết định.'
              : status === ''
                ? 'Đang xem tất cả trạng thái yêu cầu.'
                : status === 'Approved'
                  ? 'Các yêu cầu đã được Owner phê duyệt.'
                  : 'Các yêu cầu đã được Owner từ chối.'}
          </Typography>
          <Stack direction="row" useFlexGap sx={{ gap: 1, alignItems: 'center' }}>
            {hasAdvancedFilters && (
              <Button size="small" onClick={clearAdvancedFilters}>
                Xóa bộ lọc
              </Button>
            )}
            <Button
              size="small"
              variant="outlined"
              startIcon={<ListFilter size={16} />}
              aria-expanded={filtersExpanded}
              aria-controls="adjustment-advanced-filters"
              onClick={() => setFiltersExpanded((value) => !value)}
            >
              {filtersExpanded ? 'Ẩn bộ lọc' : 'Lọc theo cơ sở, phòng'}
            </Button>
          </Stack>
        </Stack>
        <Collapse in={filtersExpanded}>
          <Box
            id="adjustment-advanced-filters"
            sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}
          >
            <FilterToolbar>
              <TextField
                size="small"
                select
                label="Cơ sở"
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  setRoom('');
                  setPage(1);
                }}
                sx={{ minWidth: 170 }}
              >
                <MenuItem value="">Tất cả cơ sở</MenuItem>
                {locations.data?.map((x) => (
                  <MenuItem key={x.id} value={x.id}>
                    {x.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                select
                label="Phòng"
                value={room}
                disabled={!location}
                onChange={(e) => {
                  setRoom(e.target.value);
                  setPage(1);
                }}
                sx={{ minWidth: 170 }}
              >
                <MenuItem value="">Tất cả phòng</MenuItem>
                {rooms.data?.map((x) => (
                  <MenuItem key={x.id} value={x.id}>
                    {x.label}
                  </MenuItem>
                ))}
              </TextField>
              {!invoiceId && (
                <TextField
                  size="small"
                  label="Mã hóa đơn (nếu có)"
                  value={invoice}
                  onChange={(e) => {
                    setInvoice(e.target.value);
                    setPage(1);
                  }}
                  helperText="Dùng mã ID hóa đơn để tra cứu chính xác."
                />
              )}
            </FilterToolbar>
            {invoiceId && (
              <Typography variant="caption" color="text.secondary">
                Danh sách đang giới hạn theo hóa đơn được mở từ liên kết.
              </Typography>
            )}
            {(locations.error || rooms.error) && (
              <Alert
                severity="error"
                sx={{ mt: 1 }}
                action={
                  <Button
                    onClick={() => {
                      void locations.refetch();
                      if (location) void rooms.refetch();
                    }}
                  >
                    Tải lại cơ sở/phòng
                  </Button>
                }
              >
                {adjustmentError(locations.error || rooms.error)}
              </Alert>
            )}
          </Box>
        </Collapse>
      </Paper>
      {list.isFetching && <LinearProgress aria-label="Đang tải yêu cầu điều chỉnh" />}
      {list.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void list.refetch()}>Thử lại</Button>}
        >
          Không tải được yêu cầu điều chỉnh. {adjustmentError(list.error)}
        </Alert>
      )}
      {!list.error && !list.isPending && list.data?.items.length === 0 && (
        <Paper
          component="section"
          variant="outlined"
          aria-label="Trạng thái danh sách yêu cầu"
          sx={{
            minHeight: 270,
            py: { xs: 3.5, sm: 5 },
            px: 2,
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            gap: 1.5,
          }}
        >
          <Box sx={{ p: 2, borderRadius: '50%', bgcolor: 'action.hover', display: 'flex' }}>
            <ClipboardCheck size={28} aria-hidden="true" />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 750 }}>
            {hasScopeFilter
              ? 'Không tìm thấy yêu cầu trong phạm vi đã lọc'
              : status === 'Pending'
                ? 'Không có yêu cầu chờ duyệt'
                : status === ''
                  ? 'Chưa có yêu cầu điều chỉnh'
                  : status === 'Approved'
                    ? 'Chưa có yêu cầu đã duyệt'
                    : 'Chưa có yêu cầu bị từ chối'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 430 }}>
            {hasScopeFilter
              ? 'Hãy kiểm tra lại cơ sở, phòng hoặc mã hóa đơn, hoặc chuyển sang trạng thái khác.'
              : status === 'Pending'
                ? 'Hiện chưa có yêu cầu nào cần Owner xem xét. Khi khách thuê gửi yêu cầu, yêu cầu sẽ xuất hiện tại đây.'
                : status === ''
                  ? 'Yêu cầu điều chỉnh do khách thuê gửi sẽ hiển thị tại đây để Owner xem xét.'
                  : 'Bạn có thể chuyển sang Chờ duyệt hoặc Tất cả để xem những yêu cầu ở trạng thái khác.'}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 0.5 }}>
            {status !== '' && (
              <Button variant="contained" onClick={() => changeStatus('')}>
                Xem tất cả yêu cầu
              </Button>
            )}
            {hasAdvancedFilters && (
              <Button
                variant={status === '' ? 'contained' : 'outlined'}
                onClick={clearAdvancedFilters}
              >
                Xóa bộ lọc chi tiết
              </Button>
            )}
            {!hasScopeFilter && status === '' && (
              <Button component={RouterLink} to="/invoices" variant="outlined">
                Xem danh sách hóa đơn
              </Button>
            )}
          </Stack>
        </Paper>
      )}
      {!!list.data?.items.length && !list.error && (
        <Paper variant="outlined" sx={{ minWidth: 0, borderRadius: 2, overflow: 'hidden' }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            sx={{
              px: 2,
              py: 1.5,
              gap: 0.5,
              alignItems: { sm: 'center' },
              justifyContent: 'space-between',
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
              Danh sách yêu cầu
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              Hiển thị {list.data.items.length} / {list.data.totalCount} yêu cầu · Trang {page}
            </Typography>
          </Stack>
          <OwnerTable
            label="Danh sách yêu cầu điều chỉnh"
            rows={list.data.items}
            id={(x) => x.id}
            select={(x) => setSelected(x.id)}
            selectLabel="Xem và xử lý"
            loading={list.isFetching}
            columns={[
              {
                label: 'Yêu cầu / Phòng',
                render: (x) => (
                  <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 650 }}>Phòng {x.roomNumber}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {x.locationName}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        maxWidth: 330,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {x.reason}
                    </Typography>
                  </Stack>
                ),
              },
              {
                label: 'Kỳ hóa đơn',
                render: (x) => (
                  <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                    <Typography>{x.billingPeriod.slice(0, 7)}</Typography>
                    <StatusChip label={x.invoiceStatus === 'Draft' ? 'Bản nháp' : 'Đã phát hành'} />
                  </Stack>
                ),
              },
              {
                label: 'Giá trị đề nghị',
                render: (x) => (
                  <Stack spacing={0.5}>
                    <Typography variant="caption" color="text.secondary">
                      {x.chargeCode ?? 'Toàn hóa đơn'} · Khi gửi
                    </Typography>
                    <Typography variant="body2">{formatContractMoney(x.currentAmount)}</Typography>
                    <Typography sx={{ fontWeight: 700 }}>
                      Đề xuất:{' '}
                      {x.proposedAmount === null
                        ? 'Chưa đề xuất'
                        : formatContractMoney(x.proposedAmount)}
                    </Typography>
                  </Stack>
                ),
              },
              {
                label: 'Ngày gửi',
                render: (x) => (
                  <Typography variant="body2">{formatInstant(x.submittedAt)}</Typography>
                ),
              },
              {
                label: 'Trạng thái',
                render: (x) => <StatusChip label={adjustmentStatus(x.status)} />,
              },
            ]}
          />
        </Paper>
      )}
      {list.data && list.data.totalCount > 20 && !list.error && (
        <OwnerPagination
          page={page}
          total={list.data.totalCount}
          change={setPage}
          busy={list.isFetching}
        />
      )}
      <Drawer
        anchor="right"
        open={!!selected}
        onClose={() => setSelected('')}
        slotProps={{
          paper: {
            'aria-labelledby': 'adjustment-detail-title',
            sx: {
              width: { xs: '100%', md: 780 },
              maxWidth: '100vw',
              bgcolor: 'background.default',
            },
          },
        }}
      >
        <Stack
          direction="row"
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 1,
            bgcolor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
            px: 2,
            py: 1.5,
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
          }}
        >
          <Box>
            <Typography id="adjustment-detail-title" variant="subtitle1" sx={{ fontWeight: 750 }}>
              Xem & xử lý yêu cầu
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Đóng để quay lại danh sách và bộ lọc hiện tại.
            </Typography>
          </Box>
          <Button variant="outlined" startIcon={<X size={16} />} onClick={() => setSelected('')}>
            Đóng
          </Button>
        </Stack>
        <Box sx={{ p: { xs: 1.5, sm: 2 }, minWidth: 0 }}>
          {selected && <OwnerAdjustmentDetail key={selected} id={selected} />}
        </Box>
      </Drawer>
    </Stack>
  );
}
export function FinancialSummary({ value }: { value: AdjustmentFinancials }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'background.default' }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 750, mb: 1 }}>
        Số dư sau điều chỉnh
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
        <Typography variant="body2">
          Tiền hóa đơn gốc: {formatContractMoney(value.originalIssuedAmount)}
        </Typography>
        <Typography variant="body2">
          Điều chỉnh sau phát hành: {signedVnd(value.approvedAdjustmentTotal)}
        </Typography>
        <Typography variant="body2">
          Nghĩa vụ hiện hành: {formatContractMoney(value.effectivePayableAmount)} · Đã xác minh:{' '}
          {formatContractMoney(value.allocatedPayments)}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 750 }}>
          Còn phải trả: {formatContractMoney(value.outstandingAmount)}
        </Typography>
      </Box>
      {value.reviewStatus === 'PendingReview' && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          Tiền thừa chờ xem xét: {formatContractMoney(value.potentialExcessAmount)}. Chưa hoàn tiền
          hoặc chuyển credit.
        </Alert>
      )}
    </Paper>
  );
}
export function OwnerAdjustmentDetail({ id }: { id: string }) {
  const api = useAdjustmentApi(),
    { session } = useAuth(),
    cache = useQueryClient();
  const detail = useQuery({
    queryKey: ['adjustment', session?.userId, id],
    queryFn: ({ signal }) => api.get(id, signal),
  });
  return (
    <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      <Stack spacing={2.5}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 750 }}>
          Chi tiết yêu cầu điều chỉnh
        </Typography>
        {detail.isPending && <LinearProgress />}
        {detail.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void detail.refetch()}>Tải lại yêu cầu</Button>}
          >
            {adjustmentError(detail.error)}
          </Alert>
        )}
        {detail.data && !detail.error && (
          <>
            <Box
              component="section"
              aria-label="Nội dung yêu cầu của khách thuê"
              sx={{
                pb: 2,
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Stack spacing={1.5}>
                <Stack
                  direction="row"
                  sx={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 1,
                  }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                    {detail.data.locationName} · Phòng {detail.data.roomNumber}
                  </Typography>
                  <StatusChip label={adjustmentStatus(detail.data.status)} />
                </Stack>
                <Typography variant="body1" sx={{ fontWeight: 650 }}>
                  Yêu cầu: {detail.data.reason}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Kỳ {detail.data.billingPeriod.slice(0, 7)} · Khoản cần xem xét:{' '}
                  {detail.data.chargeCode ?? 'Toàn hóa đơn'}
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                    gap: 2,
                    py: 1.5,
                  }}
                >
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Giá trị khi khách gửi yêu cầu
                    </Typography>
                    <Typography
                      variant="h6"
                      sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatContractMoney(detail.data.currentAmount)}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Số tiền khách thuê đề xuất
                    </Typography>
                    <Typography
                      variant="h6"
                      sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {detail.data.proposedAmount === null
                        ? 'Chưa đề xuất'
                        : formatContractMoney(detail.data.proposedAmount)}
                    </Typography>
                  </Box>
                </Box>
                {detail.data.status === 'Pending' && (
                  <Alert severity="info">
                    Kiểm tra số dư, bản chụp hóa đơn và bằng chứng trước khi điền lý do, phê duyệt
                    hoặc từ chối ở cuối trang.
                  </Alert>
                )}
              </Stack>
            </Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
              Số tiền hiện hành trên hệ thống
            </Typography>
            <Typography variant="body2">
              Giá trị hiện hành của khoản yêu cầu:{' '}
              {detail.data.currentChargeAmount === null
                ? 'Khoản nguồn đã thay đổi'
                : formatContractMoney(detail.data.currentChargeAmount)}
            </Typography>
            {detail.data.financials && <FinancialSummary value={detail.data.financials} />}
            <Accordion
              variant="outlined"
              disableGutters
              sx={{ borderRadius: '12px !important', '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
                    Xem bản chụp và các khoản phí của hóa đơn
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Kiểm tra hóa đơn gốc và các khoản phí hiện hành khi cần đối chiếu.
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1}>
                  <Typography>
                    Hóa đơn gốc khi gửi: {snapshotTotal(detail.data)} · Gửi lúc{' '}
                    {formatInstant(detail.data.submittedAt)}
                  </Typography>
                  {detail.data.currentInvoice.lines.map((line) => (
                    <Typography key={line.id}>
                      {line.name}: {formatContractMoney(line.amount)}
                      {line.calculatedAmount != null
                        ? ` · Trước correction: ${formatContractMoney(line.calculatedAmount)}`
                        : ''}
                    </Typography>
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
            <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
              Bằng chứng đính kèm ({detail.data.evidence.length})
            </Typography>
            {detail.data.evidence.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Không có tệp bằng chứng đính kèm. Kiểm tra thông tin hóa đơn trước khi quyết định.
              </Typography>
            )}
            {detail.data.evidence.map((e, index) => (
              <PrivateEvidenceViewer
                key={e.id}
                label={`Bằng chứng điều chỉnh ${index + 1}`}
                filename={`bang-chung-dieu-chinh-${index + 1}.${e.contentType === 'application/pdf' ? 'pdf' : e.contentType === 'image/png' ? 'png' : 'jpg'}`}
                contentType={e.contentType}
                expectedSize={e.length}
                fetchBlob={(signal) => api.evidence(id, e.id, signal)}
                errorMessage={adjustmentError}
              />
            ))}
            {detail.data.decision && (
              <Alert severity={detail.data.status === 'Approved' ? 'success' : 'info'}>
                {adjustmentStatus(detail.data.status)} · {detail.data.decision.reason} ·{' '}
                {formatInstant(detail.data.decision.decidedAt)} · Thay đổi{' '}
                {signedVnd(detail.data.decision.delta)}
              </Alert>
            )}
            {detail.data.status === 'Pending' && (
              <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
                Bước 3 · Ghi quyết định của Owner
              </Typography>
            )}
            {detail.data.status === 'Pending' && (
              <DecisionForm
                key={`${id}:${detail.data.currentInvoice.version}:${detail.data.currentFinancialVersion}`}
                value={detail.data}
                saved={async () => {
                  await Promise.all(
                    [
                      'adjustments',
                      'adjustment',
                      'invoice',
                      'invoices',
                      'invoice-payment',
                      'payment-invoices',
                      'debt-summary',
                      'payment-history',
                      'transfer-instructions',
                    ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
                  );
                }}
              />
            )}
            <Button onClick={() => void detail.refetch()}>Tải lại yêu cầu</Button>
          </>
        )}
      </Stack>
    </Box>
  );
}
function snapshotTotal(value: Adjustment) {
  // Read exact legacy JSON numeric tokens without passing money through binary Number.
  const match = /"Total"\s*:\s*(?:"(\d+)"|(\d+)(?:\.0+)?)/.exec(value.invoiceSnapshot);
  return match ? formatContractMoney(match[1] ?? match[2]!) : 'Không đọc được snapshot';
}
function DecisionForm({ value, saved }: { value: Adjustment; saved: () => Promise<void> }) {
  const api = useAdjustmentApi();
  const [amount, setAmount] = useState(value.proposedAmount ?? ''),
    [reason, setReason] = useState(''),
    [code, setCode] = useState(value.chargeCode ?? ''),
    [checked, setChecked] = useState(false),
    [confirm, setConfirm] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    key = useRef(crypto.randomUUID());
  const changed = () => {
    key.current = crypto.randomUUID();
    setChecked(false);
  };
  async function decide() {
    if (lock.current || confirm === null) return;
    let input: AdjustmentDecisionInput;
    try {
      input = {
        expectedVersion: value.version,
        expectedInvoiceVersion: value.currentInvoice.version,
        expectedFinancialVersion: value.currentFinancialVersion,
        correctedAmount: confirm ? vnd(amount) : null,
        chargeCode: code || null,
        reason: reason.trim(),
        humanConfirmed: checked,
      };
      if (!input.reason || !checked) throw new Error();
    } catch {
      setError('Nhập số nguyên VND, lý do và xác nhận đã kiểm tra.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.decide(value.id, confirm, input, key.current);
      setConfirm(null);
      await saved();
    } catch (e) {
      setError(adjustmentError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        {value.currentInvoice.status === 'Draft'
          ? 'Correction chỉ sửa giá trị khoản phí trong bản nháp; không đổi chỉ số hoặc biểu giá nguồn.'
          : 'Điều chỉnh được lưu riêng. Hóa đơn đã phát hành và payment gốc được giữ nguyên.'}
      </Alert>
      <TextField
        select
        label="Khoản phí Owner xem xét"
        value={code}
        disabled={!!value.chargeCode || busy}
        onChange={(e) => {
          setCode(e.target.value);
          changed();
        }}
      >
        <MenuItem value="">
          {value.currentInvoice.status === 'Draft' ? 'Chọn khoản phí' : 'Toàn hóa đơn'}
        </MenuItem>
        {value.currentInvoice.lines.map((l) => (
          <MenuItem key={l.id} value={l.chargeCode}>
            {l.name}
          </MenuItem>
        ))}
      </TextField>
      <MoneyField
        label="Giá trị sau điều chỉnh (VND)"
        value={amount}
        disabled={busy}
        onValueChange={(raw) => {
          setAmount(raw);
          changed();
        }}
      />
      <TextField
        label="Lý do quyết định"
        value={reason}
        multiline
        slotProps={{ htmlInput: { maxLength: 2000 } }}
        disabled={busy}
        onChange={(e) => {
          setReason(e.target.value);
          changed();
        }}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={checked}
            disabled={busy}
            onChange={(e) => setChecked(e.target.checked)}
          />
        }
        label="Tôi đã kiểm tra hóa đơn, số dư và bằng chứng"
      />
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button
          disabled={
            busy ||
            !checked ||
            !reason.trim() ||
            !amount ||
            (value.currentInvoice.status === 'Draft' && !code)
          }
          variant="contained"
          onClick={() => setConfirm(true)}
        >
          Phê duyệt điều chỉnh
        </Button>
        <Button disabled={busy || !checked || !reason.trim()} onClick={() => setConfirm(false)}>
          Từ chối yêu cầu
        </Button>
      </Stack>
      <Dialog open={confirm !== null} onClose={() => !busy && setConfirm(null)}>
        <DialogTitle>
          {confirm ? 'Xác nhận phê duyệt điều chỉnh?' : 'Xác nhận từ chối yêu cầu?'}
        </DialogTitle>
        <DialogContent>
          Quyết định và lịch sử sẽ được lưu. Tiền thừa nếu có sẽ chờ xem xét theo chính sách.
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setConfirm(null)}>
            Quay lại
          </Button>
          <Button disabled={busy} onClick={() => void decide()}>
            Xác nhận quyết định
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
