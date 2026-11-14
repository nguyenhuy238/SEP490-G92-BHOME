import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type {
  ContractClient,
  ContractView,
  Signature,
} from '../../../../../packages/client-core/src/contracts';
import {
  failedUploadCheck,
  mmss,
  secondsUntil,
  signingError,
  signingErrorCode,
  UPLOAD_CHECKS,
  type DrawnSignature,
  type SigningClient,
  type SigningMethods,
  type SigningOtpView,
} from '../../../../../packages/client-core/src/signing';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { useSigningApi } from './useContractsApi';
import { SignaturePlacementPicker, type PlacementChoice } from './SignaturePlacementPicker';

const DONE = ['Signed', 'Simulated'];
const OPEN = (s: Signature) => !['Signed', 'Simulated', 'Failed'].includes(s.status);
const MAX_BYTES = 10 * 1024 * 1024;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The Owner's part of "Chữ ký số" for the in-app methods (mockups 3.2.2 web):
// UPLOAD_PROOF – download the issued PDF, sign it with MySign (certificate registered through VNeID), upload it back;
// OTP – the box on the page, a drawn signature, then the 6-digit code from email.
// Remote MySign signing keeps using the "Ký số" action of "Việc cần làm".
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
    (m): m is 'OTP' | 'UPLOAD_PROOF' => m === 'UPLOAD_PROOF' || m === 'OTP',
  );
  if (c.ownerSignerId !== actorId || c.isDevelopmentDemo || !methods) return null;
  if (current && DONE.includes(current.status)) return null;
  if (current?.method === 'OTP' && OPEN(current))
    return <OtpStep signing={signing} contractId={c.id} onDone={onChanged} />;
  if (current?.method === 'UPLOAD_PROOF' && OPEN(current))
    return (
      <UploadStep signing={signing} contractId={c.id} signature={current} onDone={onChanged} />
    );
  if (current || !['Draft', 'PendingSigning'].includes(c.status) || !inApp.length) return null;
  const preferred = inApp.find((m) => m === methods.default) ?? inApp[0];
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
                {m === 'UPLOAD_PROOF' ? 'Tải về & ký MySign (khuyến nghị)' : 'Ký điện tử bằng OTP'}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
        {chosen === 'UPLOAD_PROOF' ? (
          <UploadStart signing={signing} contractId={c.id} onStarted={onChanged} />
        ) : (
          <OtpStart signing={signing} contractId={c.id} onStarted={onChanged} />
        )}
      </Stack>
    </Paper>
  );
}

function UploadStart({
  signing,
  contractId,
  onStarted,
}: {
  signing: SigningClient;
  contractId: string;
  onStarted: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  async function start() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await signing.start(contractId, 'UPLOAD_PROOF', key);
      onStarted();
    } catch (e) {
      setError(signingError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2">
        Dùng chứng thư MySign của bạn (đăng ký qua VNeID). BHOME chuẩn bị bản hợp đồng để ký; bạn
        tải về, ký bằng MySign Desktop hoặc app MySign rồi tải bản đã ký lên. Chữ ký số có giá trị
        như chữ ký tay.
      </Typography>
      {!!error && <Alert severity="error">{error}</Alert>}
      <Box>
        <Button variant="contained" disabled={busy} onClick={() => void start()}>
          {busy ? 'Đang chuẩn bị…' : 'Bắt đầu ký'}
        </Button>
      </Box>
    </Stack>
  );
}

// UPLOAD_PROOF pending: download the issued PDF, then drop / choose the MySign-signed file; BHOME checks it.
function UploadStep({
  signing,
  contractId,
  signature,
  onDone,
}: {
  signing: SigningClient;
  contractId: string;
  signature: Signature;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [failed, setFailed] = useState(-1),
    [file, setFile] = useState<File | null>(null),
    [over, setOver] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const input = useRef<HTMLInputElement>(null);

  async function fetchSource() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      download(
        await signing.uploadSourceBlob(contractId),
        `hop-dong-${contractId.slice(0, 8)}-ban-ky.pdf`,
      );
    } catch (e) {
      setError(signingError(e));
    } finally {
      setBusy(false);
    }
  }
  function choose(next: File | undefined) {
    setError('');
    setFailed(-1);
    if (!next) return;
    if (next.type && next.type !== 'application/pdf' && !/\.pdf$/i.test(next.name)) {
      setError('Chỉ nhận file PDF.');
      return;
    }
    if (next.size > MAX_BYTES) {
      setError('File lớn hơn 10 MB.');
      return;
    }
    setFile(next);
    setKey(crypto.randomUUID());
  }
  async function upload() {
    if (busy || !file) return;
    setBusy(true);
    setError('');
    setFailed(-1);
    try {
      await signing.uploadSigned(contractId, file, key);
      onDone();
    } catch (e) {
      setError(signingError(e));
      setFailed(failedUploadCheck(e));
    } finally {
      setBusy(false);
    }
  }
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!busy) choose(e.dataTransfer.files?.[0]);
  };
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Ký hợp đồng · Tải về & ký bằng MySign
        </Typography>
        <Box
          component="ol"
          sx={{ m: 0, pl: 2.5, '& li': { mb: 0.5 }, typography: 'body2' }}
          aria-label="Các bước ký"
        >
          <li>
            Tải bản hợp đồng để ký (PDF).{' '}
            <Button size="small" disabled={busy} onClick={() => void fetchSource()}>
              Tải hợp đồng để ký
            </Button>
          </li>
          <li>
            Mở file bằng MySign Desktop (hoặc app MySign), chọn chứng thư của bạn (đăng ký qua
            VNeID), đặt chữ ký vào ô &quot;Bên A – Chủ trọ&quot; rồi xác nhận ký.
          </li>
          <li>
            Lưu file đã ký, rồi kéo thả hoặc chọn file đó ở dưới và bấm &quot;Gửi bản đã ký&quot;.
          </li>
        </Box>
        <Alert severity="warning" variant="outlined">
          Không sửa nội dung file: BHOME chỉ nhận đúng bản đã phát cộng chữ ký số.
        </Alert>
        {signature.expiresAt && (
          <Typography variant="caption" color="text.secondary">
            Hạn tải lên: {formatInstant(signature.expiresAt)}
          </Typography>
        )}
        <Box
          role="button"
          tabIndex={0}
          aria-label="Chọn hoặc kéo thả file PDF đã ký"
          onClick={() => !busy && input.current?.click()}
          onKeyDown={(e) => {
            if (!busy && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              input.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          sx={{
            border: '2px dashed',
            borderColor: over ? 'primary.main' : 'divider',
            borderRadius: 2,
            p: 3,
            textAlign: 'center',
            cursor: busy ? 'default' : 'pointer',
            bgcolor: over ? 'action.hover' : undefined,
          }}
        >
          <Typography sx={{ fontWeight: 600 }}>
            {file
              ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB`
              : 'Kéo thả file PDF đã ký vào đây'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {file ? 'Bấm để đổi file' : 'hoặc bấm để chọn file · PDF, tối đa 10 MB'}
          </Typography>
          <input
            ref={input}
            hidden
            type="file"
            accept="application/pdf,.pdf"
            data-testid="signed-pdf-input"
            onChange={(e) => {
              choose(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </Box>
        {(file || failed >= 0) && (
          <Box>
            <Typography variant="subtitle2">BHOME kiểm tra khi bạn gửi</Typography>
            <Box component="ul" sx={{ m: 0, pl: 0, listStyle: 'none' }}>
              {UPLOAD_CHECKS.map((label, i) => (
                <Typography
                  component="li"
                  variant="body2"
                  key={label}
                  color={i === failed ? 'error' : undefined}
                >
                  {i === failed ? '✕' : failed >= 0 && i < failed ? '✓' : '•'} {label}
                </Typography>
              ))}
            </Box>
          </Box>
        )}
        {!!error && <Alert severity="error">{error}</Alert>}
        <Box>
          <Button variant="contained" disabled={busy || !file} onClick={() => void upload()}>
            {busy ? 'Đang kiểm tra…' : 'Gửi bản đã ký'}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

// OTP (optional for the Owner): box on the page, drawn signature, consent, then the emailed code.
function OtpStart({
  signing,
  contractId,
  onStarted,
}: {
  signing: SigningClient;
  contractId: string;
  onStarted: () => void;
}) {
  const [choice, setChoice] = useState<PlacementChoice>({ placement: null, usePicture: true });
  const [drawing, setDrawing] = useState<DrawnSignature | null>(null);
  const [agreed, setAgreed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const [revision, setRevision] = useState(0);
  async function sign() {
    if (busy || !agreed) return;
    setBusy(true);
    setError('');
    try {
      if (drawing) {
        await signing.drawImage(drawing);
        setRevision((r) => r + 1);
      }
      await signing.start(contractId, 'OTP', key, choice.placement, choice.usePicture);
      onStarted();
    } catch (e) {
      setError(signingError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack spacing={1.5}>
      <SignaturePlacementPicker
        key={revision}
        signing={signing}
        contractId={contractId}
        value={choice}
        onChange={setChoice}
        disabled={busy}
        caption={'Ký điện tử bởi: Chủ trọ\nXác thực: mã OTP qua email'}
      />
      <Typography variant="subtitle2">Chữ ký của bạn</Typography>
      <DrawPad onChange={setDrawing} disabled={busy} />
      <Typography variant="caption" color="text.secondary">
        Bỏ trống nếu muốn dùng ảnh chữ ký đã lưu.
      </Typography>
      <FormControlLabel
        control={
          <Checkbox
            checked={agreed}
            disabled={busy}
            onChange={(e) => setAgreed(e.target.checked)}
          />
        }
        label="Tôi đã đọc toàn bộ hợp đồng và đồng ý ký điện tử. Tôi hiểu chữ ký này có giá trị như cam kết của tôi đối với hợp đồng."
      />
      {!!error && <Alert severity="error">{error}</Alert>}
      <Box>
        <Button variant="contained" disabled={busy || !agreed} onClick={() => void sign()}>
          {busy ? 'Đang gửi mã…' : 'Ký hợp đồng'}
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary">
        Bấm &quot;Ký hợp đồng&quot;, BHOME gửi mã xác nhận 6 số tới email của bạn.
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
