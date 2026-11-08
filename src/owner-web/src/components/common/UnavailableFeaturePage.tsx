import { Alert, Paper, Stack, Typography } from '@mui/material';
import { PageHeader } from './PortalUI';

export function UnavailableFeaturePage({ title, description, requirements }: {
  title: string;
  description: string;
  requirements: string[];
}) {
  return <Stack spacing={2}>
    <PageHeader title={title} subtitle={description} />
    <Alert severity="warning">
      Backend đang chạy chưa cung cấp contract API cho quy trình này. Owner Web không tạo dữ liệu giả
      và không dùng API của nghiệp vụ khác để thay thế.
    </Alert>
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>Backend cần bổ sung</Typography>
      <Stack component="ul" spacing={1} sx={{ pl: 3, m: 0 }}>
        {requirements.map((item) => <Typography component="li" key={item}>{item}</Typography>)}
      </Stack>
    </Paper>
  </Stack>;
}
