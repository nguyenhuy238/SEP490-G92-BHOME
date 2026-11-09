import { useState } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';

export function SetupEvidenceField({
  value,
  onChange,
}: {
  value: File | null;
  onChange: (file: File | null) => void;
}) {
  const [error, setError] = useState('');
  return (
    <Stack spacing={1}>
      <Button component="label">
        Chọn ảnh bằng chứng
        <input
          aria-label="Ảnh bằng chứng"
          hidden
          type="file"
          accept="image/png,image/jpeg"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            if (
              file &&
              (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024)
            ) {
              onChange(null);
              setError('Chọn ảnh JPEG hoặc PNG không quá 5 MB.');
            } else {
              onChange(file);
              setError('');
            }
          }}
        />
      </Button>
      {value && <Typography>{value.name}</Typography>}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
}
