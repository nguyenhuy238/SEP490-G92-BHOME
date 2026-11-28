import { ValidatedInput } from '../../../../components/common/ValidatedForm';
import { TextField } from '../../../../components/common/ValidatedForm';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type {
  ContractClient,
  ContractView,
  Signature,
} from '../../../../../../../packages/client-core/src/contracts';
import {
  mmss,
  secondsUntil,
  signingError,
  signingErrorCode,
  type DrawnSignature,
  type SigningClient,
  type SigningMethods,
  type SigningOtpView,
} from '../../../../../../../packages/client-core/src/signing';
import { useSigningApi } from '../../hooks/useContractsApi';
import { SignaturePlacementPicker, type PlacementChoice } from './SignaturePlacementPicker';

const DONE = ['Signed', 'Simulated'];
const OPEN = (s: Signature) => !['Signed', 'Simulated', 'Failed'].includes(s.status);

// In-app Owner signature: direct consent or email OTP.
export function OwnerSigningPanel({
  api,
  contract: c,
  actorId,
  methods,
  onChanged,
}: {
  api: ContractClient;
  contract: ContractView;
  actorId: string;
  methods: SigningMethods | null;
  onChanged: () => void;
}) {
  const signing = useSigningApi(api);
  const [method, setMethod] = useState<string | null>(null);
  const mine = c.signatures.filter((s) => s.signerUserId === actorId);
  const current = [...mine].reverse().find((s) => s.status !== 'Failed') ?? null;
  const inApp = (methods?.methods ?? []).filter(
    (m): m is 'OTP' | 'OWNER_SESSION' => m === 'OTP' || m === 'OWNER_SESSION',
  );
  if (c.ownerSignerId !== actorId || c.isDevelopmentDemo || !methods) return null;
  if (current && DONE.includes(current.status)) return null;
  const replacesOtp = current?.method === 'OTP' && OPEN(current) && inApp.includes('OWNER_SESSION');
  if (current?.method === 'OTP' && OPEN(current) && !replacesOtp)
    return <OtpStep signing={signing} contractId={c.id} onDone={onChanged} />;
  if ((current && !replacesOtp) || !['Draft', 'PendingSigning'].includes(c.status) || !inApp.length)
    return null;
  const preferred = inApp.includes('OWNER_SESSION')
    ? 'OWNER_SESSION'
    : (inApp.find((m) => m === methods.default) ?? inApp[0]);
  const chosen = inApp.find((m) => m === method) ?? preferred;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Ký hợp đồng
        </Typography>
        {inApp.length > 1 && (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={chosen}
            onChange={(_, v: string | null) => v && setMethod(v)}
            aria-label="Cách ký"
          >
            {inApp.map((m) => (
              <ToggleButton key={m} value={m}>
                {m === 'OWNER_SESSION' ? 'Ký trực tiếp' : 'Ký điện tử bằng OTP'}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
        <OtpStart
          key={c.id}
          signing={signing}
          contractId={c.id}
          onStarted={onChanged}
          session={chosen === 'OWNER_SESSION'}
        />
      </Stack>
    </Paper>
  );
}

function OtpStart({
  signing,
  contractId,
  onStarted,
  session = false,
}: {
  signing: SigningClient;
  contractId: string;
  onStarted: () => void;
  session?: boolean;
}) {
  const [choice, setChoice] = useState<PlacementChoice>({ placement: null, usePicture: true });
  const [drawing, setDrawing] = useState<DrawnSignature | null>(null);
  const [agreed, setAgreed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const [imageFile, setImageFile] = useState<File | null>(null);
  async function sign() {
    if (busy || !agreed || (!drawing && !imageFile)) return;
    setBusy(true);
    setError('');
    try {
      if (drawing) {
        await signing.drawImage(drawing);
      } else if (imageFile) {
        await signing.uploadImage(imageFile);
      }
      await signing.start(
        contractId,
        session ? 'OWNER_SESSION' : 'OTP',
        key,
        choice.placement,
        true,
      );
      onStarted();
    } catch (e) {
      setError(signingError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack spacing={1.5}>
      <Box component="details">
        <Typography component="summary" sx={{ cursor: 'pointer', py: 1 }}>
          Điều chỉnh vị trí chữ ký (nếu cần)
        </Typography>
        <SignaturePlacementPicker
          signing={signing}
          contractId={contractId}
          value={choice}
          onChange={setChoice}
          disabled={busy}
          showSignatureImage={false}
        />
      </Box>
      <Typography variant="subtitle2">Chữ ký của bạn</Typography>
      <DrawPad onChange={setDrawing} disabled={busy} />
      <Button component="label" disabled={busy}>
        Tải ảnh chữ ký PNG
        <ValidatedInput
          hidden
          type="file"
          aria-label="Ảnh chữ ký cho hợp đồng"
          accept="image/png"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setError('');
            setDrawing(null);
            setImageFile(file);
          }}
        />
      </Button>
      <Typography variant="caption" color="text.secondary">
        {imageFile ? 'Đã chọn ảnh cho hợp đồng này.' : 'Vẽ chữ ký hoặc tải ảnh cho hợp đồng này.'}
      </Typography>
      <FormControlLabel
        control={
          <Checkbox
            checked={agreed}
            disabled={busy}
            onChange={(e) => setAgreed(e.target.checked)}
          />
        }
        label="Tôi đã đọc hợp đồng và đồng ý ký điện tử."
      />
      {!!error && <Alert severity="error">{error}</Alert>}
      <Box>
        <Button
          variant="contained"
          disabled={busy || !agreed || (!drawing && !imageFile)}
          onClick={() => void sign()}
        >
          {busy ? (session ? 'Đang ký…' : 'Đang gửi mã…') : 'Ký hợp đồng'}
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {session
          ? 'Bấm Ký hợp đồng để áp dụng chữ ký bằng phiên đăng nhập Owner. Đây là ký điện tử với dấu BHOME, không phải chữ ký số cá nhân được CA chứng thực.'
          : 'Bấm Ký hợp đồng, BHOME gửi mã xác nhận 6 số tới email của bạn.'}
      </Typography>
    </Stack>
  );
}

type Point = [number, number];
// Mouse / pen / finger drawing on a canvas; the server turns the same points into the signature picture.
export function DrawPad({
  onChange,
  disabled,
  height = 170,
}: {
  onChange: (drawing: DrawnSignature | null) => void;
  disabled?: boolean;
  height?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  const size = () => {
    const el = canvas.current!;
    return { width: Math.max(1, Math.round(el.clientWidth)), height };
  };
  function paint() {
    const el = canvas.current;
    const g = el?.getContext?.('2d');
    if (!el || !g) return;
    const { width } = size();
    el.width = width;
    el.height = height;
    g.clearRect(0, 0, width, height);
    g.strokeStyle = '#0d2c8c';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const s of strokes.current) {
      g.beginPath();
      s.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      if (s.length === 1) g.lineTo(s[0][0] + 0.1, s[0][1]);
      g.stroke();
    }
  }
  useEffect(paint);
  const at = (e: React.PointerEvent): Point => {
    const r = canvas.current!.getBoundingClientRect();
    const { width } = size();
    return [
      Math.round(Math.min(Math.max(0, e.clientX - r.left), width) * 10) / 10,
      Math.round(Math.min(Math.max(0, e.clientY - r.top), height) * 10) / 10,
    ];
  };
  function publish() {
    const points = strokes.current.reduce((n, s) => n + s.length, 0);
    setEmpty(!strokes.current.length);
    const { width } = size();
    onChange(points >= 5 ? { width, height, strokes: thin(strokes.current) } : null);
  }
  return (
    <Box>
      <Box
        component="canvas"
        ref={canvas}
        aria-label="Khung ký tên"
        onPointerDown={(e: React.PointerEvent<HTMLCanvasElement>) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          drawing.current = true;
          strokes.current = [...strokes.current, [at(e)]];
          setEmpty(false);
          paint();
        }}
        onPointerMove={(e: React.PointerEvent<HTMLCanvasElement>) => {
          if (!drawing.current) return;
          const s = strokes.current[strokes.current.length - 1];
          const p = at(e),
            last = s[s.length - 1];
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return;
          s.push(p);
          paint();
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          publish();
        }}
        sx={{
          display: 'block',
          width: '100%',
          maxWidth: 560,
          height,
          border: '1.5px dashed',
          borderColor: 'divider',
          borderRadius: 2,
          bgcolor: '#fff',
          touchAction: 'none',
          cursor: disabled ? 'default' : 'crosshair',
        }}
      />
      <Button
        size="small"
        disabled={disabled || empty}
        onClick={() => {
          strokes.current = [];
          paint();
          publish();
        }}
      >
        Xoá và vẽ lại
      </Button>
    </Box>
  );
}

// The server accepts at most 8000 points: keep every n-th point of very long drawings (stroke ends are kept).
function thin(strokes: Point[][]): Point[][] {
  const total = strokes.reduce((n, s) => n + s.length, 0);
  const step = Math.ceil(total / 7000);
  if (step <= 1) return strokes.map((s) => [...s]);
  return strokes.map((s) => s.filter((_, i) => i % step === 0 || i === s.length - 1));
}

// Six boxes (one input), the 5-minute countdown, resend after 60 s, wrong / expired / locked messages.
function OtpStep({
  signing,
  contractId,
  onDone,
}: {
  signing: SigningClient;
  contractId: string;
  onDone: () => void;
}) {
  const challenge = useQuery<SigningOtpView>({
    queryKey: ['signing-otp', contractId],
    staleTime: 0,
    retry: false,
    queryFn: ({ signal }) => signing.otp(contractId, signal),
  });
  const [view, setView] = useState<SigningOtpView | null>(null);
  const shown = view ?? challenge.data ?? null;
  const [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [locked, setLocked] = useState(false),
    [now, setNow] = useState(() => Date.now()),
    [resendAt, setResendAt] = useState<number | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [opened] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = shown ? secondsUntil(shown.expiresAt, now) : 0;
  const resendIn = Math.max(
    0,
    Math.ceil(((resendAt ?? opened + (shown?.resendAfterSeconds ?? 0) * 1000) - now) / 1000),
  );
  const isLocked = locked || shown?.status === 'Locked';

  async function confirm() {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError('');
    try {
      const updated = await signing.confirmOtp(contractId, code, key);
      // The fifth wrong code is not an error: the server fails the signature and answers with the contract.
      const mine = updated.signatures.find((s) => s.id === shown?.signatureId);
      if (mine?.status === 'Failed') setLocked(true);
      else onDone();
    } catch (e) {
      const failed = signingErrorCode(e);
      setError(signingError(e));
      setCode('');
      setKey(crypto.randomUUID());
      if (failed === 'otp_locked' || failed === 'signing_not_pending') setLocked(true);
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    if (busy || resendIn > 0) return;
    setBusy(true);
    setError('');
    try {
      const v = await signing.resendOtp(contractId);
      setView(v);
      setResendAt(Date.now() + v.resendAfterSeconds * 1000);
      setCode('');
    } catch (e) {
      setError(signingError(e));
    } finally {
      setBusy(false);
    }
  }
  if (isLocked)
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Lượt ký đã bị khoá
          </Typography>
          <Typography variant="body2">
            Bạn đã nhập sai mã quá số lần cho phép. Vì bảo mật, hãy bắt đầu ký lại để nhận mã mới.
            Hợp đồng chưa được ký.
          </Typography>
          <Box>
            <Button variant="contained" onClick={onDone}>
              Ký lại từ đầu
            </Button>
          </Box>
        </Stack>
      </Paper>
    );
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5} sx={{ maxWidth: 460 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Xác thực chữ ký · nhập mã 6 số trong email
        </Typography>
        {challenge.error && <Alert severity="error">{signingError(challenge.error)}</Alert>}
        {shown && (
          <Alert severity="info">
            Đã gửi mã xác nhận tới {shown.maskedEmail}. Mở email &quot;[BHOME] Mã xác nhận ký hợp
            đồng&quot;.
          </Alert>
        )}
        <TextField
          label="Mã xác nhận"
          value={code}
          autoFocus
          autoComplete="one-time-code"
          disabled={busy}
          error={!!error}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => e.key === 'Enter' && void confirm()}
          slotProps={{
            htmlInput: {
              inputMode: 'numeric',
              maxLength: 6,
              style: { letterSpacing: '0.6em', fontSize: 24, textAlign: 'center' },
            },
          }}
        />
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {left > 0 ? `Mã hết hạn sau ${mmss(left)}` : 'Mã đã hết hạn'}
          </Typography>
          <Button size="small" disabled={busy || resendIn > 0} onClick={() => void resend()}>
            {resendIn > 0 ? `Gửi lại mã (${mmss(resendIn)})` : 'Gửi lại mã'}
          </Button>
        </Stack>
        {!!error && <Alert severity="error">{error}</Alert>}
        <Typography variant="caption" color="text.secondary">
          Không thấy email? Kiểm tra thư mục Spam/Quảng cáo. Không chia sẻ mã này với bất kỳ ai, kể
          cả nhân viên BHOME.
        </Typography>
        <Box>
          <Button
            variant="contained"
            disabled={busy || code.length !== 6 || (!!shown && left === 0)}
            onClick={() => void confirm()}
          >
            {busy ? 'Đang xác nhận…' : 'Xác nhận ký'}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}
