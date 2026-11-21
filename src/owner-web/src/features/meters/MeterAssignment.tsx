import { useRef, useState } from 'react';
import { Alert, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import type { MeterTask } from '../../../../../packages/client-core/src/meter';
import { contractError } from '../../../../../packages/client-core/src/contracts';
import { useMeterApi } from './useMeterApi';
export function MeterAssignment({ task, saved }: { task: MeterTask; saved: () => void }) {
  const api = useMeterApi();
  const { session } = useAuth();
  const [staff, setStaff] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const choices = useQuery({
    queryKey: ['meter-assignment-staff', session?.userId, task.locationId],
    enabled: !!task.locationId,
    queryFn: ({ signal }) =>
      api.request<{ id: string; label: string }[]>('/api/v1/capture/staff', { signal }),
  });
  if (!task.automationPlanId || task.status === 2 || task.status === 3) return null;
  return (
    <Stack spacing={1}>
      <Typography>Phân công: {task.assignedStaffUserId ?? 'Cần phân công Staff'}</Typography>
      <TextField
        select
        label="Staff phụ trách ghi số"
        value={staff}
        onChange={(e) => setStaff(e.target.value)}
      >
        <MenuItem value="">Chọn Staff</MenuItem>
        {choices.data?.map((s) => (
          <MenuItem key={s.id} value={s.id}>
            {s.label}
          </MenuItem>
        ))}
      </TextField>
      <Typography variant="body2">Backend chỉ chấp nhận Staff đang được giao cơ sở này.</Typography>
      {(error || choices.error) && (
        <Alert severity="error">{error || contractError(choices.error)}</Alert>
      )}
      <Button
        disabled={!staff || busy || !task.version}
        onClick={() => {
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError('');
          void api
            .request(`/api/v1/billing-automation/meter-tasks/${task.id}/assignment`, {
              method: 'POST',
              body: JSON.stringify({ staffUserId: staff, expectedVersion: task.version }),
            })
            .then(saved)
            .catch((e) => setError(contractError(e)))
            .finally(() => {
              lock.current = false;
              setBusy(false);
            });
        }}
      >
        Lưu phân công ghi số
      </Button>
    </Stack>
  );
}
