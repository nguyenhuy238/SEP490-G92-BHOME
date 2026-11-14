import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { Checkbox, Text } from 'react-native-paper';
import type { ContractView, Signature } from '../../../../../packages/client-core/src/contracts';
import {
  failedUploadCheck,
  mmss,
  secondsUntil,
  signingClient,
  signingError,
  signingErrorCode,
  signingMethodLabel,
  UPLOAD_CHECKS,
  type DrawnSignature,
  type SigningClient,
  type SigningMethods,
  type SigningOtpView,
} from '../../../../../packages/client-core/src/signing';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import type { contractClient } from '../../../../../packages/client-core/src/contracts';
import { Action, Box, Heading, Pill, ui } from '../../components/WorkspaceKit';
import { ChoiceField } from '../../components/WorkflowControls';
import { randomUUID } from '../../lib/randomUUID';
import { SignaturePad } from './SignaturePad';
import { SignaturePlacementField, type PlacementChoice } from './SigningSetup';

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

// The signer's part of the "Ký" section for the two in-app methods (mockups 3.2.2):
// Tenant – look at the contract, draw the signature, agree, Ký → type the emailed OTP;
// Owner – download the issued PDF, sign it with MySign (certificate registered through VNeID), upload it.
// Remote MySign signing keeps using the existing "Yêu cầu ký MySign" action.
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
    (m) => m === 'OTP' || (owner && m === 'UPLOAD_PROOF'),
  );
  const preferred = inApp.includes(methods?.default ?? '') ? methods!.default! : inApp[0];
  const [method, setMethod] = useState<string | undefined>(undefined);
  const chosen = method ?? preferred;
  if (!signer || c.isDevelopmentDemo || !methods) return null;

  if (current && DONE.includes(current.status)) return <Signed c={c} owner={owner} />;
  if (current?.method === 'OTP' && OPEN(current))
    return <OtpStep signing={signing} contractId={c.id} onDone={onChanged} />;
  if (current?.method === 'UPLOAD_PROOF' && OPEN(current))
    return (
      <UploadStep signing={signing} contractId={c.id} signature={current} onDone={onChanged} />
    );
  if (current || !['Draft', 'PendingSigning'].includes(c.status)) return null;
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
              label:
                m === 'UPLOAD_PROOF'
                  ? 'Tải về & ký MySign (khuyến nghị)'
                  : 'Ký điện tử bằng mã OTP',
            }))}
          />
        </Box>
      )}
      {chosen === 'UPLOAD_PROOF' ? (
        <UploadStart signing={signing} contractId={c.id} onStarted={onChanged} />
      ) : (
        <OtpStart signing={signing} contract={c} owner={owner} onStarted={onChanged} />
      )}
    </>
  );
}

function Signed({ c, owner }: { c: ContractView; owner: boolean }) {
  const otherId = owner ? c.tenantUserId : c.ownerSignerId;
  const otherDone = c.signatures.some((s) => s.signerUserId === otherId && DONE.includes(s.status));
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
}: {
  signing: SigningClient;
  contract: ContractView;
  owner: boolean;
  onStarted: () => void;
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
      await signing.start(c.id, 'OTP', key, choice.placement, choice.usePicture);
      onStarted();
    } catch (e) {
      setError(signingError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Box>
      <Heading title="Ký hợp đồng" detail="Ký điện tử · xác thực bằng mã OTP qua email" />
      <SignaturePlacementField
        key={pictureRevision}
        signing={signing}
        contractId={c.id}
        value={choice}
        onChange={setChoice}
        disabled={busy}
        caption={`Ký điện tử bởi: ${owner ? 'Chủ trọ' : 'Khách thuê'}\nXác thực: mã OTP qua email`}
      />
      <Text variant="titleSmall">Chữ ký của bạn</Text>
      <SignaturePad onChange={setDrawing} disabled={busy} />
      <Text variant="bodySmall">
        Bỏ trống nếu muốn dùng ảnh chữ ký đã lưu. Chữ ký sẽ đặt vào ô của bạn trên hợp đồng.
      </Text>
      <Checkbox.Item
        label="Tôi đã đọc toàn bộ hợp đồng và đồng ý ký điện tử. Tôi hiểu chữ ký này có giá trị như cam kết của tôi đối với hợp đồng."
        labelVariant="bodySmall"
        status={agreed ? 'checked' : 'unchecked'}
        onPress={() => setAgreed((a) => !a)}
        disabled={busy}
        position="leading"
      />
      {!!error && <Text style={ui.red}>{error}</Text>}
      <Action disabled={busy || !agreed} onPress={() => void sign()}>
        {busy ? 'Đang gửi mã…' : 'Ký hợp đồng'}
      </Action>
      <Text style={ui.muted}>Bấm "Ký hợp đồng", BHOME gửi mã xác nhận 6 số tới email của bạn.</Text>
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
      {!!loadError && <Text style={ui.red}>{loadError}</Text>}
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
      {!!error && <Text style={ui.red}>{error}</Text>}
      <Text style={ui.muted}>Không thấy email? Kiểm tra thư mục Spam/Quảng cáo.</Text>
      <Text style={ui.muted}>Không chia sẻ mã này với bất kỳ ai, kể cả nhân viên BHOME.</Text>
      <Action disabled={busy || code.length !== 6 || left === 0} onPress={() => void confirm()}>
        {busy ? 'Đang xác nhận…' : 'Xác nhận ký'}
      </Action>
    </Box>
  );
}

// Owner, UPLOAD_PROOF: start keeps the exact PDF to sign on the server (72 hours).
function UploadStart({
  signing,
  contractId,
  onStarted,
}: {
  signing: SigningClient;
  contractId: string;
  onStarted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key] = useState(randomUUID);
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
    <Box>
      <Heading title="Ký hợp đồng" detail="Tải về & ký bằng MySign" />
      <Text>
        Dùng chứng thư MySign của bạn (đăng ký qua VNeID). Ký bằng app MySign hoặc MySign Desktop,
        rồi tải bản đã ký lên. Chữ ký số có giá trị như chữ ký tay.
      </Text>
      {!!error && <Text style={ui.red}>{error}</Text>}
      <Action disabled={busy} onPress={() => void start()}>
        {busy ? 'Đang chuẩn bị…' : 'Bắt đầu ký'}
      </Action>
    </Box>
  );
}

// Owner, UPLOAD_PROOF pending: open the issued PDF in MySign, then pick the signed file; BHOME checks it.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(-1);
  const [file, setFile] = useState<{ name: string; size: number; bytes: Uint8Array } | null>(null);
  const [key, setKey] = useState(randomUUID);

  async function download() {
    if (busy) return;
    setBusy(true);
    setError('');
    let temporary: import('expo-file-system').File | null = null;
    try {
      if (Platform.OS === 'web') {
        const blob = await signing.uploadSourceBlob(contractId);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `hop-dong-${contractId.slice(0, 8)}-ban-ky.pdf`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      // Native file and share modules are loaded on demand (as in TenantIncidentPhotos).
      const { Directory, File, Paths } = await import('expo-file-system');
      const Sharing = await import('expo-sharing');
      if (!(await Sharing.isAvailableAsync())) {
        setError('Thiết bị chưa hỗ trợ mở tài liệu bằng ứng dụng khác.');
        return;
      }
      const bytes = await signing.uploadSourceBytes(contractId);
      const directory = new Directory(Paths.cache, 'bhome-contract-downloads');
      directory.create({ idempotent: true, intermediates: true });
      temporary = new File(directory, `hop-dong-${contractId.slice(0, 8)}-ban-ky.pdf`);
      if (temporary.exists) temporary.delete();
      temporary.create();
      temporary.write(bytes);
      await Sharing.shareAsync(temporary.uri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: 'Mở bằng MySign để ký',
      });
    } catch (e) {
      setError(signingError(e));
    } finally {
      if (temporary?.exists) temporary.delete();
      setBusy(false);
    }
  }
  async function pick() {
    if (busy) return;
    setError('');
    setFailed(-1);
    // Loaded on demand: the picker's native module is only needed when the Owner chooses a file.
    const DocumentPicker = await import('expo-document-picker');
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    try {
      const bytes = asset.file
        ? new Uint8Array(await asset.file.arrayBuffer())
        : await new (await import('expo-file-system')).File(asset.uri).bytes();
      if (bytes.length > 10 * 1024 * 1024) {
        setError('File lớn hơn 10 MB.');
        return;
      }
      setFile({ name: asset.name, size: bytes.length, bytes });
      setKey(randomUUID());
    } catch {
      setError('Không đọc được file đã chọn.');
    }
  }
  async function upload() {
    if (busy || !file) return;
    setBusy(true);
    setError('');
    setFailed(-1);
    try {
      await signing.uploadSigned(contractId, file.bytes as unknown as BodyInit, key);
      onDone();
    } catch (e) {
      setError(signingError(e));
      setFailed(failedUploadCheck(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Box>
      <Heading title="Ký hợp đồng" detail="Tải về & ký bằng MySign" />
      <Action secondary disabled={busy} onPress={() => void download()}>
        {Platform.OS === 'web' ? 'Tải hợp đồng để ký (PDF)' : 'Tải về / Mở bằng MySign'}
      </Action>
      <View style={ui.soft}>
        <Text variant="titleSmall">Ký bằng MySign</Text>
        <Text>1. Bấm "{Platform.OS === 'web' ? 'Tải hợp đồng để ký' : 'Mở bằng MySign'}".</Text>
        <Text>
          2. Chọn chứng thư của bạn (đăng ký qua VNeID), đặt chữ ký vào ô "Bên A – Chủ trọ".
        </Text>
        <Text>
          3. Xác nhận ký, lưu file đã ký{Platform.OS === 'web' ? '' : ' vào Tệp (Files)'}.
        </Text>
        <Text>4. Quay lại đây, chọn file đã ký rồi gửi.</Text>
      </View>
      <Pill tone="amber">Không sửa nội dung file: BHOME chỉ nhận đúng bản này cộng chữ ký số.</Pill>
      {signature.expiresAt && (
        <Text style={ui.muted}>Hạn tải lên: {formatInstant(signature.expiresAt)}</Text>
      )}
      <Action secondary disabled={busy} onPress={() => void pick()}>
        {file ? 'Đổi file' : 'Chọn file PDF đã ký'}
      </Action>
      {file && (
        <Text>
          {file.name} · {Math.round(file.size / 1024)} KB
        </Text>
      )}
      {(file || failed >= 0) && (
        <View style={ui.soft}>
          <Text variant="titleSmall">BHOME kiểm tra khi bạn gửi</Text>
          {UPLOAD_CHECKS.map((label, i) => (
            <Text key={label} style={i === failed ? ui.red : undefined}>
              {i === failed ? '✕' : failed >= 0 && i < failed ? '✓' : '•'} {label}
            </Text>
          ))}
        </View>
      )}
      {!!error && <Text style={ui.red}>{error}</Text>}
      <Action disabled={busy || !file} onPress={() => void upload()}>
        {busy ? 'Đang kiểm tra…' : 'Gửi bản đã ký'}
      </Action>
    </Box>
  );
}

/** One line per signature: status, method, and who signed with which certificate. */
export function signatureLine(s: Signature, status: (value: string) => string) {
  const parts = [status(s.status), signingMethodLabel(s.method)];
  if (s.signedAt) parts.push(formatInstant(s.signedAt));
  if (s.certificateSubject && s.method !== 'OTP')
    parts.push(`${s.certificateSubject}${s.certificateIssuer ? ` (${s.certificateIssuer})` : ''}`);
  return parts.join(' · ');
}
