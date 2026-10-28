
import { Box, Typography, Button } from '@mui/material';
import { Link } from 'react-router';

export default function HomePage() {
  return (
    <Box sx={{ textAlign: 'center', py: 8 }}>
      <Typography variant="h3" fontWeight="bold">
        Chào mừng đến với BHOME
      </Typography>

      <Typography sx={{ mt: 2, mb: 3 }}>
        Khám phá các cơ sở và phòng trọ thuộc hệ thống BHOME.
      </Typography>

      <Button
        component={Link}
        to="/locations"
        variant="contained"
      >
        Khám phá cơ sở
      </Button>
    </Box>
  );
}
