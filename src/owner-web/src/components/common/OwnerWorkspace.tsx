import type { ReactNode } from 'react';
import {
  Alert,
  Box,
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
  useMediaQuery,
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
  selectLabel = 'Xem chi tiết',
}: {
  rows: T[];
  columns: { label: string; render: (row: T) => ReactNode }[];
  id: (row: T) => string;
  select?: (row: T) => void;
  loading?: boolean;
  error?: unknown;
  retry?: () => void;
  label?: string;
  selectLabel?: string;
}) {
  const compact = useMediaQuery('(max-width:599px)');
  if (error)
    return retry ? (
      <ErrorState error={new Error(ownerError(error))} retry={retry} />
    ) : (
      <Alert severity="error">{ownerError(error)}</Alert>
    );
  if (loading && !rows.length) return <LoadingState />;
  if (!rows.length) return <EmptyState />;
  // A compact record summary keeps the actual data and primary action visible
  // without requiring a horizontal swipe on a phone. Desktop keeps every column.
  if (compact && columns.length > 1) {
    return (
      <TableContainer aria-busy={loading || undefined} sx={{ maxWidth: '100%' }}>
        <Table size="small" aria-label={label} sx={{ tableLayout: 'fixed' }}>
          <TableHead>
            <TableRow>
              <TableCell scope="col">{columns[0].label}</TableCell>
              {select && (
                <TableCell scope="col" align="right" sx={{ width: 112 }}>
                  Thao tác
                </TableCell>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={id(row)} hover>
                <TableCell
                  component="th"
                  scope="row"
                  sx={{ verticalAlign: 'top', minWidth: 0, overflowWrap: 'anywhere', py: 1.25 }}
                >
                  <Stack
                    spacing={0.75}
                    sx={{ minWidth: 0, '& > *': { minWidth: 0, maxWidth: '100%' } }}
                  >
                    <Box sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}>
                      {columns[0].render(row)}
                    </Box>
                    {columns.slice(1).map((column) => (
                      <Box key={column.label} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        <Typography variant="caption" component="div" color="text.secondary">
                          {column.label}
                        </Typography>
                        <Box sx={{ fontWeight: 400 }}>{column.render(row)}</Box>
                      </Box>
                    ))}
                  </Stack>
                </TableCell>
                {select && (
                  <TableCell align="right" sx={{ verticalAlign: 'top', px: 1, py: 1.25 }}>
                    <Button
                      onClick={() => select(row)}
                      sx={{
                        maxWidth: '100%',
                        minHeight: 44,
                        lineHeight: 1.4,
                        whiteSpace: 'normal',
                      }}
                    >
                      {selectLabel}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }
  return (
    <TableContainer aria-busy={loading || undefined} sx={{ maxWidth: '100%' }}>
      <Table size="small" aria-label={label}>
        <TableHead>
          <TableRow>
            {columns.map((c) => (
              <TableCell key={c.label} scope="col">
                {c.label}
              </TableCell>
            ))}
            {select && (
              <TableCell scope="col" align="right">
                Thao tác
              </TableCell>
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={id(row)} hover>
              {columns.map((c) => (
                <TableCell key={c.label} sx={{ overflowWrap: 'anywhere' }}>
                  {c.render(row)}
                </TableCell>
              ))}
              {select && (
                <TableCell align="right">
                  <Button onClick={() => select(row)} sx={{ whiteSpace: 'nowrap' }}>
                    {selectLabel}
                  </Button>
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
      spacing={1}
      sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}
    >
      <Button disabled={busy || page <= 1} onClick={() => change(page - 1)}>
        Trang trước
      </Button>
      <Typography variant="body2" aria-live="polite" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        Trang {page} · {total} bản ghi
      </Typography>
      <Button disabled={busy || page * size >= total} onClick={() => change(page + 1)}>
        Trang sau
      </Button>
    </Stack>
  );
}
