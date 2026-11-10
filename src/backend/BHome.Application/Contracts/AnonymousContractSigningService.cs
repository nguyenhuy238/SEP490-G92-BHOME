using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Storage;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed class AnonymousContractSigningService(IContractRepository contracts, IAnonymousSigningRepository invitations,
    IAnonymousSigningSecurity security, IInternalAcceptanceRenderer evidenceRenderer, ICurrentUser actor,
    IContractDocumentRenderer renderer, IContractSigningDocumentSource source, IContractFileStore files,
    IObjectStorage storage, TimeProvider clock, IContractSigningPages pages, ContractService? lifecycle = null)
{
    private DateTimeOffset Now => clock.GetUtcNow();
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));
    private static string Hash(string value) => Hash(Encoding.UTF8.GetBytes(value));
    private static string Secret() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private static bool Matches(string? stored, string value) => stored is not null &&
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(stored), Encoding.UTF8.GetBytes(value));
    private static InternalAcceptanceEvidence? Evidence(Contract c) => c.InternalAcceptance == "{}" ? null :
        JsonSerializer.Deserialize<InternalAcceptanceEvidence>(c.InternalAcceptance);
    private async Task<Contract> OwnerContract(Guid id, CancellationToken t)
    {
        if (actor.UserId is not { } owner || !actor.IsInRole(Roles.Owner)) throw new ContractException(403, "invitation_owner_required");
        var contract = await contracts.FindAsync(id, t) ?? throw ContractException.Missing();
        if (contract.OwnerSignerId != owner) throw ContractException.Missing();
        return contract;
    }
    private static void Intact(Contract c)
    {
        if (c.SigningMode != ContractSigningModes.Internal || c.SnapshotHash != ContractDocumentSnapshot.Hash(ContractService.Document(c)))
            throw ContractException.Conflict("signed_terms_changed");
        if (c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation))
            throw ContractException.Conflict("contract_not_open_for_signing");
    }
    public async Task<InternalSigningStatus> StatusAsync(Guid id, CancellationToken t)
    {
        var c = await OwnerContract(id, t); var evidence = Evidence(c);
        return new(c.SigningMode, evidence?.OwnerAcceptedAt is not null ? "OwnerConfirmed" : evidence is not null ? "TenantAccepted" : "AwaitingAcceptance",
            evidence?.SourceHash, evidence?.AcceptedAt, evidence?.OwnerAcceptedAt,
            (await invitations.ListAsync(id, t)).Select(i => new SigningInvitationResult(i.Id,
                i.RevokedAt is not null ? "Revoked" : i.AcceptedAt is not null ? "Accepted" : i.ExpiresAt <= Now ? "Expired" : i.DeliveryStatus, i.ExpiresAt)).ToArray());
    }
    public async Task<SigningInvitationResult> InviteAsync(Guid id, SigningInvitationInput input, CancellationToken t)
    {
        var before = await OwnerContract(id, t);
        if (input.ExpiresAt.Offset != TimeSpan.Zero || input.ExpiresAt <= Now || input.ExpiresAt > Now.AddHours(24))
            throw ContractException.Invalid("signing_invitation_expiry_invalid");
        // Fail before creating an unusable invitation when the separately scoped OTP key is absent.
        _ = security.OtpHash(Guid.Empty, "", "");
        string recipient = "";
        var result = await contracts.InTransactionAsync(before.RoomId, async () =>
        {
            var c = await OwnerContract(id, t); Intact(c);
            if (input.SnapshotHash != c.SnapshotHash || Evidence(c) is not null) throw ContractException.Conflict("signing_review_changed");
            if (c.Kind == ContractKind.Holding && (c.ApprovedAt is null || c.HoldingExpiryAt <= Now))
                throw ContractException.Conflict("holding_owner_approval_required");
            if (c.DraftMetadata != "{}" && c.Status == ContractStatus.Draft) throw ContractException.Conflict("main_draft_review_required");
            var people = await contracts.ResidentsAsync(c.RoomId, c.Residents.Select(r => r.ResidentId).ToArray(), t);
            if (people.Count != c.Residents.Count || people.Any(r => r.VerificationStatus != IdentityVerificationStatus.Verified ||
                string.IsNullOrWhiteSpace(r.ContactEmail) || !MailAddress.TryCreate(r.ContactEmail, out _)) ||
                people.Select(r => r.ContactEmail!.Trim().ToLowerInvariant()).Distinct().Count() != people.Count)
                throw ContractException.Conflict("verified_residents_with_email_required");
            var token = Secret(); var person = people.Single(r => r.Id == c.RepresentativeResidentId);
            recipient = person.ContactEmail!.Trim().ToLowerInvariant();
            var document = ContractService.Document(c);
            var pdf = await source.ReadAsync(document, t) ?? await renderer.RenderAsync(document, t);
            if (pdf.Length < 5 || !pdf.AsSpan(0, 5).SequenceEqual("%PDF-"u8)) throw ContractException.Conflict("contract_document_integrity_failed");
            foreach (var old in await invitations.ListAsync(id, t)) { old.RevokedAt ??= Now; old.OtpHash = null; old.SessionHash = null; }
            var invite = new ContractSigningInvitation
            {
                ContractId = id,
                ResidentId = person.Id,
                ApprovedByUserId = actor.UserId!.Value,
                TokenHash = Hash(token),
                SnapshotHash = c.SnapshotHash,
                RecipientEmail = person.ContactEmail!.Trim().ToLowerInvariant(),
                DocumentHash = Hash(pdf),
                ExpiresAt = input.ExpiresAt,
                DeliveryStatus = "OwnerApprovedLink"
            };
            invite.DocumentObjectKey = $"contracts/{id:N}/internal/{invite.Id:N}/review.pdf";
            await files.PutAsync(c.RoomId, invite.DocumentObjectKey, pdf, "application/pdf", t);
            invitations.Add(invite); c.Status = ContractStatus.PendingSigning;
            contracts.Audit(actor.UserId.Value, "InternalSigningInvitationApproved", id, Now);
            // A one-time Owner-visible copy link is a supported manual handoff. Raw tokens never enter persistence.
            return new SigningInvitationResult(invite.Id, invite.DeliveryStatus, invite.ExpiresAt, token);
        }, t);
        if (!security.EmailConfigured) return result;
        var deliveryStatus = "InvitationAcceptedByProvider";
        try
        {
            await security.SendAsync(recipient, $"internal-signing-invitation:{result.Id:N}", "BHOME — Lời mời ký hợp đồng",
                "Owner đã duyệt lời mời. Bạn cần xác minh OTP, đọc PDF và đồng ý trước khi ký nội bộ. " +
                (security.InvitationUrl(result.Token!) is { } url ? "Mở liên kết: " + url :
                    "Mở BHOME Mobile > Mở lời mời ký hợp đồng và dán mã: " + result.Token) +
                $"\nLời mời hết hạn lúc {result.ExpiresAt:O}. Đây không phải chữ ký số CA.", t);
        }
        catch (Exception e) when (e is not OperationCanceledException) { deliveryStatus = "InvitationPendingManualDelivery"; }
        await WithToken(result.Token!, (invite, _) => { invite.DeliveryStatus = deliveryStatus; return Task.FromResult(true); }, t);
        return result with { Status = deliveryStatus };
    }
    public async Task RevokeAsync(Guid id, Guid invitationId, CancellationToken t)
    {
        var before = await OwnerContract(id, t);
        await contracts.InTransactionAsync(before.RoomId, async () =>
        {
            var c = await OwnerContract(id, t);
            var invite = (await invitations.ListAsync(id, t)).SingleOrDefault(i => i.Id == invitationId) ?? throw ContractException.Missing();
            if (invite.AcceptedAt is not null || Evidence(c) is not null) throw ContractException.Conflict("accepted_invitation_cannot_be_revoked");
            invite.RevokedAt ??= Now; invite.OtpHash = null; invite.SessionHash = null;
            contracts.Audit(actor.UserId!.Value, "InternalSigningInvitationRevoked", id, Now); return true;
        }, t);
    }
    private async Task<ContractSigningInvitation> Token(string token, CancellationToken t)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length != 64 || !token.All(Uri.IsHexDigit)) throw ContractException.Missing();
        var invite = await invitations.FindByTokenHashAsync(Hash(token), t) ?? throw ContractException.Missing();
        Valid(invite); return invite;
    }
    private void Valid(ContractSigningInvitation i)
    {
        if (i.RevokedAt is not null || i.ExpiresAt <= Now) throw ContractException.Missing();
    }
    private async Task<T> WithToken<T>(string token, Func<ContractSigningInvitation, Contract, Task<T>> work, CancellationToken t)
    {
        var prior = await Token(token, t);
        var before = await contracts.FindAsync(prior.ContractId, t) ?? throw ContractException.Missing();
        return await contracts.InTransactionAsync(before.RoomId, async () =>
        {
            var invite = await invitations.FindAsync(prior.Id, t) ?? throw ContractException.Missing(); Valid(invite);
            var c = await contracts.FindAsync(invite.ContractId, t) ?? throw ContractException.Missing();
            Intact(c);
            if (invite.SnapshotHash != c.SnapshotHash) throw ContractException.Conflict("signed_terms_changed");
            return await work(invite, c);
        }, t);
    }
    public Task<AnonymousSigningInfo> InfoAsync(string token, CancellationToken t) => WithToken(token, (i, _) =>
    {
        var at = i.RecipientEmail.IndexOf('@');
        return Task.FromResult(new AnonymousSigningInfo(i.RecipientEmail[..1] + "***" + i.RecipientEmail[at..], i.ExpiresAt, i.AcceptedAt is not null, ContractSigningModes.Internal));
    }, t);
    public async Task RequestOtpAsync(string token, CancellationToken t)
    {
        if (!security.EmailConfigured) throw new ContractException(503, "signing_email_not_configured");
        var pending = await WithToken(token, (i, _) =>
        {
            if (i.AcceptedAt is not null || i.OtpSendCount >= 5 || i.OtpSentAt > Now.AddMinutes(-1))
                throw new ContractException(429, "signing_otp_retry_later");
            var otp = RandomNumberGenerator.GetInt32(1_000_000).ToString("D6");
            i.OtpHash = security.OtpHash(i.Id, i.TokenHash, otp); i.OtpExpiresAt = Now.AddMinutes(5);
            i.OtpSentAt = Now; i.OtpSendCount++; i.OtpAttempts = 0; i.SessionHash = null; i.SessionExpiresAt = null; i.DeliveryStatus = "OtpPendingDelivery";
            return Task.FromResult((i.Id, i.RecipientEmail, otp, i.OtpSendCount));
        }, t);
        try
        {
            await security.SendAsync(pending.RecipientEmail, $"internal-signing:{pending.Id}:{pending.OtpSendCount}", "BHOME — Mã xác nhận ký hợp đồng",
                $"Mã xác nhận của bạn: {pending.otp}. Mã có hiệu lực 5 phút. Không chia sẻ mã này.", t);
            await WithToken(token, (invite, _) =>
            {
                if (invite.OtpHash is not null && invite.OtpSendCount == pending.OtpSendCount) invite.DeliveryStatus = "OtpAcceptedByProvider";
                return Task.FromResult(true);
            }, t);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // Durable pending state survives delivery failure; do not manufacture a delivered result.
            throw new ContractException(503, "signing_otp_delivery_failed");
        }
    }
    public async Task<AnonymousSigningAccess> VerifyOtpAsync(AnonymousOtpInput input, CancellationToken t)
    {
        var result = await WithToken(input.Token, (i, _) =>
        {
            if (i.AcceptedAt is not null || i.OtpHash is null || i.OtpExpiresAt <= Now || i.OtpAttempts >= 5)
                return Task.FromResult<AnonymousSigningAccess?>(null);
            i.OtpAttempts++;
            if (input.Otp is null || input.Otp.Length != 6 || !Matches(i.OtpHash, security.OtpHash(i.Id, i.TokenHash, input.Otp)))
                return Task.FromResult<AnonymousSigningAccess?>(null);
            var session = Secret(); i.SessionHash = Hash(session); i.SessionExpiresAt = Now.AddMinutes(15);
            i.OtpHash = null; i.DeliveryStatus = "OtpVerified";
            return Task.FromResult<AnonymousSigningAccess?>(new(session, i.DocumentHash, ContractSigningModes.InternalConsent));
        }, t);
        // Reject after committing the failed-attempt counter.
        return result ?? throw ContractException.Invalid("signing_otp_invalid_or_expired");
    }
    private void Session(ContractSigningInvitation i, string session)
    {
        if (session is null || session.Length != 64 || i.SessionExpiresAt <= Now || !Matches(i.SessionHash, Hash(session)))
            throw new ContractException(401, "signing_session_invalid_or_expired");
    }
    private async Task<byte[]> Read(string key, string hash, CancellationToken t)
    {
        using var buffer = new MemoryStream(); await storage.CopyToAsync(key, buffer, t);
        var bytes = buffer.ToArray(); if (!Matches(hash, Hash(bytes))) throw ContractException.Conflict("signing_evidence_integrity_failed");
        return bytes;
    }
    public Task<byte[]> DocumentAsync(AnonymousSigningSession input, CancellationToken t) => WithToken(input.Token, async (i, _) =>
    { Session(i, input.Session); return await Read(i.DocumentObjectKey, i.DocumentHash, t); }, t);
    public async Task<SigningLayoutInfo> LayoutAsync(AnonymousSigningSession input, CancellationToken t)
    {
        var pdf = await DocumentAsync(input, t); var layout = pages.Inspect(pdf, false);
        if (layout.Pages.Count > 50) throw ContractException.Conflict("signing_document_page_limit");
        return layout;
    }
    public async Task<byte[]> PageAsync(AnonymousSigningSession input, int page, CancellationToken t)
    {
        if (page is < 1 or > 50) throw ContractException.Invalid("signing_page_invalid");
        var pdf = await DocumentAsync(input, t);
        if (page > pages.Inspect(pdf, false).Pages.Count) throw ContractException.Missing();
        return pages.RenderPage(pdf, page, 900);
    }
    public Task AcceptAsync(AnonymousAcceptanceInput input, CancellationToken t) => WithToken(input.Token, async (i, c) =>
    {
        Session(i, input.Session);
        if (!input.Consent || input.ConsentVersion != ContractSigningModes.InternalConsent || input.DocumentHash != i.DocumentHash)
            throw ContractException.Invalid("exact_document_consent_required");
        var strokes = input.Strokes;
        if (strokes is null || strokes.Length is < 1 or > 20 || strokes.Any(s => s is null || s.Length is < 2 or > 1000) ||
            strokes.Sum(s => s.Length) > 4000 || strokes.SelectMany(s => s).Any(p => p is null || !double.IsFinite(p.X) || !double.IsFinite(p.Y) || p.X is < 0 or > 1 || p.Y is < 0 or > 1) ||
            strokes.SelectMany(s => s).Select(p => (p.X, p.Y)).Distinct().Count() < 2)
            throw ContractException.Invalid("drawn_signature_required");
        var strokeHash = Hash(JsonSerializer.Serialize(strokes));
        if (i.AcceptedAt is not null)
        {
            if (i.SignatureHash != strokeHash) throw ContractException.Conflict("acceptance_already_recorded");
            return true;
        }
        var bytes = await Read(i.DocumentObjectKey, i.DocumentHash, t);
        var accepted = evidenceRenderer.Accept(bytes, strokes, i.ResidentId, Now, i.DocumentHash);
        i.SignatureObjectKey = $"contracts/{c.Id:N}/internal/{i.Id:N}/signature.png";
        i.AcceptedDocumentObjectKey = $"contracts/{c.Id:N}/internal/{i.Id:N}/accepted.pdf";
        await files.PutAsync(c.RoomId, i.SignatureObjectKey, accepted.SignaturePng, "image/png", t);
        await files.PutAsync(c.RoomId, i.AcceptedDocumentObjectKey, accepted.Pdf, "application/pdf", t);
        i.SignatureHash = strokeHash; i.AcceptedDocumentHash = Hash(accepted.Pdf); i.AcceptedAt = Now; i.DeliveryStatus = "Accepted";
        c.InternalAcceptance = JsonSerializer.Serialize(new InternalAcceptanceEvidence(i.Id, i.ResidentId, c.SnapshotHash, i.DocumentHash,
            Hash(accepted.SignaturePng), i.AcceptedDocumentObjectKey, i.AcceptedDocumentHash, Now));
        contracts.AuditAnonymous("InternalTenantAcceptanceRecorded", c.Id, Now);
        return true;
    }, t);
    public async Task ConfirmOwnerAsync(Guid id, InternalOwnerAcceptance input, CancellationToken t)
    {
        var before = await OwnerContract(id, t);
        await contracts.InTransactionAsync(before.RoomId, async () =>
        {
            var c = await OwnerContract(id, t); Intact(c);
            var e = Evidence(c) ?? throw ContractException.Conflict("tenant_acceptance_required");
            if (!input.Consent || input.ConsentVersion != ContractSigningModes.InternalConsent || input.DocumentHash != e.SourceHash || e.SnapshotHash != c.SnapshotHash)
                throw ContractException.Invalid("exact_document_consent_required");
            if (e.OwnerAcceptedAt is not null) return true;
            var pdf = evidenceRenderer.ConfirmOwner(await Read(e.TenantDocumentKey, e.TenantDocumentHash, t), actor.UserId!.Value, Now, e.SourceHash);
            var key = $"contracts/{id:N}/internal/{e.InvitationId:N}/owner-confirmed.pdf";
            await files.PutAsync(c.RoomId, key, pdf, "application/pdf", t);
            c.InternalAcceptance = JsonSerializer.Serialize(e with { OwnerId = actor.UserId, OwnerAcceptedAt = Now, FinalDocumentKey = key, FinalDocumentHash = Hash(pdf) });
            c.Status = ContractStatus.PendingActivation;
            if (c.Kind == ContractKind.Holding)
                await (lifecycle ?? throw new ContractException(503, "holding_workflow_unavailable")).CompleteInternalHoldingSigningAsync(c, t);
            contracts.Audit(actor.UserId.Value, "InternalOwnerAcceptanceConfirmed", id, Now); return true;
        }, t);
    }
    public static bool Complete(Contract c)
    {
        var e = Evidence(c);
        return c.SigningMode == ContractSigningModes.Internal && e is not null && e.OwnerId == c.OwnerSignerId &&
            e.ResidentId == c.RepresentativeResidentId && e.SnapshotHash == c.SnapshotHash &&
            e.OwnerAcceptedAt is not null && e.FinalDocumentKey is not null && e.FinalDocumentHash is not null;
    }
    public static InternalAcceptanceEvidence? AcceptedEvidence(Contract c) => Evidence(c);
}
