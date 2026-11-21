import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { Link } from 'react-router';
import type { SetupRequest } from '../../../../../packages/client-core/src/propertySetup';

export function LifecycleAttention({ request, actor }: { request: SetupRequest; actor?: string }) {
  const query = useQuery({
    queryKey: ['owner-lifecycle-attention', actor],
    queryFn: ({ signal }) =>
      request<Record<string, number>>('/api/v1/owner-attention/lifecycle', { signal }),
  });
  const entries = [
    ['unsafeEquipment', 'Thiết bị không được sử dụng', '/assets'],
    ['expiredLegalRecords', 'Hồ sơ quá ngày hết hạn ghi nhận', '/locations'],
    ['overdueTaxPeriods', 'Kỳ thuế quá hạn theo dõi', '/finance/tax-records'],
    ['pendingPersonalDataRequests', 'Yêu cầu dữ liệu chờ xử lý', '/account/profile'],
  ];
  return (
    <Stack spacing={1}>
      <Typography variant="h6">Hồ sơ và thiết bị cần chú ý</Typography>
      {query.isPending && <Typography role="status">Đang tải…</Typography>}
      {query.isError && (
        <Alert
          severity="error"
          action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
        >
          Chưa tải được dữ liệu cần chú ý.
        </Alert>
      )}
      {query.data &&
        entries.map(([key, label, to]) => (
          <Button key={key} component={Link} to={to} sx={{ justifyContent: 'space-between' }}>
            <span>{label}</span>
            <span>{typeof query.data[key] === 'number' ? query.data[key] : '—'}</span>
          </Button>
        ))}
    </Stack>
  );
}
