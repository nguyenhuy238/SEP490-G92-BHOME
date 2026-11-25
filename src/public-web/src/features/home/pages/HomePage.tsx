import { Box, Typography, Button, Stack } from '@mui/material';
import { Link } from 'react-router';
import { LocationsPage } from './PublicContentPages';

export default function HomePage() {
  return (
    <Stack spacing={6}>
      <Box sx={{ py: { xs: 2, md: 5 }, maxWidth: '52rem' }}>
        <Typography
          variant="h2"
          component="h1"
          sx={{ fontWeight: 700, fontSize: { xs: '2.4rem', md: '4rem' }, lineHeight: 1.12, mb: 3 }}
        >
          Chào mừng đến với BHome
        </Typography>
        <Typography sx={{ maxWidth: '60ch', fontSize: '1.125rem', mb: 3 }}>
          Tìm nơi ở phù hợp từ thông tin cơ sở, hình ảnh và tiện ích được chủ cơ sở công bố. Xem
          phòng và liên hệ trực tiếp với cơ sở để tìm hiểu thêm.
        </Typography>
        <Button component={Link} to="/locations" variant="contained" size="large">
          Khám phá cơ sở
        </Button>
      </Box>
      <Box>
        <LocationsPage home />
      </Box>
    </Stack>
  );
}
