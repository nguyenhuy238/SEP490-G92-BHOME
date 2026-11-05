using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Application.Storage;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed class MainDraftService(IContractRepository repository, IMainDraftData data, ICurrentUser user,
    ResourceAccess access, PropertyService prices, IMainDraftRenderer renderer, IContractFileStore files,
    IObjectStorage storage, TimeProvider clock)
{
    private Guid Actor => user.UserId is { } id && id != Guid.Empty ? id : throw new ContractException(401, "authentication_required");
    private void Role() { _ = Actor; if (!user.IsInRole(Roles.Staff) && !user.IsInRole(Roles.Owner)) throw new ContractException(403, "contract_role_forbidden"); }
    private static string Hash<T>(T value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    private static string Snapshot(Contract c, MainDraftState state) => Hash(new
    {
        c.Id,
        c.DraftVersion,
        c.RoomId,
        c.OwnerSignerId,
        c.TenantUserId,
        c.RepresentativeResidentId,
        People = c.Residents.Select(r => r.ResidentId).Order().ToArray(),
        c.StartDate,
        c.EndDate,
        Rent = c.MonthlyRent.ToString("0", System.Globalization.CultureInfo.InvariantCulture),
        Deposit = c.RequiredDeposit.ToString("0", System.Globalization.CultureInfo.InvariantCulture),
        c.Terms,
        state
    });
    private async Task<Room> Room(Guid id, CancellationToken t)
    {
        Role(); var room = await repository.RoomAsync(id, t) ?? throw ContractException.Missing();
        if (!room.Location.IsActive || !await access.CanAccessAsync(new(room.LocationId, null), [Roles.Staff, Roles.Owner], t)) throw ContractException.Missing();
        return room;
    }
    private async Task<Contract> Load(Guid id, CancellationToken t)
    {
        Role(); var c = await repository.FindAsync(id, t) ?? throw ContractException.Missing();
        await Room(c.RoomId, t);
        if (c.DraftMetadata == "{}") throw ContractException.Conflict("not_onboarding_draft");
        return c;
    }
    public async Task<MainContractSettings?> OwnerSettingsAsync(Guid locationId, CancellationToken t)
    {
        if (!user.IsInRole(Roles.Owner)) throw new ContractException(403, "contract_role_forbidden");
        _ = Actor; return await data.OwnerSettingsAsync(locationId, t);
    }
    public Task SetSettingsAsync(Guid locationId, MainContractSettingsInput input, CancellationToken t)
    {
        if (!user.IsInRole(Roles.Owner)) throw new ContractException(403, "contract_role_forbidden");
        if (input.OwnerSignerId != Actor) throw new ContractException(403, "owner_profile_must_be_own");
        var p = input.Owner;
        if (p is null || string.IsNullOrWhiteSpace(p.FullName) || p.FullName.Length > 150 ||
           !System.Text.RegularExpressions.Regex.IsMatch(p.CitizenNumber ?? "", "^[0-9]{12}$") ||
           p.DateOfBirth == default || p.DateOfIssue == default || p.DateOfBirth > input.EffectiveFrom || p.DateOfIssue > input.EffectiveFrom ||
           string.IsNullOrWhiteSpace(p.Address) || p.Address.Length > 1000 || string.IsNullOrWhiteSpace(p.PlaceOfIssue) || p.PlaceOfIssue.Length > 200 ||
           string.IsNullOrWhiteSpace(p.Phone) || p.Phone.Length > 30 || input.EffectiveFrom == default || input.EffectiveTo < input.EffectiveFrom ||
           input.SecurityDeposit < 0 || input.SecurityDeposit >= 1_000_000_000_000_000_000m || decimal.Truncate(input.SecurityDeposit) != input.SecurityDeposit ||
           string.IsNullOrWhiteSpace(input.PaymentTerms) || input.PaymentTerms.Length > 1000 || input.AdditionalTerms is null || input.AdditionalTerms.Length > 4000)
            throw ContractException.Invalid("invalid_contract_settings");
        return data.SetSettingsAsync(locationId, input, Actor, t);
    }
    public async Task<MainDraftPreparation> PrepareAsync(Guid roomId, Guid representative, Guid[] ids, DateOnly on, CancellationToken t)
    {
        var room = await Room(roomId, t);
        if (on == default || ids is null || ids.Length is < 1 or > 50 || ids.Distinct().Count() != ids.Length || !ids.Contains(representative)) throw ContractException.Invalid("invalid_contract_period_or_residents");
        var residents = await repository.ResidentsAsync(roomId, ids, t);
        if (residents.Count != ids.Length || residents.Any(r => r.VerificationStatus != IdentityVerificationStatus.Verified)) throw ContractException.Invalid("verified_residents_required");
        var settings = await data.SettingsAsync(room.LocationId, on, t);
        var pricing = await prices.ResolvePricesAsync(roomId, on, t);
        var blockers = new List<string>();
        if (residents.Single(r => r.Id == representative).ResidentType != ResidentType.Representative || residents.Any(r => r.Id != representative && r.ResidentType == ResidentType.Representative)) blockers.Add("individual_representatives_require_separate_contracts");
        if (room.Status is not (RoomStatus.Available or RoomStatus.Occupied)) blockers.Add("room_not_available");
        if (string.IsNullOrWhiteSpace(room.Location.Address)) blockers.Add("location_address_required");
        if (settings is null) blockers.Add("owner_contract_settings_required");
        blockers.AddRange(pricing.MissingRequiredCharges.Select(code => "missing_policy_" + code.ToLowerInvariant()));
        if (pricing.Charges.Any(p => p.ChargeCode is "ELECTRICITY" or "WATER" ? p.Method != ChargingMethod.Metered : p.Method != ChargingMethod.FixedPerRoomPerMonth)) blockers.Add("unsupported_contract_charge_unit");
        var summaries = new List<DraftTenantSummary>();
        foreach (var r in residents)
        {
            var identity = await data.IdentityAsync(roomId, r.Id, t);
            if (string.IsNullOrWhiteSpace(identity.FullName) || !identity.HumanConfirmed || identity.DateOfBirth == default || !System.Text.RegularExpressions.Regex.IsMatch(identity.CitizenIdentityNumber ?? "", "^[0-9]{12}$")) blockers.Add("confirmed_identity_required");
            if (r.Id == representative && (identity.DateOfIssue is null || string.IsNullOrWhiteSpace(identity.ResidentialAddress))) blockers.Add("tenant_issue_date_and_address_required");
            var number = identity.CitizenIdentityNumber;
            summaries.Add(new(r.Id, identity.FullName, number is { Length: >= 4 } ? "********" + number[^4..] : "Chưa có dữ liệu", identity.DateOfIssue, r.Id == representative, await data.PhoneAsync(roomId, r.Id, t)));
        }
        return new(roomId, room.LocationId, room.Location.Name, room.RoomNumber, room.Location.Address, on, summaries, pricing.Charges,
            settings?.SecurityDeposit, settings?.PaymentTerms, settings?.Owner.FullName, blockers.Distinct().ToArray());
    }
    private static void Validate(MainDraftInput x)
    {
        if (x.StartDate == default || x.EndDate <= x.StartDate || x.Notes is null || x.Notes.Length > 4000 ||
           string.IsNullOrWhiteSpace(x.TenantPhone) || x.TenantPhone.Length > 30 || string.IsNullOrWhiteSpace(x.TenantPlaceOfIssue) || x.TenantPlaceOfIssue.Length > 200)
            throw ContractException.Invalid("invalid_main_draft_input");
    }
    public async Task<MainDraftView> SaveAsync(Guid? id, MainDraftInput x, Guid key, CancellationToken t)
    {
        if (key == Guid.Empty) throw ContractException.Invalid("idempotency_key_required");
        await Room(x.RoomId, t);
        var existingPhone = await data.PhoneAsync(x.RoomId, x.RepresentativeResidentId, t);
        if (!string.IsNullOrWhiteSpace(existingPhone)) x = x with { TenantPhone = existingPhone };
        Validate(x);
        return await repository.InTransactionAsync(x.RoomId, async () =>
        {
            var room = await Room(x.RoomId, t); await data.LockConfigurationAsync(room.LocationId, t);
            var fingerprint = Hash(new { id, input = x });
            var operation = await repository.OperationAsync(Actor, key, "main-draft", t);
            if (operation is not null)
            {
                if (operation.Fingerprint != fingerprint) throw ContractException.Conflict("idempotency_key_reused");
                return await GetAsync(operation.ResultId, t);
            }
            var preparation = await PrepareAsync(x.RoomId, x.RepresentativeResidentId, x.ResidentIds, x.StartDate, t);
            if (preparation.Blockers.Count > 0) throw ContractException.Conflict(preparation.Blockers[0]);
            var settings = (await data.SettingsAsync(room.LocationId, x.StartDate, t))!;
            if (!await repository.ActiveUserInRoleAsync(settings.OwnerSignerId, Roles.Owner, t)) throw ContractException.Conflict("owner_contract_settings_required");
            Contract c;
            if (id is { } existing)
            {
                c = await Load(existing, t);
                if (c.RoomId != x.RoomId || c.Status != ContractStatus.Draft || c.DraftVersion != x.ExpectedVersion || c.Signatures.Count > 0) throw ContractException.Conflict("draft_version_or_status_changed");
                if (c.RepresentativeResidentId != x.RepresentativeResidentId || !c.Residents.Select(r => r.ResidentId).Order().SequenceEqual(x.ResidentIds.Order())) throw ContractException.Invalid("draft_people_immutable");
                c.DraftVersion++;
            }
            else
            {
                c = new Contract { RoomId = x.RoomId, OwnerSignerId = settings.OwnerSignerId, RepresentativeResidentId = x.RepresentativeResidentId, Status = ContractStatus.Draft };
                var representative = (await repository.ResidentsAsync(x.RoomId, [x.RepresentativeResidentId], t)).Single();
                c.TenantUserId = representative.TenantUserId;
                c.Residents = x.ResidentIds.Select(r => new ContractResident { ContractId = c.Id, ResidentId = r, Role = r == x.RepresentativeResidentId ? ResidentType.Representative : ResidentType.CoOccupant, ResidenceFrom = x.StartDate }).ToList();
                repository.Add(c);
            }
            if (await data.DuplicateAsync(x.RoomId, c.Id, x.ResidentIds, x.StartDate, x.EndDate, t) || await repository.ConflictsAsync(x.RoomId, c.Id, x.StartDate, x.EndDate, x.ResidentIds, t)) throw ContractException.Conflict("room_contract_conflict");
            c.StartDate = x.StartDate; c.EndDate = x.EndDate; c.OwnerSignerId = settings.OwnerSignerId;
            foreach (var resident in c.Residents) resident.ResidenceFrom = x.StartDate;
            c.MonthlyRent = preparation.Charges.Single(p => p.ChargeCode == "RENT").Rate;
            if (c.MonthlyRent <= 0 || decimal.Truncate(c.MonthlyRent) != c.MonthlyRent) throw ContractException.Invalid("invalid_vnd_amount");
            c.RequiredDeposit = settings.SecurityDeposit; c.Terms = settings.AdditionalTerms + "\n" + x.Notes.Trim();
            var state = new MainDraftState(x, preparation.Charges, settings.Version, Hash(settings), renderer.TemplateHash);
            c.DraftMetadata = data.Protect(c, state); c.SnapshotHash = Snapshot(c, state);
            repository.Add(new ContractOperation { ActorId = Actor, Key = key, Operation = "main-draft", Fingerprint = fingerprint, ResultId = c.Id, CreatedAt = clock.GetUtcNow() });
            repository.Audit(Actor, id is null ? "MainDraftCreated" : "MainDraftUpdated", c.Id, clock.GetUtcNow());
            return new MainDraftView(c.Id, "Draft", c.DraftVersion, x, preparation);
        }, t);
    }
    public async Task<MainDraftView> GetAsync(Guid id, CancellationToken t)
    {
        var c = await Load(id, t); var state = data.Unprotect(c);
        var preparation = await PrepareAsync(c.RoomId, c.RepresentativeResidentId, c.Residents.Select(r => r.ResidentId).ToArray(), c.StartDate, t);
        return new(c.Id, c.Status.ToString(), c.DraftVersion, state.Input, preparation with { Charges = state.Charges, SecurityDeposit = c.RequiredDeposit });
    }
    private static ContractDocumentView FileView(ContractDocumentFile f) => new(f.Id, f.ContractId, f.Kind.ToString(), f.SnapshotHash, f.TemplateId, f.TemplateVersion, f.DevelopmentOnly, f.RecordedAt);
    public async Task<MainDraftFiles> GenerateAsync(Guid id, CancellationToken t)
    {
        var before = await Load(id, t);
        return await repository.InTransactionAsync(before.RoomId, async () =>
        {
            var c = await Load(id, t);
            if (c.Status != ContractStatus.Draft || c.Signatures.Count > 0) throw ContractException.Conflict("draft_version_or_status_changed");
            var state = data.Unprotect(c); var settings = await data.SettingsAsync(c.Room.LocationId, c.StartDate, t) ?? throw ContractException.Conflict("owner_contract_settings_required");
            if (c.SnapshotHash != Snapshot(c, state)) throw ContractException.Conflict("signed_terms_changed");
            if (state.TemplateHash != renderer.TemplateHash) throw ContractException.Conflict("draft_template_changed_save_again");
            if (Hash(settings) != state.SettingsHash) throw ContractException.Conflict("draft_configuration_changed_save_again");
            var prep = await PrepareAsync(c.RoomId, c.RepresentativeResidentId, c.Residents.Select(r => r.ResidentId).ToArray(), c.StartDate, t);
            if (prep.Blockers.Count > 0) throw ContractException.Conflict(prep.Blockers[0]);
            if (!prep.Charges.Select(p => (p.Id, p.Version, p.Rate)).SequenceEqual(state.Charges.Select(p => (p.Id, p.Version, p.Rate)))) throw ContractException.Conflict("draft_configuration_changed_save_again");
            var existing = await data.FilesAsync(id, c.SnapshotHash, t);
            var docx = existing.FirstOrDefault(f => f.Kind == ContractFileKind.DraftDocx);
            var pdf = existing.FirstOrDefault(f => f.Kind == ContractFileKind.DraftPdf);
            byte[] bytes;
            if (docx is null)
            {
                bytes = await renderer.DocxAsync(new(c, state, settings, await data.IdentityAsync(c.RoomId, c.RepresentativeResidentId, t), c.Room.Location.Name, c.Room.RoomNumber, c.Room.Location.Address, prep.Residents.Where(r => !r.Representative).Select(r => r.FullName).ToArray()), t);
                docx = await Store(c, bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ContractFileKind.DraftDocx, "docx", t);
            }
            else
            {
                using var buffer = new MemoryStream(); await storage.CopyToAsync(docx.ObjectKey, buffer, t); bytes = buffer.ToArray();
                if (bytes.Length != docx.Length || Convert.ToHexString(SHA256.HashData(bytes)) != docx.FileHash) throw ContractException.Conflict("contract_document_integrity_failed");
            }
            string? error = null;
            if (pdf is null)
            {
                try { pdf = await Store(c, await renderer.PdfAsync(bytes, t), "application/pdf", ContractFileKind.DraftPdf, "pdf", t); }
                catch (ContractException ex) when (ex.Status == 503) { error = ex.Code; }
            }
            repository.Audit(Actor, "MainDraftDocumentsGenerated", id, clock.GetUtcNow());
            return new MainDraftFiles(FileView(docx), pdf is null ? null : FileView(pdf), error);
        }, t);
    }
    private async Task<ContractDocumentFile> Store(Contract c, byte[] bytes, string contentType, ContractFileKind kind, string extension, CancellationToken t)
    {
        var f = new ContractDocumentFile
        {
            ContractId = c.Id,
            Kind = kind,
            SnapshotHash = c.SnapshotHash,
            TemplateId = "main-tenancy-docx-v1",
            TemplateVersion = 1,
            ContentType = contentType,
            Length = bytes.Length,
            FileHash = Convert.ToHexString(SHA256.HashData(bytes)),
            RecordedByUserId = Actor,
            RecordedAt = clock.GetUtcNow()
        };
        f.ObjectKey = $"contracts/{c.Id:N}/draft/{f.Id:N}.{extension}";
        await files.PutAsync(c.RoomId, f.ObjectKey, bytes, contentType, t); repository.Add(f); return f;
    }
    public async Task<string> CopyFileAsync(Guid id, Guid fileId, Stream output, CancellationToken t)
    {
        var c = await Load(id, t);
        var f = await data.FileAsync(id, fileId, t) ?? throw ContractException.Missing();
        if (f.Kind is not (ContractFileKind.DraftDocx or ContractFileKind.DraftPdf) || f.SnapshotHash != c.SnapshotHash) throw ContractException.Conflict("draft_document_outdated");
        using var buffer = new MemoryStream(); await storage.CopyToAsync(f.ObjectKey, buffer, t);
        if (buffer.Length != f.Length || Convert.ToHexString(SHA256.HashData(buffer.ToArray())) != f.FileHash) throw ContractException.Conflict("contract_document_integrity_failed");
        buffer.Position = 0; await buffer.CopyToAsync(output, t); return f.ContentType;
    }
}
