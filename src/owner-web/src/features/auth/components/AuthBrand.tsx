import { Box, Stack, Typography } from '@mui/material';

/** Shared brand for standalone authentication screens, never part of the form. */
export function AuthBrand({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Box
          component="img"
          src="/bhome-mark.png"
          alt=""
          sx={{ width: 32, height: 32, objectFit: 'contain', flexShrink: 0 }}
        />
        <Typography sx={{ fontWeight: 700 }}>BHome</Typography>
      </Stack>
    );
  }
  return (
    <Stack component="header" sx={{ alignItems: 'center', textAlign: 'center', mb: 3 }}>
      <Box
        component="img"
        src="/bhome-logo.png"
        alt="BHome"
        sx={{ width: 124, height: 124, objectFit: 'contain' }}
      />
      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
        Owner Portal
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320, mt: 0.5 }}>
        Nền tảng quản lý &amp; vận hành chuỗi nhà trọ thông minh
      </Typography>
    </Stack>
  );
}
