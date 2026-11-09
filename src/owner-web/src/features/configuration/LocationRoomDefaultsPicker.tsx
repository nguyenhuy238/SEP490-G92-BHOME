import { useState } from 'react';
import { Alert, MenuItem, Stack, TextField } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { ErrorState } from '../../components/common/PortalUI';
import { useSharedConfigurationApi } from './useSharedConfigurationApi';

export function LocationRoomDefaultsPicker({
  location,
  choose,
}: {
  location: string;
  choose: (capacity: number) => void;
}) {
  const api = useSharedConfigurationApi();
  const { session } = useAuth();
  const [id, setId] = useState('');
  const query = useQuery({
    queryKey: ['property-setup', 'room-defaults', session?.userId, location],
    queryFn: ({ signal }) => api.roomDefaults(location, signal),
    enabled: !!location && !!session?.roles.includes('Owner'),
  });
  const selected = query.data?.find((d) => d.id === id);
  return (
    <Stack spacing={1}>
      {query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        !!query.data?.length && (
          <TextField
            select
            label="Dùng cấu hình gợi ý"
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              const doc = query.data?.find((d) => d.id === e.target.value);
              if (doc) choose(doc.data.defaults.capacity);
            }}
          >
            <MenuItem value="">Nhập trực tiếp</MenuItem>
            {query.data.map((d) => (
              <MenuItem key={d.id} value={d.id}>
                {d.data.name}
              </MenuItem>
            ))}
          </TextField>
        )
      )}
      {selected && (
        <Alert severity="info">
          Diện tích tham khảo: {selected.data.defaults.area} m². Tiện ích:{' '}
          {selected.data.defaults.amenities.join(', ')}. Giá thuê tham khảo:{' '}
          {selected.data.defaults.referenceRent ?? 'Chưa đặt'}. Giá thu thực tế cần được cấu hình và
          xác nhận riêng.
        </Alert>
      )}
    </Stack>
  );
}
