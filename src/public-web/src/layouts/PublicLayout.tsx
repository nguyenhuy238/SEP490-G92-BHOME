import { AppBar, Toolbar, Typography, Box, Container } from '@mui/material';
import { Outlet, Link } from 'react-router';

export default function PublicLayout() {
  return (
    <>
      <AppBar position="static">
        <Toolbar sx={{ gap: { xs: 1, sm: 2 }, px: { xs: 1.5, sm: 3 } }}>
          <Box
            component={Link}
            to="/"
            aria-label="BHome - Trang chủ"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flexGrow: 1,
              minWidth: 0,
              textDecoration: 'none',
              color: 'inherit',
              minHeight: 44,
              '&:focus-visible': { outlineColor: 'common.white' },
            }}
          >
            <Box
              component="img"
              src="/bhome-mark.png"
              alt=""
              aria-hidden="true"
              sx={{
                width: 40,
                height: 40,
                p: 0.4,
                borderRadius: 1,
                bgcolor: 'common.white',
                objectFit: 'contain',
                flexShrink: 0,
              }}
            />
            <Typography variant="h6" sx={{ fontWeight: 750, letterSpacing: '-0.02em' }}>
              BHome
            </Typography>
          </Box>

          <Box
            component="nav"
            aria-label="Điều hướng chính"
            sx={{
              display: 'flex',
              flexShrink: 0,
              gap: { xs: 1.5, sm: 3 },
              '& a': { display: 'flex', alignItems: 'center', minHeight: 44, whiteSpace: 'nowrap' },
              '& a:focus-visible': { outlineColor: 'common.white' },
            }}
          >
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
        <Typography variant="body2">© BHome · Thông tin cơ sở và phòng trọ</Typography>
        <Link to="/locations">Xem cơ sở và thông tin liên hệ</Link>
      </Box>
    </>
  );
}
