using System.Text.Json;
using BHome.Domain.IdentityAccess;
using BHome.Domain.TenantContracts;
namespace BHome.Application.Contracts;

public sealed partial class ContractService
{
    private IContractHandoverRepository Handovers => handoverRepository ?? throw new ContractException(503, "handover_unavailable");
    private static HandoverSnapshot Snapshot(ContractHandover h) => JsonSerializer.Deserialize<HandoverSnapshot>(h.Snapshot) ?? throw ContractException.Conflict("handover_integrity_failed");
    private static HandoverView HandoverView(ContractHandover h) => new(h.Version, h.Status.ToString(), Snapshot(h), h.TenantConfirmedVersion, h.TenantConfirmedAt, h.StaffConfirmedAt);
    private void HandoverEvent(ContractHandover h, string action, string note = "")
    {
        repository.Add(new ContractHandoverHistory { ContractId = h.ContractId, Version = h.Version, Action = action, ActorId = Actor, OccurredAt = clock.GetUtcNow(), Snapshot = h.Snapshot, Note = note, ElectricityReadingId = h.ElectricityReadingId, WaterReadingId = h.WaterReadingId });
        Audit("ContractHandover" + action, h.ContractId);
    }
    private static void HandoverActive(Contract c)
    { if (c.Status != ContractStatus.Active || c.Kind != ContractKind.Main) throw ContractException.Conflict("active_main_contract_required"); }
    private static string HandoverText(string? value, int max, bool required = true)
    { var text = value?.Trim() ?? ""; if (text.Length > max || required && text.Length == 0) throw ContractException.Invalid("invalid_handover_input"); return text; }

    public async Task<HandoverView> GetHandoverAsync(Guid id, CancellationToken t)
    { await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t); return HandoverView(await Handovers.GetAsync(id, t) ?? throw ContractException.Missing()); }
    public async Task<IReadOnlyList<HandoverHistoryView>> HandoverHistoryAsync(Guid id, CancellationToken t)
    {
        await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        return (await Handovers.HistoryAsync(id, t)).Select(h => new HandoverHistoryView(h.Version, h.Action, h.ActorId, h.OccurredAt, h.Note,
            JsonSerializer.Deserialize<HandoverSnapshot>(h.Snapshot) ?? throw ContractException.Conflict("handover_integrity_failed"))).ToArray();
    }
    public async Task<HandoverChoices> HandoverChoicesAsync(Guid id, CancellationToken t)
    {
        var c = await Load(id, [Roles.Staff], t); HandoverActive(c);
        return new((await Handovers.AssetsAsync(c.RoomId, t)).Select(a => new HandoverAsset(a.Id, a.Name, a.Condition, "")).ToArray(),
            await Handovers.ReadingsAsync(c.RoomId, c.StartDate, t), (await Workflow.FilesAsync(id, ContractFileKind.HandoverEvidence, t)).Select(DocumentView).ToArray());
    }
    private async Task ValidateHandoverEvidence(Contract c, HandoverSnapshot snapshot, CancellationToken t)
    {
        var readings = await Handovers.ReadingsAsync(c.RoomId, c.StartDate, t);
        foreach (var reading in new[] { snapshot.Electricity, snapshot.Water })
        {
            var current = readings.SingleOrDefault(r => r.Id == reading.Id && r.Date == snapshot.Date && r.UtilityType == reading.UtilityType && r.Value == reading.Value && r.EvidenceHash == reading.EvidenceHash)
                ?? throw ContractException.Invalid("confirmed_handover_readings_required");
            using var image = new MemoryStream(); await storage.CopyToAsync(current.EvidenceObjectKey, image, t);
            if (FileHash(image.ToArray()) != current.EvidenceHash) throw ContractException.Conflict("handover_evidence_integrity_failed");
        }
        foreach (var evidenceId in snapshot.EvidenceIds)
        {
            var f = await Workflow.FileAsync(c.Id, evidenceId, t) ?? throw ContractException.Invalid("invalid_handover_evidence");
            if (f.Kind != ContractFileKind.HandoverEvidence) throw ContractException.Invalid("invalid_handover_evidence");
            await CopyVerifiedFile(f, Stream.Null, t);
        }
    }
    public Task<HandoverView> SaveHandoverAsync(Guid id, HandoverInput x, Guid key, CancellationToken t) => Mutate(id, [Roles.Staff], async c =>
    {
        HandoverActive(c);
        var h = await Handovers.GetAsync(id, t);
        if (await Replay(key, "handover-save", new { id, x }, t) is not null) return HandoverView(h ?? throw ContractException.Missing());
        if (h?.Status == ContractHandoverStatus.Confirmed) throw ContractException.Conflict("handover_already_confirmed");
        if (x.Version != (h?.Version ?? 0)) throw ContractException.Conflict("handover_version_changed");
        if (x.Date < c.StartDate || x.Date > Today || x.Date > c.EndDate || x.Assets is null || x.Assets.Length > 200 || x.Assets.Any(a => a is null) || x.EvidenceIds is null ||
            x.EvidenceIds.Length is < 1 or > 5 || x.EvidenceIds.Distinct().Count() != x.EvidenceIds.Length || x.Assets.Select(a => a.Id).Distinct().Count() != x.Assets.Length)
            throw ContractException.Invalid("invalid_handover_input");
        var assets = await Handovers.AssetsAsync(c.RoomId, t);
        if (assets.Count != x.Assets.Length || assets.Any(a => !x.Assets.Any(i => i.Id == a.Id))) throw ContractException.Invalid("handover_asset_inventory_changed");
        var readings = await Handovers.ReadingsAsync(c.RoomId, c.StartDate, t);
        var electricity = readings.SingleOrDefault(r => r.Id == x.ElectricityReadingId && r.UtilityType == 0 && r.Date == x.Date);
        var water = readings.SingleOrDefault(r => r.Id == x.WaterReadingId && r.UtilityType == 1 && r.Date == x.Date);
        if (electricity is null || water is null) throw ContractException.Invalid("confirmed_handover_readings_required");
        var snapshot = new HandoverSnapshot(x.Date, c.Room.RoomNumber, HandoverText(x.RoomCondition, 2000), HandoverText(x.KeysAndAccess, 2000), HandoverText(x.Notes, 4000, false),
            assets.Select(a => new HandoverAsset(a.Id, a.Name, a.Condition, HandoverText(x.Assets.Single(i => i.Id == a.Id).Condition, 1000))).ToArray(), electricity, water, x.EvidenceIds);
        await ValidateHandoverEvidence(c, snapshot, t);
        if (h is null) { h = new ContractHandover { ContractId = id }; repository.Add(h); } else h.Version++;
        h.Snapshot = JsonSerializer.Serialize(snapshot); h.Status = ContractHandoverStatus.Draft;
        h.ElectricityReadingId = electricity.Id; h.WaterReadingId = water.Id;
        h.TenantConfirmedVersion = null; h.TenantConfirmedAt = null; h.TenantConfirmedBy = null;
        HandoverEvent(h, "Recorded"); Remember(key, "handover-save", new { id, x }, id); return HandoverView(h);
    }, t);
    public Task<HandoverView> DecideHandoverAsync(Guid id, HandoverDecision x, Guid key, bool dispute, bool staff, CancellationToken t) => Mutate(id, staff ? [Roles.Staff] : [Roles.Tenant], async c =>
    {
        HandoverActive(c); var h = await Handovers.GetAsync(id, t) ?? throw ContractException.Missing();
        var operation = staff ? "handover-staff" : dispute ? "handover-dispute" : "handover-tenant";
        if (await Replay(key, operation, new { id, x }, t) is not null) return HandoverView(h);
        if (h.Version != x.Version) throw ContractException.Conflict("handover_version_changed");
        if (h.Status == ContractHandoverStatus.Confirmed) throw ContractException.Conflict("handover_already_confirmed");
        var note = HandoverText(x.Note, 2000, dispute);
        if (staff)
        {
            if (h.TenantConfirmedVersion != h.Version || h.Status != ContractHandoverStatus.Draft) throw ContractException.Conflict("tenant_handover_confirmation_required");
            await ValidateHandoverEvidence(c, Snapshot(h), t);
            h.StaffConfirmedBy = Actor; h.StaffConfirmedAt = clock.GetUtcNow(); h.Status = ContractHandoverStatus.Confirmed;
        }
        else
        {
            if (Actor != c.TenantUserId) throw new ContractException(403, "contract_tenant_required");
            if (!dispute && h.Status == ContractHandoverStatus.Disputed) throw ContractException.Conflict("handover_correction_required");
            h.TenantConfirmedVersion = dispute ? null : h.Version; h.TenantConfirmedAt = dispute ? null : clock.GetUtcNow(); h.TenantConfirmedBy = dispute ? null : Actor;
            h.Status = dispute ? ContractHandoverStatus.Disputed : ContractHandoverStatus.Draft;
        }
        HandoverEvent(h, staff ? "Completed" : dispute ? "Disputed" : "TenantConfirmed", note); Remember(key, operation, new { id, x }, id); return HandoverView(h);
    }, t);
    public async Task<ContractId> UploadHandoverEvidenceAsync(Guid id, Stream input, CancellationToken t)
    {
        Role(Roles.Staff); await Load(id, [Roles.Staff], t);
        using var buffer = new MemoryStream(); var block = new byte[81920];
        while (true) { var n = await input.ReadAsync(block, t); if (n == 0) break; if (buffer.Length + n > 5 * 1024 * 1024) throw new ContractException(413, "inspection_image_too_large"); await buffer.WriteAsync(block.AsMemory(0, n), t); }
        var bytes = buffer.ToArray(); var type = images.Validate(bytes);
        return await Mutate(id, [Roles.Staff], async c =>
        {
            HandoverActive(c); if ((await Handovers.GetAsync(id, t))?.Status == ContractHandoverStatus.Confirmed) throw ContractException.Conflict("handover_already_confirmed");
            if ((await Workflow.FilesAsync(id, ContractFileKind.HandoverEvidence, t)).Count >= 50) throw ContractException.Conflict("handover_evidence_limit");
            var f = new ContractDocumentFile { ContractId = id, Kind = ContractFileKind.HandoverEvidence, SnapshotHash = c.SnapshotHash, DevelopmentOnly = c.IsDevelopmentDemo, ContentType = type, Length = bytes.Length, FileHash = FileHash(bytes), RecordedByUserId = Actor, RecordedAt = clock.GetUtcNow() };
            f.ObjectKey = $"contracts/{id:N}/handover/{f.Id:N}"; await files.PutAsync(c.RoomId, f.ObjectKey, bytes, type, t); repository.Add(f); Audit("ContractHandoverEvidenceAdded", id); return new ContractId(f.Id);
        }, t);
    }
    public async Task CopyHandoverEvidenceAsync(Guid id, Guid fileId, Stream output, CancellationToken t)
    {
        await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        var h = await Handovers.GetAsync(id, t); var f = await Workflow.FileAsync(id, fileId, t) ?? throw ContractException.Missing();
        var recorded = h is not null && Snapshot(h).EvidenceIds.Contains(fileId) || await Handovers.HistoryContainsEvidenceAsync(id, fileId, t);
        if (f.Kind != ContractFileKind.HandoverEvidence || !recorded && f.RecordedByUserId != Actor) throw ContractException.Missing();
        await CopyVerifiedFile(f, output, t);
    }
    public async Task CopyHandoverMeterEvidenceAsync(Guid id, Guid readingId, Stream output, CancellationToken t)
    {
        var contract = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        var handover = await Handovers.GetAsync(id, t) ?? throw ContractException.Missing();
        var snapshot = Snapshot(handover);
        var recorded = new[] { snapshot.Electricity, snapshot.Water }.SingleOrDefault(r => r.Id == readingId);
        if (recorded is null)
        {
            var history = await Handovers.HistoryForReadingAsync(id, readingId, t) ?? throw ContractException.Missing();
            var previous = JsonSerializer.Deserialize<HandoverSnapshot>(history) ?? throw ContractException.Conflict("handover_integrity_failed");
            recorded = new[] { previous.Electricity, previous.Water }.SingleOrDefault(r => r.Id == readingId) ?? throw ContractException.Missing();
        }
        var current = await Handovers.ReadingAsync(contract.RoomId, readingId, t) ?? throw ContractException.Missing();
        using var buffer = new MemoryStream(); await storage.CopyToAsync(current.EvidenceObjectKey, buffer, t);
        if (FileHash(buffer.ToArray()) != recorded.EvidenceHash) throw ContractException.Conflict("handover_evidence_integrity_failed");
        buffer.Position = 0; await buffer.CopyToAsync(output, t);
    }
}
