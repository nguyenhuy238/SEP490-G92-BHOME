import type { createApiClient } from './api';
export type DrawnPoint = { x: number; y: number };
export type InternalSigningStatus = {
  mode: string;
  state: string;
  documentHash: string | null;
  tenantAcceptedAt: string | null;
  ownerAcceptedAt: string | null;
  invitations: { id: string; status: string; expiresAt: string }[];
  maskedEmail?: string | null;
  tenantSimulated?: boolean;
  canContinue?: boolean;
  sandboxAvailable?: boolean;
};
export type SigningAccess = { session: string; documentHash: string; consentVersion: string };
export function internalSigningClient(request: ReturnType<typeof createApiClient>) {
  function post<T>(path: string, body: unknown) {
    return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }
  const root = '/api/v1/contract-signing';
  return {
    info: (token: string) =>
      post<{ maskedEmail: string; expiresAt: string; accepted: boolean; mode: string }>(
        root + '/info',
        { token },
      ),
    otp: (token: string) => post<void>(root + '/otp', { token }),
    verify: (token: string, otp: string) => post<SigningAccess>(root + '/verify', { token, otp }),
    document: (token: string, session: string) =>
      request<Uint8Array>(
        root + '/document',
        {
          method: 'POST',
          body: JSON.stringify({ token, session }),
        },
        'bytes',
      ),
    accept: (token: string, access: SigningAccess, consent: boolean, strokes: DrawnPoint[][]) =>
      post<void>(root + '/accept', { token, ...access, consent, strokes }),
    layout: (token: string, session: string) =>
      post<{ pages: { width: number; height: number }[] }>(root + '/document/layout', {
        token,
        session,
      }),
    page: (token: string, session: string, page: number) =>
      request<Uint8Array>(
        root + '/document/pages/' + page,
        { method: 'POST', body: JSON.stringify({ token, session }) },
        'bytes',
      ),
    status: (id: string) =>
      request<InternalSigningStatus>('/api/v1/contracts/' + id + '/internal-signing'),
    invite: (id: string, snapshotHash: string, expiresAt: string) =>
      post<{ id: string; token?: string | null; status: string; expiresAt: string }>(
        '/api/v1/contracts/' + id + '/signing-invitations',
        { snapshotHash, expiresAt },
      ),
    revoke: (id: string, invitationId: string) =>
      request<void>('/api/v1/contracts/' + id + '/signing-invitations/' + invitationId, {
        method: 'DELETE',
      }),
    ownerConfirm: (id: string, documentHash: string) =>
      post<void>('/api/v1/contracts/' + id + '/internal-signing/owner-confirmation', {
        documentHash,
        consent: true,
        consentVersion: 'internal-acceptance-v1',
      }),
    acceptAccount: (userName: string, token: string, newPassword: string) =>
      post<void>('/api/v1/auth/accept-invitation', {
        userName: userName.trim(),
        token: token.trim(),
        newPassword,
      }),
  };
}
export function signingMessage(error: unknown) {
  const value = error as { code?: string; problem?: { code?: string } };
  const code = value?.code ?? value?.problem?.code;
  if (code === 'signing_otp_key_not_configured')
    return 'Chưa cấu hình khóa xác minh OTP. Vui lòng liên hệ quản trị viên trước khi tạo lời mời ký.';
  if (code === 'signing_email_not_configured')
    return 'Chưa cấu hình dịch vụ gửi email ký hợp đồng. Vui lòng liên hệ quản trị viên.';
  const status = (error as { status?: number }).status;
  if (status === 503) return 'Chưa cấu hình dịch vụ gửi mã hoặc tài liệu. Vui lòng liên hệ Owner.';
  if (status === 429) return 'Bạn đã thử quá nhiều lần. Vui lòng chờ rồi thử lại.';
  if (status === 404 || status === 401)
    return 'Lời mời hoặc phiên xác nhận đã hết hạn. Vui lòng yêu cầu lời mời mới.';
  if (status === 409)
    return 'Tài liệu hoặc trạng thái đã thay đổi. Vui lòng tải lại và kiểm tra với Owner.';
  if (status === 400) return 'Mã xác nhận hoặc thông tin chưa hợp lệ. Vui lòng kiểm tra lại.';
  return 'Chưa thể hoàn tất. Vui lòng kiểm tra kết nối và thử lại.';
}
