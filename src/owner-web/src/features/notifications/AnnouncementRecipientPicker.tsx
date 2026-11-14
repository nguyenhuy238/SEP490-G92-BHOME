import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { FilterToolbar } from '../../components/common/PortalUI';
import { OwnerLocationPicker } from '../../components/common/OwnerSelectors';
import { OwnerPagination, OwnerTable } from '../../components/common/OwnerWorkspace';
import { ownerQuery, useOwnerQuery, type OwnerPage } from '../../hooks/useOwnerWorkspace';

export interface AnnouncementRecipient {
  id: string;
  label: string;
}
interface ResidentChoice {
  id: string;
  tenantUserId: string | null;
  displayLabel: string;
  roomNumber: string;
}

export function AnnouncementRecipientPicker({
  value,
  change,
  single,
  disabled,
}: {
  value: AnnouncementRecipient[];
  change: (value: AnnouncementRecipient[]) => void;
  single: boolean;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(''),
    [location, setLocation] = useState(''),
    [page, setPage] = useState(1);
  const q = useOwnerQuery<OwnerPage<ResidentChoice>>(
    ['announcement-recipient-choices', location, search, page],
    '/api/v1/residents?' + ownerQuery({ locationId: location, search, page, pageSize: 20 }),
    open,
  );
  function toggle(r: ResidentChoice) {
    if (!r.tenantUserId) return;
    const selected = value.some((v) => v.id === r.tenantUserId);
    if (selected) change(value.filter((v) => v.id !== r.tenantUserId));
    else if (single) {
      change([{ id: r.tenantUserId, label: r.displayLabel }]);
      setOpen(false);
    } else if (value.length < 500)
      change([...value, { id: r.tenantUserId, label: r.displayLabel }]);
  }
  return (
    <Stack spacing={1}>
      <Button disabled={disabled} variant="outlined" onClick={() => setOpen(true)}>
        Chọn tài khoản người nhận
      </Button>
      <Typography variant="body2">
        {value.length} tài khoản đã chọn. Máy chủ kiểm tra lại điều kiện nhận theo cư trú hiện tại.
      </Typography>
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
        {value.map((v) => (
          <Chip
            key={v.id}
            label={v.label}
            onDelete={disabled ? undefined : () => change(value.filter((x) => x.id !== v.id))}
          />
        ))}
      </Stack>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="md"
        aria-labelledby="recipient-picker-title"
      >
        <DialogTitle id="recipient-picker-title">Chọn tài khoản người nhận</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <FilterToolbar>
              <OwnerLocationPicker
                value={location}
                change={(id) => {
                  setLocation(id);
                  setPage(1);
                }}
              />
              <TextField
                label="Tìm tên người nhận"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </FilterToolbar>
            <Alert severity="info">
              Chỉ chọn người ở đã liên kết tài khoản. Bước kiểm tra người nhận sẽ xác định lại điều
              kiện cư trú hiện tại. Chọn tối đa 500 tài khoản.
            </Alert>
            <OwnerTable
              rows={q.data?.items ?? []}
              id={(r) => r.id}
              loading={q.isFetching}
              error={q.error}
              retry={() => void q.refetch()}
              label="Lựa chọn người nhận"
              columns={[
                {
                  label: 'Chọn',
                  render: (r) => (
                    <Checkbox
                      slotProps={{ input: { 'aria-label': `Chọn người nhận ${r.displayLabel}` } }}
                      checked={!!r.tenantUserId && value.some((v) => v.id === r.tenantUserId)}
                      disabled={
                        !r.tenantUserId ||
                        (!single &&
                          value.length >= 500 &&
                          !value.some((v) => v.id === r.tenantUserId))
                      }
                      onChange={() => toggle(r)}
                    />
                  ),
                },
                { label: 'Người ở', render: (r) => r.displayLabel },
                { label: 'Phòng', render: (r) => r.roomNumber },
                {
                  label: 'Tài khoản',
                  render: (r) => (r.tenantUserId ? 'Đã liên kết' : 'Chưa liên kết'),
                },
              ]}
            />
            <OwnerPagination
              page={page}
              total={q.data?.totalCount ?? 0}
              busy={q.isFetching}
              change={setPage}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Xong</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
