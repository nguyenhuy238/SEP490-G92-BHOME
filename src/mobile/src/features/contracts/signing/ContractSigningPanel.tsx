import { ContractNotice } from '../ContractNotice';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { Checkbox, Text } from 'react-native-paper';
import type { ContractView, Signature } from '../../../../../../packages/client-core/src/contracts';
import {
  mmss,
  secondsUntil,
  signingClient,
  signingError,
  signingErrorCode,
  signingMethodLabel,
  type DrawnSignature,
  type SigningClient,
  type SigningMethods,
  type SigningOtpView,
} from '../../../../../../packages/client-core/src/signing';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import type { contractClient } from '../../../../../../packages/client-core/src/contracts';
import { Action, Box, Heading, ui } from '../../../components/WorkspaceKit';
import { ChoiceField } from '../../../components/WorkflowControls';
import { randomUUID } from '../../../lib/randomUUID';
import { SignaturePad } from './SignaturePad';
import {
  SignatureImageSection,
  SignaturePlacementField,
  type PlacementChoice,
} from './SigningSetup';

type Api = ReturnType<typeof contractClient>;
const DONE = ['Signed', 'Simulated'];
const OPEN = (s: Signature) => !['Signed', 'Simulated', 'Failed'].includes(s.status);

/** What GET /contracts/signing-methods offers; null while loading or when the server is older. */
export function useSigningMethods(api: Api, enabled = true) {
  const signing = useMemo(() => signingClient(api.transport), [api]);
  const [value, setValue] = useState<SigningMethods | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.resolve(signing.methods(controller.signal)).then(
      (v) => !controller.signal.aborted && setValue(Array.isArray(v?.methods) ? v : null),
      () => !controller.signal.aborted && setValue(null),
    );
    return () => controller.abort();
  }, [signing, enabled]);
  return enabled ? value : null;
}

// In-app signing: Owner consents directly; Tenant confirms using email OTP.
export function ContractSigningPanel({
  api,
  contract: c,
  actorId,
  methods,
  onChanged,
}: {
  api: Api;
  contract: ContractView & { isDevelopmentDemo?: boolean };
  actorId: string;
  methods: SigningMethods | null;
  onChanged: () => void;
}) {
  const signing = useMemo(() => signingClient(api.transport), [api]);
  const owner = actorId === c.ownerSignerId;
  const signer = owner || actorId === c.tenantUserId;
  const mine = c.signatures.filter((s) => s.signerUserId === actorId);
  const current = [...mine].reverse().find((s) => s.status !== 'Failed') ?? null;
  const otherOpen = c.signatures.some((s) => s.signerUserId !== actorId && OPEN(s));
  const inApp = (methods?.methods ?? []).filter(
    (m) => m === 'OTP' || (owner && m === 'OWNER_SESSION'),
  );
  const preferred =
    owner && inApp.includes('OWNER_SESSION')
      ? 'OWNER_SESSION'
      : inApp.includes(methods?.default ?? '')
        ? methods!.default!
        : inApp[0];
  const [method, setMethod] = useState<string | undefined>(undefined);
  const chosen = method ?? preferred;
  if (!signer || c.isDevelopmentDemo || !methods) return null;

  if (current && DONE.includes(current.status)) return <Signed c={c} owner={owner} />;
  const replacesOtp =
    owner && current?.method === 'OTP' && OPEN(current) && inApp.includes('OWNER_SESSION');
  if (current?.method === 'OTP' && OPEN(current) && !replacesOtp)
    return <OtpStep signing={signing} contractId={c.id} onDone={onChanged} />;
  if ((current && !replacesOtp) || !['Draft', 'PendingSigning'].includes(c.status)) return null;
  if (otherOpen)
    return (
      <Box>
        <Heading title="Ký hợp đồng" />
        <Text>Bên kia đang ký. Bạn sẽ nhận email khi đến lượt mình.</Text>
      </Box>
    );
  if (!inApp.length) return null;
  return (
    <>
      {inApp.length > 1 && (
        <Box>
          <ChoiceField
            label="Cách ký"
            value={chosen}
            onChange={setMethod}
            options={inApp.map((m) => ({
              id: m,
              label: m === 'OWNER_SESSION' ? 'Ký trực tiếp' : 'Ký điện tử bằng mã OTP',
            }))}
          />
        </Box>
      )}
      <OtpStart
        signing={signing}
        contract={c}
        owner={owner}
        session={chosen === 'OWNER_SESSION'}
        onStarted={onChanged}
      />
    </>
  );
}

function Signed({ c, owner }: { c: ContractView; owner: boolean }) {
  const otherId = owner ? c.tenantUserId : c.ownerSignerId;
  const otherDone =
    (c.signingMode === 'INTERNAL_OTP_DRAWN' &&
      ['PendingActivation', 'Active'].includes(c.status)) ||
    c.signatures.some((s) => s.signerUserId === otherId && DONE.includes(s.status));
  return (
    <Box>
      <Heading title={otherDone ? 'Hợp đồng đã được ký đủ' : 'Bạn đã ký hợp đồng'} />
      <Text>
        {otherDone
          ? 'Chủ trọ xác nhận tiền cọc rồi kích hoạt hợp đồng.'
          : owner
            ? 'Đã gửi email mời khách thuê ký. Khách thuê ký bằng mã OTP nối thêm lên bản này.'
            : 'Đang chờ bên còn lại.'}
      </Text>
    </Box>
  );
}

// Tenant (or Owner choosing OTP): the page with their box, the drawn signature, agreement, then Ký sends the code.
function OtpStart({
  signing,
  contract: c,
  owner,
  onStarted,
  session = false,
}: {
  signing: SigningClient;
  contract: ContractView;
  owner: boolean;
  onStarted: () => void;
  session?: boolean;
}) {
  const [choice, setChoice] = useState<PlacementChoice>({ placement: null, usePicture: true });
  const [drawing, setDrawing] = useState<DrawnSignature | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key] = useState(randomUUID);
  const [pictureRevision, setPictureRevision] = useState(0);
  async function sign() {
    if (busy || !agreed) return;
    setBusy(true);
    setError('');
    try {
      if (drawing) {
        await signing.drawImage(drawing);
        setPictureRevision((r) => r + 1);
      }
      await signing.start(
        c.id,
        session ? 'OWNER_SESSION' : 'OTP',
        key,
        choice.placement,
        choice.usePicture,
      );
      onStarted();
    } catch (e) {
      setError(signingError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Box>
      <Heading
        title="Ký hợp đồng"
        detail={
          session
            ? 'Ký điện tử · xác thực bằng phiên đăng nhập Owner'
            : 'Ký điện tử · xác thực bằng mã OTP qua email'
        }
      />
      <SignaturePlacementField
        key={pictureRevision}
        signing={signing}
        contractId={c.id}
        value={choice}
        onChange={setChoice}
        disabled={busy}
        caption={`Ký điện tử bởi: ${owner ? 'Chủ trọ' : 'Khách thuê'}`}
      />
      <Text variant="titleSmall">Chữ ký của bạn</Text>
      <SignaturePad onChange={setDrawing} disabled={busy} />
      <SignatureImageSection
        signing={signing}
        onChanged={() => {
          setDrawing(null);
          setPictureRevision((r) => r + 1);
        }}
      />
      <Text variant="bodySmall">
        Bỏ trống nếu muốn dùng ảnh chữ ký đã lưu. Chữ ký sẽ đặt vào ô của bạn trên hợp đồng.
      </Text>
      <Checkbox.Item
        mode="android"
        label="Tôi đã đọc toàn bộ hợp đồng và đồng ý ký điện tử. Tôi hiểu chữ ký này có giá trị như cam kết của tôi đối với hợp đồng."
        labelVariant="bodySmall"
        status={agreed ? 'checked' : 'unchecked'}
        onPress={() => setAgreed((a) => !a)}
        disabled={busy}
        position="leading"
      />
      {!!error && <ContractNotice message={error} />}
      <Action disabled={busy || !agreed} onPress={() => void sign()}>
        {busy ? (session ? 'Đang ký…' : 'Đang gửi mã…') : 'Ký hợp đồng'}
      </Action>
      <Text style={ui.muted}>
        {session
          ? 'Bấm Ký hợp đồng để áp dụng chữ ký bằng phiên đăng nhập Owner. Đây là ký điện tử với dấu BHOME, không phải chữ ký số cá nhân được CA chứng thực.'
          : 'Bấm Ký hợp đồng, BHOME gửi mã xác nhận 6 số tới email của bạn.'}
      </Text>
    </Box>
  );
}

// Six boxes over one hidden input, the 5-minute countdown, resend after 60 s, wrong / expired / locked messages.
function OtpStep({
  signing,
  contractId,
  onDone,
}: {
  signing: SigningClient;
  contractId: string;
  onDone: () => void;
}) {
  const [challenge, setChallenge] = useState<SigningOtpView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [resendAt, setResendAt] = useState(0);
  const [key, setKey] = useState(randomUUID);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    const controller = new AbortController();
    signing.otp(contractId, controller.signal).then(
      (v) => {
        if (controller.signal.aborted) return;
        setChallenge(v);
        setLocked(v.status === 'Locked');
        setResendAt(Date.now() + v.resendAfterSeconds * 1000);
      },
      (e: unknown) => !controller.signal.aborted && setLoadError(signingError(e)),
    );
    return () => controller.abort();
  }, [signing, contractId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = challenge ? secondsUntil(challenge.expiresAt, now) : 0;
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function confirm() {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError('');
    try {
      const updated = await signing.confirmOtp(contractId, code, key);
      // The fifth wrong code is not an error: the server fails the signature and answers with the contract.
      const mine = updated.signatures.find((s) => s.id === challenge?.signatureId);
      if (mine?.status === 'Failed') setLocked(true);
      else onDone();
    } catch (e) {
      const failed = signingErrorCode(e);
      setError(signingError(e));
      setCode('');
      setKey(randomUUID());
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
      setChallenge(v);
      setResendAt(Date.now() + v.resendAfterSeconds * 1000);
      setCode('');
    } catch (e) {
      setError(signingError(e));
    } finally {
      setBusy(false);
    }
  }
  // Too many wrong codes fail the signature on the server: a fresh start sends a new code.
  if (locked)
    return (
      <Box>
        <Heading title="Lượt ký đã bị khoá" />
        <Text>
          Bạn đã nhập sai mã quá số lần cho phép. Vì bảo mật, hãy bắt đầu ký lại để nhận mã mới. Hợp
          đồng chưa được ký.
        </Text>
        <Action onPress={onDone}>Ký lại từ đầu</Action>
      </Box>
    );
  return (
    <Box>
      <Heading title="Xác thực chữ ký" detail="Nhập mã 6 số trong email" />
      {!!loadError && <ContractNotice message={loadError} />}
      {challenge && (
        <View style={ui.soft}>
          <Text variant="titleSmall">Đã gửi mã xác nhận</Text>
          <Text>Tới {challenge.maskedEmail}. Mở email "[BHOME] Mã xác nhận ký hợp đồng".</Text>
        </View>
      )}
      <Pressable accessibilityLabel="Ô nhập mã OTP" onPress={() => input.current?.focus()}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <View
              key={i}
              style={{
                width: 44,
                height: 54,
                borderRadius: 10,
                borderWidth: i === code.length || error ? 2 : 1.5,
                borderColor: error ? '#c62828' : i === code.length ? '#111' : '#d4d4d4',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 24, fontWeight: '600' }}>{code[i] ?? ''}</Text>
            </View>
          ))}
        </View>
        <TextInput
          ref={input}
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
          maxLength={6}
          autoFocus
          style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
        />
      </Pressable>
      <View style={ui.between}>
        <Text style={ui.muted}>{left > 0 ? `Mã hết hạn sau ${mmss(left)}` : 'Mã đã hết hạn'}</Text>
        <Text
          onPress={() => void resend()}
          style={
            resendIn > 0 || busy ? ui.muted : { fontWeight: '600', textDecorationLine: 'underline' }
          }
        >
          {resendIn > 0 ? `Gửi lại mã (${mmss(resendIn)})` : 'Gửi lại mã'}
        </Text>
      </View>
      {!!error && <ContractNotice message={error} />}
      <Text style={ui.muted}>Không thấy email? Kiểm tra thư mục Spam/Quảng cáo.</Text>
      <Text style={ui.muted}>Không chia sẻ mã này với bất kỳ ai, kể cả nhân viên BHOME.</Text>
      <Action disabled={busy || code.length !== 6 || left === 0} onPress={() => void confirm()}>
        {busy ? 'Đang xác nhận…' : 'Xác nhận ký'}
      </Action>
    </Box>
  );
}

// Owner, UPLOAD_PROOF: start keeps the exact PDF to sign on the server (72 hours).
export function signatureLine(s: Signature, status: (value: string) => string) {
  const parts = [status(s.status), signingMethodLabel(s.method)];
  if (s.signedAt) parts.push(formatInstant(s.signedAt));
  if (s.certificateSubject && s.method !== 'OTP')
    parts.push(`${s.certificateSubject}${s.certificateIssuer ? ` (${s.certificateIssuer})` : ''}`);
  return parts.join(' · ');
}
