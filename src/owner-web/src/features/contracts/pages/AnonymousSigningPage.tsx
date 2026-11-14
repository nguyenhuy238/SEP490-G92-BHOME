import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { createApiClient } from '../../../../../../packages/client-core/src/api';
import { apiBaseUrl } from '../../../services/config';
import {
  internalSigningClient,
  signingMessage,
  type DrawnPoint,
  type SigningAccess,
} from '../../../../../../packages/client-core/src/internalSigning';

export default function AnonymousSigningPage() {
  const api = useMemo(() => internalSigningClient(createApiClient(apiBaseUrl)), []);
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
  );
  const [otp, setOtp] = useState(''),
    [info, setInfo] = useState(''),
    [access, setAccess] = useState<SigningAccess | null>(null),
    [url, setUrl] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [done, setDone] = useState(false),
    [drawn, setDrawn] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    strokes = useRef<DrawnPoint[][]>([]),
    drawing = useRef(false),
    lock = useRef(false),
    objectUrl = useRef('');
  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname);
    let active = true;
    void api
      .info(token)
      .then((i) => {
        if (active) {
          setInfo('Mã được gửi đến ' + i.maskedEmail);
          setDone(i.accepted);
        }
      })
      .catch((e) => {
        if (active) setError(signingMessage(e));
      });
    return () => {
      active = false;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      strokes.current = [];
    };
  }, [api, token]);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(signingMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }
  return (
    <Box component="main" sx={{ maxWidth: 1000, mx: 'auto', p: 2 }}>
      <Paper sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography component="h1" variant="h5">
            Đọc và chấp thuận hợp đồng BHOME
          </Typography>
          <Alert severity="info">
            Ký bằng OTP và nét vẽ; không cần tài khoản. Đây là chấp thuận điện tử nội bộ, không phải
            chữ ký số CA.
          </Alert>
          {error && <Alert severity="error">{error}</Alert>}
          {done ? (
            <Alert severity="success">
              Đã ghi nhận chấp thuận. Owner tiếp tục xác nhận, kiểm tra cọc và kích hoạt. Bạn sẽ
              nhận lời mời thiết lập tài khoản sau khi Main Active.
            </Alert>
          ) : (
            <>
              {!access ? (
                <>
                  <Typography>{info}</Typography>
                  <Button
                    disabled={busy || !info}
                    onClick={() =>
                      void run(async () => {
                        await api.otp(token);
                        setInfo('Đã yêu cầu gửi mã xác nhận. Kiểm tra email của bạn.');
                      })
                    }
                  >
                    Gửi mã OTP
                  </Button>
                  <TextField
                    label="Mã OTP 6 chữ số"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    disabled={busy}
                    autoComplete="one-time-code"
                  />
                  <Button
                    disabled={busy || otp.length !== 6}
                    onClick={() =>
                      void run(async () => {
                        const next = await api.verify(token, otp);
                        const bytes = await api.document(token, next.session);
                        objectUrl.current = URL.createObjectURL(
                          new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
                        );
                        setUrl(objectUrl.current);
                        setAccess(next);
                        setOtp('');
                        bytes.fill(0);
                      })
                    }
                  >
                    Xác minh và xem hợp đồng
                  </Button>
                </>
              ) : (
                <>
                  <iframe
                    title="PDF hợp đồng cần chấp thuận"
                    src={url}
                    style={{ width: '100%', height: 620, border: 0 }}
                  />
                  <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
                    Mã tài liệu: {access.documentHash}
                  </Typography>
                  <Typography>Vẽ chữ ký trong khung dưới</Typography>
                  <canvas
                    ref={canvas}
                    width={900}
                    height={300}
                    aria-label="Khung vẽ chữ ký"
                    style={{
                      width: '100%',
                      height: 220,
                      touchAction: 'none',
                      border: '1px solid #667085',
                    }}
                    onPointerDown={(e) => {
                      if (busy || strokes.current.length >= 20) return;
                      drawing.current = true;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      strokes.current.push([point(e)]);
                    }}
                    onPointerMove={(e) => {
                      if (!drawing.current) return;
                      const stroke = strokes.current.at(-1)!;
                      if (stroke.length >= 1000 || strokes.current.flat().length >= 4000) return;
                      const next = point(e),
                        last = stroke.at(-1)!;
                      const ctx = canvas.current?.getContext('2d');
                      if (ctx) {
                        ctx.lineWidth = 3;
                        ctx.beginPath();
                        ctx.moveTo(last.x * 900, last.y * 300);
                        ctx.lineTo(next.x * 900, next.y * 300);
                        ctx.stroke();
                      }
                      stroke.push(next);
                      setDrawn(true);
                    }}
                    onPointerUp={() => {
                      drawing.current = false;
                    }}
                    onPointerCancel={() => {
                      drawing.current = false;
                    }}
                  />
                  <Button
                    disabled={busy}
                    onClick={() => {
                      canvas.current?.getContext('2d')?.clearRect(0, 0, 900, 300);
                      strokes.current = [];
                      setDrawn(false);
                    }}
                  >
                    Vẽ lại
                  </Button>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={consent}
                        disabled={busy}
                        onChange={(_, v) => setConsent(v)}
                      />
                    }
                    label="Tôi đã đọc đúng PDF, đồng ý nội dung và dùng nét ký trên để chấp thuận hợp đồng"
                  />
                  <Button
                    variant="contained"
                    disabled={busy || !consent || !drawn}
                    onClick={() =>
                      void run(async () => {
                        await api.accept(
                          token,
                          access,
                          consent,
                          strokes.current.filter((s) => s.length >= 2),
                        );
                        setDone(true);
                        strokes.current = [];
                        URL.revokeObjectURL(objectUrl.current);
                      })
                    }
                  >
                    Chấp thuận hợp đồng
                  </Button>
                </>
              )}
            </>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
