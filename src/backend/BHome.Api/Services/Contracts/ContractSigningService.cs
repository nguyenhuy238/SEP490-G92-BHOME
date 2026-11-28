using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Application.Storage;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed partial class ContractService
{
    // Persist prepared work before making the ambiguous external mutation. Never automatically resend Dispatching.
    public async Task<SignatureView> RequestSigningAsync(Guid id, SigningInput x, Guid key, CancellationToken t)
    {
        var otp = SigningMethods.IsOtp(x.Method);
        var session = SigningMethods.IsOwnerSession(x.Method);
        if (session && !user.IsInRole(Roles.Owner)) throw new ContractException(403, "owner_session_signing_owner_only");
        if (session && !x.Consent) throw ContractException.Invalid("signing_consent_required");
        if (session && signingMethods?.IsEnabled(SigningMethods.OwnerSession) != true) throw new ContractException(503, "signing_method_disabled");
        var completed = false;
        if (x.Method is { } method && !session && !otp &&
            !string.Equals(method, SigningMethods.Simulated, StringComparison.OrdinalIgnoreCase)) throw ContractException.Invalid("signing_method_invalid");
        if (otp && signingMethods?.IsEnabled(SigningMethods.Otp) != true) throw new ContractException(503, "signing_method_disabled");
        if (!session && !otp && !DemoEnabled) throw new ContractException(503, "signing_method_disabled");
        if (x.Placement is { IsValid: false }) throw ContractException.Invalid("signature_placement_invalid");
        await Mutate(id, [Roles.Owner, Roles.Tenant], async c =>
        {
            RequireSigningMode(c);
            if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
            if (session && Actor != c.OwnerSignerId) throw new ContractException(403, "owner_session_signing_owner_only");
            if (await Replay(key, "sign", new { id, x }, t) is not null) return true;
            await ValidateHoldingOwnerSigningAsync(c, t);
            if (c.Kind == ContractKind.Holding && await repository.HoldingConflictAsync(c.RoomId, c.Id, c.StartDate, c.EndDate, t)) throw ContractException.Conflict("room_contract_conflict");
            if (c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning) || !Intact(c)) throw ContractException.Conflict("contract_not_signable");
            if (c.Kind is ContractKind.Main or ContractKind.Renewal or ContractKind.Holding)
                await ContractChargeSnapshot.ValidateBindingAsync(repository, c, t,
                    checkProfile: c.Status == ContractStatus.Draft && c.Kind != ContractKind.Holding && !c.PriceLockedAt.HasValue);
            if (session)
                foreach (var old in c.Signatures.Where(s => s.SignerUserId == Actor && s.CredentialId == OtpCredential &&
                    s.Status is SignatureStatus.Prepared or SignatureStatus.Pending or SignatureStatus.Dispatching or SignatureStatus.ManualReview))
                {
                    old.Status = SignatureStatus.Failed;
                    Audit("OwnerOtpSigningSupersededBySessionConsent", id);
                }
            if (c.Status == ContractStatus.Draft)
            {
                if (c.Kind is ContractKind.Main or ContractKind.Renewal)
                {
                    ContractChargeSnapshot.MarkMainBound(c, clock.GetUtcNow());
                }
                c.Status = ContractStatus.PendingSigning; Audit("ContractSigningInitiated", id);
            }
            return true;
        }, t);
        var signatureId = await Mutate(id, [Roles.Owner, Roles.Tenant], async c =>
        {
            RequireSigningMode(c);
            if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
            if (session && Actor != c.OwnerSignerId) throw new ContractException(403, "owner_session_signing_owner_only");
            if (await Replay(key, "sign", new { id, x }, t) is { } prior) return prior;
            await ValidateHoldingOwnerSigningAsync(c, t);
            if (c.Kind == ContractKind.Holding && await repository.HoldingConflictAsync(c.RoomId, c.Id, c.StartDate, c.EndDate, t)) throw ContractException.Conflict("room_contract_conflict");
            if (c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning) || !Intact(c)) throw ContractException.Conflict("contract_not_signable");
            if (c.Signatures.Any(s => s.SignerUserId == Actor && s.Status != SignatureStatus.Failed)) throw ContractException.Conflict("signer_already_requested");
            if (c.Signatures.Any(s => s.Status is not (SignatureStatus.Signed or SignatureStatus.Simulated or SignatureStatus.Failed))) throw ContractException.Conflict("previous_signature_pending");
            var previous = await PreviousSignedPdfAsync(c, t);
            var prepared = !session && !otp && x.Placement is null && x.UsePicture is null or true
                ? await signing.PrepareAsync(Document(c), x.CertificateId, previous, t)
                : await signing.PrepareAsync(Document(c), x.CertificateId, previous,
                    new SigningAppearance(x.Placement, x.UsePicture ?? true, session ? SigningMethods.OwnerSession : otp ? SigningMethods.Otp : null), t);
            var s = new ContractSigning
            {
                ContractId = id,
                SignerUserId = Actor,
                CertificateId = session || otp ? Guid.Empty : x.CertificateId,
                SnapshotHash = c.SnapshotHashOrEmpty,
                SourceHashOrEmpty = FileHash(prepared.SourcePdf),
                FieldName = prepared.FieldName,
                PreparedHashOrEmpty = FileHash(prepared.PreparedPdf),
                DocumentDigest = prepared.DocumentDigest,
                DataToSignDigest = prepared.DataToSignDigest,
                CertificateChain = prepared.CertificateChain,
                ProviderUserId = prepared.ProviderUserId,
                CredentialId = prepared.CredentialId,
                ExpiresAt = clock.GetUtcNow().AddMinutes(5)
            };
            s.PreparedObjectKeyOrEmpty = $"contracts/{id:N}/signatures/{s.Id:N}/prepared.pdf";
            if (AnonymousContractSigningService.AllowsEitherSigningOrder(c) && c.SigningMode == ContractSigningModes.Internal)
                await files.PutAsync(c.RoomId, $"contracts/{id:N}/signatures/{s.Id:N}/source.pdf", prepared.SourcePdf, "application/pdf", t);
            await files.PutAsync(c.RoomId, s.PreparedObjectKeyOrEmpty, prepared.PreparedPdf, "application/pdf", t);
            repository.Add(s); c.Status = ContractStatus.PendingSigning; Audit("ContractSigningPrepared", id);
            if (session)
            {
                s.ProviderReference = "owner-session:" + s.Id.ToString("N");
                completed = await ApplyOutcomeAsync(c, s, await signing.PollAsync(s, prepared.PreparedPdf, t), t);
                if (!completed) throw ContractException.Conflict("owner_session_signing_failed");
                Audit("OwnerSessionSigningConsentRecorded", id);
            }
            Remember(key, "sign", new { id, x }, s.Id); return s.Id;
        }, t);
        var dispatch = await Mutate(id, [Roles.Owner, Roles.Tenant], c =>
        {
            var s = c.Signatures.Single(s => s.Id == signatureId);
            if (s.Status != SignatureStatus.Prepared) return Task.FromResult(false);
            s.Status = SignatureStatus.Dispatching; Audit("ContractSigningDispatching", id); return Task.FromResult(true);
        }, t);
        if (dispatch)
        {
            var c = await Load(id, [Roles.Owner, Roles.Tenant], t); var s = c.Signatures.Single(s => s.Id == signatureId);
            string reference;
            try { reference = await signing.RequestAsync(s, t); }
            catch (Exception e) when (e is IntegrationUnavailableException or HttpRequestException or OperationCanceledException)
            {
                await Mutate(id, [Roles.Owner, Roles.Tenant], current =>
                {
                    current.Signatures.Single(a => a.Id == signatureId).Status = SignatureStatus.ManualReview;
                    Audit("ContractSigningNeedsReview", id); return Task.FromResult(true);
                }, CancellationToken.None);
                throw new IntegrationUnavailableException("contract signing; check pending provider request before retry");
            }
            await Mutate(id, [Roles.Owner, Roles.Tenant], current =>
            {
                var attempt = current.Signatures.Single(a => a.Id == signatureId); attempt.ProviderReference = reference; attempt.Status = SignatureStatus.Pending; // 349-351:Tự sinh ObjectKey (contracts/.../prepared.pdf, signed.pdf), băm SHA-256 và gọi lưu file.
                Audit("ContractSigningRequested", id); return Task.FromResult(true);
            }, t);
        }
        var updated = await Load(id, [Roles.Owner, Roles.Tenant], t);
        var result = updated.Signatures.Single(s => s.Id == signatureId);
        if (completed) await NotifySignatureCompletedAsync(id, t);
        return SignatureOf(result);
    }

    public async Task<ContractView> SyncSigningAsync(Guid id, CancellationToken t)
    {
        var completed = false;
        var view = await Mutate(id, [Roles.Owner, Roles.Tenant], async c =>
        {
            RequireSigningMode(c);
            if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
            if (c.Status is ContractStatus.Cancelled or ContractStatus.Terminated or ContractStatus.Superseded or ContractStatus.Expired or ContractStatus.Converted or ContractStatus.Applied) return View(c);
            var s = c.Signatures.Where(s => s.SignerUserId == Actor).OrderBy(s => s.CreatedAt).ThenBy(s => s.Id).LastOrDefault() ?? throw ContractException.Missing();
            if (s.Status != SignatureStatus.Pending) return View(c);
            var prepared = await PreparedPdfAsync(c, s, t);
            completed = await ApplyOutcomeAsync(c, s, await signing.PollAsync(s, prepared, t), t);
            return View(c);
        }, t);
        if (completed) await NotifySignatureCompletedAsync(id, t);
        return view;
    }

    // OTP: the signer types the code emailed by RequestSigningAsync. A wrong code changes nothing and is reported
    // (otp_incorrect); too many wrong codes fail the signature so the signer starts again with a new code.
    public async Task<ContractView> ConfirmSigningAsync(Guid id, SigningOtpConfirmation x, Guid key, CancellationToken t)
    {
        if (string.IsNullOrWhiteSpace(x.Code) || x.Code.Length > 16) throw ContractException.Invalid("otp_invalid_format");
        var completed = false;
        var view = await Mutate(id, [Roles.Owner, Roles.Tenant], async c =>
        {
            RequireSigningMode(c);
            if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
            if (await Replay(key, "sign-confirm", id, t) is not null) return View(c);
            var s = PendingOtpSignature(c);
            if (s.Status != SignatureStatus.Pending) throw ContractException.Conflict("signing_not_pending");
            var prepared = await PreparedPdfAsync(c, s, t);
            completed = await ApplyOutcomeAsync(c, s, await signing.ConfirmAsync(s, prepared, x.Code, t), t);
            if (!completed) Audit("ContractSigningOtpRejected", id);
            Remember(key, "sign-confirm", id, s.Id);
            return View(c);
        }, t);
        if (completed) await NotifySignatureCompletedAsync(id, t);
        return view;
    }

    // OTP: a new code after the resend delay. Also recovers a code whose first email could not be sent.
    public Task<SigningOtpView> ResendSigningCodeAsync(Guid id, CancellationToken t) => Mutate(id, [Roles.Owner, Roles.Tenant], async c =>
    {
        RequireSigningMode(c);
        if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
        var s = PendingOtpSignature(c);
        if (s.Status is not (SignatureStatus.Pending or SignatureStatus.Dispatching or SignatureStatus.ManualReview)) throw ContractException.Conflict("signing_not_pending");
        if (!Intact(c) || s.SnapshotHash != c.SnapshotHashOrEmpty) throw ContractException.Conflict("signed_terms_changed");
        var sent = await signing.ResendAsync(s, t);
        if (s.Status != SignatureStatus.Pending) { s.ProviderReference = "otp:" + s.Id.ToString("N"); s.Status = SignatureStatus.Pending; }
        s.ExpiresAt = sent.ExpiresAt;
        Audit("ContractSigningOtpResent", id);
        return sent;
    }, t);

    public async Task<SigningOtpView> SigningChallengeAsync(Guid id, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Tenant], t);
        if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
        return await signing.ChallengeAsync(PendingOtpSignature(c), t) ?? throw ContractException.Conflict("otp_expired");
    }

    // Historical signature label only; no new uploads are accepted.
    private const string UploadCredential = "BHOME-UPLOAD-PROOF";

    public SigningMethodsView ListSigningMethods()
    {
        Role(Roles.Owner, Roles.Tenant);
        IReadOnlyList<string> enabled = signingMethods?.Enabled ?? (DemoEnabled ? [SigningMethods.Simulated] : [SigningMethods.OwnerSession, SigningMethods.Otp]);
        var owner = user.IsInRole(Roles.Owner);
        var mine = owner ? enabled.Where(m => m != SigningMethods.Otp).ToArray()
            : enabled.Where(m => m != SigningMethods.OwnerSession).ToArray();
        string[] preference = owner
            ? [SigningMethods.OwnerSession, SigningMethods.Simulated]
            : [SigningMethods.Otp, SigningMethods.Simulated];
        return new(mine, preference.FirstOrDefault(mine.Contains));
    }

    private ContractSigning PendingOtpSignature(Contract c) =>
        c.Signatures.Where(s => s.SignerUserId == Actor && s.CredentialId == OtpCredential && s.Status != SignatureStatus.Failed)
            .OrderBy(s => s.CreatedAt).ThenBy(s => s.Id).LastOrDefault() ?? throw ContractException.Missing();

    // Marks an OTP signature (ContractSigningRouter.OtpCredential in Infrastructure).
    private const string OtpCredential = "BHOME-OTP";
    private const string OwnerSessionCredential = "BHOME-OWNER-SESSION";

    private async Task<byte[]> PreparedPdfAsync(Contract c, ContractSigning s, CancellationToken t)
    {
        if (!Intact(c) || s.SnapshotHash != c.SnapshotHashOrEmpty) throw ContractException.Conflict("signed_terms_changed");
        using var prepared = new MemoryStream(); await storage.CopyToAsync(s.PreparedObjectKeyOrEmpty, prepared, t);
        if (FileHash(prepared.ToArray()) != s.PreparedHashOrEmpty) throw ContractException.Conflict("prepared_document_integrity_failed");
        return prepared.ToArray();
    }

    // Stores a verified signed PDF and moves the contract on when every party has signed. True when a signature completed.
    private async Task<bool> ApplyOutcomeAsync(Contract c, ContractSigning s, SigningOutcome answer, CancellationToken t)
    {
        if (answer.State is "Signed" or "Simulated" && answer.SignedPdf is { Length: > 0 } pdf)
        {
            if ((answer.State == "Simulated") != c.IsDevelopmentDemo) throw ContractException.Conflict("signing_mode_mismatch");
            s.SignedObjectKey = $"contracts/{c.Id:N}/signatures/{s.Id:N}/signed.pdf";  // 372–377 (CopyDocumentAsync): Kiểm tra đúng quyền Owner/Tenant rồi gọi storage.CopyToAsync tải PDF từ MinIO.
            await files.PutAsync(c.RoomId, s.SignedObjectKey, pdf, "application/pdf", t);
            s.SignedHash = FileHash(pdf); s.Status = c.IsDevelopmentDemo ? SignatureStatus.Simulated : SignatureStatus.Signed; s.SignedAt = clock.GetUtcNow();
            if (!string.IsNullOrEmpty(answer.CertificateChain)) s.CertificateChain = answer.CertificateChain;
            if (c.SigningMode == ContractSigningModes.Internal)
            {
                var evidence = AnonymousContractSigningService.AcceptedEvidence(c);
                if (AnonymousContractSigningService.AllowsEitherSigningOrder(c) && evidence is null)
                {
                    if (s.SignerUserId != c.OwnerSignerId) throw ContractException.Conflict("holding_owner_signature_required");
                    c.Status = ContractStatus.PendingSigning;
                    Audit("ContractSignatureVerified", c.Id);
                    return true;
                }
                if (evidence is null) throw ContractException.Conflict("tenant_acceptance_required");
                if (s.SignerUserId != c.OwnerSignerId || s.Status != SignatureStatus.Signed ||
                    evidence.SnapshotHash != c.SnapshotHashOrEmpty)
                    throw ContractException.Conflict("signing_evidence_integrity_failed");
                var finalKey = s.SignedObjectKey;
                var finalHash = s.SignedHash;
                if (s.SourceHashOrEmpty != evidence.TenantDocumentHash)
                {
                    // Owner may have started signing the same review PDF before Tenant accepted.
                    // Retain that verified signature and append the already recorded Tenant evidence.
                    if (!AnonymousContractSigningService.AllowsEitherSigningOrder(c) || s.SourceHashOrEmpty != evidence.SourceHash)
                        throw ContractException.Conflict("signing_evidence_integrity_failed");
                    var invitation = signingInvitations is null ? null : await signingInvitations.FindAsync(evidence.InvitationId, t);
                    if (invitation is null || invitation.AcceptedAt != evidence.AcceptedAt || invitation.RevokedAt is not null ||
                        invitation.ContractId != c.Id || invitation.SnapshotHash != c.SnapshotHashOrEmpty || invitation.DocumentHash != evidence.SourceHash)
                        throw ContractException.Conflict("signing_evidence_integrity_failed");
                    using var image = new MemoryStream();
                    await storage.CopyToAsync(invitation.SignatureObjectKey!, image, t);
                    var png = image.ToArray();
                    if (FileHash(png) != evidence.SignatureHash)
                        throw ContractException.Conflict("signing_evidence_integrity_failed");
                    var combined = (acceptanceRenderer ?? throw new ContractException(503, "holding_workflow_unavailable"))
                        .AppendTenant(pdf, png, evidence.ResidentId, evidence.AcceptedAt, evidence.SourceHash);
                    finalKey = $"contracts/{c.Id:N}/signatures/{s.Id:N}/combined.pdf";
                    finalHash = FileHash(combined);
                    await files.PutAsync(c.RoomId, finalKey, combined, "application/pdf", t);
                }
                c.InternalAcceptance = System.Text.Json.JsonSerializer.Serialize(evidence with
                {
                    OwnerId = c.OwnerSignerId,
                    OwnerAcceptedAt = s.SignedAt,
                    FinalDocumentKey = finalKey,
                    FinalDocumentHash = finalHash
                });
                c.Status = ContractStatus.PendingActivation;
                if (c.Kind == ContractKind.Holding)
                    await CompleteInternalHoldingSigningAsync(c, t);
                Audit("ContractSignatureVerified", c.Id);
                return true;
            }
            if (new[] { c.OwnerSignerId, c.TenantUserId }.All(signer => c.Signatures.Any(a => a.SignerUserId == signer && CompleteSignature(a, c))))
            {
                c.Status = ContractStatus.PendingActivation;
                if (c.Kind == ContractKind.Holding) await LockHoldingPriceAsync(c, "SigningCompleted", s.SignedAt.Value, t);
            }
            Audit(c.IsDevelopmentDemo ? "ContractSignatureSimulated" : "ContractSignatureVerified", c.Id);
            return true;
        }
        if (answer.State == "Failed") { s.Status = SignatureStatus.Failed; Audit("ContractSigningFailed", c.Id); }
        return false;
    }

    // Best effort, after the transaction: an email failure never undoes a verified signature.
    private async Task NotifySignatureCompletedAsync(Guid id, CancellationToken t)
    {
        if (signingNotifier is null) return;
        try
        {
            var c = await Load(id, [Roles.Owner, Roles.Tenant], t);
            if (AnonymousContractSigningService.AllowsEitherSigningOrder(c) && c.SigningMode == ContractSigningModes.Internal &&
                AnonymousContractSigningService.AcceptedEvidence(c) is null)
            {
                await signingNotifier.HoldingOwnerSignedAsync(c.Id, t);
                return;
            }
            Guid[] parties = c.TenantUserId is { } tenant ? [c.OwnerSignerId, tenant] : [c.OwnerSignerId];
            Guid? next = parties.Where(p => !c.Signatures.Any(a => a.SignerUserId == p && CompleteSignature(a, c))).Select(p => (Guid?)p).FirstOrDefault();
            await signingNotifier.SignatureCompletedAsync(new(c.Id, c.Room.RoomNumber, c.Room.Location?.Name ?? "", next, parties), t);
        }
        catch (Exception e) when (e is not OperationCanceledException) { }
    }
    public Task<ContractView> RecoverSigningAsync(Guid id, SigningRecoveryInput x, Guid key, CancellationToken t)
    {
        Validate(x);
        return Mutate(id, [Roles.Owner, Roles.Tenant], async c =>
        {
            RequireSigningMode(c);
            if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
            if (await Replay(key, "sign-recover", new { id, x }, t) is not null) return View(c);
            var s = c.Signatures.SingleOrDefault(s => s.SignerUserId == Actor && s.Status != SignatureStatus.Failed) ?? throw ContractException.Missing();
            if (s.Status is not (SignatureStatus.Dispatching or SignatureStatus.ManualReview)) throw ContractException.Conflict("signing_not_ambiguous");
            // Linking a reference never means signed: sync must still verify its signature against the persisted PDF.
            s.ProviderReference = x.ProviderReference.Trim(); s.Status = SignatureStatus.Pending;
            Audit("ContractSigningReferenceRecovered", id); Remember(key, "sign-recover", new { id, x }, s.Id); return View(c);
        }, t);
    }
    // The first signer's verified PDF, which the second signer signs incrementally; null before anyone has signed.
    private async Task<byte[]?> PreviousSignedPdfAsync(Contract c, CancellationToken t)
    {
        var last = c.Signatures.Where(s => CompleteSignature(s, c)).OrderBy(s => s.SignedAt).LastOrDefault();
        if (last is null)
        {
            if (c.SigningMode != ContractSigningModes.Internal) return null;
            var evidence = AnonymousContractSigningService.AcceptedEvidence(c);
            if (evidence is null)
            {
                var invitation = AnonymousContractSigningService.AllowsEitherSigningOrder(c) && signingInvitations is not null
                    ? (await signingInvitations.ListAsync(c.Id, t)).FirstOrDefault(i => i.RevokedAt is null &&
                        i.AcceptedAt is null && i.ExpiresAt > clock.GetUtcNow() && i.SnapshotHash == c.SnapshotHashOrEmpty) : null;
                if (invitation is null) return null;
                using var reviewed = new MemoryStream();
                await storage.CopyToAsync(invitation.DocumentObjectKey, reviewed, t);
                var reviewedBytes = reviewed.ToArray();
                if (FileHash(reviewedBytes) != invitation.DocumentHash) throw ContractException.Conflict("signing_evidence_integrity_failed");
                return reviewedBytes;
            }
            if (evidence.SnapshotHash != c.SnapshotHashOrEmpty) throw ContractException.Conflict("signed_terms_changed");
            using var accepted = new MemoryStream();
            await storage.CopyToAsync(evidence.TenantDocumentKey, accepted, t);
            var bytes = accepted.ToArray();
            if (FileHash(bytes) != evidence.TenantDocumentHash) throw ContractException.Conflict("signing_evidence_integrity_failed");
            return bytes;
        }
        using var stream = new MemoryStream(); await storage.CopyToAsync(last.SignedObjectKey!, stream, t);
        var previous = stream.ToArray();
        if (FileHash(previous) != last.SignedHash) throw ContractException.Conflict("signing_evidence_integrity_failed");
        return previous;
    }

    // Exactly the PDF the caller would sign now: the signed PDF so far, the reviewed Main Draft PDF, or the
    // contract rendered from its snapshot — the same order the signing adapters use.
    private async Task<(Contract Contract, byte[] Pdf)> SigningSourceAsync(Guid id, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Tenant], t);
        if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
        if (c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning) || !Intact(c)) throw ContractException.Conflict("contract_not_signable");
        if (renderer is null || signingPages is null) throw new IntegrationUnavailableException("contract signing pages");
        var pdf = await PreviousSignedPdfAsync(c, t);
        if (pdf is null)
        {
            var document = Document(c);
            pdf = signingDocuments is null ? null : await signingDocuments.ReadAsync(document, t);
            if (pdf is null) { await renderer.ValidateAsync(document, t); pdf = await renderer.RenderAsync(document, t); }
        }
        return (c, pdf);
    }

    public async Task<SigningLayout> SigningLayoutAsync(Guid id, CancellationToken t)
    {
        var (c, pdf) = await SigningSourceAsync(id, t);
        var owner = Actor == c.OwnerSignerId;
        var info = signingPages!.Inspect(pdf, owner);
        var (picture, name) = await signing.SignerAsync(t);
        return new(info.Pages.Count, info.Pages, info.Suggested, owner ? "Owner" : "Tenant", picture, name);
    }

    public async Task<byte[]> SigningPageAsync(Guid id, int page, int width, CancellationToken t)
    {
        if (page is < 1 or > 500) throw ContractException.Invalid("signing_page_invalid");
        var (_, pdf) = await SigningSourceAsync(id, t);
        return signingPages!.RenderPage(pdf, page, Math.Clamp(width, 200, 1400));
    }

    public async Task<string> CopyDocumentAsync(Guid id, Stream output, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Tenant], t);
        if (c.SigningMode == ContractSigningModes.Internal)
        {
            var evidence = AnonymousContractSigningService.AcceptedEvidence(c);
            if (evidence is not null)
            {
                using var accepted = new MemoryStream();
                await storage.CopyToAsync(evidence.FinalDocumentKey ?? evidence.TenantDocumentKey, accepted, t);
                if (FileHash(accepted.ToArray()) != (evidence.FinalDocumentHash ?? evidence.TenantDocumentHash)) throw ContractException.Conflict("signing_evidence_integrity_failed");
                accepted.Position = 0; await accepted.CopyToAsync(output, t); return ContractDownloadName.For(c.Kind, c.Id);
            }
            if (!AnonymousContractSigningService.AllowsEitherSigningOrder(c)) throw ContractException.Conflict("signed_document_not_available");
            // Owner-first Holding can expose its verified Owner PDF while awaiting Tenant acceptance.
        }
        var s = c.Signatures.Where(s => CompleteSignature(s, c)).OrderBy(s => s.SignedAt).LastOrDefault() ?? throw ContractException.Conflict("signed_document_not_available");
        if (!Intact(c) || s.SnapshotHash != c.SnapshotHashOrEmpty || string.IsNullOrWhiteSpace(s.SignedObjectKey) || string.IsNullOrWhiteSpace(s.SignedHash))
            throw ContractException.Conflict("signing_evidence_integrity_failed");
        using var buffer = new MemoryStream();
        await storage.CopyToAsync(s.SignedObjectKey, buffer, t);
        if (FileHash(buffer.ToArray()) != s.SignedHash) throw ContractException.Conflict("signing_evidence_integrity_failed");
        buffer.Position = 0; await buffer.CopyToAsync(output, t);
        return ContractDownloadName.For(c.Kind, c.Id);
    }
}
