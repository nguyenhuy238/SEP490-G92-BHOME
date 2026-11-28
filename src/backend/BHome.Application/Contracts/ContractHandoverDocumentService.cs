using System.Security.Cryptography;
using System.Text;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed partial class ContractService
{
    private static Guid HandoverKey(string value) => new(SHA256.HashData(Encoding.UTF8.GetBytes(value)).AsSpan(0, 16));
    private async Task PersistHandoverDocument(Contract c, ContractHandover h, CancellationToken t, string[]? decisions = null) =>
        await PersistReport(c, "MoveIn", h.Version, Snapshot(h), null, h.StaffConfirmedBy!.Value, h.TenantConfirmedAt,
            h.StaffConfirmedAt!.Value, [], decisions ?? [], t);

    private async Task<ContractDocumentView> PersistReport(Contract c, string type, int version, HandoverSnapshot snapshot,
        HandoverSnapshot? baseline, Guid staffId, DateTimeOffset? tenantAt, DateTimeOffset confirmedAt,
        string[] references, string[] decisions, CancellationToken t, Guid? eventId = null, Guid? evidenceContractId = null)
    {
        if (type is not ("MoveIn" or "AssetChange"))
            throw ContractException.Conflict("move_out_pdf_not_supported");
        var kind = type == "MoveIn" ? ContractFileKind.MoveInReport : ContractFileKind.AssetChangeReport;
        var templateId = "handover-" + type + (eventId is null ? "" : "-" + eventId.Value.ToString("N"));
        var prior = (await Workflow.FilesAsync(c.Id, kind, t)).SingleOrDefault(f => f.TemplateId == templateId && f.TemplateVersion == version);
        if (prior is not null) { await CopyVerifiedFile(prior, Stream.Null, t); return DocumentView(prior); }
        var fileRecord = new ContractDocumentFile();
        var documentId = fileRecord.Id;
        var photos = new List<HandoverDocumentPhoto>();
        foreach (var id in snapshot.EvidenceIds.Concat(snapshot.Assets.SelectMany(a => a.EvidenceIds ?? []))
                     .Concat((snapshot.RoomChecks ?? []).SelectMany(check => check.EvidenceIds))
                     .Concat(snapshot.KeyEvidenceIds ?? []).Distinct())
        {
            using var bytes = new MemoryStream();
            var file = await Workflow.FileAsync(evidenceContractId ?? c.Id, id, t) ?? throw ContractException.Invalid("invalid_handover_evidence");
            if (file.Kind != ContractFileKind.HandoverEvidence) throw ContractException.Invalid("invalid_handover_evidence");
            await CopyVerifiedFile(file, bytes, t);
            if (bytes.Length > 5 * 1024 * 1024) throw ContractException.Invalid("inspection_image_too_large");
            var groups = snapshot.Assets.Where(a => a.EvidenceIds?.Contains(id) == true).Select(a => a.Name)
                .Concat((snapshot.RoomChecks ?? []).Where(check => check.EvidenceIds.Contains(id))
                    .Select(check => HandoverRoomChecklist.Labels[check.Code]))
                .Concat((snapshot.KeyEvidenceIds ?? []).Contains(id) ? ["Chìa khóa bàn giao"] : [])
                .Distinct().ToArray();
            photos.Add(new(id, $"{snapshot.Date:dd/MM/yyyy} · {(groups.Length == 0 ? "Toàn cảnh phòng" : string.Join(", ", groups))}", bytes.ToArray()));
        }
        if (type == "MoveIn")
        {
            // Include the actual photographed first electricity/water readings
            // in the immutable final report, not merely their textual values.
            // Object storage keys are deliberately omitted from serialized
            // snapshots, so resolve them via contract-scoped verified readings.
            var readings = await Handovers.ReadingsAsync(c.Id, c.RoomId, c.StartDate, t);
            foreach (var accepted in new[] { snapshot.Electricity, snapshot.Water })
            {
                var recorded = readings.SingleOrDefault(r => r.Id == accepted.Id &&
                    r.EvidenceHash == accepted.EvidenceHash && r.Date == accepted.Date);
                if (recorded is null)
                {
                    // Historical confirmed legacy snapshots can carry readings
                    // from before contract-specific Initial tasks existed. Keep
                    // their original retry/export behavior without inventing an
                    // image from another tenant. New Draft workflows always
                    // require their own verified meter photos.
                    if (handoverDrafts is not null && await Drafts.GetAsync(c.Id, t) is not null)
                        throw ContractException.Conflict("confirmed_handover_readings_required");
                    continue;
                }
                using var image = new MemoryStream();
                await storage.CopyToAsync(recorded.EvidenceObjectKey, image, t);
                if (image.Length > 5 * 1024 * 1024 || FileHash(image.ToArray()) != accepted.EvidenceHash)
                    throw ContractException.Conflict("handover_evidence_integrity_failed");
                photos.Add(new(recorded.EvidenceId,
                    $"Chỉ số {(recorded.UtilityType == 0 ? "điện" : "nước")} lần đầu · " +
                    $"{recorded.Value} · {recorded.MeterCode} · {recorded.Date:dd/MM/yyyy}", image.ToArray()));
            }
        }
        var report = new HandoverDocumentReport(documentId, c.Id, type, version, c.Room.Location.Name,
            c.Room.Location.Address, c.OwnerSignerId, c.TenantUserId, staffId, tenantAt, confirmedAt, snapshot, baseline, references, decisions, photos.ToArray());
        var bytesPdf = await (handoverDocuments ?? throw new ContractException(503, "handover_documents_unavailable")).RenderAsync(report, t);
        fileRecord.ContractId = c.Id; fileRecord.Kind = kind;
        fileRecord.TemplateId = templateId; fileRecord.TemplateVersion = version; fileRecord.SnapshotHash = Hash(new { snapshot, baseline, references, decisions });
        fileRecord.FileHash = FileHash(bytesPdf); fileRecord.Length = bytesPdf.Length; fileRecord.ContentType = "application/pdf"; fileRecord.RecordedByUserId = Actor;
        fileRecord.RecordedAt = clock.GetUtcNow(); fileRecord.ObjectKey = $"contracts/{c.Id:N}/handover-documents/{documentId:N}/{Guid.NewGuid():N}.pdf";
        // The staged unique object key also prevents an aborted attempt from overwriting committed bytes.
        await files.PutAsync(c.RoomId, fileRecord.ObjectKey, bytesPdf, fileRecord.ContentType, t);
        using var check = new MemoryStream(); await storage.CopyToAsync(fileRecord.ObjectKey, check, t);
        if (check.Length != fileRecord.Length || FileHash(check.ToArray()) != fileRecord.FileHash) throw ContractException.Conflict("contract_document_integrity_failed");
        repository.Add(fileRecord); Audit("ContractHandoverDocumentStored", c.Id); return DocumentView(fileRecord);
    }
    public async Task<IReadOnlyList<ContractDocumentView>> HandoverDocumentsAsync(Guid id, CancellationToken t)
    {
        await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        var result = new List<ContractDocumentView>();
        var c = await repository.FindAsync(id, t) ?? throw ContractException.Missing();
        foreach (var related in await HandoverLineage(c, t))
            // Historical MoveOutReport files remain accessible for audit.
            // New Move-Out inspections never create or require these PDFs.
            foreach (var kind in new[] { ContractFileKind.MoveInReport, ContractFileKind.AssetChangeReport, ContractFileKind.MoveOutReport })
                result.AddRange((await Workflow.FilesAsync(related, kind, t)).Select(DocumentView));
        return result.OrderBy(f => f.RecordedAt).ToArray();
    }
    public async Task CopyHandoverDocumentAsync(Guid id, Guid documentId, Stream output, CancellationToken t)
    {
        await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        var file = await Workflow.FileAsync(id, documentId, t) ?? throw ContractException.Missing();
        if (file.Kind is not (ContractFileKind.MoveInReport or ContractFileKind.AssetChangeReport or ContractFileKind.MoveOutReport)) throw ContractException.Missing();
        await CopyVerifiedFile(file, output, t);
    }
    public Task<ContractDocumentView> RetryMoveInDocumentAsync(Guid id, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner, Roles.Staff], async c =>
    {
        var h = await Handovers.GetAsync(id, t) ?? throw ContractException.Missing();
        if (h.Status != ContractHandoverStatus.Confirmed) throw ContractException.Conflict("confirmed_handover_required");
        var result = await PersistReport(c, "MoveIn", h.Version, Snapshot(h), null, h.StaffConfirmedBy!.Value, h.TenantConfirmedAt, h.StaffConfirmedAt!.Value, [], [], t);
        if (await Replay(key, "handover-document", id, t) is null) Remember(key, "handover-document", id, result.Id);
        return result;
    }, t);

    public async Task<byte[]> HandoverDraftPdfAsync(Guid id, CancellationToken token)
    {
        var view = await GetHandoverDraftAsync(id, token);
        if (user.IsInRole(Roles.Tenant) && view.Status is not ("Ready" or "Confirmed" or "ChangesRequested"))
            throw ContractException.Missing();
        if (view.Status is "Ready" or "Confirmed" or "ChangesRequested" && view.OwnerDocumentId is not null)
            return await HandoverOwnerSignedPdfAsync(id, token);
        var contract = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], token);
        return await (handoverDraftPdf ?? throw new ContractException(503, "handover_draft_template_unavailable"))
            .RenderDraftAsync(await HandoverViewWithPartiesAsync(contract, view, token), token);
    }

    private async Task<HandoverDraftView> HandoverViewWithPartiesAsync(
        Contract contract, HandoverDraftView view, CancellationToken token)
    {
        if (handoverPartyData is null)
            throw new ContractException(503, "handover_party_data_unavailable");
        var settings = await handoverPartyData.SettingsAsync(contract.OwnerSignerId, contract.StartDate, token);
        if (settings is null || settings.OwnerSignerId != contract.OwnerSignerId ||
            string.IsNullOrWhiteSpace(settings.Owner.FullName))
            throw ContractException.Conflict("handover_owner_identity_unavailable");
        var tenant = await handoverPartyData.IdentityAsync(contract.RoomId, contract.RepresentativeResidentId, token);
        if (!tenant.HumanConfirmed || string.IsNullOrWhiteSpace(tenant.FullName))
            throw ContractException.Conflict("handover_tenant_identity_unavailable");
        return view with { OwnerName = settings.Owner.FullName.Trim(), TenantName = tenant.FullName.Trim() };
    }

    public async Task CopyHandoverDraftEvidenceAsync(Guid id, Guid fileId,
        Stream output, CancellationToken token)
    {
        var contract = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], token);
        RequireMainHandover(contract);
        var state = await DraftState(contract, token);
        if (user.IsInRole(Roles.Tenant) && state.Status is not ("Ready" or "Confirmed" or "ChangesRequested"))
            throw ContractException.Missing();
        // A stored draft reference is mandatory; guessing a private file ID
        // must not reveal another Tenant's or another draft's uploads.
        if (!state.EvidenceIds.Contains(fileId) &&
            !(state.KeyEvidenceIds ?? []).Contains(fileId) &&
            !state.Assets.Any(a => a.EvidenceIds?.Contains(fileId) == true) &&
            !(state.RoomChecks ?? []).Any(check => check.EvidenceIds.Contains(fileId)))
            throw ContractException.Missing();
        var file = await Workflow.FileAsync(id, fileId, token) ?? throw ContractException.Missing();
        if (file.Kind != ContractFileKind.HandoverEvidence)
            throw ContractException.Missing();
        await CopyVerifiedFile(file, output, token);
    }

    public async Task<ContractId> UploadHandoverDraftEvidenceAsync(Guid id, Stream input, CancellationToken token)
    {
        Role(Roles.Staff);
        var contract = await Load(id, [Roles.Staff], token);
        RequireMainHandover(contract);
        var buffer = new MemoryStream();
        var block = new byte[81920];
        while (true)
        {
            var count = await input.ReadAsync(block, token);
            if (count == 0) break;
            if (buffer.Length + count > 5 * 1024 * 1024)
                throw new ContractException(413, "inspection_image_too_large");
            await buffer.WriteAsync(block.AsMemory(0, count), token);
        }
        var bytes = buffer.ToArray();
        var contentType = images.Validate(bytes);
        return await Mutate(id, [Roles.Staff], async current =>
        {
            RequireMainHandover(current);
            var draft = await DraftState(current, token);
            if (draft.Status is not ("Draft" or "ReinspectionRequested"))
                throw ContractException.Conflict("handover_draft_not_editable");
            await RequireStartedMoveInWork(current, token);
            if ((await Workflow.FilesAsync(id, ContractFileKind.HandoverEvidence, token)).Count >= 200)
                throw ContractException.Conflict("handover_evidence_limit");
            var file = new ContractDocumentFile
            {
                ContractId = id,
                Kind = ContractFileKind.HandoverEvidence,
                SnapshotHash = current.SnapshotHash,
                DevelopmentOnly = current.IsDevelopmentDemo,
                ContentType = contentType,
                Length = bytes.Length,
                FileHash = FileHash(bytes),
                RecordedByUserId = Actor,
                RecordedAt = clock.GetUtcNow()
            };
            file.ObjectKey = BHome.Application.Storage.PrivateImageKeys.Evidence(current.Room.LocationId, current.RoomId, "move-in", id, file.Id);
            await files.PutAsync(current.RoomId, file.ObjectKey, bytes, contentType, token);
            repository.Add(file);
            Audit("ContractHandoverDraftEvidenceAdded", id);
            return new ContractId(file.Id);
        }, token);
    }
}
