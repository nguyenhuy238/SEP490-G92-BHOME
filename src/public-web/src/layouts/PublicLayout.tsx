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

          <Box component="nav" aria-label="Điều hướng chính" sx={{ display: 'flex', gap: 3 }}>
            <Link to="/" style={{ color: 'white' }}>
              Trang chủ
            </Link>
            <Link to="/locations" style={{ color: 'white' }}>
              Cơ sở
            </Link>
          </Box>
        </Toolbar>
      </AppBar>

      <Container
        component="main"
        maxWidth="lg"
        sx={{ py: { xs: 4, md: 6 }, minHeight: '70vh', overflowWrap: 'anywhere' }}
      >
        <Outlet />
      </Container>

      <Box component="footer" sx={{ py: 3, textAlign: 'center' }}>
        <Typography variant="body2">© BHOME - Smart Boarding House Management</Typography>
      </Box>
    </>
  );
}
