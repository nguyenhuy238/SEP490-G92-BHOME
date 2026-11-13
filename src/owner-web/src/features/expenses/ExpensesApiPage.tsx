import { MoneyField } from '../../components/common/MoneyField';
import { useRef, useState } from 'react';
import {
  Alert,
  Button,
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
        subtitle="Khoản chi thực tế theo cơ sở; lịch sử chỉnh sửa được lưu trên máy chủ."
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
      <Tabs
        aria-label="Loại khoản chi"
        value={filter.expenseType || ''}
        onChange={(_, v: string) => changeFilter('expenseType', v)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mb: 2 }}
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
      {!rows.error && rows.data?.items.length === 0 && (
        <Alert severity="info">Chưa có khoản chi phù hợp.</Alert>
      )}
      {!rows.error &&
        rows.data?.items.map((e) => (
          <Paper
            key={e.id}
            variant="outlined"
            sx={{
              p: 2.5,
              mb: 2,
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '1.5fr 1fr' },
              columnGap: 3,
              rowGap: 1,
              '& > .MuiTypography-h6': { fontWeight: 750 },
              '& > .MuiButton-root': { justifySelf: 'start' },
            }}
          >
            <Typography variant="h6">
              {e.category} — {formatDraftMoney(e.amount)}
            </Typography>
            <Typography>
              {e.occurredOn.split('-').reverse().join('/')} ·{' '}
              {locations.data?.find((l) => l.id === e.locationId)?.label} ·{' '}
              {types.find((t) => t.id === e.expenseType)?.name}
            </Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary', lineHeight: 1.7 }}>
              {e.note}
            </Typography>
            {(e.assetName || e.taskTitle) && (
              <Typography>{[e.assetName, e.taskTitle].filter(Boolean).join(' · ')}</Typography>
            )}
            {routed && e.taskId && (
              <Button
                component={RouterLink}
                to={`/maintenance?workOrderId=${encodeURIComponent(e.taskId)}`}
              >
                Xem Work Order
              </Button>
            )}
            <Button disabled={busy} onClick={() => void view(e.id)}>
              Chi tiết / chỉnh sửa
            </Button>
          </Paper>
        ))}
      {rows.data && (
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
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
        maxWidth="sm"
      >
        <DialogTitle>{editor?.previous ? 'Chi tiết khoản chi' : 'Ghi khoản chi'}</DialogTitle>
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
                    Danh sách lựa chọn vượt giới hạn 500 mục. Cần thu hẹp dữ liệu nguồn trước khi
                    chọn tham chiếu chưa hiển thị.
                  </Alert>
                )}
                <TextField
                  select
                  label="Phòng ghi nhận"
                  value={editor.value.roomId || ''}
                  disabled={busy || !!editor.previous || references.isPending || !!references.error}
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
                    !references.data?.assets.some((a) => a.id === editor.previous!.assetId) && (
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
                    const task = references.data?.workOrders.find((t) => t.id === e.target.value);
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
                    !references.data?.workOrders.some((t) => t.id === editor.previous!.taskId) && (
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
                <MoneyField
                  maxRawLength={18}
                  required
                  label="Số tiền (VND)"
                  disabled={busy}
                  value={editor.value.amount}
                  onValueChange={(raw) => editField('amount', raw)}
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
                <TextField
                  required
                  multiline
                  label="Nội dung / tham chiếu chứng từ"
                  disabled={busy}
                  value={editor.value.note}
                  slotProps={{ htmlInput: { maxLength: 4000 } }}
                  onChange={(e) => editField('note', e.target.value)}
                />
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
