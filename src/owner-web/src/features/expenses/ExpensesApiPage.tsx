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
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import {
  financeError,
  type Expense,
  type ExpenseFilter,
  type ExpenseInput,
} from '../../../../../packages/client-core/src/finance';
import { formatDraftMoney } from '../../../../../packages/client-core/src/mainDrafts';
import { PageHeader } from '../../components/common/PortalUI';
import { useFinanceApi } from './useFinanceApi';

type Editor = { value: ExpenseInput; previous?: Expense; key: string; reason: string };
export function ExpensesApiPage() {
  const api = useFinanceApi(),
    queryClient = useQueryClient();
  const { session } = useAuth();
  const actor = session?.userId;
  const { locationId: routeLocation } = useParams();
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
                  expenseType: 'OPERATING',
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
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ my: 2 }}>
        <TextField
          select
          label="Cơ sở"
          value={routeLocation || filter.locationId || ''}
          disabled={!!routeLocation}
          onChange={(e) => changeFilter('locationId', e.target.value)}
        >
          <MenuItem value="">Tất cả cơ sở</MenuItem>
          {locations.data?.map((l) => (
            <MenuItem key={l.id} value={l.id}>
              {l.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Loại khoản chi"
          value={filter.expenseType || ''}
          onChange={(e) => changeFilter('expenseType', e.target.value)}
        >
          <MenuItem value="">Tất cả</MenuItem>
          {types.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.name}
            </MenuItem>
          ))}
        </TextField>
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
      </Stack>
      {!rows.error && rows.data?.items.length === 0 && (
        <Alert severity="info">Chưa có khoản chi phù hợp.</Alert>
      )}
      {!rows.error &&
        rows.data?.items.map((e) => (
          <Paper key={e.id} sx={{ p: 2, mb: 1 }}>
            <Typography variant="h6">
              {e.category} — {formatDraftMoney(e.amount)}
            </Typography>
            <Typography>
              {e.occurredOn.split('-').reverse().join('/')} ·{' '}
              {locations.data?.find((l) => l.id === e.locationId)?.label} ·{' '}
              {types.find((t) => t.id === e.expenseType)?.name}
            </Typography>
            <Typography>{e.note}</Typography>
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
                  disabled={busy || !!editor.previous}
                  value={editor.value.locationId}
                  onChange={(e) => editField('locationId', e.target.value)}
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
                    editField('expenseType', e.target.value as ExpenseInput['expenseType'])
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
