import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { ownerQuery, useOwnerQuery, type OwnerPage } from '../../hooks/useOwnerWorkspace';
import { OwnerTable, OwnerPagination } from '../../components/common/OwnerWorkspace';
import type { Incident } from './incidentContracts';
export interface IncidentReferenceScope {
  id: string;
  locationId: string;
  roomId: string | null;
  assetId: string | null;
}
export function IncidentReferenceField({
  scope,
  change,
  disabled,
}: {
  scope: IncidentReferenceScope;
  change: (id: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(1),
    [label, setLabel] = useState('');
  const path =
    '/api/v1/incidents?' +
    ownerQuery({
      locationId: scope.locationId,
      roomId: scope.roomId,
      assetId: scope.assetId,
      page,
      pageSize: 20,
    });
  const q = useOwnerQuery<OwnerPage<Incident>>(['incident-reference', path], path, open);
  const rows =
    q.data?.items.filter(
      (i) =>
        i.id !== scope.id &&
        i.roomId === scope.roomId &&
        i.assetId === scope.assetId &&
        !['Duplicate', 'Rejected', 'Cancelled'].includes(i.status),
    ) ?? [];
  return (
    <Stack spacing={1}>
      <Typography>{label || 'Chưa chọn sự cố gốc'}</Typography>
      <Button disabled={disabled} onClick={() => setOpen(true)}>
        Chọn sự cố gốc
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="md"
        fullWidth
        aria-labelledby="incident-reference-title"
      >
        <DialogTitle id="incident-reference-title">Chọn sự cố gốc cùng phạm vi</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Các hồ sơ đủ điều kiện trong trang đang xem. Máy chủ kiểm tra lại phạm vi và trạng thái
            khi lưu quyết định.
          </Typography>
          <OwnerTable
            rows={rows}
            id={(i) => i.id}
            loading={q.isFetching}
            error={q.error}
            retry={() => void q.refetch()}
            selectLabel="Chọn sự cố này"
            select={(i) => {
              change(i.id);
              setLabel(`${i.code} · ${i.description}`);
              setOpen(false);
            }}
            columns={[
              { label: 'Mã', render: (i) => i.code },
              { label: 'Nội dung', render: (i) => i.description },
            ]}
          />
          <OwnerPagination
            page={page}
            total={q.data?.totalCount ?? 0}
            busy={q.isFetching}
            change={setPage}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Đóng chọn sự cố</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
