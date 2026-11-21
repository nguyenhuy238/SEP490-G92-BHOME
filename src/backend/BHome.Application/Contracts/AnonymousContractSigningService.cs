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
    IObjectStorage storage, TimeProvider clock, IContractSigningPages pages, ContractService? lifecycle = null,
    IHoldingTestScope? testScope = null)
{
    private DateTimeOffset Now => clock.GetUtcNow();
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));
    private static string Hash(string value) => Hash(Encoding.UTF8.GetBytes(value));
    private static string Secret() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private static bool Matches(string? stored, string value) => stored is not null &&
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(stored), Encoding.UTF8.GetBytes(value));
    private static InternalAcceptanceEvidence? Evidence(Contract c) => c.InternalAcceptance == "{}" || MainSandboxAcceptance.Read(c) is not null ? null :
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
        if (c.SigningMode != ContractSigningModes.Internal || !ContractChargeSnapshot.IsIntact(c))
            throw ContractException.Conflict("signed_terms_changed");
        if (c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation))
            throw ContractException.Conflict("contract_not_open_for_signing");
    }
    public static bool AllowsEitherSigningOrder(Contract c) => c.Kind is ContractKind.Holding or ContractKind.Main;
    private bool TestHolding(Contract c) => c.Kind == ContractKind.Holding && c.IsDevelopmentDemo && testScope?.Allows(c.Room.LocationId) == true;
    private bool TestMain(Contract c) => c.Kind == ContractKind.Main && c.SigningMode == ContractSigningModes.Internal && c.TenantUserId is null &&
        testScope?.Allows(c.Room.LocationId) == true;
    private async Task<Contract> SigningOperator(Guid id, CancellationToken t)
    {
        if (actor.IsInRole(Roles.Owner)) return await OwnerContract(id, t);
        if (!actor.IsInRole(Roles.Staff) || lifecycle is null) throw new ContractException(403, "invitation_owner_required");
        await lifecycle.GetAsync(id, t);
        var c = await contracts.FindAsync(id, t) ?? throw ContractException.Missing();
        if (TestMain(c)) return c;
        if (c.Kind is ContractKind.Main or ContractKind.Renewal && c.SigningMode == ContractSigningModes.Internal)
            return c;
        if (c.Kind != ContractKind.Holding) throw new ContractException(403, "invitation_owner_required");
        return c;
    }
    public async Task<InternalSigningStatus> StatusAsync(Guid id, CancellationToken t)
    {
        var c = await SigningOperator(id, t); var evidence = Evidence(c);
        if (TestMain(c) && evidence is null && (await invitations.ListAsync(id, t)).All(i => i.AcceptedAt is null))
        {
            var accepted = MainSandboxAcceptance.Read(c);
            return new(c.SigningMode, accepted is null ? "AwaitingAcceptance" : "OwnerConfirmedSandbox",
                c.SnapshotHash, null, accepted?.ConfirmedAt, [], null, accepted?.TenantSimulatedAt is not null, Complete(c), true);
        }
        var simulation = TestHolding(c) ? SandboxSignatures.Read(c) : null;
        var simulated = evidence is null && simulation?.TenantAt is not null;
        var ownerAt = evidence?.OwnerAcceptedAt ?? (AllowsEitherSigningOrder(c) ? VerifiedOwnerSignature(c)?.SignedAt : null) ?? (simulation?.OwnerConfirmed(c) == true ? simulation.OwnerConfirmedAt : null);
        var rows = await invitations.ListAsync(id, t);
        var email = rows.FirstOrDefault()?.RecipientEmail;
        if (email is null)
            email = (await contracts.ResidentsAsync(c.RoomId, [c.RepresentativeResidentId], t)).FirstOrDefault()?.ContactEmail;
        var masked = email is { Length: > 0 } && email.Contains('@') ? email[..1] + "***" + email[email.IndexOf('@')..] : null;
        return new(c.SigningMode, ownerAt is not null ? "OwnerConfirmed" : evidence is not null ? "TenantAccepted" : "AwaitingAcceptance",
            actor.IsInRole(Roles.Owner) ? evidence?.SourceHash ?? (c.Kind == ContractKind.Holding || simulation is not null ? c.SnapshotHash : null) : null,
            evidence?.AcceptedAt, ownerAt,
            rows.Select(i => new SigningInvitationResult(i.Id,
                i.RevokedAt is not null ? "Revoked" : i.AcceptedAt is not null ? "Accepted" : i.ExpiresAt <= Now ? "Expired" : i.DeliveryStatus, i.ExpiresAt)).ToArray(),
            masked, simulated, Complete(c) && (MainSandboxAcceptance.Read(c) is null || TestMain(c)) || simulated && ownerAt is not null, simulation is not null);
    }
    public async Task<SigningInvitationResult> InviteAsync(Guid id, SigningInvitationInput input, CancellationToken t)
    {
        var before = await SigningOperator(id, t);
        if (actor.IsInRole(Roles.Staff) && !security.EmailConfigured) throw new ContractException(503, "signing_email_not_configured");
        if (input.ExpiresAt.Offset != TimeSpan.Zero || input.ExpiresAt <= Now || input.ExpiresAt > Now.AddHours(24))
            throw ContractException.Invalid("signing_invitation_expiry_invalid");
        // Fail before creating an unusable invitation when the separately scoped OTP key is absent.
        _ = security.OtpHash(Guid.Empty, "", "");
        string recipient = "";
        string? invitationOtp = null;
        var attempt = 0;
        var result = await contracts.InTransactionAsync(before.RoomId, async () =>
        {
            var c = await SigningOperator(id, t); Intact(c);
            if (c.Signatures.Any(s => s.Status != SignatureStatus.Failed &&
                !(AllowsEitherSigningOrder(c) && s.SignerUserId == c.OwnerSignerId && s.SnapshotHash == c.SnapshotHash)))
                throw ContractException.Conflict("signing_already_started");
            if (input.SnapshotHash != c.SnapshotHash || Evidence(c) is not null) throw ContractException.Conflict("signing_review_changed");
            if (c.Kind == ContractKind.Holding && c.HoldingExpiryAt <= Now)
                throw ContractException.Conflict("holding_expired");
            if (c.Kind == ContractKind.Main && c.DraftMetadata != "{}" && c.Status == ContractStatus.Draft) throw ContractException.Conflict("main_draft_review_required");
            if (c.Kind is ContractKind.Main or ContractKind.Renewal or ContractKind.Holding)
            {
                await ContractChargeSnapshot.ValidateBindingAsync(contracts, c, t,
                    checkProfile: c.Status == ContractStatus.Draft && c.Kind != ContractKind.Holding && !c.PriceLockedAt.HasValue);
                if (c.Status == ContractStatus.Draft) ContractChargeSnapshot.MarkMainBound(c, Now);
            }
            if (!AllowsEitherSigningOrder(c) && actor.IsInRole(Roles.Staff) && (await invitations.ListAsync(id, t)).Any(i => i.RevokedAt is null && i.AcceptedAt is null && i.ExpiresAt > Now))
                throw ContractException.Conflict("signing_invitation_already_active");
            var people = await contracts.ResidentsAsync(c.RoomId, c.Residents.Select(r => r.ResidentId).ToArray(), t);
            if (people.Count != c.Residents.Count || people.Any(r => !BHome.Application.Ocr.ContractResidentEligibility.Ready(r, c.RepresentativeResidentId)))
                throw ContractException.Conflict("verified_residents_required");
            if (input.Contacts is { } supplied && (supplied.Select(p => p.ResidentId).Distinct().Count() != supplied.Count ||
                supplied.Any(p => people.All(r => r.Id != p.ResidentId))))
                throw ContractException.Invalid("signing_contacts_invalid");
            var heldInvitation = AllowsEitherSigningOrder(c) ? (await invitations.ListAsync(id, t))
                .FirstOrDefault(i => i.RevokedAt is null && i.AcceptedAt is null && i.ExpiresAt > Now) : null;
            var heldContacts = SigningContacts.Read(heldInvitation);
            var contacts = people.Where(r => r.Id == c.RepresentativeResidentId).ToDictionary(r => r.Id, r =>
                (r.Id == c.RepresentativeResidentId ? input.RecipientEmail : null)?.Trim().ToLowerInvariant() ??
                input.Contacts?.SingleOrDefault(p => p.ResidentId == r.Id)?.Email?.Trim().ToLowerInvariant() ??
                (heldContacts.TryGetValue(r.Id, out var heldEmail) ? heldEmail : null) ?? r.ContactEmail?.Trim().ToLowerInvariant() ?? "");
            if (contacts.Values.Any(email => email.Length > 256 || !MailAddress.TryCreate(email, out _)) ||
                contacts.Values.Distinct().Count() != contacts.Count)
                throw ContractException.Invalid("signing_contacts_required");
            if (AllowsEitherSigningOrder(c))
                foreach (var contact in contacts.OrderBy(p => p.Value, StringComparer.Ordinal))
                    if (await invitations.IsEmailInUseAsync(c.Id, contact.Key, contact.Value, t))
                        throw ContractException.Conflict("signing_email_already_in_use");
            var pending = AllowsEitherSigningOrder(c) ? (await invitations.ListAsync(id, t))
                .FirstOrDefault(i => i.RevokedAt is null && i.AcceptedAt is null && i.ExpiresAt > Now) : null;
            if (pending is not null && pending.DeliveryStatus != "AwaitingOwnerSignature")
            {
                if (pending.SnapshotHash != input.SnapshotHash || (!input.Resend &&
                    (pending.RecipientEmail != contacts[c.RepresentativeResidentId] ||
                    !SigningContacts.Read(pending).OrderBy(x => x.Key).SequenceEqual(contacts.OrderBy(x => x.Key)))))
                    throw ContractException.Conflict("signing_invitation_already_active");
                // A correction only changes the representative's pending delivery address.
                if (!input.Resend) return new SigningInvitationResult(pending.Id, pending.DeliveryStatus, pending.ExpiresAt);
                if (!security.EmailConfigured) throw new ContractException(503, "signing_email_not_configured");
                if (pending.OtpSendCount >= 5 || pending.OtpSentAt > Now.AddMinutes(-1))
                    throw new ContractException(429, "signing_otp_retry_later");
            }
            if (input.Resend && pending is null) throw ContractException.Conflict("signing_invitation_not_active");
            var token = Secret(); var person = people.Single(r => r.Id == c.RepresentativeResidentId);
            recipient = contacts[person.Id];
            var document = ContractService.Document(c);
            var ownerSignature = AllowsEitherSigningOrder(c) ? VerifiedOwnerSignature(c) : null;
            var pdf = input.Resend && pending is not null
                ? await Read(pending.DocumentObjectKey, pending.DocumentHash, t)
                : ownerSignature is not null
                ? await Read(ownerSignature.SignedObjectKey!, ownerSignature.SignedHash!, t)
                : await source.ReadAsync(document, t) ?? await renderer.RenderAsync(document, t);
            var pendingOwner = AllowsEitherSigningOrder(c) ? c.Signatures.FirstOrDefault(s =>
                s.SignerUserId == c.OwnerSignerId && s.Status != SignatureStatus.Failed && s.SnapshotHash == c.SnapshotHash) : null;
            if (!input.Resend && ownerSignature is null && pendingOwner is not null && Hash(pdf) != pendingOwner.SourceHash)
                pdf = await Read($"contracts/{id:N}/signatures/{pendingOwner.Id:N}/source.pdf", pendingOwner.SourceHash!, t);
            if (pdf.Length < 5 || !pdf.AsSpan(0, 5).SequenceEqual("%PDF-"u8)) throw ContractException.Conflict("contract_document_integrity_failed");
            foreach (var old in (await invitations.ListAsync(id, t)).Where(i => i.Id != pending?.Id)) { old.RevokedAt ??= Now; old.OtpHash = null; old.SessionHash = null; }
            var invite = pending ?? new ContractSigningInvitation();
            invite.ContractId = id;
            invite.ResidentId = person.Id;
            invite.ApprovedByUserId = actor.UserId!.Value;
            invite.TokenHash = Hash(token);
            invite.SnapshotHash = c.SnapshotHash;
            invite.RecipientEmail = recipient;
            invite.ContactEmails = JsonSerializer.Serialize(contacts);
            invite.DocumentHash = Hash(pdf);
            invite.ExpiresAt = input.Resend && pending is not null ? pending.ExpiresAt : input.ExpiresAt;
            invite.DeliveryStatus = "OwnerApprovedLink";
            if (security.EmailConfigured) invitationOtp = NewOtp(invite);
            attempt = invite.OtpSendCount;
            invite.DocumentObjectKey = $"contracts/{id:N}/internal/{invite.Id:N}/review.pdf";
            await files.PutAsync(c.RoomId, invite.DocumentObjectKey, pdf, "application/pdf", t);
            if (pending is null) invitations.Add(invite);
            c.Status = ContractStatus.PendingSigning;
            if (!input.Resend && AllowsEitherSigningOrder(c)) contracts.Audit(actor.UserId!.Value, c.Kind == ContractKind.Holding ? "HoldingSigningSubmitted" : "MainSigningSubmitted", id, Now);
            contracts.Audit(actor.UserId!.Value, input.Resend ? "InternalSigningInvitationResent" : "InternalSigningInvitationApproved", id, Now);
            // A one-time Owner-visible copy link is a supported manual handoff. Raw tokens never enter persistence.
            return new SigningInvitationResult(invite.Id, invite.DeliveryStatus, invite.ExpiresAt, token,
                security.InvitationUrl(token));
        }, t);
        if (!security.EmailConfigured || result.Token is null) return result;
        var deliveryStatus = "InvitationAcceptedByProvider";
        try
        {
            await security.SendAsync(recipient, input.Resend ? $"internal-signing-invitation:{result.Id:N}:resend:{attempt}" : $"internal-signing-invitation:{result.Id:N}", "BHOME — Lời mời ký hợp đồng",
                $"Mã OTP của bạn: {invitationOtp}. Mã có hiệu lực 5 phút. Không chia sẻ mã này.\n" +
                "Bạn được mời ký hợp đồng. Mở lời mời, nhập mã OTP trong email này, đọc PDF và đồng ý trước khi ký nội bộ. " +
                (result.Url is not null ? "" : "Mở BHOME Mobile > Mở lời mời ký hợp đồng và dán mã: " + result.Token) +
                $"\nLời mời hết hạn lúc {TimeZoneInfo.ConvertTimeBySystemTimeZoneId(result.ExpiresAt, "Asia/Ho_Chi_Minh"):HH:mm dd/MM/yyyy} (giờ Việt Nam). Đây không phải chữ ký số CA.", t, result.Url);
        }
        catch (Exception e) when (e is not OperationCanceledException) { deliveryStatus = "InvitationPendingManualDelivery"; }
        await WithToken(result.Token!, (invite, _) => { invite.DeliveryStatus = deliveryStatus; return Task.FromResult(true); }, t);
        var ownerCanCopyLink = actor.IsInRole(Roles.Owner);
        return result with
        {
            Status = deliveryStatus,
            Token = ownerCanCopyLink ? result.Token : null,
            Url = ownerCanCopyLink ? result.Url : null
        };
    }
    public async Task DispatchHoldingInvitationAsync(Guid id, CancellationToken t)
    {
        var c = await OwnerContract(id, t);
        if (!AllowsEitherSigningOrder(c)) return;
        var pending = (await invitations.ListAsync(id, t)).FirstOrDefault(i =>
            i.RevokedAt is null && i.AcceptedAt is null && i.ExpiresAt > Now &&
            i.DeliveryStatus == "AwaitingOwnerSignature");
        if (pending is null) return;
        await InviteAsync(id, new(pending.ExpiresAt, pending.SnapshotHash, pending.RecipientEmail,
            SigningContacts.Read(pending).Select(p => new SigningResidentEmail(p.Key, p.Value)).ToArray()), t);
    }
    private static ContractSignature? VerifiedOwnerSignature(Contract c) => c.Signatures.FirstOrDefault(s =>
        s.SignerUserId == c.OwnerSignerId && s.SnapshotHash == c.SnapshotHash && s.SignedAt is not null &&
        (s.Status == SignatureStatus.Signed && !c.IsDevelopmentDemo || s.Status == SignatureStatus.Simulated && c.IsDevelopmentDemo) &&
        !string.IsNullOrWhiteSpace(s.SignedObjectKey) && !string.IsNullOrWhiteSpace(s.SignedHash) && !string.IsNullOrWhiteSpace(s.ProviderReference));
    public static bool HoldingOwnerHasSigned(Contract c) => c.Kind == ContractKind.Holding &&
        (VerifiedOwnerSignature(c) is not null || Complete(c) || c.IsDevelopmentDemo && SandboxSignatures.Read(c).OwnerConfirmed(c));
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
    private string NewOtp(ContractSigningInvitation invitation)
    {
        var otp = RandomNumberGenerator.GetInt32(1_000_000).ToString("D6");
        invitation.OtpHash = security.OtpHash(invitation.Id, invitation.TokenHash, otp);
        invitation.OtpExpiresAt = Now.AddMinutes(5);
        invitation.OtpSentAt = Now;
        invitation.OtpSendCount++;
        invitation.OtpAttempts = 0;
        invitation.SessionHash = null;
        invitation.SessionExpiresAt = null;
        return otp;
    }
    public async Task RequestOtpAsync(string token, CancellationToken t)
    {
        if (!security.EmailConfigured) throw new ContractException(503, "signing_email_not_configured");
        var pending = await WithToken(token, async (i, c) =>
        {
            if (i.AcceptedAt is not null || i.OtpSendCount >= 5 || i.OtpSentAt > Now.AddMinutes(-1))
                throw new ContractException(429, "signing_otp_retry_later");
            if (AllowsEitherSigningOrder(c) && await invitations.IsEmailInUseAsync(c.Id, i.ResidentId, i.RecipientEmail, t))
                throw ContractException.Conflict("signing_email_already_in_use");
            var otp = NewOtp(i);
            i.DeliveryStatus = "OtpPendingDelivery";
            return (i.Id, i.RecipientEmail, otp, i.OtpSendCount);
        }, t);
        try
        {
            await security.SendAsync(pending.RecipientEmail, $"internal-signing:{pending.Id}:{pending.OtpSendCount}", "BHOME — Mã xác nhận ký hợp đồng",
                $"Mã xác nhận của bạn: {pending.otp}. Mã có hiệu lực 5 phút. Không chia sẻ mã này.", t, security.InvitationUrl(token));
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
        var ownerSignature = AllowsEitherSigningOrder(c) ? VerifiedOwnerSignature(c) : null;
        if (ownerSignature is not null && ownerSignature.SignedHash != i.DocumentHash && ownerSignature.SourceHash != i.DocumentHash)
            throw ContractException.Conflict("signing_evidence_integrity_failed");
        var bytes = ownerSignature is not null
            ? await Read(ownerSignature.SignedObjectKey!, ownerSignature.SignedHash!, t)
            : await Read(i.DocumentObjectKey, i.DocumentHash, t);
        var resident = (await contracts.ResidentsAsync(c.RoomId, [i.ResidentId], t)).SingleOrDefault()
            ?? throw ContractException.Conflict("contract_residents_changed");
        if (AllowsEitherSigningOrder(c) && await invitations.IsEmailInUseAsync(c.Id, i.ResidentId, i.RecipientEmail, t))
            throw ContractException.Conflict("signing_email_already_in_use");
        var accepted = evidenceRenderer.Accept(bytes, strokes, i.ResidentId, Now, i.DocumentHash, preserveSignatures: AllowsEitherSigningOrder(c));
        i.SignatureObjectKey = $"contracts/{c.Id:N}/internal/{i.Id:N}/signature.png";
        i.AcceptedDocumentObjectKey = $"contracts/{c.Id:N}/internal/{i.Id:N}/accepted.pdf";
        await files.PutAsync(c.RoomId, i.SignatureObjectKey, accepted.SignaturePng, "image/png", t);
        await files.PutAsync(c.RoomId, i.AcceptedDocumentObjectKey, accepted.Pdf, "application/pdf", t);
        i.SignatureHash = strokeHash; i.AcceptedDocumentHash = Hash(accepted.Pdf); i.AcceptedAt = Now; i.DeliveryStatus = "Accepted";
        // Only OTP-verified, completed acceptance promotes the invitation address to the profile.
        resident.ContactEmail = i.RecipientEmail;
        c.InternalAcceptance = JsonSerializer.Serialize(new InternalAcceptanceEvidence(i.Id, i.ResidentId, c.SnapshotHash, i.DocumentHash,
            Hash(accepted.SignaturePng), i.AcceptedDocumentObjectKey, i.AcceptedDocumentHash, Now,
            ownerSignature is null ? null : c.OwnerSignerId, ownerSignature?.SignedAt,
            ownerSignature is null ? null : i.AcceptedDocumentObjectKey, ownerSignature is null ? null : i.AcceptedDocumentHash));
        if (ownerSignature is not null)
        {
            c.Status = ContractStatus.PendingActivation;
            if (c.Kind == ContractKind.Holding) await (lifecycle ?? throw new ContractException(503, "holding_workflow_unavailable"))
                .CompleteInternalHoldingSigningAsync(c, t, anonymousTenant: true);
        }
        contracts.AuditAnonymous("InternalTenantAcceptanceRecorded", c.Id, Now);
        return true;
    }, t);
    public Task ConfirmOwnerAsync(Guid id, InternalOwnerAcceptance input, CancellationToken t) => ConfirmOwnerCoreAsync(id, input, false, t);
    public async Task<InternalSigningStatus> SimulateMainOwnerAsync(Guid id, InternalOwnerAcceptance input, CancellationToken t)
    {
        if (!actor.IsInRole(Roles.Staff) || actor.UserId is null) throw new ContractException(403, "staff_required");
        await ConfirmOwnerCoreAsync(id, input, true, t);
        return await StatusAsync(id, t);
    }
    private async Task ConfirmOwnerCoreAsync(Guid id, InternalOwnerAcceptance input, bool simulation, CancellationToken t)
    {
        var before = simulation ? await SigningOperator(id, t) : await OwnerContract(id, t);
        if (simulation && !TestMain(before)) throw new ContractException(404, "sandbox_unavailable");
        await contracts.InTransactionAsync(before.RoomId, async () =>
        {
            var c = simulation ? await SigningOperator(id, t) : await OwnerContract(id, t); Intact(c);
            if (!simulation && !c.IsDevelopmentDemo)
                throw ContractException.Conflict("owner_verified_signature_required");
            if (simulation && !TestMain(c)) throw new ContractException(404, "sandbox_unavailable");
            if (TestMain(c) && Evidence(c) is null)
            {
                if (c.Status is not (ContractStatus.PendingSigning or ContractStatus.PendingActivation))
                    throw ContractException.Conflict("contract_not_open_for_signing");
                if (!input.Consent || input.ConsentVersion != ContractSigningModes.InternalConsent || input.DocumentHash != c.SnapshotHash)
                    throw ContractException.Invalid("exact_document_consent_required");
                if (MainSandboxAcceptance.Read(c) is not null) return true;
                var previousInvitations = await invitations.ListAsync(id, t);
                if (c.InternalAcceptance != "{}" || c.Signatures.Count != 0 ||
                    previousInvitations.Any(i => i.AcceptedAt is not null))
                    throw ContractException.Conflict("sandbox_existing_signing_evidence");
                foreach (var invite in previousInvitations.Where(i => i.RevokedAt is null))
                {
                    invite.RevokedAt = Now; invite.OtpHash = null; invite.SessionHash = null;
                    contracts.Audit(actor.UserId!.Value, simulation ? "SandboxTransitionSigningInvitationRevokedByStaff" : "SandboxTransitionSigningInvitationRevokedByOwner", id, Now);
                }
                byte[] sandboxPdf;
                var rebuilt = false;
                try { sandboxPdf = await source.ReadAsync(ContractService.Document(c), t) ?? throw ContractException.Conflict("contract_document_not_available"); }
                catch (Exception missingSource) when (TestMain(c) &&
                    (missingSource is FileNotFoundException || missingSource is ContractException { Code: "signing_source_document_required" or "contract_document_not_available" }))
                {
                    // Explicit Sandbox simulation only: create a labelled development artifact
                    // from the locked snapshot, never replace the reviewed/legal source record.
                    sandboxPdf = await renderer.RenderAsync(ContractService.Document(c), t);
                    rebuilt = true;
                    contracts.Audit(actor.UserId!.Value, "SandboxArtifactRebuiltFromLockedSnapshot", id, Now);
                }
                var sandboxKey = $"contracts/{id:N}/sandbox/owner-only-{c.SnapshotHash}.pdf";
                await files.PutAsync(c.RoomId, sandboxKey, sandboxPdf, "application/pdf", t);
                c.IsDevelopmentDemo = true;
                c.InternalAcceptance = JsonSerializer.Serialize(new MainSandboxAcceptance(MainSandboxAcceptance.Kind,
                    c.OwnerSignerId, c.SnapshotHash, Now, sandboxKey, Hash(sandboxPdf), OwnerSimulatedBy: simulation ? actor.UserId : null, RebuiltTestArtifact: rebuilt));
                c.Status = ContractStatus.PendingSigning;
                contracts.Audit(actor.UserId!.Value, simulation ? "MainOwnerSandboxSimulatedByStaff" : "MainOwnerOnlySandboxConfirmed", id, Now);
                return true;
            }
            var e = Evidence(c);
            if (e is null && TestHolding(c))
            {
                var simulated = SandboxSignatures.Read(c);
                if (c.HoldingExpiryAt <= Now) throw ContractException.Conflict("holding_expired");
                if (!input.Consent || input.ConsentVersion != ContractSigningModes.InternalConsent || input.DocumentHash != c.SnapshotHash)
                    throw ContractException.Invalid("exact_document_consent_required");
                if (!simulated.OwnerConfirmed(c))
                {
                    c.DraftMetadata = JsonSerializer.Serialize(simulated with { OwnerConfirmedBy = actor.UserId, OwnerConfirmedAt = Now });
                    contracts.Audit(actor.UserId!.Value, "OwnerConfirmedSandboxTenantAcceptance", id, Now);
                }
                if (simulated.TenantAt is not null) c.Status = ContractStatus.PendingActivation;
                return true;
            }
            if (e is null) throw ContractException.Conflict("tenant_acceptance_required");
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
        if (MainSandboxAcceptance.Read(c) is { TenantSimulatedBy: not null, TenantSimulatedAt: not null }) return true;
        var e = Evidence(c);
        return c.SigningMode == ContractSigningModes.Internal && e is not null && e.OwnerId == c.OwnerSignerId &&
            e.ResidentId == c.RepresentativeResidentId && e.SnapshotHash == c.SnapshotHash &&
            e.OwnerAcceptedAt is not null && e.FinalDocumentKey is not null && e.FinalDocumentHash is not null;
    }
    public static InternalAcceptanceEvidence? AcceptedEvidence(Contract c) => Evidence(c);
    public async Task<InternalSigningStatus> SimulateMainTenantAsync(Guid id, CancellationToken t)
    {
        if (!actor.IsInRole(Roles.Staff) || actor.UserId is null)
            throw new ContractException(403, "assigned_staff_required");
        var before = await SigningOperator(id, t);
        await contracts.InTransactionAsync(before.RoomId, async () =>
        {
            var c = await SigningOperator(id, t);
            if (!TestMain(c)) throw new ContractException(404, "sandbox_unavailable");
            Intact(c);
            var accepted = MainSandboxAcceptance.Read(c) ?? throw ContractException.Conflict("owner_confirmation_required");
            if (accepted.TenantSimulatedAt is null)
            {
                c.InternalAcceptance = JsonSerializer.Serialize(accepted with { TenantSimulatedBy = actor.UserId, TenantSimulatedAt = Now });
                c.Status = ContractStatus.PendingActivation;
                contracts.Audit(actor.UserId.Value, "MainTenantSandboxSimulated", id, Now);
            }
            return true;
        }, t);
        return await StatusAsync(id, t);
    }
}
