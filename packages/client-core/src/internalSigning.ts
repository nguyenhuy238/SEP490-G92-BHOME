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
export function signingInvitationLabel(status: string) {
  return (
    (
      {
        AwaitingOwnerSignature: 'Đã gửi Owner ký · Chưa gửi email Tenant',
        OwnerApprovedLink: 'Đã tạo lời mời · Chưa xác nhận gửi email',
        InvitationAcceptedByProvider: 'Đã gửi email · Chờ ký',
        InvitationPendingManualDelivery: 'Chưa gửi được email · Owner cần kiểm tra',
        OtpPendingDelivery: 'Đang gửi mã OTP',
        OtpAcceptedByProvider: 'Đã gửi mã OTP',
        OtpVerified: 'Đã xác minh OTP · Cần hoàn tất chữ ký',
        Accepted: 'Đã ký',
        Expired: 'Lời mời đã hết hạn',
        Revoked: 'Lời mời đã thu hồi',
      } as Record<string, string>
    )[status] ?? 'Chưa xác định trạng thái gửi lời mời'
  );
}
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
    invite: (
      id: string,
      snapshotHash: string,
      expiresAt: string,
      recipientEmail?: string,
      contacts?: { residentId: string; email: string }[],
      resend = false,
    ) =>
      post<{ id: string; token?: string | null; status: string; expiresAt: string }>(
        '/api/v1/contracts/' + id + '/signing-invitations',
        {
          snapshotHash,
          expiresAt,
          ...(recipientEmail?.trim() ? { recipientEmail: recipientEmail.trim() } : {}),
          ...(contacts?.length ? { contacts } : {}),
          ...(resend ? { resend: true } : {}),
        },
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
    simulateTenant: (id: string) =>
      post<InternalSigningStatus>(
        '/api/v1/contracts/' + id + '/internal-signing/tenant-simulation',
        {},
      ),
    simulateOwner: (id: string, documentHash: string) =>
      post<InternalSigningStatus>(
        '/api/v1/contracts/' + id + '/internal-signing/owner-simulation',
        { documentHash, consent: true, consentVersion: 'internal-acceptance-v1' },
      ),
    validateAccountInvitation: (token: string) =>
      post<{ status: string; email?: string | null }>('/api/v1/auth/accept-invitation/validate', {
        token,
      }),
    acceptAccount: (userName: string | null, token: string, newPassword: string) =>
      post<void>('/api/v1/auth/accept-invitation', {
        userName: userName?.trim(),
        token: token.trim(),
        newPassword,
      }),
  };
}
export function signingMessage(error: unknown) {
  const value = error as { code?: string; problem?: { code?: string } };
  const code = value?.code ?? value?.problem?.code;
  if (code === 'signing_invitation_already_active')
    return 'Hợp đồng đang có lời mời ký còn hiệu lực. Làm mới trạng thái, rồi dùng Gửi lại email để đổi địa chỉ nhận.';
  if (code === 'signing_otp_retry_later')
    return 'Chưa thể gửi lại mã qua email. Vui lòng thử lại sau.';
  if (code === 'signing_invitation_not_active')
    return 'Lời mời đã hết hạn, bị thu hồi hoặc đã ký. Hãy làm mới trạng thái trước khi gửi tiếp.';
  if (code === 'holding_owner_signature_required')
    return 'Cần chữ ký Owner hợp lệ để hoàn tất hợp đồng giữ chỗ.';
  if (code === 'signing_email_already_in_use')
    return 'Email này đã được sử dụng trong hồ sơ/hợp đồng chính thức hoặc tài khoản nhân viên. Vui lòng nhập email khác.';
  if (code === 'signing_contacts_required')
    return 'Nhập email hợp lệ của người đại diện thuê trước khi gửi lời mời ký.';
  if (code === 'resident_account_email_mismatch')
    return 'Nhập đúng email của tài khoản đã liên kết với người đại diện thuê.';
  if (code === 'signing_contacts_invalid')
    return 'Danh sách email không khớp người ở trong hợp đồng. Hãy tải lại và kiểm tra.';
  if (code === 'holding_owner_approval_required')
    return 'Owner chưa phê duyệt hợp đồng giữ chỗ. Hãy phê duyệt trên Web trước khi ký.';
  if (code === 'exact_document_consent_required')
    return 'Xác nhận ký không khớp phiên bản tài liệu hiện tại. Tải lại hợp đồng và xác nhận lại.';
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
