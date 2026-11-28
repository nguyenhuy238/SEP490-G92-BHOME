import { TextField, ValidatedForm } from '../../components/common/ValidatedForm';
import { MoneyField } from '../../components/common/MoneyField';
import { useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { ChevronDown } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useInRouterContext, useParams } from 'react-router';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  financeError,
  formatFinanceMoney,
  type Expense,
  type ExpenseFilter,
  type ExpenseInput,
} from '../../../../../packages/client-core/src/finance';
import { formatDraftMoney } from '../../../../../packages/client-core/src/mainDrafts';
import { FilterToolbar, PageHeader } from '../../components/common/PortalUI';
import { OptionPicker } from '../../components/common/OptionPicker';
import { useFinanceApi } from './useFinanceApi';
import { ExpenseEvidencePanel } from './ExpenseEvidencePanel';
import { ExpenseFinanceActions } from './ExpenseFinanceActions';
import { StaffCostDialog } from './StaffCostDialog';
import { todayVietnam } from '../staff/staffContracts';
import { useFinanceSearch } from '../finance/financeScope';
import { invalidateFinance } from '../finance/invalidateFinance';

type Editor = { value: ExpenseInput; previous?: Expense; key: string; reason: string };
export function ExpensesApiPage() {
  const api = useFinanceApi();
  const { session } = useAuth();
  const { locationId: routeLocation } = useParams();
  const search = useFinanceSearch();
  const linkedExpense = search.get('expenseId');
  const locationId = routeLocation || search.get('locationId');
  const linkedDetail = useQuery({
    queryKey: ['expense-detail-link', session?.userId, linkedExpense],
    queryFn: ({ signal }) => api.expense(linkedExpense!, signal),
    enabled: !!linkedExpense,
  });
  if (linkedExpense && linkedDetail.isPending)
    return <LinearProgress aria-label="Đang tải chi tiết khoản chi" />;
  const initialExpense =
    linkedDetail.data && (!locationId || linkedDetail.data.locationId === locationId)
      ? linkedDetail.data
      : undefined;
  return (
    <>
      {linkedExpense && linkedDetail.isError && (
        <Alert
          severity="error"
          action={<Button onClick={() => void linkedDetail.refetch()}>Thử lại</Button>}
        >
          {financeError(linkedDetail.error)}
        </Alert>
      )}
      {linkedDetail.data && !initialExpense && (
        <Alert severity="warning">Khoản chi không thuộc cơ sở đang chọn.</Alert>
      )}
      <ExpensesWorkspace
        key={`${locationId ?? ''}:${initialExpense?.id ?? ''}`}
        initialExpense={initialExpense}
      />
    </>
  );
}

function ExpensesWorkspace({ initialExpense }: { initialExpense?: Expense }) {
  const api = useFinanceApi(),
    queryClient = useQueryClient();
  const { session } = useAuth();
  const actor = session?.userId;
  const { locationId: routeLocation } = useParams();
  const search = useFinanceSearch();
  const routed = useInRouterContext();
  const [filter, setFilter] = useState<ExpenseFilter>(() => ({
    page: 1,
    locationId: search.get('locationId') || undefined,
    expenseType: ['INITIAL_INVESTMENT', 'OPERATING'].includes(search.get('expenseType') ?? '')
      ? search.get('expenseType')!
      : undefined,
  }));
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(() =>
    initialExpense
      ? { value: initialExpense, previous: initialExpense, key: crypto.randomUUID(), reason: '' }
      : null,
  );
  const [staffCostOpen, setStaffCostOpen] = useState(false);
  const [recurringPickerOpen, setRecurringPickerOpen] = useState(false);
  const [editorBusy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const [financeBusy, setFinanceBusy] = useState(false);
  const busy = editorBusy || financeBusy;
  const lock = useRef(false);
  const locations = useQuery({
    queryKey: ['finance-locations', actor],
    queryFn: ({ signal }) => api.locations(signal),
  });
  const scopedFilter = { ...filter, locationId: routeLocation || filter.locationId };
  const invalidRange = !!(filter.from && filter.to && filter.from > filter.to);
  const hasActiveFilters = !!(
    filter.expenseType ||
    filter.locationId ||
    filter.category ||
    filter.from ||
    filter.to
  );
  const today = todayVietnam();
  const reportFilter = {
    from: `${today.slice(0, 7)}-01`,
    to: today,
    locationId: scopedFilter.locationId,
  };
  const report = useQuery({
    queryKey: ['financial-report', actor, reportFilter],
    queryFn: ({ signal }) => api.report(reportFilter, signal),
    enabled: summaryOpen,
  });
  const rows = useQuery({
    queryKey: ['expenses', actor, scopedFilter],
    queryFn: ({ signal }) => api.expenses(scopedFilter, signal),
    enabled: !invalidRange,
  });
  const references = useQuery({
    queryKey: ['expense-references', actor, editor?.value.locationId, editor?.value.roomId],
    queryFn: ({ signal }) =>
      api.expenseReferences(editor!.value.locationId, editor!.value.roomId, signal),
    enabled: !!editor,
  });
  function editField<K extends keyof ExpenseInput>(key: K, value: ExpenseInput[K]) {
    setEditor((e) => e && { ...e, value: { ...e.value, [key]: value } });
  }
  function changeFilter(key: keyof ExpenseFilter, value: string) {
    setFilter((f) => ({ ...f, [key]: value || undefined, page: 1 }));
  }
  async function view(id: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const previous = await api.expense(id);
      setEditor({ value: previous, previous, key: crypto.randomUUID(), reason: '' });
    } catch (e) {
      setError(financeError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save() {
    if (!editor || lock.current || financeBusy || editor.previous?.canEdit === false) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      if (editor.previous)
        await api.updateExpense(
          editor.previous.id,
          editor.value,
          editor.previous.version,
          editor.reason,
        );
      else await api.createExpense(editor.value, editor.key);
      await invalidateFinance(queryClient, actor, editor.value.locationId);
      await queryClient.invalidateQueries({ queryKey: ['expense-detail-link', actor] });
      setEditor(null);
      setSuccess('Đã lưu khoản chi.');
    } catch (e) {
      setError(financeError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const types = [
    { id: 'INITIAL_INVESTMENT', name: 'Đầu tư ban đầu' },
    { id: 'OPERATING', name: 'Chi phí vận hành' },
  ];
  return (
    <>
      <PageHeader
        group={null}
        headingLevel={routeLocation ? 'h2' : 'h1'}
        title="Chi phí & đầu tư"
        subtitle={routeLocation ? undefined : 'Ghi khoản chi và theo dõi số tiền đã trả.'}
        actions={
          <Button
            variant="contained"
            disabled={busy || !locations.data?.length}
            onClick={() => {
              setError('');
              setSuccess('');
              setEditor({
                key: crypto.randomUUID(),
                reason: '',
                value: {
                  locationId: routeLocation || filter.locationId || locations.data![0].id,
                  roomId: null,
                  expenseType:
                    filter.expenseType === 'INITIAL_INVESTMENT'
                      ? 'INITIAL_INVESTMENT'
                      : 'OPERATING',
                  category: '',
                  amount: '',
                  occurredOn: todayVietnam(),
                  note: '',
                },
              });
            }}
          >
            Ghi khoản chi
          </Button>
        }
      />
      <Accordion variant="outlined" disableGutters sx={{ mb: 1.5 }}>
        <AccordionSummary expandIcon={<ChevronDown size={18} />}>
          <Typography variant="subtitle2">Lương, chi phí định kỳ & vốn</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
            {!routeLocation && (
              <Button variant="outlined" onClick={() => setStaffCostOpen(true)}>
                Phân bổ chi phí nhân viên
              </Button>
            )}
            {routed &&
              (scopedFilter.locationId ? (
                <Button
                  component={RouterLink}
                  variant="outlined"
                  to={`/locations/${encodeURIComponent(scopedFilter.locationId)}/investment?tab=recurring`}
                >
                  Chi phí định kỳ
                </Button>
              ) : (
                <Button variant="outlined" onClick={() => setRecurringPickerOpen(true)}>
                  Chi phí định kỳ
                </Button>
              ))}
          </Stack>
          <Dialog
            open={recurringPickerOpen}
            onClose={() => setRecurringPickerOpen(false)}
            fullWidth
            maxWidth="xs"
          >
            <DialogTitle>Chi phí định kỳ theo cơ sở</DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Chọn cơ sở để thiết lập khoản cần chi lặp lại như Internet, vệ sinh. Hệ thống tạo
                chi phí theo lịch; bạn xác nhận thực chi riêng.
              </Typography>
              {locations.isPending && <LinearProgress />}
              {locations.isError && (
                <Alert
                  severity="error"
                  action={<Button onClick={() => void locations.refetch()}>Thử lại</Button>}
                >
                  {financeError(locations.error)}
                </Alert>
              )}
              {locations.data?.length === 0 && (
                <Alert severity="info">Chưa có cơ sở để cấu hình chi phí định kỳ.</Alert>
              )}
              <Stack spacing={1}>
                {routed &&
                  locations.data?.map((item) => (
                    <Button
                      key={item.id}
                      component={RouterLink}
                      variant="outlined"
                      to={`/locations/${encodeURIComponent(item.id)}/investment?tab=recurring`}
                    >
                      {item.label}
                    </Button>
                  ))}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setRecurringPickerOpen(false)}>Đóng</Button>
            </DialogActions>
          </Dialog>
          {staffCostOpen && <StaffCostDialog close={() => setStaffCostOpen(false)} />}
          {
            <Accordion
              variant="outlined"
              disableGutters
              expanded={summaryOpen}
              onChange={(_, open) => setSummaryOpen(open)}
              sx={{ mb: 1.5, '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Xem tổng hợp vốn và chi phí
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 1 }}
                >
                  {scopedFilter.locationId ? 'Toàn cơ sở' : 'Toàn chuỗi'} · đến{' '}
                  {today.split('-').reverse().join('/')}
                </Typography>
                {report.isPending && <LinearProgress aria-label="Đang tải báo cáo chi phí" />}
                {report.isError && (
                  <Alert
                    severity="warning"
                    action={<Button onClick={() => void report.refetch()}>Thử lại</Button>}
                  >
                    {financeError(report.error)}
                  </Alert>
                )}
                {report.data && !report.isError && (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary">
                        Vốn đầu tư ban đầu lũy kế
                      </Typography>
                      <Typography sx={{ fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>
                        {formatFinanceMoney(report.data.total.initialInvestment)}
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary">
                        Chi phí vận hành từ đầu tháng
                      </Typography>
                      <Typography sx={{ fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>
                        {formatFinanceMoney(report.data.total.operatingExpenses)}
                      </Typography>
                    </Box>
                  </Stack>
                )}
              </AccordionDetails>
            </Accordion>
          }
        </AccordionDetails>
      </Accordion>
      {error && !editor && <Alert severity="error">{error}</Alert>}
      {success && <Alert severity="success">{success}</Alert>}
      {((!invalidRange && rows.isPending) || locations.isPending) && <LinearProgress />}
      {((!invalidRange && rows.error) || locations.error) && (
        <Alert
          severity="error"
          action={
            <Button
              onClick={() => {
                if (!invalidRange) void rows.refetch();
                void locations.refetch();
              }}
            >
              Thử lại
            </Button>
          }
        >
          {financeError((!invalidRange && rows.error) || locations.error)}
        </Alert>
      )}
      <Tabs
        aria-label="Loại khoản chi"
        value={filter.expenseType || ''}
        onChange={(_, v: string) => changeFilter('expenseType', v)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{
          mb: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          '& .MuiTab-root': { minHeight: 44 },
        }}
      >
        <Tab value="" label="Tất cả khoản chi" />
        {types.map((t) => (
          <Tab key={t.id} value={t.id} label={t.name} />
        ))}
      </Tabs>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ alignItems: { sm: 'center' }, gap: 1, mb: 1.5 }}
      >
        {!routeLocation && (
          <OptionPicker
            label="Cơ sở"
            value={routeLocation || filter.locationId || ''}
            disabled={!!routeLocation}
            options={locations.data ?? []}
            loading={locations.isPending}
            error={!!locations.error}
            change={(id) => changeFilter('locationId', id)}
          />
        )}
        <Button
          size="small"
          variant={
            advancedFiltersOpen || filter.category || filter.from || filter.to ? 'outlined' : 'text'
          }
          aria-expanded={advancedFiltersOpen}
          aria-controls="expense-advanced-filters"
          onClick={() => setAdvancedFiltersOpen((value) => !value)}
          sx={{ minHeight: { xs: 44, sm: 36 }, alignSelf: { xs: 'flex-start', sm: 'center' } }}
        >
          {advancedFiltersOpen ? 'Ẩn bộ lọc chi tiết' : 'Bộ lọc chi tiết'}
          {!advancedFiltersOpen && (filter.category || filter.from || filter.to)
            ? ' • Đang lọc'
            : ''}
        </Button>
        {(filter.locationId || filter.category || filter.from || filter.to) && (
          <Button
            size="small"
            onClick={() => setFilter({ page: 1, expenseType: filter.expenseType })}
            sx={{ minHeight: { xs: 44, sm: 36 } }}
          >
            Xóa bộ lọc
          </Button>
        )}
      </Stack>
      <Collapse in={advancedFiltersOpen} unmountOnExit={false}>
        <Box id="expense-advanced-filters" sx={{ mb: 1.5 }}>
          <FilterToolbar>
            <TextField
              label="Danh mục"
              value={filter.category || ''}
              onChange={(e) => changeFilter('category', e.target.value)}
              placeholder="Tên danh mục chính xác"
              slotProps={{ htmlInput: { maxLength: 60 } }}
            />
            <TextField
              label="Từ ngày"
              type="date"
              slotProps={{ inputLabel: { shrink: true } }}
              value={filter.from || ''}
              onChange={(e) => changeFilter('from', e.target.value)}
            />
            <TextField
              label="Đến ngày"
              type="date"
              slotProps={{ inputLabel: { shrink: true } }}
              value={filter.to || ''}
              onChange={(e) => changeFilter('to', e.target.value)}
              error={invalidRange}
              helperText={invalidRange ? 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' : undefined}
            />
          </FilterToolbar>
        </Box>
      </Collapse>
      {invalidRange && <Alert severity="warning">Chọn lại khoảng ngày để xem khoản chi.</Alert>}
      {!invalidRange && !rows.error && rows.data?.items.length === 0 && (
        <Alert
          severity="info"
          action={
            hasActiveFilters ? (
              <Button onClick={() => setFilter({ page: 1 })}>Xem tất cả khoản chi</Button>
            ) : undefined
          }
        >
          {hasActiveFilters
            ? 'Không tìm thấy khoản chi theo bộ lọc hiện tại. Xem tất cả khoản chi để kiểm tra lại danh sách.'
            : 'Chưa có khoản chi nào được ghi nhận trong phạm vi này. Chọn Ghi khoản chi để thêm khoản chi thực tế đầu tiên.'}
        </Alert>
      )}
      {!invalidRange && !rows.error && !!rows.data?.items.length && (
        <>
          <Typography variant="subtitle1" sx={{ fontWeight: 750, mb: 1 }}>
            Danh sách khoản chi ({rows.data.total})
          </Typography>
          <Box sx={{ display: { xs: 'grid', md: 'none' }, gap: 1.25 }}>
            {rows.data.items.map((e) => (
              <Paper key={e.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                <Stack spacing={0.75}>
                  <Stack
                    direction="row"
                    sx={{ justifyContent: 'space-between', gap: 1, alignItems: 'flex-start' }}
                  >
                    <Typography sx={{ fontWeight: 750, overflowWrap: 'anywhere' }}>
                      {e.category}
                    </Typography>
                    <Typography
                      sx={{ fontWeight: 800, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatDraftMoney(e.amount)}
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {types.find((t) => t.id === e.expenseType)?.name ?? e.expenseType} ·{' '}
                    {e.occurredOn.split('-').reverse().join('/')} ·{' '}
                    {locations.data?.find((l) => l.id === e.locationId)?.label ??
                      'Cơ sở đã liên kết'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {e.canEdit ? 'Có thể chỉnh sửa tại đây' : 'Do nghiệp vụ nguồn quản lý'}
                  </Typography>
                  {e.note && (
                    <Typography
                      variant="body2"
                      sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}
                    >
                      {e.note}
                    </Typography>
                  )}
                  {(e.assetName || e.taskTitle) && (
                    <Typography variant="caption" color="text.secondary">
                      {[
                        e.assetName ? `Tài sản: ${e.assetName}` : '',
                        e.taskTitle ? `Work Order: ${e.taskTitle}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Typography>
                  )}
                  <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap', pt: 0.5 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={busy}
                      onClick={() => void view(e.id)}
                    >
                      {e.canEdit ? 'Chi tiết / chỉnh sửa' : 'Xem chi tiết'}
                    </Button>
                    {routed && e.taskId && (
                      <Button
                        size="small"
                        component={RouterLink}
                        to={`/maintenance?workOrderId=${encodeURIComponent(e.taskId)}`}
                      >
                        Xem Work Order
                      </Button>
                    )}
                  </Stack>
                  {!e.canEdit && (
                    <Typography variant="caption" color="text.secondary">
                      Do nghiệp vụ nguồn quản lý; chỉ có thể xem chi tiết tại đây.
                    </Typography>
                  )}
                </Stack>
              </Paper>
            ))}
          </Box>
          <TableContainer
            component={Paper}
            variant="outlined"
            sx={{ display: { xs: 'none', md: 'block' } }}
          >
            <Table size="small" sx={{ minWidth: 700 }} aria-label="Khoản chi thực tế">
              <TableHead>
                <TableRow>
                  <TableCell>Khoản chi</TableCell>
                  <TableCell>Ngày phát sinh</TableCell>
                  <TableCell>Phạm vi</TableCell>
                  <TableCell align="right">Số tiền</TableCell>
                  <TableCell>Thao tác</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.data.items.map((e) => (
                  <TableRow key={e.id} hover>
                    <TableCell sx={{ maxWidth: 320 }}>
                      <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                        {e.category}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {types.find((t) => t.id === e.expenseType)?.name ?? e.expenseType}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block' }}
                      >
                        {e.canEdit ? 'Có thể chỉnh sửa tại đây' : 'Do nghiệp vụ nguồn quản lý'}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {e.note}
                      </Typography>
                      {(e.assetName || e.taskTitle) && (
                        <Typography variant="caption" sx={{ display: 'block' }}>
                          {[
                            e.assetName ? `Tài sản: ${e.assetName}` : '',
                            e.taskTitle ? `Work Order: ${e.taskTitle}` : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {e.occurredOn.split('-').reverse().join('/')}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {locations.data?.find((l) => l.id === e.locationId)?.label ??
                          'Cơ sở đã liên kết'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {e.roomId ? 'Phòng riêng' : 'Toàn cơ sở / khu chung'}
                      </Typography>
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        whiteSpace: 'nowrap',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 700,
                      }}
                    >
                      {formatDraftMoney(e.amount)}
                    </TableCell>
                    <TableCell>
                      <Stack sx={{ alignItems: 'flex-start' }}>
                        <Button disabled={busy} onClick={() => void view(e.id)}>
                          {e.canEdit ? 'Chi tiết / chỉnh sửa' : 'Xem chi tiết'}
                        </Button>
                        {routed && e.taskId && (
                          <Button
                            component={RouterLink}
                            to={`/maintenance?workOrderId=${encodeURIComponent(e.taskId)}`}
                          >
                            Xem Work Order
                          </Button>
                        )}
                        {!e.canEdit && (
                          <Typography variant="caption" color="text.secondary">
                            Do nghiệp vụ nguồn quản lý
                          </Typography>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
      {!invalidRange && rows.data && (
        <Stack
          direction="row"
          useFlexGap
          spacing={1.5}
          sx={{ alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', mt: 1.5 }}
        >
          <Button
            disabled={(filter.page || 1) <= 1 || rows.isFetching}
            onClick={() => setFilter((f) => ({ ...f, page: (f.page || 1) - 1 }))}
          >
            Trang trước
          </Button>
          <Typography>
            Trang {rows.data.page} · {rows.data.total} khoản chi phù hợp
          </Typography>
          <Button
            disabled={rows.data.page * rows.data.pageSize >= rows.data.total || rows.isFetching}
            onClick={() => setFilter((f) => ({ ...f, page: (f.page || 1) + 1 }))}
          >
            Trang sau
          </Button>
        </Stack>
      )}
      <Dialog
        open={!!editor}
        onClose={() => {
          if (!busy) setEditor(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{editor?.previous ? 'Chi tiết khoản chi' : 'Ghi khoản chi mới'}</DialogTitle>
        <DialogContent>
          {editor && (
            <ValidatedForm
              id="expense-editor"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <Stack spacing={2} sx={{ pt: 1 }}>
                {error && <Alert severity="error">{error}</Alert>}
                {editor.previous && !editor.previous.canEdit && (
                  <Alert severity="info">
                    Khoản chi này do nghiệp vụ nguồn quản lý; chỉnh sửa tại nghiệp vụ nguồn.
                    {routed && editor.previous.taskId && (
                      <Button
                        component={RouterLink}
                        to={`/maintenance?workOrderId=${encodeURIComponent(editor.previous.taskId)}`}
                      >
                        Mở Work Order liên quan
                      </Button>
                    )}
                  </Alert>
                )}
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    gap: 1.5,
                  }}
                >
                  <TextField
                    select
                    required
                    label="Cơ sở ghi nhận"
                    disabled={busy || !!editor.previous || !!routeLocation}
                    value={editor.value.locationId}
                    onChange={(e) =>
                      setEditor(
                        (v) =>
                          v && {
                            ...v,
                            value: {
                              ...v.value,
                              locationId: e.target.value,
                              roomId: null,
                              assetId: null,
                              taskId: null,
                            },
                          },
                      )
                    }
                  >
                    {locations.data?.map((l) => (
                      <MenuItem key={l.id} value={l.id}>
                        {l.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    required
                    label="Phân loại"
                    disabled={busy || !!editor.previous}
                    value={editor.value.expenseType}
                    onChange={(e) =>
                      setEditor(
                        (v) =>
                          v && {
                            ...v,
                            value: {
                              ...v.value,
                              expenseType: e.target.value as ExpenseInput['expenseType'],
                              taskId: null,
                            },
                          },
                      )
                    }
                  >
                    {types.map((t) => (
                      <MenuItem key={t.id} value={t.id}>
                        {t.name}
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>
                <Autocomplete
                  freeSolo
                  clearText="Xóa tên khoản chi"
                  openText="Xem gợi ý"
                  closeText="Đóng gợi ý"
                  options={
                    editor.value.expenseType === 'OPERATING'
                      ? ['Điện', 'Nước', 'Internet', 'Vệ sinh', 'Sửa chữa']
                      : ['Xây dựng', 'Cải tạo', 'Trang thiết bị']
                  }
                  disabled={busy || editor.previous?.canEdit === false}
                  inputValue={editor.value.category}
                  onInputChange={(_, value) => editField('category', value)}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      required
                      label="Danh mục khoản chi"
                      placeholder="Chọn hoặc nhập tên khoản chi"
                      slotProps={{
                        ...params.slotProps,
                        htmlInput: { ...params.slotProps.htmlInput, maxLength: 60 },
                      }}
                    />
                  )}
                />
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    gap: 1.5,
                  }}
                >
                  <MoneyField
                    maxRawLength={18}
                    required
                    label="Số tiền (VND)"
                    disabled={busy || editor.previous?.canEdit === false}
                    value={editor.value.amount}
                    onValueChange={(raw) => editField('amount', raw)}
                  />
                  <TextField
                    required
                    label="Ngày phát sinh"
                    type="date"
                    disabled={busy || editor.previous?.canEdit === false}
                    value={editor.value.occurredOn}
                    slotProps={{ inputLabel: { shrink: true } }}
                    onChange={(e) => editField('occurredOn', e.target.value)}
                  />
                </Box>
                <TextField
                  required
                  multiline
                  label="Nội dung / tham chiếu chứng từ"
                  disabled={busy || editor.previous?.canEdit === false}
                  value={editor.value.note}
                  slotProps={{ htmlInput: { maxLength: 4000 } }}
                  onChange={(e) => editField('note', e.target.value)}
                />
                {!editor.previous && (
                  <Typography variant="body2" color="text.secondary">
                    Lưu chi phí trước, xác nhận tiền đã trả tại Chi tiết.
                  </Typography>
                )}
                <Accordion
                  variant="outlined"
                  defaultExpanded={Boolean(
                    editor.previous?.roomId || editor.previous?.assetId || editor.previous?.taskId,
                  )}
                  sx={{ borderRadius: '10px !important', '&:before': { display: 'none' } }}
                >
                  <AccordionSummary
                    expandIcon={<ChevronDown size={18} />}
                    aria-controls="expense-reference-details"
                    id="expense-reference-header"
                  >
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
                        Liên kết bổ sung (không bắt buộc)
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails id="expense-reference-details">
                    <Stack spacing={2}>
                      {references.error && (
                        <Alert severity="error">
                          Không tải được lựa chọn phòng/tài sản/Work Order.{' '}
                          <Button type="button" onClick={() => void references.refetch()}>
                            Thử lại lựa chọn
                          </Button>
                        </Alert>
                      )}
                      {references.data?.truncated && (
                        <Alert severity="warning">
                          Danh sách lựa chọn vượt giới hạn 500 mục. Cần thu hẹp dữ liệu nguồn trước
                          khi chọn tham chiếu chưa hiển thị.
                        </Alert>
                      )}
                      <TextField
                        select
                        label="Phòng ghi nhận"
                        value={editor.value.roomId || ''}
                        disabled={
                          busy || !!editor.previous || references.isPending || !!references.error
                        }
                        onChange={(e) =>
                          setEditor(
                            (v) =>
                              v && {
                                ...v,
                                value: {
                                  ...v.value,
                                  roomId: e.target.value || null,
                                  assetId: null,
                                  taskId: null,
                                },
                              },
                          )
                        }
                      >
                        <MenuItem value="">Toàn cơ sở / khu chung</MenuItem>
                        {references.data?.rooms.map((r) => (
                          <MenuItem key={r.id} value={r.id}>
                            {r.label}
                          </MenuItem>
                        ))}
                        {editor.value.roomId &&
                          !references.data?.rooms.some((r) => r.id === editor.value.roomId) && (
                            <MenuItem value={editor.value.roomId}>
                              {editor.previous ? 'Phòng đã liên kết' : 'Phòng đã chọn'}
                            </MenuItem>
                          )}
                      </TextField>
                      <TextField
                        select
                        label="Tài sản liên quan"
                        value={editor.value.assetId || ''}
                        disabled={
                          busy ||
                          !!editor.previous ||
                          !!references.data?.workOrders.find((t) => t.id === editor.value.taskId)
                            ?.assetId ||
                          references.isPending ||
                          !!references.error
                        }
                        onChange={(e) => editField('assetId', e.target.value || null)}
                      >
                        <MenuItem value="">Không gắn tài sản</MenuItem>
                        {references.data?.assets.map((a) => (
                          <MenuItem key={a.id} value={a.id}>
                            {a.label}
                          </MenuItem>
                        ))}
                        {editor.previous?.assetId &&
                          !references.data?.assets.some(
                            (a) => a.id === editor.previous!.assetId,
                          ) && (
                            <MenuItem value={editor.previous.assetId}>
                              {editor.previous.assetName || 'Tài sản đã liên kết'}
                            </MenuItem>
                          )}
                      </TextField>
                      <TextField
                        select
                        label="Work Order liên quan"
                        value={editor.value.taskId || ''}
                        disabled={
                          busy ||
                          !!editor.previous ||
                          editor.value.expenseType !== 'OPERATING' ||
                          references.isPending ||
                          !!references.error
                        }
                        onChange={(e) => {
                          const task = references.data?.workOrders.find(
                            (t) => t.id === e.target.value,
                          );
                          setEditor(
                            (v) =>
                              v && {
                                ...v,
                                value: {
                                  ...v.value,
                                  taskId: task?.id || null,
                                  assetId: task?.assetId ?? null,
                                },
                              },
                          );
                        }}
                      >
                        <MenuItem value="">Không gắn Work Order</MenuItem>
                        {references.data?.workOrders.map((t) => (
                          <MenuItem key={t.id} value={t.id}>
                            {t.label}
                          </MenuItem>
                        ))}
                        {editor.previous?.taskId &&
                          !references.data?.workOrders.some(
                            (t) => t.id === editor.previous!.taskId,
                          ) && (
                            <MenuItem value={editor.previous.taskId}>
                              {editor.previous.taskTitle || 'Công việc đã liên kết'}
                            </MenuItem>
                          )}
                      </TextField>
                      {!references.isPending &&
                        !references.error &&
                        references.data?.workOrders.length === 0 && (
                          <Typography variant="body2">
                            Chưa có Work Order được ghi nhận trong phạm vi này.
                          </Typography>
                        )}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
                {editor.previous?.canEdit && (
                  <TextField
                    required
                    label="Lý do chỉnh sửa"
                    disabled={busy}
                    value={editor.reason}
                    slotProps={{ htmlInput: { maxLength: 1000 } }}
                    onChange={(e) => setEditor((v) => v && { ...v, reason: e.target.value })}
                  />
                )}
                {editor.previous && (
                  <ExpenseEvidencePanel
                    key={editor.previous.id}
                    expenseId={editor.previous.id}
                    disabled={busy}
                  />
                )}
              </Stack>
            </ValidatedForm>
          )}
          {editor?.previous && (
            <ExpenseFinanceActions
              key={editor.previous.id}
              expense={editor.previous}
              disabled={editorBusy}
              onBusyChange={setFinanceBusy}
              onChanged={() => {
                setEditor(null);
                setSuccess('Đã cập nhật thông tin tài chính.');
              }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setEditor(null)}>
            Đóng
          </Button>
          <Button
            type="submit"
            form="expense-editor"
            variant="contained"
            disabled={busy || editor?.previous?.canEdit === false}
          >
            {busy ? 'Đang lưu…' : 'Lưu khoản chi'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
