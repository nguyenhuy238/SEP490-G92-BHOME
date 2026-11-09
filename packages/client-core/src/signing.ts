import {
  contractError,
  type ContractRequest,
  type ContractView,
  type Signature as ContractSignatureView,
} from './contracts';

// Remote signing with Viettel MySign, shared by the Owner portal and the mobile app: the signer's picture, where the
// visible signature goes on the contract, and the Owner's Viettel account. The private key never leaves Viettel;
// BHOME only sends the document hash and the signer confirms on the MySign app.

/** Page is 1-based; x, y and width are fractions of the page from its top-left corner. */
export interface SignaturePlacement {
  page: number;
  x: number;
  y: number;
  width: number;
}
export interface SigningLayout {
  pageCount: number;
  pages: { width: number; height: number }[];
  suggested: SignaturePlacement | null;
  party: 'Owner' | 'Tenant';
  hasPicture: boolean;
  signerName: string;
}
export interface SignatureImageView {
  present: boolean;
  width: number;
  height: number;
  version: string | null;
  updatedAt: string | null;
}
export type SettingSource = 'DATABASE' | 'CONFIGURATION' | 'NONE';
export interface ViettelSettings {
  baseUrl: string;
  baseUrlSource: SettingSource;
  clientId: string;
  clientIdSource: SettingSource;
  profileId: string;
  profileIdSource: SettingSource;
  secretSet: boolean;
  secretHint: string;
  secretSource: SettingSource;
  secretUnreadable: boolean;
  updatedByUserId: string | null;
  updatedAt: string | null;
}
export interface SaveViettelSettings {
  baseUrl: string | null;
  clientId: string | null;
  profileId: string | null;
  clientSecret: string | null;
  clearSecret: boolean;
}
export interface ConnectionTestResult {
  ok: boolean;
  milliseconds: number;
  message: string;
}

/** What GET /contracts/signing-methods offers the signed-in party (Owner: UPLOAD_PROOF first; Tenant: OTP). */
export interface SigningMethods {
  methods: string[];
  default: string | null;
}
/** OTP challenge: where the code went, until when it is valid and when a new one can be asked for. */
export interface SigningOtpView {
  signatureId: string;
  status: 'Sent' | 'Locked';
  maskedEmail: string;
  expiresAt: string;
  resendAfterSeconds: number;
}
/** A finger/mouse drawing: one array of [x, y] points per stroke, on a width × height pad. */
export interface DrawnSignature {
  width: number;
  height: number;
  strokes: [number, number][][];
}
export const NO_CERTIFICATE = '00000000-0000-0000-0000-000000000000';

const image = '/api/v1/digital-signing/signature-image';
const viettel = '/api/v1/digital-signing/settings/viettel';
const guid = (value: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new Error('Mã không hợp lệ.');
  return value;
};

export function signingClient(request: ContractRequest) {
  return {
    layout: (contractId: string, signal?: AbortSignal) =>
      request<SigningLayout>(`/api/v1/contracts/${guid(contractId)}/signing/layout`, { signal }),
    pageBlob: (contractId: string, page: number, width: number, signal?: AbortSignal) =>
      request<Blob>(
        `/api/v1/contracts/${guid(contractId)}/signing/pages/${Math.trunc(page)}?width=${Math.trunc(width)}`,
        { signal, headers: { Accept: 'image/png' } },
        'blob',
      ),
    pageBytes: (contractId: string, page: number, width: number, signal?: AbortSignal) =>
      request<Uint8Array>(
        `/api/v1/contracts/${guid(contractId)}/signing/pages/${Math.trunc(page)}?width=${Math.trunc(width)}`,
        { signal, headers: { Accept: 'image/png' } },
        'bytes',
      ),
    image: (signal?: AbortSignal) => request<SignatureImageView>(image, { signal }),
    imageBlob: (signal?: AbortSignal) =>
      request<Blob>(`${image}/content`, { signal, headers: { Accept: 'image/png' } }, 'blob'),
    imageBytes: (signal?: AbortSignal) =>
      request<Uint8Array>(
        `${image}/content`,
        { signal, headers: { Accept: 'image/png' } },
        'bytes',
      ),
    uploadImage: (png: BodyInit) =>
      request<SignatureImageView>(image, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: png,
      }),
    generateImage: (name: string) =>
      request<SignatureImageView>(`${image}/generate`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      }),
    removeImage: () => request<void>(image, { method: 'DELETE' }),
    /** The signer's drawing, turned into their transparent signature picture by the server. */
    drawImage: (drawing: DrawnSignature) =>
      request<SignatureImageView>(`${image}/drawn`, {
        method: 'POST',
        body: JSON.stringify(drawing),
      }),
    methods: (signal?: AbortSignal) =>
      request<SigningMethods>('/api/v1/contracts/signing-methods', { signal }),
    /** Starts OTP (in-app) or UPLOAD_PROOF (Owner signs the PDF with MySign outside BHOME) signing. */
    start: (
      contractId: string,
      method: 'OTP' | 'UPLOAD_PROOF',
      key: string,
      placement: SignaturePlacement | null = null,
      usePicture = true,
    ) =>
      request<ContractSignatureView>(`/api/v1/contracts/${guid(contractId)}/signing`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({
          certificateId: NO_CERTIFICATE,
          method,
          ...(placement ? { placement: roundPlacement(placement) } : {}),
          usePicture,
        }),
      }),
    otp: (contractId: string, signal?: AbortSignal) =>
      request<SigningOtpView>(`/api/v1/contracts/${guid(contractId)}/signing/otp`, { signal }),
    confirmOtp: (contractId: string, code: string, key: string) =>
      request<ContractView>(`/api/v1/contracts/${guid(contractId)}/signing/otp/confirm`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ code: code.trim() }),
      }),
    resendOtp: (contractId: string) =>
      request<SigningOtpView>(`/api/v1/contracts/${guid(contractId)}/signing/otp/resend`, {
        method: 'POST',
      }),
    /** UPLOAD_PROOF: the exact PDF the Owner must sign with MySign. */
    uploadSourceBytes: (contractId: string, signal?: AbortSignal) =>
      request<Uint8Array>(
        `/api/v1/contracts/${guid(contractId)}/signing/upload-source`,
        { signal, headers: { Accept: 'application/pdf' } },
        'bytes',
      ),
    uploadSourceBlob: (contractId: string, signal?: AbortSignal) =>
      request<Blob>(
        `/api/v1/contracts/${guid(contractId)}/signing/upload-source`,
        { signal, headers: { Accept: 'application/pdf' } },
        'blob',
      ),
    /** UPLOAD_PROOF: the MySign-signed PDF; BHOME checks it before accepting. */
    uploadSigned: (contractId: string, pdf: BodyInit, key: string) =>
      request<ContractView>(`/api/v1/contracts/${guid(contractId)}/signing/upload`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf', 'Idempotency-Key': key },
        body: pdf,
      }),
    removeCertificate: (id: string) =>
      request<void>(`/api/v1/digital-signing/certificates/${guid(id)}`, { method: 'DELETE' }),
    viettel: (signal?: AbortSignal) => request<ViettelSettings>(viettel, { signal }),
    saveViettel: (settings: SaveViettelSettings) =>
      request<ViettelSettings>(viettel, { method: 'PUT', body: JSON.stringify(settings) }),
    resetViettel: () => request<ViettelSettings>(viettel, { method: 'DELETE' }),
    testViettel: (userId: string) =>
      request<ConnectionTestResult>(`${viettel}/test`, {
        method: 'POST',
        body: JSON.stringify({ userId: userId.trim() }),
      }),
  };
}
export type SigningClient = ReturnType<typeof signingClient>;

const codes: Record<string, string> = {
  signature_placement_invalid:
    'Ô chữ ký nằm ngoài trang hoặc quá nhỏ/quá lớn. Kéo ô vào trong trang rồi thử lại.',
  signing_page_invalid: 'Trang cần xem không có trong hợp đồng.',
  signature_name_invalid: 'Nhập họ tên từ 2 đến 60 ký tự, chỉ gồm chữ và khoảng trắng.',
  certificate_has_contract_history:
    'Chứng thư đã dùng để ký hợp đồng nên không gỡ được. Hãy khóa chứng thư thay vì gỡ.',
  contract_template_not_approved:
    'Mẫu hợp đồng hiện chỉ là mẫu thử, máy chủ chỉ cho ký ở môi trường Development/Testing.',
  // OTP (Tenant, in-app electronic signature)
  otp_invalid_format: 'Nhập đúng 6 chữ số trong email.',
  otp_incorrect: 'Mã không đúng. Kiểm tra lại email rồi nhập lại.',
  otp_expired: 'Mã đã hết hạn. Bấm "Gửi lại mã" để nhận mã mới.',
  otp_resend_too_soon: 'Vui lòng chờ hết thời gian đếm ngược rồi gửi lại mã.',
  otp_locked: 'Bạn đã nhập sai quá số lần cho phép. Hãy bắt đầu ký lại để nhận mã mới.',
  otp_email_unavailable: 'Máy chủ chưa cấu hình gửi email nên chưa gửi được mã xác nhận.',
  signer_email_required: 'Tài khoản của bạn chưa có email để nhận mã xác nhận.',
  signature_drawing_empty: 'Hãy ký vào khung (một chấm hoặc một nét quá ngắn chưa phải chữ ký).',
  signature_drawing_invalid: 'Chữ ký vẽ không hợp lệ. Hãy xoá và vẽ lại.',
  // UPLOAD_PROOF (Owner signs with MySign, then uploads)
  signed_pdf_not_from_issued_contract:
    'File không phải bản hợp đồng đã phát. Hãy tải lại bản gốc và ký bằng MySign.',
  signed_pdf_has_no_new_signature: 'File chưa có chữ ký số. Hãy ký bằng MySign trước khi tải lên.',
  signed_pdf_signature_invalid: 'Chữ ký số trong file không hợp lệ.',
  signed_pdf_changed_after_signing: 'File đã bị sửa sau khi ký.',
  signed_pdf_certificate_issuer_not_allowed: 'Chứng thư không do Viettel-CA cấp.',
  signed_pdf_certificate_not_valid: 'Chứng thư đã hết hạn tại thời điểm ký.',
  signed_pdf_content_changed:
    'Nội dung hợp đồng đã bị thay đổi trước khi ký. Hãy tải lại bản gốc và ký lại.',
  signed_pdf_too_large: 'File lớn hơn 10 MB.',
  signed_pdf_invalid: 'File không phải PDF hợp lệ.',
  upload_proof_owner_only: 'Chỉ chủ trọ ký bằng cách tải file lên.',
  signing_method_disabled: 'Cách ký này đang tắt trên máy chủ.',
  signing_not_pending: 'Không có lượt ký nào đang chờ. Hãy tải lại trang.',
};

/** The four checks BHOME runs on an uploaded MySign-signed PDF (UPLOAD_PROOF), in display order. */
export const UPLOAD_CHECKS = [
  'Đúng bản hợp đồng đã phát',
  'Có chữ ký số mới, nguyên vẹn, phủ toàn bộ file',
  'Chứng thư do Viettel-CA cấp, còn hiệu lực lúc ký',
  'Nội dung các trang không thay đổi',
] as const;
/** Error code of a failed signing call, if the server sent one. */
export function signingErrorCode(error: unknown): string {
  return (error as { problem?: { code?: string } } | null)?.problem?.code ?? '';
}
/** Which of UPLOAD_CHECKS a refusal points at, or -1. */
export function failedUploadCheck(error: unknown): number {
  const code = signingErrorCode(error);
  if (code === 'signed_pdf_not_from_issued_contract') return 0;
  if (
    [
      'signed_pdf_has_no_new_signature',
      'signed_pdf_signature_invalid',
      'signed_pdf_changed_after_signing',
    ].includes(code)
  )
    return 1;
  if (code.startsWith('signed_pdf_certificate')) return 2;
  if (code === 'signed_pdf_content_changed') return 3;
  return -1;
}
/** Seconds left until an ISO instant (never negative). */
export function secondsUntil(iso: string, now = Date.now()) {
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000));
}
export const mmss = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
/** How a signature was made, for status lines. */
export function signingMethodLabel(method: string | undefined) {
  switch (method) {
    case 'OTP':
      return 'Ký điện tử · OTP email';
    case 'UPLOAD_PROOF':
      return 'Ký số MySign (tải lên)';
    case 'SIMULATED':
      return 'Ký mô phỏng (Development)';
    default:
      return 'Ký số MySign';
  }
}

/** Prefers the server's own sentence (digital-signing refusals are written for the signer), then BHOME's codes. */
export function signingError(error: unknown): string {
  const e = error as { problem?: { detail?: string; code?: string }; status?: number } | null;
  // OTP / upload / drawing refusals have BHOME's own sentence; the server detail for them is generic.
  const code = e?.problem?.code ?? '';
  if (
    codes[code] &&
    /^(otp_|signed_pdf_|signature_drawing|signer_email|upload_proof|signing_)/.test(code)
  )
    return codes[code];
  if (e?.problem?.detail) return e.problem.detail;
  if (error instanceof Error && !['ApiError', 'AbortError'].includes(error.name))
    return error.message;
  if (e?.problem?.code && codes[e.problem.code]) return codes[e.problem.code];
  return contractError(error);
}

/**
 * Height of the box the server draws, as a fraction of the page height: the picture keeps its proportions over the
 * box width, followed by two caption lines (9.8 pt, 1.35 leading, 6 pt padding); text only is two 14 pt lines.
 */
export function boxHeight(
  width: number,
  page: { width: number; height: number },
  picture: { width: number; height: number } | null,
  usePicture: boolean,
) {
  const boxWidth = width * page.width;
  const points =
    picture && usePicture && picture.width > 0
      ? (boxWidth * picture.height) / picture.width + 2 * 9.8 * 1.35 + 12
      : 2 * 14 * 1.35 + 12;
  return points / page.height;
}

/** Keeps the box on an existing page and entirely inside it, as the server requires. */
export function clampPlacement(
  p: SignaturePlacement,
  pages: { width: number; height: number }[],
  picture: { width: number; height: number } | null,
  usePicture: boolean,
): SignaturePlacement {
  const page = Math.min(Math.max(1, Math.trunc(p.page)), Math.max(1, pages.length));
  const size = pages[page - 1] ?? { width: 595, height: 842 };
  let width = Math.min(0.6, Math.max(0.08, p.width));
  while (width > 0.08 && boxHeight(width, size, picture, usePicture) > 0.98) width -= 0.01;
  const height = boxHeight(width, size, picture, usePicture);
  return {
    page,
    width,
    x: Math.min(Math.max(0, p.x), 1 - width),
    y: Math.min(Math.max(0, p.y), Math.max(0, 1 - height - 0.002)),
  };
}

/** The signing request body: certificate, and the placement/picture choice made on screen. */
export function signingPayload(
  certificateId: string,
  placement: SignaturePlacement | null,
  usePicture: boolean,
) {
  // Nothing chosen on screen: the plain request, which signs in the signer's own box with their picture.
  if (!placement && usePicture) return { certificateId: guid(certificateId) };
  return {
    certificateId: guid(certificateId),
    placement: placement
      ? {
          page: placement.page,
          x: round(placement.x),
          y: round(placement.y),
          width: round(placement.width),
        }
      : null,
    usePicture,
  };
}
const round = (value: number) => Math.round(value * 10000) / 10000;
const roundPlacement = (p: SignaturePlacement) => ({
  page: p.page,
  x: round(p.x),
  y: round(p.y),
  width: round(p.width),
});
