import { contractError, type ContractRequest } from './contracts';

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
};

/** Prefers the server's own sentence (digital-signing refusals are written for the signer), then BHOME's codes. */
export function signingError(error: unknown): string {
  const e = error as { problem?: { detail?: string; code?: string }; status?: number } | null;
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
