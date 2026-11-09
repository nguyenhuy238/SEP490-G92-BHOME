import { useState } from 'react';
import { MenuItem, Stack, TextField } from '@mui/material';
import {
  ownerQuery,
  useOwnerQuery,
  type OwnerLocation,
  type OwnerPage,
  type OwnerRoom,
} from '../../hooks/useOwnerWorkspace';
import { OwnerFeedback, OwnerPagination } from './OwnerWorkspace';

export function OwnerLocationPicker({
  value,
  change,
  required = false,
}: {
  value: string;
  change: (id: string) => void;
  required?: boolean;
}) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState('');
  const q = useOwnerQuery<OwnerPage<OwnerLocation>>(
    ['location-options', page, search],
    '/api/v1/locations?' + ownerQuery({ page, pageSize: 20, search }),
  );
  return (
    <Stack spacing={1}>
      <TextField
        size="small"
        label="Tìm cơ sở"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      <TextField
        select
        required={required}
        label="Cơ sở"
        value={value}
        onChange={(e) => change(e.target.value)}
      >
        <MenuItem value="">{required ? 'Chọn cơ sở' : 'Tất cả cơ sở'}</MenuItem>
        {value && !q.data?.items.some((x) => x.id === value) && (
          <MenuItem value={value}>{value}</MenuItem>
        )}
        {q.data?.items.map((x) => (
          <MenuItem key={x.id} value={x.id}>
            {x.name}
          </MenuItem>
        ))}
      </TextField>
      <OwnerFeedback busy={q.isFetching} error={q.error} />
      <OwnerPagination
        page={page}
        total={q.data?.totalCount ?? 0}
        change={setPage}
        busy={q.isFetching}
      />
    </Stack>
  );
}
export function OwnerRoomPicker({
  location,
  value,
  change,
  required = false,
}: {
  location: string;
  value: string;
  change: (id: string) => void;
  required?: boolean;
}) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState('');
  const q = useOwnerQuery<OwnerPage<OwnerRoom>>(
    ['room-options', location, page, search],
    '/api/v1/rooms?' + ownerQuery({ locationId: location, page, pageSize: 20, search }),
    !!location,
  );
  return (
    <Stack spacing={1}>
      <TextField
        size="small"
        label="Tìm phòng"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        disabled={!location}
      />
      <TextField
        select
        required={required}
        label="Phòng"
        value={value}
        disabled={!location}
        onChange={(e) => change(e.target.value)}
      >
        <MenuItem value="">{required ? 'Chọn phòng' : 'Tất cả phòng'}</MenuItem>
        {value && !q.data?.items.some((x) => x.id === value) && (
          <MenuItem value={value}>{value}</MenuItem>
        )}
        {q.data?.items.map((x) => (
          <MenuItem key={x.id} value={x.id}>
            {x.roomNumber}
          </MenuItem>
        ))}
      </TextField>
      <OwnerFeedback busy={q.isFetching} error={q.error} />
      <OwnerPagination
        page={page}
        total={q.data?.totalCount ?? 0}
        change={setPage}
        busy={q.isFetching}
      />
    </Stack>
  );
}
