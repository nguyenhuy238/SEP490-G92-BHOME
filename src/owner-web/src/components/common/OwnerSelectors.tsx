import { useEffect, useState } from 'react';
import { Autocomplete, Button, Stack, TextField } from '@mui/material';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { useMeterApi } from '../../features/meters/useMeterApi';
import {
  ownerError,
  ownerQuery,
  useOwnerQuery,
  type OwnerLocation,
  type OwnerPage,
  type OwnerRoom,
} from '../../hooks/useOwnerWorkspace';

type Option = { id: string; label: string };

function OwnerPicker<T extends { id: string }>({
  value,
  change,
  required,
  label,
  path,
  scope = '',
  enabled = true,
  optionLabel,
}: {
  value: string;
  change: (id: string) => void;
  required: boolean;
  label: string;
  path: string;
  scope?: string;
  enabled?: boolean;
  optionLabel: (item: T) => string;
}) {
  const { session } = useAuth();
  const { request } = useMeterApi();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(input), 250);
    return () => clearTimeout(timer);
  }, [input]);
  const q = useInfiniteQuery({
    queryKey: ['owner-workspace', session?.userId, 'picker', path, scope, search],
    enabled: enabled && !!session?.roles.includes('Owner'),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      request<OwnerPage<T>>(
        path + '?' + ownerQuery({ page: pageParam, pageSize: 20, search, locationId: scope }),
        { signal },
      ),
    getNextPageParam: (last, pages) =>
      last.items.length > 0 &&
      pages.reduce((count, p) => count + p.items.length, 0) < last.totalCount
        ? pages.length + 1
        : undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const found = rows.find((item) => item.id === value);
  const selected = useOwnerQuery<T>(
    ['picker-selected', path, scope, value],
    `${path}/${value}`,
    enabled && !!value && !found,
  );
  const current = found ?? selected.data;
  const options: Option[] = rows.map((item) => ({ id: item.id, label: optionLabel(item) }));
  // Retain the chosen record's label even when a search no longer includes it.
  const chosen = value
    ? { id: value, label: current ? optionLabel(current) : 'Đang tải lựa chọn…' }
    : null;
  if (chosen && !options.some((o) => o.id === chosen.id)) options.unshift(chosen);
  const error = q.error || selected.error;
  function more() {
    if (q.hasNextPage && !q.isFetching) void q.fetchNextPage();
  }
  return (
    <Stack spacing={0.5} sx={{ minWidth: 200, flex: 1 }}>
      <Autocomplete
        size="small"
        openOnFocus
        disabled={!enabled}
        options={options}
        getOptionKey={(item) => item.id}
        value={chosen}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        filterOptions={(items) => items}
        loading={q.isFetching}
        loadingText="Đang tải lựa chọn…"
        noOptionsText={error ? 'Không tải được lựa chọn' : 'Không có kết quả phù hợp'}
        clearText="Xóa lựa chọn"
        openText="Mở lựa chọn"
        closeText="Đóng lựa chọn"
        onInputChange={(_, text, reason) => {
          if (reason === 'input') setInput(text);
          if (reason === 'clear' || reason === 'selectOption' || reason === 'blur') setInput('');
        }}
        onChange={(_, item) => change(item?.id ?? '')}
        onHighlightChange={(_, item) => {
          if (item?.id === options.at(-1)?.id) more();
        }}
        slotProps={{
          listbox: {
            onScroll: (event) => {
              const list = event.currentTarget;
              if (list.scrollTop + list.clientHeight >= list.scrollHeight - 24) more();
            },
          },
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            required={required}
            error={!!error}
            helperText={
              error
                ? ownerError(error)
                : !enabled
                  ? 'Chọn cơ sở trước'
                  : q.hasNextPage
                    ? 'Nhập tên để tìm hoặc cuộn để xem thêm'
                    : undefined
            }
          />
        )}
      />
      {!!error && (
        <Button
          disabled={q.isFetching || selected.isFetching}
          onClick={() => {
            void q.refetch();
            if (selected.error) void selected.refetch();
          }}
        >
          Thử lại {label.toLocaleLowerCase('vi')}
        </Button>
      )}
    </Stack>
  );
}

export function OwnerLocationPicker({
  value,
  change,
  required = false,
}: {
  value: string;
  change: (id: string) => void;
  required?: boolean;
}) {
  return (
    <OwnerPicker<OwnerLocation>
      value={value}
      change={change}
      required={required}
      label="Cơ sở"
      path="/api/v1/locations"
      optionLabel={(item) => item.name}
    />
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
  return (
    <OwnerPicker<OwnerRoom>
      key={location}
      value={value}
      change={change}
      required={required}
      label="Phòng"
      path="/api/v1/rooms"
      scope={location}
      enabled={!!location}
      optionLabel={(item) => item.roomNumber}
    />
  );
}
