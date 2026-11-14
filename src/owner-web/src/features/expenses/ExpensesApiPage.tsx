import { useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { ChevronDown } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useInRouterContext, useParams } from 'react-router';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  financeError,
  type Expense,
  type ExpenseFilter,
  type ExpenseInput,
} from '../../../../../packages/client-core/src/finance';
import { formatDraftMoney } from '../../../../../packages/client-core/src/mainDrafts';
import { FilterToolbar, PageHeader } from '../../components/common/PortalUI';
import { OptionPicker } from '../../components/common/OptionPicker';
import { useFinanceApi } from './useFinanceApi';
import { ExpenseEvidencePanel } from './ExpenseEvidencePanel';

type Editor = { value: ExpenseInput; previous?: Expense; key: string; reason: string };
export function ExpensesApiPage() {
  const api = useFinanceApi(),
    queryClient = useQueryClient();
  const { session } = useAuth();
  const actor = session?.userId;
  const { locationId: routeLocation } = useParams();
  const routed = useInRouterContext();
  const [filter, setFilter] = useState<ExpenseFilter>({ page: 1 });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const lock = useRef(false);
  const locations = useQuery({
    queryKey: ['finance-locations', actor],
    queryFn: ({ signal }) => api.locations(signal),
  });
  const scopedFilter = { ...filter, locationId: routeLocation || filter.locationId };
  const rows = useQuery({
    queryKey: ['expenses', actor, scopedFilter],
    queryFn: ({ signal }) => api.expenses(scopedFilter, signal),
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
    if (!editor || lock.current) return;
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
      await queryClient.invalidateQueries({ queryKey: ['expenses', actor] });
      await queryClient.invalidateQueries({ queryKey: ['financial-report', actor] });
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
        title="Đầu tư ban đầu & Chi phí"
        subtitle="Theo dõi chi phí và vốn đầu tư theo cơ sở. Xem chi tiết hoặc ghi khoản chi ngay tại đây."
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
                  occurredOn: '',
                  note: '',
                },
              });
            }}
          >
            Ghi khoản chi
          </Button>
        }
      />
      {error && !editor && <Alert severity="error">{error}</Alert>}
      {success && <Alert severity="success">{success}</Alert>}
      {(rows.isPending || locations.isPending) && <LinearProgress />}
      {(rows.error || locations.error) && (
        <Alert
          severity="error"
          action={
            <Button
              onClick={() => {
                void rows.refetch();
                void locations.refetch();
              }}
            >
              Thử lại
            </Button>
          }
        >
          {financeError(rows.error || locations.error)}
        </Alert>
      )}
      <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, mb: 2, borderRadius: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          sx={{ justifyContent: 'space-between', alignItems: { md: 'center' }, gap: 1 }}
        >
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Tìm khoản chi
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Chọn loại khoản chi và phạm vi cần xem.
            </Typography>
          </Box>
          {(filter.locationId ||
            filter.category ||
            filter.from ||
            filter.to ||
            filter.expenseType) && (
            <Button size="small" onClick={() => setFilter({ page: 1 })}>
              Xóa bộ lọc
            </Button>
          )}
        </Stack>
        <Tabs
          aria-label="Loại khoản chi"
          value={filter.expenseType || ''}
          onChange={(_, v: string) => changeFilter('expenseType', v)}
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{ my: 1.5, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="" label="Tất cả khoản chi" />
          {types.map((t) => (
            <Tab key={t.id} value={t.id} label={t.name} />
          ))}
        </Tabs>
        <FilterToolbar>
          <OptionPicker
            label="Cơ sở"
            value={routeLocation || filter.locationId || ''}
            disabled={!!routeLocation}
            options={locations.data ?? []}
            loading={locations.isPending}
            error={!!locations.error}
            change={(id) => changeFilter('locationId', id)}
          />
          <TextField
            label="Danh mục"
            value={filter.category || ''}
            onChange={(e) => changeFilter('category', e.target.value)}
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
          />
        </FilterToolbar>
      </Paper>
      {rows.data && (
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Danh sách khoản chi ({rows.data.total})
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Chọn Chi tiết / chỉnh sửa để xem chứng từ và thông tin liên quan.
          </Typography>
        </Stack>
      )}
      {!rows.error && rows.data?.items.length === 0 && (
        <Alert severity="info">Chưa có khoản chi phù hợp.</Alert>
      )}
      {!rows.error &&
        rows.data?.items.map((e) => (
          <Paper
            key={e.id}
            variant="outlined"
            sx={{
              p: { xs: 1.5, sm: 2 },
              mb: 1.25,
              borderRadius: 2,
            }}
          >
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between', gap: 2 }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack
                  direction="row"
                  sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 0.75 }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {e.category} — {formatDraftMoney(e.amount)}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={types.find((t) => t.id === e.expenseType)?.name ?? e.expenseType}
                  />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {e.occurredOn.split('-').reverse().join('/')} ·{' '}
                  {locations.data?.find((l) => l.id === e.locationId)?.label}
                </Typography>
                {e.note && (
                  <Typography
                    variant="body2"
                    sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {e.note}
                  </Typography>
                )}
                {(e.assetName || e.taskTitle) && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 0.5 }}
                  >
                    Liên kết: {[e.assetName, e.taskTitle].filter(Boolean).join(' · ')}
                  </Typography>
                )}
              </Box>
              <Stack
                spacing={1}
                sx={{ alignItems: { xs: 'flex-start', md: 'flex-end' }, flexShrink: 0 }}
              >
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                  {routed && e.taskId && (
                    <Button
                      size="small"
                      component={RouterLink}
                      to={`/maintenance?workOrderId=${encodeURIComponent(e.taskId)}`}
                    >
                      Xem Work Order
                    </Button>
                  )}
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={busy}
                    onClick={() => void view(e.id)}
                  >
                    Chi tiết / chỉnh sửa
                  </Button>
                </Stack>
              </Stack>
            </Stack>
          </Paper>
        ))}
      {rows.data && (
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', justifyContent: 'center', my: 2 }}
        >
          <Button
            disabled={(filter.page || 1) <= 1 || rows.isFetching}
            onClick={() => setFilter((f) => ({ ...f, page: (f.page || 1) - 1 }))}
          >
            Trang trước
          </Button>
          <Typography>
            Trang {rows.data.page} · {rows.data.total} khoản chi
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
        maxWidth="md"
      >
        <DialogTitle>{editor?.previous ? 'Chi tiết khoản chi' : 'Ghi khoản chi mới'}</DialogTitle>
        <DialogContent>
          {editor && (
            <form
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
                  </Alert>
                )}
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    1. Chọn cơ sở phát sinh
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Khoản chi thuộc cơ sở nào? Bạn có thể liên kết phòng hoặc tài sản ở bước 3.
                  </Typography>
                </Box>
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
                <Box sx={{ pt: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    2. Nội dung & số tiền
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Điền thông tin thực tế để lưu vào sổ chi phí.
                  </Typography>
                </Box>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    gap: 2,
                  }}
                >
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
                  <TextField
                    required
                    label="Danh mục khoản chi"
                    disabled={busy}
                    value={editor.value.category}
                    slotProps={{ htmlInput: { maxLength: 60 } }}
                    onChange={(e) => editField('category', e.target.value)}
                  />
                  <TextField
                    required
                    label="Số tiền (VND)"
                    disabled={busy}
                    value={editor.value.amount}
                    slotProps={{
                      htmlInput: { pattern: '[0-9]+', maxLength: 18, inputMode: 'numeric' },
                    }}
                    onChange={(e) => editField('amount', e.target.value)}
                  />
                  <TextField
                    required
                    label="Ngày phát sinh"
                    type="date"
                    disabled={busy}
                    value={editor.value.occurredOn}
                    slotProps={{ inputLabel: { shrink: true } }}
                    onChange={(e) => editField('occurredOn', e.target.value)}
                  />
                </Box>
                <TextField
                  required
                  multiline
                  label="Nội dung / tham chiếu chứng từ"
                  disabled={busy}
                  value={editor.value.note}
                  slotProps={{ htmlInput: { maxLength: 4000 } }}
                  onChange={(e) => editField('note', e.target.value)}
                />
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
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        3. Liên kết bổ sung (không bắt buộc)
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Chỉ mở khi khoản chi thuộc phòng, tài sản hoặc công việc bảo trì cụ thể.
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
                        {editor.previous?.roomId &&
                          !references.data?.rooms.some((r) => r.id === editor.previous!.roomId) && (
                            <MenuItem value={editor.previous.roomId}>Phòng đã liên kết</MenuItem>
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
                {editor.previous && (
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
            </form>
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
