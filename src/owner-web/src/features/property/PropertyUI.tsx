import { useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { X } from 'lucide-react';
import { usePortalData } from '../../hooks/usePortalData';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../components/common/PortalUI';
import type { DemoDatabase } from '../../types/portal';
import { roomStatuses, type RoomStatus } from './model';
import { matches } from './propertyUtils';

export function PropertyBoundary({ children }: { children: (db: DemoDatabase) => ReactNode }) {
  const q = usePortalData();
  if (q.isPending) return <LoadingState />;
  if (q.error || !q.data?.property)
    return (
      <ErrorState
        error={q.error || new Error('Provider chưa cung cấp dữ liệu quản lý cơ sở.')}
        retry={() => void q.refetch()}
      />
    );
  return <>{children(q.data)}</>;
}
export function RoomBadge({ status }: { status: RoomStatus }) {
  const s = roomStatuses[status];
  return (
    <Chip
      size="small"
      label={s.label}
      sx={{
        color: s.color,
        bgcolor: s.background,
        fontWeight: 650,
        border: `1px solid ${s.color}25`,
      }}
    />
  );
}
export function Panel({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Paper sx={{ p: { xs: 2, md: 3 }, border: '1px solid', borderColor: 'divider', mb: 2 }}>
      <Stack
        direction="row"
        sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2 }}
      >
        <Typography component="h2" sx={{ fontWeight: 650, fontSize: 16 }}>
          {title}
        </Typography>
        {actions}
      </Stack>
      {children}
    </Paper>
  );
}
export function Select({
  label,
  value,
  onChange,
  options,
  all,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; name: string }[];
  all?: string;
}) {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      sx={{ minWidth: 150, flex: 1 }}
    >
      {all !== undefined && <MenuItem value="">{all}</MenuItem>}
      {options.map((o) => (
        <MenuItem key={o.id} value={o.id}>
          {o.name}
        </MenuItem>
      ))}
    </TextField>
  );
}
export function ListView<T>({
  rows,
  searchText,
  children,
  noun = 'bản ghi',
}: {
  rows: T[];
  searchText: (row: T) => string;
  children: (rows: T[]) => ReactNode;
  noun?: string;
}) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(0),
    [size, setSize] = useState(12);
  const filtered = rows.filter((r) => matches(searchText(r), search));
  const actualPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / size) - 1));
  return (
    <>
      <TextField
        label={`Tìm kiếm ${noun}`}
        size="small"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
        sx={{ mb: 2, minWidth: 260, maxWidth: '100%' }}
      />
      {filtered.length ? (
        children(filtered.slice(actualPage * size, (actualPage + 1) * size))
      ) : (
        <EmptyState />
      )}
      <TablePagination
        component="div"
        count={filtered.length}
        page={actualPage}
        rowsPerPage={size}
        rowsPerPageOptions={[6, 12, 24, 60]}
        labelRowsPerPage="Số dòng"
        labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count}`}
        onPageChange={(_, next) => setPage(next)}
        onRowsPerPageChange={(e) => {
          setSize(Number(e.target.value));
          setPage(0);
        }}
      />
    </>
  );
}
export function DataList<T extends { id: string }>({
  rows,
  columns,
  searchText,
  noun,
}: {
  rows: T[];
  columns: { label: string; value: (row: T) => ReactNode }[];
  searchText: (row: T) => string;
  noun?: string;
}) {
  return (
    <ListView rows={rows} searchText={searchText} noun={noun}>
      {(page) => (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {columns.map((c) => (
                  <TableCell
                    key={c.label}
                    sx={{ fontWeight: 650, bgcolor: '#f8fafc', whiteSpace: 'nowrap' }}
                  >
                    {c.label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {page.map((r) => (
                <TableRow key={r.id} hover>
                  {columns.map((c) => (
                    <TableCell key={c.label} sx={{ py: 1.5 }}>
                      {c.value(r)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </ListView>
  );
}
export interface FormField {
  key: string;
  label: string;
  type?: 'number' | 'date' | 'text';
  options?: { id: string; name: string }[];
  required?: boolean;
  helper?: string;
}
export function EditDrawer({
  title,
  fields,
  initial,
  onClose,
  onSave,
  children,
  description,
}: {
  title: string;
  fields: FormField[];
  initial: Record<string, string>;
  onClose: () => void;
  onSave: (values: Record<string, string>) => Promise<void>;
  children?: ReactNode;
  description?: string;
}) {
  const [values, setValues] = useState(initial),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  async function save() {
    setBusy(true);
    setError('');
    try {
      await onSave(values);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể lưu.');
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer
      anchor="right"
      open
      onClose={busy ? undefined : onClose}
      sx={{ '& .MuiDrawer-paper': { width: { xs: '100%', sm: 540 }, p: 3 } }}
    >
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography component="h2" sx={{ fontSize: 20, fontWeight: 650 }}>
          {title}
        </Typography>
        <Button aria-label="Đóng biểu mẫu" disabled={busy} onClick={onClose}>
          <X size={18} />
        </Button>
      </Stack>
      {description && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {description}
        </Alert>
      )}
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          setConfirm(true);
        }}
        sx={{ display: 'grid', gap: 2 }}
      >
        {fields.map((f) => (
          <TextField
            key={f.key}
            label={f.label}
            value={values[f.key] || ''}
            select={!!f.options}
            type={f.type || 'text'}
            required={f.required}
            helperText={f.helper}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { step: f.type === 'number' ? 'any' : undefined },
            }}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
          >
            {f.options?.map((o) => (
              <MenuItem key={o.id} value={o.id}>
                {o.name || '—'}
              </MenuItem>
            ))}
          </TextField>
        ))}
        {children}
        {error && <Alert severity="error">{error}</Alert>}
        <Divider />
        <Stack direction="row" sx={{ gap: 1 }}>
          <Button variant="outlined" disabled={busy} onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            Lưu bản ghi demo
          </Button>
        </Stack>
      </Box>
      <ConfirmDialog
        open={confirm}
        busy={busy}
        title="Xác nhận lưu dữ liệu demo?"
        onClose={() => setConfirm(false)}
        onConfirm={() => void save()}
      >
        Thay đổi sẽ được lưu vào dữ liệu mô phỏng trên trình duyệt này.
      </ConfirmDialog>
    </Drawer>
  );
}
