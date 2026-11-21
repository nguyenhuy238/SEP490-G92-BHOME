import { useEffect, useState } from 'react';
import { Alert, Button, Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { useMeterApi } from '../../meters/useMeterApi';
import type { DemoSms } from '../../../../../../packages/client-core/src/smsDemo';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';

export default function DemoSmsInboxPage() {
  const { request } = useMeterApi();
  const [messages, setMessages] = useState<DemoSms[]>([]);
  const [recipient, setRecipient] = useState('');
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const query = new URLSearchParams();
      if (recipient) query.set('recipient', recipient);
      if (template) query.set('template', template);
      setMessages(await request<DemoSms[]>('/api/v1/demo/sms?' + query));
    } catch {
      setMessages([]);
      setError('Hộp thư demo không khả dụng hoặc bạn không có quyền truy cập.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    void request<DemoSms[]>('/api/v1/demo/sms').then(
      (data) => {
        if (active) setMessages(data);
      },
      () => {
        if (active) setError('Hộp thư demo không khả dụng hoặc bạn không có quyền truy cập.');
      },
    );
    return () => {
      active = false;
    };
  }, [request]);
  return (
    <Stack spacing={2}>
      <Typography variant="h5">Hộp thư SMS Demo</Typography>
      <Alert severity="info">
        Môi trường Demo cách ly · Tin nhắn mô phỏng, không gửi qua mạng di động. Mã OTP tự hết hạn.
      </Alert>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          label="ID người nhận demo"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          size="small"
        />
        <TextField
          select
          label="Loại tin"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          size="small"
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">Tất cả</MenuItem>
          {['SMS-01', 'SMS-02', 'SMS-03', 'SMS-04', 'SMS-05', 'SMS-06'].map((id) => (
            <MenuItem key={id} value={id}>
              {id}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="outlined" onClick={() => void refresh()} disabled={busy}>
          {busy ? 'Đang tải…' : 'Làm mới'}
        </Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {!error && messages.length === 0 && (
        <Typography color="text.secondary">Chưa có tin nhắn mô phỏng còn hiệu lực.</Typography>
      )}
      {messages.map((message) => (
        <Paper key={message.id} sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
            <Typography sx={{ fontWeight: 600 }}>{message.maskedPhone}</Typography>
            <Chip size="small" label="Mô phỏng" />
            <Chip size="small" label={message.templateId} />
          </Stack>
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>{message.content}</Typography>
          <Typography variant="caption" color="text.secondary">
            {formatInstant(message.createdAt)} · Mock · {message.recipientId}
          </Typography>
        </Paper>
      ))}
    </Stack>
  );
}
