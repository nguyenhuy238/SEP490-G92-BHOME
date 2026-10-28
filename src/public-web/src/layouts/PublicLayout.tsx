
import { AppBar, Toolbar, Typography, Box, Container } from '@mui/material';
import { Outlet, Link } from 'react-router';

export default function PublicLayout() {
  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            BHOME
          </Typography>

          <Box sx={{ display: 'flex', gap: 3 }}>
            <Link to="/" style={{ color: 'white' }}>
              Trang chủ
            </Link>
            <Link to="/locations" style={{ color: 'white' }}>
              Cơ sở
            </Link>
          </Box>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Outlet />
      </Container>

      <Box component="footer" sx={{ py: 3, textAlign: 'center' }}>
        <Typography variant="body2">
          © BHOME - Smart Boarding House Management
        </Typography>
      </Box>
    </>
  );
}
