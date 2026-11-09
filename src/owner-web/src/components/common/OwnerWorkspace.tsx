import type { ReactNode } from 'react';
import {
  Alert,
  Button,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { EmptyState, ErrorState, LoadingState } from './PortalUI';
import { ownerError } from '../../hooks/useOwnerWorkspace';

export function OwnerFeedback({
  busy,
  error,
  notice,
}: {
  busy?: boolean;
  error?: unknown;
  notice?: string;
}) {
  return (
    <>
      {busy && <LinearProgress />}
      {!!error && (
        <Alert severity="error">{typeof error === 'string' ? error : ownerError(error)}</Alert>
      )}
      {!!notice && <Alert severity="success">{notice}</Alert>}
    </>
  );
}
export function OwnerTable<T>({
  rows,
  columns,
  id,
  select,
  loading,
  error,
  retry,
  label = 'Danh sách bản ghi',
}: {
  rows: T[];
  columns: { label: string; render: (row: T) => ReactNode }[];
  id: (row: T) => string;
  select?: (row: T) => void;
  loading?: boolean;
  error?: unknown;
  retry?: () => void;
  label?: string;
}) {
  if (error) return <ErrorState error={new Error(ownerError(error))} retry={retry ?? (() => {})} />;
  if (loading && !rows.length) return <LoadingState />;
  if (!rows.length) return <EmptyState />;
  return (
    <TableContainer aria-busy={loading || undefined}>
      <Table size="small" aria-label={label}>
        <TableHead>
          <TableRow>
            {columns.map((c) => (
              <TableCell key={c.label}>{c.label}</TableCell>
            ))}
            {select && <TableCell>Chi tiết</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={id(row)} hover>
              {columns.map((c) => (
                <TableCell key={c.label}>{c.render(row)}</TableCell>
              ))}
              {select && (
                <TableCell>
                  <Button onClick={() => select(row)}>Xem chi tiết</Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
export function OwnerPagination({
  page,
  total,
  size = 20,
  change,
  busy,
}: {
  page: number;
  total: number;
  size?: number;
  change: (page: number) => void;
  busy?: boolean;
}) {
  return (
    <Stack
      component="nav"
      aria-label="Phân trang danh sách"
      direction="row"
      useFlexGap
      spacing={1.5}
      sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}
    >
      <Button disabled={busy || page <= 1} onClick={() => change(page - 1)}>
        Trang trước
      </Button>
      <Typography variant="body2" aria-live="polite">
        Trang {page} · {total} bản ghi
      </Typography>
      <Button disabled={busy || page * size >= total} onClick={() => change(page + 1)}>
        Trang sau
      </Button>
    </Stack>
  );
}
