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
import { EmptyState } from './PortalUI';
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
}: {
  rows: T[];
  columns: { label: string; render: (row: T) => ReactNode }[];
  id: (row: T) => string;
  select?: (row: T) => void;
}) {
  if (!rows.length) return <EmptyState />;
  return (
    <TableContainer>
      <Table size="small">
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
            <TableRow key={id(row)}>
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
    <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
      <Button disabled={busy || page <= 1} onClick={() => change(page - 1)}>
        Trang trước
      </Button>
      <Typography>
        Trang {page} · {total} bản ghi
      </Typography>
      <Button disabled={busy || page * size >= total} onClick={() => change(page + 1)}>
        Trang sau
      </Button>
    </Stack>
  );
}
