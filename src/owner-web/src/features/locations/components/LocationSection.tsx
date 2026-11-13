import type { ReactNode } from 'react';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';

export function LocationSection({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack spacing={2.5} sx={{ minWidth: 0 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { md: 'center' } }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            component="h2"
            variant="h2"
            sx={{ fontSize: '1.25rem', overflowWrap: 'anywhere' }}
          >
            {title}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.75, maxWidth: 760, lineHeight: 1.7 }}
          >
            {description}
          </Typography>
        </Box>
        {actions && (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexShrink: 0, flexWrap: 'wrap' }}>
            {actions}
          </Stack>
        )}
      </Stack>
      {children}
    </Stack>
  );
}

export function LocationEmpty({
  title,
  description,
  action,
  onAction,
}: {
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 }, textAlign: 'center' }}>
      <Typography component="h3" sx={{ fontWeight: 700, mb: 1 }}>
        {title}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mb: action ? 2 : 0, maxWidth: '65ch', mx: 'auto' }}
      >
        {description}
      </Typography>
      {action && (
        <Button variant="contained" onClick={onAction}>
          {action}
        </Button>
      )}
    </Paper>
  );
}
