using System.Text.Json;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed partial class ContractService
{
    // A linked Tenant signs the handover even when the tenancy contract was
    // accepted internally. Document() intentionally omits that party for the
    // original internal contract; that signing context does not apply here.
    private static ContractDocument TenantHandoverDocument(Contract contract) =>
        Document(contract) with { TenantUserId = RequireTenant(contract) };

    private async Task<byte[]> VerifiedHandoverPdf(Contract contract,
        HandoverSignatureDocument source, CancellationToken token)
    {
        using var content = new MemoryStream();
        await storage.CopyToAsync(source.ObjectKey, content, token);
        var bytes = content.ToArray();
        if (bytes.Length < 5 || !bytes.AsSpan(0, 5).SequenceEqual("%PDF-"u8) ||
            FileHash(bytes) != source.FileHash)
            throw ContractException.Conflict("handover_signed_document_integrity_failed");
        return bytes;
    }

    private async Task<HandoverSignatureDocument> SignOwnerHandoverAsync(Contract contract,
        HandoverDraftView view, SigningInput? input, HandoverInkInput? ink, CancellationToken token)
    {
        if (input is null || !SigningMethods.IsOwnerSession(input.Method) || !input.Consent ||
            input.CertificateId != Guid.Empty || input.Placement is { IsValid: false } ||
            input.UsePicture == false)
            throw ContractException.Invalid("handover_owner_signature_consent_required");
        if (Actor != contract.OwnerSignerId)
            throw new ContractException(403, "contract_owner_signer_required");
        if (ink is null)
            throw ContractException.Invalid("handover_owner_ink_required");
        if (signingMethods?.IsEnabled(SigningMethods.OwnerSession) != true)
            throw new ContractException(503, "signing_method_disabled");
        // Render actual ink only after role, signer, version and all physical
        // conditions have passed. This PNG is never stored as a mutable profile
        // image: the signed bytes themselves bind the visible ink permanently.
        var inkPng = (handoverInkRenderer ??
            throw new ContractException(503, "handover_ink_renderer_unavailable")).Render(ink);
        var pdfRenderer = handoverDraftPdf ?? throw new ContractException(503, "handover_draft_template_unavailable");
        // The administrative PDF intentionally excludes evidence photos. Verify
        // each private object's integrity, but avoid retaining all image bytes
        // in memory merely to pass an unused photo collection to the renderer.
        await VerifyHandoverSigningEvidenceAsync(contract, view, token);
        var unsignedPdf = await pdfRenderer.RenderSigningAsync(
            await HandoverViewWithPartiesAsync(contract, view, token), [], token);
        if (unsignedPdf.Length > 10 * 1024 * 1024)
            throw ContractException.Conflict("handover_signing_pdf_too_large");
        var prepared = await signing.PrepareAsync(Document(contract), Guid.Empty, unsignedPdf,
            new SigningAppearance(input.Placement, true, SigningMethods.OwnerSession, inkPng), token);
        if (FileHash(prepared.SourcePdf) != FileHash(unsignedPdf))
            throw ContractException.Conflict("handover_signing_source_changed");
        var signature = new ContractSigning
        {
            ContractId = contract.Id,
            SignerUserId = Actor,
            SourceHashOrEmpty = FileHash(prepared.SourcePdf),
            PreparedHashOrEmpty = FileHash(prepared.PreparedPdf),
            FieldName = prepared.FieldName,
            DocumentDigest = prepared.DocumentDigest,
            DataToSignDigest = prepared.DataToSignDigest,
            CertificateChain = prepared.CertificateChain,
            ProviderUserId = prepared.ProviderUserId,
            CredentialId = prepared.CredentialId,
            Status = SignatureStatus.Pending
        };
        var result = await signing.PollAsync(signature, prepared.PreparedPdf, token);
        if (result.State != "Signed" || result.SignedPdf is not { Length: > 0 } signedPdf)
            throw ContractException.Conflict("handover_owner_signing_failed");
        var signed = new HandoverSignatureDocument(signature.Id, Actor, clock.GetUtcNow(),
            $"contracts/{contract.Id:N}/handover-signatures/{signature.Id:N}/owner.pdf",
            FileHash(signedPdf), SigningMethods.OwnerSession);
        await files.PutAsync(contract.RoomId, signed.ObjectKey, signedPdf, "application/pdf", token);
        Audit("ContractHandoverOwnerSigned", contract.Id);
        return signed;
    }

    private async Task VerifyHandoverSigningEvidenceAsync(Contract contract,
        HandoverDraftView view, CancellationToken token)
    {
        // Resolve ALL metadata sequentially before parallel file downloads:
        // Workflow/Handovers use the same EF DbContext and are not thread-safe.
        // The prior implementation made a full MinIO round trip for every photo
        // serially, so signing a room with many inventory photos could appear
        // stuck despite a valid submission.
        var fileIds = view.EvidenceIds.Concat(view.Assets.SelectMany(asset => asset.EvidenceIds ?? []))
            .Concat((view.RoomChecks ?? []).SelectMany(check => check.EvidenceIds))
            .Concat(view.KeyEvidenceIds ?? []).Distinct().ToArray();
        var available = (await Workflow.FilesAsync(contract.Id, ContractFileKind.HandoverEvidence, token))
            .ToDictionary(file => file.Id);
        var checks = new List<Func<Task>>(fileIds.Length + 2);
        foreach (var fileId in fileIds)
        {
            var file = available.TryGetValue(fileId, out var found)
                ? found
                : await Workflow.FileAsync(contract.Id, fileId, token)
                    ?? throw ContractException.Invalid("invalid_handover_evidence");
            if (file.Kind != ContractFileKind.HandoverEvidence)
                throw ContractException.Invalid("invalid_handover_evidence");
            if (file.Length > 5 * 1024 * 1024)
                throw ContractException.Invalid("inspection_image_too_large");
            checks.Add(() => CopyVerifiedFile(file, Stream.Null, token));
        }
        var recorded = await Handovers.ReadingsAsync(contract.Id, contract.RoomId, contract.StartDate, token);
        foreach (var reading in new[] { view.Electricity, view.Water })
        {
            if (reading is null) throw ContractException.Conflict("confirmed_handover_readings_required");
            var stored = recorded.SingleOrDefault(x => x.Id == reading.Id &&
                x.EvidenceHash == reading.EvidenceHash && x.Date == reading.Date)
                ?? throw ContractException.Conflict("confirmed_handover_readings_required");
            var key = stored.EvidenceObjectKey;
            var hash = reading.EvidenceHash;
            checks.Add(async () =>
            {
                using var bytes = new MemoryStream();
                await storage.CopyToAsync(key, bytes, token);
                if (bytes.Length > 5 * 1024 * 1024 || FileHash(bytes) != hash)
                    throw ContractException.Conflict("handover_evidence_integrity_failed");
            });
        }
        // Four concurrent private MinIO reads cut N serial network waits while
        // limiting memory and connections; every hash must still pass before
        // the signature PDF is prepared or stored.
        using var slots = new SemaphoreSlim(4);
        await Task.WhenAll(checks.Select(async verify =>
        {
            await slots.WaitAsync(token);
            try { await verify(); }
            finally { slots.Release(); }
        }));
    }

    public async Task<byte[]> HandoverOwnerSignedPdfAsync(Guid id, CancellationToken token)
    {
        var contract = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], token);
        RequireMainHandover(contract);
        var state = await DraftState(contract, token);
        var doc = state.Status == "Confirmed" && state.TenantSignature is not null
            ? state.TenantSignature : state.OwnerSignature;
        if (doc is null) throw ContractException.Conflict("handover_owner_signature_required");
        return await VerifiedHandoverPdf(contract, doc, token);
    }

    // A one-action handover signature using the authenticated Tenant session.
    // This is intentionally restricted to the Move-In report; it does not
    // change the regular contract signing/OTP policy or allow plain approval.
    public Task<HandoverDraftView> SignTenantHandoverInSessionAsync(Guid id,
        HandoverDraftTenantSessionSign input, Guid key, CancellationToken token) =>
        Mutate(id, [Roles.Tenant], async contract =>
    {
        RequireMainHandover(contract);
        if (contract.TenantUserId != Actor)
            throw new ContractException(403, "contract_tenant_required");
        var prior = await DraftState(contract, token);
        if (await Replay(key, "handover-tenant-session-sign", new { id, input }, token) is not null)
            return await DraftView(contract, prior, token);
        if (prior.Status != "Ready" || prior.Version != input.Version ||
            prior.OwnerSignature is not { } ownerSigned ||
            prior.Requests.Any(request => request.Status == "Pending"))
            throw ContractException.Conflict("handover_not_ready_for_tenant_signing");
        if (!input.Consent || input.Ink is null)
            throw ContractException.Invalid("handover_tenant_signature_consent_and_ink_required");
        if (signingMethods?.IsEnabled(SigningMethods.OwnerSession) != true)
            throw new ContractException(503, "signing_method_disabled");
        // DraftView uses EF/inspection repositories; the immutable Owner PDF is
        // fetched exclusively from object storage. Overlap those independent
        // reads without ever executing two EF operations concurrently.
        var viewTask = DraftView(contract, prior, token);
        var ownerPdfTask = VerifiedHandoverPdf(contract, ownerSigned, token);
        await Task.WhenAll(viewTask, ownerPdfTask);
        var current = await viewTask;
        if (current.Missing.Length != 0 || current.Electricity?.Id != prior.ApprovedElectricityReadingId ||
            current.Water?.Id != prior.ApprovedWaterReadingId ||
            !await Handovers.InventoryReadyAsync(id, token))
            throw ContractException.Conflict("handover_changed_since_owner_signature");

        // Fresh strokes are rendered server-side, bound into the Tenant's PDF
        // signature, and not reused from a mutable profile picture or typed name.
        var inkPng = (handoverInkRenderer ??
            throw new ContractException(503, "handover_ink_renderer_unavailable")).Render(input.Ink);
        var ownerPdf = await ownerPdfTask;
        var prepared = await signing.PrepareAsync(TenantHandoverDocument(contract), Guid.Empty, ownerPdf,
            new SigningAppearance(null, true, SigningMethods.TenantSession, inkPng), token);
        if (FileHash(prepared.SourcePdf) != ownerSigned.FileHash)
            throw ContractException.Conflict("handover_signing_source_changed");
        var signature = new ContractSigning
        {
            ContractId = id,
            SignerUserId = Actor,
            SourceHashOrEmpty = FileHash(prepared.SourcePdf),
            PreparedHashOrEmpty = FileHash(prepared.PreparedPdf),
            FieldName = prepared.FieldName,
            DocumentDigest = prepared.DocumentDigest,
            DataToSignDigest = prepared.DataToSignDigest,
            CertificateChain = prepared.CertificateChain,
            ProviderUserId = prepared.ProviderUserId,
            CredentialId = prepared.CredentialId,
            Status = SignatureStatus.Pending
        };
        var signed = await signing.PollAsync(signature, prepared.PreparedPdf, token);
        if (signed.State != "Signed" || signed.SignedPdf is not { Length: > 0 } tenantPdf)
            throw ContractException.Conflict("handover_tenant_signature_failed");
        var completedAt = clock.GetUtcNow();
        var finalDocument = new HandoverSignatureDocument(signature.Id, Actor, completedAt,
            $"contracts/{id:N}/handover-signatures/{signature.Id:N}/final.pdf",
            FileHash(tenantPdf), SigningMethods.TenantSession);
        // An old outstanding OTP attempt, if any, is superseded only once this
        // fully authenticated PDF is committed. It cannot complete afterward.
        return await CompleteTenantSignedHandoverAsync(contract, prior, current, ownerSigned,
            finalDocument, tenantPdf, input.Note, key, "handover-tenant-session-sign",
            new { id, input }, token);
    }, token);

    private async Task<HandoverDraftView> CompleteTenantSignedHandoverAsync(Contract contract,
        HandoverDraftState prior, HandoverDraftView current,
        HandoverSignatureDocument ownerSigned, HandoverSignatureDocument finalDocument,
        byte[] tenantPdf, string? note, Guid key, string replayAction,
        object replayInput, CancellationToken token)
    {
        var id = contract.Id;
        var h = await Handovers.GetAsync(id, token);
        if (h?.Status == ContractHandoverStatus.Confirmed)
            throw ContractException.Conflict("handover_already_confirmed");
        if (h is null) { h = new ContractHandover { ContractId = id }; repository.Add(h); }
        else h.Version++;
        var assets = ReadyAssets(current, prior.Assets, handoverInventory is not null);
        var acceptance = new HandoverOwnerAcceptance(h.Version, prior.OwnerReadyBy!.Value,
            ownerSigned.SignedAt, prior.OwnerReadyReason ?? "Owner đã ký biên bản",
            prior.OwnerHandlingPlan ?? "Không có ngoại lệ cần xử lý");
        var completedAt = finalDocument.SignedAt;
        var feedback = new HandoverFeedback(Actor, completedAt, true, DraftText(note ?? "", 2000));
        var snapshot = DraftSnapshot(contract, current, assets, acceptance) with { TenantFeedback = feedback };
        await ValidateHandoverEvidence(contract, snapshot, token);
        await files.PutAsync(contract.RoomId, finalDocument.ObjectKey, tenantPdf, "application/pdf", token);
        var record = new ContractDocumentFile
        {
            ContractId = id,
            Kind = ContractFileKind.MoveInReport,
            TemplateId = "handover-MoveIn",
            TemplateVersion = h.Version,
            SnapshotHash = Hash(new { snapshot, finalDocument.FileHash }),
            FileHash = finalDocument.FileHash,
            Length = tenantPdf.Length,
            ContentType = "application/pdf",
            RecordedByUserId = Actor,
            RecordedAt = completedAt,
            ObjectKey = finalDocument.ObjectKey,
            DevelopmentOnly = contract.IsDevelopmentDemo
        };
        repository.Add(record);
        h.Snapshot = JsonSerializer.Serialize(snapshot);
        h.Status = ContractHandoverStatus.Confirmed;
        h.ElectricityReadingId = current.Electricity!.Id;
        h.WaterReadingId = current.Water!.Id;
        h.TenantConfirmedVersion = h.Version;
        h.TenantConfirmedBy = Actor;
        h.TenantConfirmedAt = completedAt;
        h.StaffConfirmedBy = prior.StaffSubmittedBy;
        h.StaffConfirmedAt = prior.StaffSubmittedAt;
        HandoverEvent(h, "Completed", $"PDF signed by Owner and Tenant; SHA256={finalDocument.FileHash}");
        await Handovers.CompleteMoveInTaskAsync(id, ownerSigned.SignerId, completedAt, token);
        var next = prior with
        {
            Version = prior.Version + 1,
            Status = "Confirmed",
            TenantSigning = null,
            TenantSignature = finalDocument,
            TenantConfirmedBy = Actor,
            TenantConfirmedAt = completedAt
        };
        await SaveDraftState(contract, prior, next, "TenantDigitallySigned", token);
        Remember(key, replayAction, replayInput, id);
        return await DraftView(contract, next, token);
    }
}
