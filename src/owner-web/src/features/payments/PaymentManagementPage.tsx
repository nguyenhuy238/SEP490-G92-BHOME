import { useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  Checkbox,
  Drawer,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  Chip,
} from '@mui/material';
import { ArrowDownToLine, Clock3, FileText, Landmark, RefreshCw, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { formatContractMoney } from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import {
  paymentError,
  paymentText,
  type BankAccount,
  type BankTransfer,
  type DebtInvoice,
} from '../../../../../packages/client-core/src/payments';
import { PageHeader, FilterToolbar, KPIGrid, StatusChip } from '../../components/common/PortalUI';
import { OwnerTable, OwnerPagination } from '../../components/common/OwnerWorkspace';
import { usePaymentApi } from './usePaymentApi';
import { SePayEventsPanel } from './SePayEventsPanel';
import { SePayTestingPanel } from './SePayTestingPanel';
import {
  OwnerInvoicePaymentPanel,
  ReconcileTransfer,
  RecordTransferForm,
} from './OwnerInvoicePaymentPanel';

export function PaymentManagementPage({ debtOnly = false }: { debtOnly?: boolean }) {
  const api = usePaymentApi();
  const [searchParams] = useSearchParams();
  const linkedReceipt = searchParams.get('transferId') ?? '';
  const validLinkedReceipt = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(linkedReceipt);
  const { session } = useAuth();
  const actor = session?.userId ?? '';
  const cache = useQueryClient();
  const linked = useQuery({
    queryKey: ['payment-transfer-link', actor, linkedReceipt],
    queryFn: ({ signal }) => api.transfer(linkedReceipt, signal),
    enabled: !debtOnly && !!actor && validLinkedReceipt,
  });
  const [location, setLocation] = useState(''),
    [room, setRoom] = useState(''),
    [period, setPeriod] = useState(''),
    [status, setStatus] = useState(''),
    [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState(''),
    [selectedLabel, setSelectedLabel] = useState(''),
    [transferPage, setTransferPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [recordUnmatched, setRecordUnmatched] = useState(false);
  const [section, setSection] = useState(0),
    [transferStatus, setTransferStatus] = useState('PendingReview');
  const filter = {
    page,
    locationId: location,
    roomId: room,
    billingPeriod: period ? period + '-01' : '',
    paymentStatus: status,
    overdueOnly: overdue,
  };
  const historyFilter = {
    ...filter,
    page: historyPage,
    ...(debtOnly ? {} : { paymentStatus: '', overdueOnly: false }),
  };
  const locations = useQuery({
    queryKey: ['payment-locations', actor],
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>('/api/v1/capture/locations', { signal }),
  });
  const rooms = useQuery({
    queryKey: ['payment-rooms', actor, location],
    enabled: !!location,
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>(`/api/v1/capture/locations/${location}/rooms`, {
        signal,
      }),
  });
  const invoices = useQuery({
    queryKey: ['payment-invoices', actor, debtOnly, filter],
    queryFn: ({ signal }) => (debtOnly ? api.debts(filter, signal) : api.invoices(filter, signal)),
    enabled: debtOnly || section === 0,
  });
  const summary = useQuery({
    queryKey: ['debt-summary', actor, location, room, period, overdue],
    enabled: debtOnly,
    queryFn: ({ signal }) => api.debtSummary(filter, signal),
  });
  const transfers = useQuery({
    queryKey: ['payment-transfers', actor, location, room, period, transferPage, transferStatus],
    enabled: !debtOnly && section === 1,
    queryFn: ({ signal }) =>
      api.transfers(
        {
          page: transferPage,
          locationId: location,
          roomId: room,
          billingPeriod: period ? period + '-01' : '',
          paymentStatus: transferStatus,
        },
        signal,
      ),
  });
  const history = useQuery({
    queryKey: ['payment-history', actor, historyFilter],
    queryFn: ({ signal }) => api.history(historyFilter, signal),
    enabled: debtOnly || section === 2,
  });
  const showFilters = debtOnly || section !== 4;
  const showInvoiceFilters = debtOnly || section === 0;
  const hasCustomFilters = Boolean(
    location ||
    room ||
    period ||
    (showInvoiceFilters && (status || overdue)) ||
    (!debtOnly && section === 1 && transferStatus !== 'PendingReview'),
  );
  const refresh = () =>
    void cache.invalidateQueries({
      predicate: (q) =>
        [
          'payment-invoices',
          'payment-history',
          'payment-transfers',
          'debt-summary',
          'invoice-payment',
        ].includes(String(q.queryKey[0])),
    });
  const openInvoice = (invoice: DebtInvoice) => {
    setSelected(invoice.invoiceId);
    setSelectedLabel(
      `${invoice.locationName} · Phòng ${invoice.roomNumber} · Kỳ ${invoice.billingPeriod.slice(0, 7)}`,
    );
  };
  return (
    <>
      <PageHeader
        title={debtOnly ? 'Công nợ phòng' : 'Thanh toán & Đối soát'}
        subtitle={
          debtOnly
            ? 'Theo dõi dư nợ, hạn trả và lịch sử thu tiền của từng phòng; tổng hợp từ toàn bộ kết quả trên máy chủ.'
            : 'Đối chiếu sao kê, xác minh và theo dõi phân bổ vào hóa đơn phòng.'
        }
        actions={
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshCw size={16} />}
            disabled={invoices.isFetching || history.isFetching || transfers.isFetching}
            onClick={refresh}
          >
            Làm mới dữ liệu
          </Button>
        }
      />
      <Stack spacing={2}>
        {!debtOnly && linkedReceipt && (
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6">Giao dịch được liên kết</Typography>
            {!validLinkedReceipt ? (
              <Alert severity="error">Liên kết giao dịch không hợp lệ.</Alert>
            ) : linked.isPending ? (
              <LinearProgress />
            ) : linked.error ? (
              <Alert
                severity="error"
                action={<Button onClick={() => void linked.refetch()}>Thử lại</Button>}
              >
                {paymentError(linked.error)}
              </Alert>
            ) : linked.data ? (
              <ReconcileTransfer key={linkedReceipt} transfer={linked.data} />
            ) : null}
          </Paper>
        )}
        {!debtOnly && (
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Tabs
              value={section}
              onChange={(_, value) => {
                setSelected('');
                setSection(value);
              }}
              variant="scrollable"
              allowScrollButtonsMobile
              aria-label="Nghiệp vụ thanh toán"
              sx={{ px: 1, minHeight: 52, '& .MuiTab-root': { minHeight: 52 } }}
            >
              <Tab icon={<FileText size={17} />} iconPosition="start" label="Hóa đơn và số dư" />
              <Tab
                icon={<ArrowDownToLine size={17} />}
                iconPosition="start"
                label="Đối soát giao dịch"
              />
              <Tab icon={<Clock3 size={17} />} iconPosition="start" label="Lịch sử đã xác minh" />
              <Tab icon={<Landmark size={17} />} iconPosition="start" label="Tài khoản nhận tiền" />
              <Tab label="Webhook SePay" />
            </Tabs>
          </Paper>
        )}
        {!debtOnly && section === 4 && (
          <>
            <SePayTestingPanel />
            <SePayEventsPanel />
          </>
        )}
        {recordUnmatched && (
          <Dialog
            open
            onClose={() => setRecordUnmatched(false)}
            maxWidth="sm"
            fullWidth
            aria-labelledby="unmatched-transfer-title"
          >
            <DialogTitle id="unmatched-transfer-title">
              Ghi nhận giao dịch chưa xác định hóa đơn
            </DialogTitle>
            <DialogContent>
              <RecordTransferForm invoiceId="" onClose={() => setRecordUnmatched(false)} />
            </DialogContent>
          </Dialog>
        )}
        {showFilters && (
          <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
            <Stack spacing={2}>
              <Stack
                direction="row"
                sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {section === 3 && !debtOnly ? 'Chọn cơ sở nhận tiền' : 'Bộ lọc dữ liệu'}
                </Typography>
                {hasCustomFilters && (
                  <Button
                    size="small"
                    onClick={() => {
                      setLocation('');
                      setRoom('');
                      setPeriod('');
                      setStatus('');
                      setOverdue(false);
                      setTransferStatus('PendingReview');
                      setPage(1);
                      setTransferPage(1);
                      setHistoryPage(1);
                    }}
                  >
                    Xóa bộ lọc
                  </Button>
                )}
              </Stack>
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
                    setTransferPage(1);
                    setHistoryPage(1);
                  }}
                >
                  <MenuItem value="">Tất cả cơ sở</MenuItem>
                  {locations.data?.map((l) => (
                    <MenuItem key={l.id} value={l.id}>
                      {l.label}
                    </MenuItem>
                  ))}
                </TextField>
                {(section !== 3 || debtOnly) && (
                  <TextField
                    size="small"
                    select
                    label="Phòng"
                    value={room}
                    disabled={!location}
                    onChange={(e) => {
                      setRoom(e.target.value);
                      setPage(1);
                      setTransferPage(1);
                      setHistoryPage(1);
                    }}
                  >
                    <MenuItem value="">Tất cả phòng</MenuItem>
                    {rooms.data?.map((r) => (
                      <MenuItem key={r.id} value={r.id}>
                        {r.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
                {(section !== 3 || debtOnly) && (
                  <TextField
                    size="small"
                    type="month"
                    label="Kỳ hóa đơn"
                    value={period}
                    onChange={(e) => {
                      setPeriod(e.target.value);
                      setPage(1);
                      setTransferPage(1);
                      setHistoryPage(1);
                    }}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                )}
                {!debtOnly && section === 0 && (
                  <TextField
                    size="small"
                    select
                    label="Trạng thái thanh toán"
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      setPage(1);
                      setHistoryPage(1);
                    }}
                  >
                    <MenuItem value="">Tất cả</MenuItem>
                    <MenuItem value="Unpaid">Chưa thanh toán</MenuItem>
                    <MenuItem value="Paid">Đã thanh toán</MenuItem>
                  </TextField>
                )}
                {showInvoiceFilters && (
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={overdue}
                        onChange={(e) => {
                          setOverdue(e.target.checked);
                          setPage(1);
                          setHistoryPage(1);
                        }}
                      />
                    }
                    label="Chỉ hóa đơn quá hạn"
                  />
                )}
                {!debtOnly && section === 1 && (
                  <TextField
                    size="small"
                    select
                    label="Trạng thái đối soát"
                    value={transferStatus}
                    onChange={(e) => {
                      setTransferStatus(e.target.value);
                      setTransferPage(1);
                    }}
                  >
                    <MenuItem value="PendingReview">Chờ xác minh / chưa ghép hóa đơn</MenuItem>
                    <MenuItem value="ExcessRefundPending">Phải hoàn toàn bộ tiền dư</MenuItem>
                    <MenuItem value="ExcessRefundCompleted">Đã hoàn toàn bộ tiền dư</MenuItem>
                    <MenuItem value="Allocated">Đã phân bổ</MenuItem>
                    <MenuItem value="Rejected">Không phân bổ</MenuItem>
                    <MenuItem value="">Tất cả giao dịch</MenuItem>
                  </TextField>
                )}
              </FilterToolbar>
            </Stack>
          </Paper>
        )}
        {(locations.error || rooms.error) && (
          <Alert severity="error">{paymentError(locations.error || rooms.error)}</Alert>
        )}
        {debtOnly && summary.isFetching && <LinearProgress aria-label="Đang tổng hợp công nợ" />}
        {debtOnly && summary.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void summary.refetch()}>Thử lại tổng hợp</Button>}
          >
            {paymentError(summary.error)}
          </Alert>
        )}
        {debtOnly && !summary.error && summary.data && (
          <KPIGrid
            items={[
              {
                label: 'Tổng dư nợ trong bộ lọc',
                value: formatContractMoney(summary.data.outstandingAmount),
              },
              {
                label: 'Số tiền quá hạn',
                value: formatContractMoney(summary.data.overdueAmount),
                danger: true,
              },
              { label: 'Hóa đơn còn nợ', value: summary.data.invoiceCount },
              { label: 'Hóa đơn quá hạn', value: summary.data.overdueInvoiceCount, danger: true },
            ]}
          />
        )}
        {(debtOnly || section === 0) && (
          <>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              sx={{ gap: 1, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {debtOnly ? 'Các hóa đơn còn công nợ' : 'Theo dõi tiền theo hóa đơn'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Số dư và trạng thái lấy từ hệ thống đối soát; bấm xem thanh toán để kiểm tra một
                  hóa đơn.
                </Typography>
              </Box>
              <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap' }}>
                <Chip
                  clickable
                  size="small"
                  color={overdue ? 'error' : 'default'}
                  variant={overdue ? 'filled' : 'outlined'}
                  label="Quá hạn"
                  onClick={() => {
                    setOverdue(!overdue);
                    setPage(1);
                  }}
                />
                {!debtOnly && (
                  <>
                    <Chip
                      clickable
                      size="small"
                      color={status === 'Unpaid' ? 'primary' : 'default'}
                      variant={status === 'Unpaid' ? 'filled' : 'outlined'}
                      label="Còn phải trả"
                      onClick={() => {
                        setStatus(status === 'Unpaid' ? '' : 'Unpaid');
                        setPage(1);
                      }}
                    />
                    <Chip
                      clickable
                      size="small"
                      color={status === 'Paid' ? 'primary' : 'default'}
                      variant={status === 'Paid' ? 'filled' : 'outlined'}
                      label="Đã đủ tiền"
                      onClick={() => {
                        setStatus(status === 'Paid' ? '' : 'Paid');
                        setPage(1);
                      }}
                    />
                  </>
                )}
              </Stack>
            </Stack>
            {invoices.isPending && <LinearProgress />}
            {invoices.error && (
              <Alert
                severity="error"
                action={<Button onClick={() => void invoices.refetch()}>Thử lại</Button>}
              >
                {paymentError(invoices.error)}
              </Alert>
            )}
            {!invoices.error && invoices.data?.items.length === 0 && (
              <Alert
                severity="info"
                action={
                  hasCustomFilters ? (
                    <Button
                      color="inherit"
                      onClick={() => {
                        setLocation('');
                        setRoom('');
                        setPeriod('');
                        setStatus('');
                        setOverdue(false);
                        setPage(1);
                      }}
                    >
                      Bỏ bộ lọc
                    </Button>
                  ) : undefined
                }
              >
                {invoices.data && invoices.data.totalCount > 0
                  ? 'Trang này chưa có hóa đơn. Chọn trang trước để tiếp tục.'
                  : 'Không có hóa đơn phù hợp bộ lọc.'}
              </Alert>
            )}
            {invoices.data && (
              <Typography variant="subtitle2" color="text.secondary">
                {invoices.data.totalCount} hóa đơn trong bộ lọc
              </Typography>
            )}
            {!!invoices.data?.items.length && !invoices.error && (
              <>
                <Stack
                  role="list"
                  aria-label="Danh sách công nợ trên màn hình nhỏ"
                  spacing={1.25}
                  sx={{ display: { xs: 'flex', md: 'none' } }}
                >
                  {invoices.data.items.map((invoice) => (
                    <Paper
                      key={invoice.invoiceId}
                      variant="outlined"
                      role="listitem"
                      sx={{ p: 1.5, borderRadius: 1.5 }}
                    >
                      <Stack spacing={1}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                          {invoice.locationName} · Phòng {invoice.roomNumber}
                        </Typography>
                        <Stack
                          direction="row"
                          sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}
                        >
                          <Typography variant="caption" color="text.secondary">
                            Kỳ {invoice.billingPeriod.slice(0, 7)}
                          </Typography>
                          <Typography sx={{ fontWeight: 750 }}>
                            {formatContractMoney(invoice.outstandingAmount)}
                          </Typography>
                        </Stack>
                        <Stack
                          direction="row"
                          sx={{
                            justifyContent: 'space-between',
                            gap: 1,
                            flexWrap: 'wrap',
                            alignItems: 'center',
                          }}
                        >
                          <StatusChip
                            label={
                              invoice.overdueDays > 0
                                ? `Quá hạn ${invoice.overdueDays} ngày`
                                : paymentText(invoice.paymentStatus)
                            }
                          />
                          <Typography variant="caption" color="text.secondary">
                            Hạn: {invoice.dueDate.split('-').reverse().join('/')}
                          </Typography>
                        </Stack>
                        <Button
                          fullWidth
                          size="small"
                          variant="outlined"
                          aria-label={`Xem thanh toán phòng ${invoice.roomNumber}, kỳ ${invoice.billingPeriod.slice(0, 7)}`}
                          onClick={() => openInvoice(invoice)}
                        >
                          Xem thanh toán
                        </Button>
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
                <Paper
                  variant="outlined"
                  sx={{ overflow: 'hidden', display: { xs: 'none', md: 'block' } }}
                >
                  <OwnerTable
                    rows={invoices.data.items}
                    id={(i) => i.invoiceId}
                    select={openInvoice}
                    selectLabel="Xem thanh toán"
                    label={debtOnly ? 'Công nợ theo phòng' : 'Hóa đơn và số dư'}
                    columns={[
                      {
                        label: 'Cơ sở / Phòng',
                        render: (i) => `${i.locationName} · ${i.roomNumber}`,
                      },
                      { label: 'Kỳ hóa đơn', render: (i) => i.billingPeriod.slice(0, 7) },
                      {
                        label: 'Còn phải trả',
                        render: (i) => formatContractMoney(i.outstandingAmount),
                      },
                      {
                        label: 'Hạn thanh toán',
                        render: (i) => i.dueDate.split('-').reverse().join('/'),
                      },
                      {
                        label: 'Trạng thái',
                        render: (i) => (
                          <StatusChip
                            label={
                              i.overdueDays > 0
                                ? `Quá hạn ${i.overdueDays} ngày`
                                : paymentText(i.paymentStatus)
                            }
                          />
                        ),
                      },
                    ]}
                  />
                </Paper>
              </>
            )}
            <OwnerPagination
              page={page}
              total={invoices.data?.totalCount ?? 0}
              change={setPage}
              busy={invoices.isFetching}
            />
            <Drawer
              anchor="right"
              open={!!selected}
              onClose={() => setSelected('')}
              aria-labelledby="payment-detail-title"
              ModalProps={{ keepMounted: false }}
              slotProps={{
                paper: {
                  sx: {
                    width: { xs: '100%', sm: 560 },
                    maxWidth: '100%',
                    height: '100dvh',
                    display: 'flex',
                    flexDirection: 'column',
                  },
                },
              }}
            >
              <Stack
                direction="row"
                sx={{
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  p: 2,
                  gap: 1,
                  flexShrink: 0,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    id="payment-detail-title"
                    variant="subtitle1"
                    sx={{ fontWeight: 700 }}
                  >
                    Chi tiết thanh toán hóa đơn
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {selectedLabel}
                  </Typography>
                </Box>
                <IconButton aria-label="Đóng chi tiết thanh toán" onClick={() => setSelected('')}>
                  <X size={20} />
                </IconButton>
              </Stack>
              <Box sx={{ minHeight: 0, overflowY: 'auto', flex: 1, p: { xs: 1, sm: 2 } }}>
                {selected && <OwnerInvoicePaymentPanel key={selected} invoiceId={selected} />}
              </Box>
            </Drawer>
          </>
        )}
        {!debtOnly &&
          section === 3 &&
          (location ? (
            <ReceivingAccountForm locationId={location} />
          ) : (
            <Alert severity="info">Chọn cơ sở để cấu hình tài khoản nhận tiền.</Alert>
          ))}
        {!debtOnly && section === 1 && (
          <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
            <Stack spacing={2}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                sx={{ gap: 1, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
              >
                <Box>
                  <Typography variant="h6">Giao dịch ngân hàng</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Kiểm tra giao dịch chờ xác minh, chọn hóa đơn rồi xác nhận phân bổ.
                  </Typography>
                </Box>
                <Button variant="contained" size="small" onClick={() => setRecordUnmatched(true)}>
                  Ghi nhận giao dịch chưa xác định hóa đơn
                </Button>
              </Stack>
              {transfers.isPending && <LinearProgress />}
              {transfers.error && (
                <Alert
                  severity="error"
                  action={<Button onClick={() => void transfers.refetch()}>Thử lại</Button>}
                >
                  {paymentError(transfers.error)}
                </Alert>
              )}
              {transfers.data?.items.length === 0 && (
                <Alert
                  severity="info"
                  action={
                    transferStatus !== 'PendingReview' ? (
                      <Button color="inherit" onClick={() => setTransferStatus('PendingReview')}>
                        Xem giao dịch cần đối soát
                      </Button>
                    ) : undefined
                  }
                >
                  {transferStatus === 'PendingReview'
                    ? 'Không có giao dịch chờ xác minh trong phạm vi đã chọn.'
                    : 'Không có giao dịch ở trạng thái này trong phạm vi đã chọn.'}
                </Alert>
              )}
              {!!transfers.data && (
                <Typography variant="body2" color="text.secondary">
                  {transfers.data.totalCount} giao dịch trong bộ lọc
                </Typography>
              )}
              {transfers.data?.items.map((transfer, index) => (
                <TransferListItem
                  key={transfer.id}
                  transfer={transfer}
                  initiallyExpanded={index === 0 && transfer.status === 'PendingReview'}
                />
              ))}
              <Stack direction="row">
                <Button
                  disabled={transferPage === 1}
                  onClick={() => setTransferPage(transferPage - 1)}
                >
                  Giao dịch trước
                </Button>
                <Button
                  disabled={!transfers.data || transferPage * 20 >= transfers.data.totalCount}
                  onClick={() => setTransferPage(transferPage + 1)}
                >
                  Giao dịch sau
                </Button>
              </Stack>
            </Stack>
          </Paper>
        )}
        {(debtOnly || section === 2) && (
          <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
            <Stack spacing={2}>
              <Box>
                <Typography variant="h6">Lịch sử thanh toán đã xác minh</Typography>
                <Typography variant="caption" color="text.secondary">
                  Các khoản đã phân bổ được máy chủ xác nhận, lọc theo cơ sở, phòng và kỳ hóa đơn.
                </Typography>
              </Box>
              {history.isPending && <LinearProgress />}
              {history.error && (
                <Alert
                  severity="error"
                  action={<Button onClick={() => void history.refetch()}>Thử lại</Button>}
                >
                  {paymentError(history.error)}
                </Alert>
              )}
              {history.data?.items.length === 0 && (
                <Alert severity="info">Chưa có thanh toán đã phân bổ trong phạm vi đã chọn.</Alert>
              )}
              {history.data?.items.map((item) => (
                <Box
                  key={item.id}
                  sx={{
                    px: 1.5,
                    py: 1.25,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1.5,
                  }}
                >
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    sx={{ justifyContent: 'space-between', gap: 1 }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 650 }}>
                        {item.locationName} · Phòng {item.roomNumber}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Kỳ {item.billingPeriod.slice(0, 7)} · {formatInstant(item.paidAt)}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ overflowWrap: 'anywhere' }}
                      >
                        Tham chiếu: {item.bankReference}
                      </Typography>
                    </Box>
                    <Typography color="success.main" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      +{formatContractMoney(item.amount)}
                    </Typography>
                  </Stack>
                </Box>
              ))}
              <Stack direction="row" spacing={1}>
                <Button
                  disabled={historyPage === 1 || history.isFetching}
                  onClick={() => setHistoryPage(historyPage - 1)}
                >
                  Lịch sử trước
                </Button>
                <Typography>
                  Trang lịch sử {historyPage} · {history.data?.totalCount ?? 0} thanh toán
                </Typography>
                <Button
                  disabled={
                    history.isFetching ||
                    !history.data ||
                    historyPage * 20 >= history.data.totalCount
                  }
                  onClick={() => setHistoryPage(historyPage + 1)}
                >
                  Lịch sử sau
                </Button>
              </Stack>
            </Stack>
          </Paper>
        )}
      </Stack>
    </>
  );
}

function TransferListItem({
  transfer,
  initiallyExpanded,
}: {
  transfer: BankTransfer;
  initiallyExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const detailId = useId();
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ p: 1.5, gap: 1.5, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
            {transfer.bankReference} · {formatContractMoney(transfer.amount)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatInstant(transfer.occurredAt)} · {transfer.providerIdentity}
          </Typography>
        </Box>
        <Stack
          direction="row"
          sx={{ gap: 1, alignItems: 'center', justifyContent: 'space-between' }}
        >
          <StatusChip label={paymentText(transfer.status)} />
          <Button
            variant={
              expanded ? 'text' : transfer.status === 'PendingReview' ? 'contained' : 'outlined'
            }
            size="small"
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? 'Thu gọn'
              : transfer.status === 'PendingReview'
                ? 'Kiểm tra & đối soát'
                : 'Xem chi tiết'}
          </Button>
        </Stack>
      </Stack>
      {expanded && (
        <Box
          id={detailId}
          sx={{
            p: { xs: 1, sm: 1.5 },
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.default',
          }}
        >
          <ReconcileTransfer transfer={transfer} />
        </Box>
      )}
    </Box>
  );
}

function ReceivingAccountForm({ locationId }: { locationId: string }) {
  const api = usePaymentApi();
  const { session } = useAuth();
  const actor = session?.userId ?? '';
  const account = useQuery({
    queryKey: ['receiving-account', actor, locationId],
    queryFn: ({ signal }) => api.account(locationId, signal),
  });
  return (
    <>
      {account.isPending && <LinearProgress />}
      {account.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void account.refetch()}>Thử lại</Button>}
        >
          {paymentError(account.error)}
        </Alert>
      )}
      {account.isSuccess && (
        <AccountEditor
          key={locationId + ':' + (account.data?.version ?? 0)}
          current={account.data}
          locationId={locationId}
          saved={() => void account.refetch()}
        />
      )}
    </>
  );
}
function AccountEditor({
  current,
  locationId,
  saved,
}: {
  current: BankAccount | null;
  locationId: string;
  saved: () => void;
}) {
  const api = usePaymentApi();
  const [bank, setBank] = useState(current?.bankIdentifier ?? ''),
    [number, setNumber] = useState(current?.accountNumber ?? ''),
    [holder, setHolder] = useState(current?.accountHolder ?? '');
  const [enabled, setEnabled] = useState(current?.enabled ?? false),
    [demo, setDemo] = useState(current?.isDevelopmentDemo ?? false),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2.5 } }}>
      <Stack
        component="form"
        spacing={2}
        sx={{ maxWidth: 860 }}
        onSubmit={(event) => {
          event.preventDefault();
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError('');
          void api
            .saveAccount({
              locationId,
              bankIdentifier: bank,
              accountNumber: number,
              accountHolder: holder,
              enabled,
              isDevelopmentDemo: demo,
              version: current?.version ?? 0,
            })
            .then(saved)
            .catch((e) => setError(paymentError(e)))
            .finally(() => {
              lock.current = false;
              setBusy(false);
            });
        }}
      >
        <Box>
          <Typography variant="h6">Tài khoản nhận tiền của cơ sở</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Kiểm tra thông tin ngân hàng trước khi lưu để hướng dẫn chuyển khoản của cơ sở chính
            xác.
          </Typography>
        </Box>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
          <TextField
            size="small"
            required
            label="BIN ngân hàng (6 số)"
            value={bank}
            onChange={(e) => {
              setBank(e.target.value);
              setChecked(false);
            }}
          />
          <TextField
            size="small"
            required
            label="Số tài khoản nhận tiền"
            value={number}
            onChange={(e) => {
              setNumber(e.target.value);
              setChecked(false);
            }}
          />
          <TextField
            size="small"
            required
            label="Chủ tài khoản (in hoa không dấu)"
            value={holder}
            sx={{ gridColumn: { md: '1 / -1' } }}
            onChange={(e) => {
              setHolder(e.target.value.toUpperCase());
              setChecked(false);
            }}
          />
        </Box>
        <Box sx={{ border: '1px solid', borderColor: 'divider', p: 1.5, borderRadius: 1.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Cấu hình hướng dẫn nhận tiền
          </Typography>
          <Stack>
            <FormControlLabel
              control={
                <Checkbox
                  checked={enabled}
                  onChange={(e) => {
                    setEnabled(e.target.checked);
                    setChecked(false);
                  }}
                />
              }
              label="Bật hướng dẫn nhận tiền"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={demo}
                  onChange={(e) => {
                    setDemo(e.target.checked);
                    setChecked(false);
                  }}
                />
              }
              label="Tài khoản tổng hợp Development/Testing"
            />
          </Stack>
          <Divider sx={{ my: 1 }} />
          <FormControlLabel
            control={<Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} />}
            label="Tôi đã kiểm tra và phê duyệt thông tin tài khoản nhận"
          />
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        <Button
          type="submit"
          variant="contained"
          disabled={busy || !checked}
          sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
        >
          Lưu tài khoản nhận tiền
        </Button>
      </Stack>
    </Paper>
  );
}
