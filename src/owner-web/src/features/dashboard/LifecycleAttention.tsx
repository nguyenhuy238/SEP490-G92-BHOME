import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
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
    <Paper
      component="section"
      aria-labelledby="lifecycle-attention-heading"
      variant="outlined"
      sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}
    >
      <Stack spacing={1}>
        <Typography id="lifecycle-attention-heading" component="h2" variant="h2">
          Hồ sơ và thiết bị cần chú ý
        </Typography>
        {query.isPending && <Typography role="status">Đang tải…</Typography>}
        {query.isError && (
          <Alert
            severity="error"
            action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
          >
            Chưa tải được dữ liệu cần chú ý.
          </Alert>
        )}
        {query.data && !query.isError && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
              columnGap: 3,
            }}
          >
            {entries.map(([key, label, to]) => (
              <Button
                key={key}
                component={Link}
                to={to}
                color="inherit"
                sx={{
                  justifyContent: 'space-between',
                  gap: 2,
                  minHeight: 44,
                  px: 0.5,
                  textAlign: 'left',
                  borderBottom: 1,
                  borderColor: 'divider',
                }}
              >
                <span>{label}</span>
                <Box component="span" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {typeof query.data[key] === 'number' ? query.data[key] : '—'}
                </Box>
              </Button>
            ))}
          </Box>
        )}
      </Stack>
    </Paper>
  );
}
