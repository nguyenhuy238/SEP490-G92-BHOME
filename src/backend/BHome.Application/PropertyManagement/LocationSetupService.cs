using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;

namespace BHome.Application.PropertyManagement;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record LocationSetupInformation(string Name, string Address, string Code, int Floors,
    string ContactPhone, string ContactEmail, string Description);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record LocationMetadataWrite(string Code, int Floors, string ContactPhone, string ContactEmail, string Description, int ExpectedVersion = 0);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record LocalRoomDefaultsWrite(string Name, string Description, SharedRoomDefaults Defaults,
    Guid? AssetTemplateId, int ExpectedVersion = 0, string Reason = "", string Status = "Recorded");
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SetupAssetRequirement(string Name, string Category, string TrackingMode, int Quantity);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SetupRoomDefaultsInput(Guid Key, string Name, string Description, int Capacity, decimal Area,
    decimal? ReferenceRent, string[] Amenities, SetupAssetRequirement[] Assets, Guid? SourceId = null,
    int? SourceVersion = null, string? SourceKind = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SetupRoomInput(Guid Key, string RoomNumber, string Floor, Guid RoomTypeKey,
    [property: JsonRequired] decimal Rent);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SetupFeeInput(Guid? RoomKey, [property: JsonRequired] ChargeCategory Category, string ChargeCode,
    string Name, [property: JsonRequired] ChargingMethod Method, [property: JsonRequired] decimal Rate,
    DateOnly EffectiveFrom, DateOnly? EffectiveTo);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SetupPolicyInput(string Title, string Content, DateOnly EffectiveFrom);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record LocationSetupInput(LocationSetupInformation Location, SetupRoomDefaultsInput[] RoomTypes,
    SetupRoomInput[] Rooms, SetupFeeInput[] Fees, SetupPolicyInput? Policy, [property: JsonRequired] bool Activate,
    [property: JsonRequired] DateOnly RentEffectiveFrom,
    Guid? SourceLocationId = null, string? SourceState = null, ConfigurationSourceReference[]? SourceReferences = null);
public sealed record LocationSetupResult(LocationDto Location, Guid[] CreatedReferences);
public sealed record LocationSetupSource(IReadOnlyList<SetupDocument> RoomTypes, IReadOnlyList<SetupDocument> AssetTemplates,
    IReadOnlyList<PolicyDto> Fees, IReadOnlyList<SetupDocument> Policies, string SourceState);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ConfiguredRoomInput(string RoomNumber, string? Floor, Guid RoomDefaultsId, int ExpectedVersion,
    [property: JsonRequired] decimal Rent);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ConfiguredRoomsInput(ConfiguredRoomInput[] Rooms, DateOnly EffectiveFrom);
public sealed record RoomProvenanceData(Guid RoomId, Guid RoomDefaultsId, int RoomDefaultsVersion, string Name,
    decimal Area, string[] Amenities, int DefaultCapacity, decimal? ReferenceRent);

internal static class LocationSetupKeys
{
    internal static Guid Key(string value) => new(SHA256.HashData(Encoding.UTF8.GetBytes(value)).AsSpan(0, 16));
    internal static Guid RoomProvenance(Guid room) => Key($"room-provenance:{room}");
    internal static Guid Metadata(Guid location) => Key($"location-metadata:{location}");
}

/// <summary>One unit of work for a new location; no writes to legacy RoomType, physical assets, tenancy or ledger.</summary>
public sealed class LocationSetupService(ISharedConfigurationStore shared, ISetupWorkspaceStore local,
    ISharedDataValidator validator, SharedConfigurationService library, PropertyService properties,
    AssetInventoryService assets, OperatingPolicyService policies, ICurrentUser user, TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json = SharedDataValidator.Json;
    private DateOnly Today => BHome.Application.Billing.BillingAutomationDates.BusinessDate(clock.GetUtcNow());
    private Guid Owner()
    {
        var actor = user.UserId ?? throw new PropertyException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new PropertyException(403, "owner_required");
        return actor;
    }
    private static string Text(string? value, int limit, bool required = true)
    {
        var result = value?.Trim() ?? "";
        if (result.Length > limit || required && result.Length == 0) throw new PropertyException(400, "invalid_location_setup_text");
        return result;
    }
    private static string Name(SetupDocument document) => document.Data.GetProperty("name").GetString() ?? "";
    private static Guid? Template(SetupDocument document) => document.Data.TryGetProperty("assetTemplateId", out var id) && id.ValueKind == JsonValueKind.String && id.TryGetGuid(out var value) ? value : null;
    private static SharedRoomDefaults Defaults(SetupDocument document) => SharedDataValidator.Read<SharedRoomDefaults>(document.Data.GetProperty("defaults"));
    private static bool Same(string a, string b) => string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);
    private async Task<SharedRoomDefaults> ValidateDefaults(SharedRoomDefaults input, CancellationToken t)
    {
        if (input is null) throw new PropertyException(400, "invalid_room_defaults");
        var data = await validator.ValidateAsync("room-type-templates", JsonSerializer.SerializeToElement(input, Json), t);
        return SharedDataValidator.Read<SharedRoomDefaults>(data);
    }
    private async Task<SetupDocument> ScopedDocument(Guid location, Guid id, string kind, CancellationToken t)
    {
        var document = await local.GetAsync(id, kind, t) ?? throw new PropertyException(404, "resource_not_found");
        if (document.LocationId != location) throw new PropertyException(404, "resource_not_found");
        return document;
    }
    private static void ValidateMetadata(LocationMetadataWrite input)
    {
        var code = Text(input.Code, 50);
        if (code.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_')) || input.Floors is < 1 or > 100)
            throw new PropertyException(400, "invalid_location_setup_metadata");
        _ = Text(input.ContactPhone, 50, false); _ = Text(input.Description, 2000, false);
        var email = Text(input.ContactEmail, 200, false);
        if (email.Length > 0 && !new EmailAddressAttribute().IsValid(email)) throw new PropertyException(400, "invalid_location_contact_email");
    }
    private async Task<SetupDocument> SaveMetadata(Guid location, LocationMetadataWrite input, Guid actor, CancellationToken t, string setupStatus = "Completed")
    {
        ValidateMetadata(input);
        if (await shared.LocationCodeExistsAsync(input.Code, location, t)) throw new PropertyException(409, "duplicate_location_code");
        return await local.SaveAsync(LocationSetupKeys.Metadata(location), location, "LocationMetadata", "Recorded", new
        {
            code = input.Code.Trim(), input.Floors, contactPhone = input.ContactPhone?.Trim() ?? "", contactEmail = input.ContactEmail?.Trim() ?? "",
            description = input.Description?.Trim() ?? "", setupStatus
        }, input.ExpectedVersion, actor, t);
    }
    public async Task<SetupDocument?> MetadataAsync(Guid location, CancellationToken t)
    { _ = Owner(); _ = await properties.GetLocationAsync(location, t); return await local.GetAsync(LocationSetupKeys.Metadata(location), "LocationMetadata", t); }
    public Task<SetupDocument> UpdateMetadataAsync(Guid location, LocationMetadataWrite input, CancellationToken t)
    {
        var actor = Owner();
        return shared.TransactionAsync([location], async () =>
        {
            _ = await properties.GetLocationAsync(location, t);
            var prior = await local.GetAsync(LocationSetupKeys.Metadata(location), "LocationMetadata", t);
            var status = prior?.Data.TryGetProperty("setupStatus", out var existing) == true ? existing.GetString() ?? "Recorded" : "Recorded";
            return await SaveMetadata(location, input, actor, t, status);
        }, t, validateActiveLocations: false);
    }

    public Task<SetupDocument> SaveRoomDefaultsAsync(Guid location, Guid? id, LocalRoomDefaultsWrite input, CancellationToken t)
    {
        var actor = Owner();
        return shared.TransactionAsync([location], async () =>
        {
            _ = await properties.GetLocationAsync(location, t);
            var before = id.HasValue ? await ScopedDocument(location, id.Value, "RoomDefaults", t) : null;
            if (input.Status == "Archived")
            {
                if (before is null) throw new PropertyException(400, "invalid_room_defaults");
                var archived = JsonNode.Parse(before.Data.GetRawText())!.AsObject();
                archived["reason"] = Text(input.Reason, 500);
                return await local.SaveAsync(before.Id, location, "RoomDefaults", "Archived", archived, input.ExpectedVersion, actor, t);
            }
            var name = Text(input.Name, 150); var description = Text(input.Description, 2000, false);
            var defaults = await ValidateDefaults(input.Defaults, t);
            if (name.Length < 2 || input.Status != "Recorded")
                throw new PropertyException(400, "invalid_room_defaults");
            if (id is not null) _ = Text(input.Reason, 500);
            if ((await local.ListAsync(location, "RoomDefaults", t)).Any(doc => doc.Id != id && doc.Status != "Archived" && Same(Name(doc), name)))
                throw new PropertyException(409, "duplicate_room_defaults_name");
            if (input.AssetTemplateId is { } template)
            {
                var assetTemplate = await ScopedDocument(location, template, "AssetTemplate", t);
                if (assetTemplate.Status != "Published") throw new PropertyException(409, "published_template_required");
            }
            // Preserve lineage when editing a copied/applied document; only editable local fields are replaced.
            var data = before is null ? new JsonObject() : JsonNode.Parse(before.Data.GetRawText())!.AsObject();
            data["name"] = name; data["description"] = description; data["defaults"] = JsonSerializer.SerializeToNode(defaults, Json);
            data["assetTemplateId"] = input.AssetTemplateId.HasValue ? JsonValue.Create(input.AssetTemplateId.Value) : null;
            data["reason"] = Text(input.Reason, 500, false);
            return await local.SaveAsync(id ?? Guid.NewGuid(), location, "RoomDefaults", input.Status, data, input.ExpectedVersion, actor, t);
        }, t, validateActiveLocations: false);
    }
    public async Task<IReadOnlyList<SetupDocument>> DefaultsHistoryAsync(Guid location, Guid id, CancellationToken t)
    { _ = Owner(); _ = await properties.GetLocationAsync(location, t); _ = await ScopedDocument(location, id, "RoomDefaults", t); return await local.HistoryAsync(id, "RoomDefaults", t); }
    public async Task<IReadOnlyList<SetupDocument>> RoomProvenanceAsync(Guid location, CancellationToken t)
    { _ = Owner(); _ = await properties.GetLocationAsync(location, t); return await local.ListAsync(location, "RoomProvenance", t); }

    private async Task<LocationSetupSource> Source(Guid location, CancellationToken t)
    {
        _ = await properties.GetLocationAsync(location, t);
        var defaults = (await local.ListAsync(location, "RoomDefaults", t)).Where(d => d.Status == "Recorded").OrderBy(d => d.Id).ToArray();
        var templates = (await local.ListAsync(location, "AssetTemplate", t)).Where(d => d.Status is "Draft" or "Published").OrderBy(d => d.Id).ToArray();
        // A room-scoped service/utility fee is selectable only by mapping it to a new room key.
        // Room rent is explicitly confirmed per new room; legacy room-type scopes cannot be copied.
        var fees = (await shared.SetupCopyPoliciesAsync(location, t)).OrderBy(p => p.Id).ToArray();
        var rules = (await local.ListAsync(location, "OperatingPolicy", t)).Where(d => d.Status is "Draft" or "Published").OrderBy(d => d.Id).ToArray();
        var hash = SharedConfigurationApplicationService.Hash(new { location, defaults, templates, fees, rules });
        return new(defaults, templates, fees, rules, hash);
    }
    public Task<LocationSetupSource> SourceAsync(Guid location, CancellationToken t)
    { _ = Owner(); return shared.TransactionAsync([location], () => Source(location, t), t, validateActiveLocations: false); }

    private async Task<RoomDto> CreateRoom(Guid location, SetupDocument type, string number, string? floor,
        decimal rent, DateOnly effectiveFrom, Guid actor, CancellationToken t)
    {
        if (type.LocationId != location || type.Status == "Archived") throw new PropertyException(400, "room_defaults_scope_invalid");
        var defaults = Defaults(type);
        _ = SharedDataValidator.Money(rent);
        var room = await properties.SaveRoomAsync(null, new(location, Text(number, 50), Text(floor, 30, false), defaults.Capacity,
            RoomStatus.Available, Reason: "Created from location room configuration"), t);
        await local.SaveAsync(LocationSetupKeys.RoomProvenance(room.Id), location, "RoomProvenance", "Recorded",
            new RoomProvenanceData(room.Id, type.Id, type.Version, Name(type), defaults.Area, defaults.Amenities, defaults.Capacity, defaults.ReferenceRent), 0, actor, t);
        await properties.CreatePolicyAsync(new(location, room.Id, ChargeCategory.Rent, "RENT", $"Rent {room.RoomNumber}",
            ChargingMethod.FixedPerRoomPerMonth, rent, effectiveFrom, null, "Owner-confirmed room setup rent"), t);
        if (Template(type) is { } templateId)
        {
            var template = await ScopedDocument(location, templateId, "AssetTemplate", t);
            if (template.Status != "Published") throw new PropertyException(409, "published_template_required");
            await assets.AssignTemplateAsync(room.Id, new(templateId), t);
            var inventory = await assets.InventoryAsync(room.Id, t);
            if (inventory.AssignedTemplateId != templateId || inventory.CurrentDesiredId is null)
                throw new PropertyException(409, "room_asset_assignment_incomplete");
        }
        return room;
    }

    public Task<BulkRoomResult> CreateConfiguredRoomsAsync(Guid location, ConfiguredRoomsInput input, Guid key, CancellationToken t)
    {
        var actor = Owner();
        if (key == Guid.Empty || input.Rooms is null || input.Rooms.Length is < 1 or > 200 || input.Rooms.Any(r => r is null))
            throw new PropertyException(400, "invalid_configured_rooms");
        var fingerprint = SharedConfigurationApplicationService.Hash(new { location, input });
        return shared.TransactionAsync([location], async () =>
        {
            var prior = await shared.OperationAsync(actor, "ConfiguredRooms", key, t);
            if (prior is not null)
            {
                if (prior.Fingerprint != fingerprint) throw new PropertyException(409, "idempotency_payload_mismatch");
                var replay = new List<RoomDto>(); foreach (var id in prior.CreatedReferences) replay.Add(await properties.GetRoomAsync(id, t));
                return new BulkRoomResult(replay);
            }
            if (input.EffectiveFrom < Today) throw new PropertyException(400, "invalid_rent_effective_date");
            var target = await properties.GetLocationAsync(location, t);
            if (!target.IsActive) throw new PropertyException(409, "location_inactive");
            if (input.Rooms.Select(room => Text(room.RoomNumber, 50)).Distinct(StringComparer.OrdinalIgnoreCase).Count() != input.Rooms.Length)
                throw new PropertyException(409, "duplicate_room_number");
            var created = new List<RoomDto>(); var references = new List<ConfigurationSourceReference>();
            foreach (var row in input.Rooms)
            {
                var type = await ScopedDocument(location, row.RoomDefaultsId, "RoomDefaults", t);
                if (type.Version != row.ExpectedVersion) throw new PropertyException(409, "stale_version");
                created.Add(await CreateRoom(location, type, row.RoomNumber, row.Floor, row.Rent, input.EffectiveFrom, actor, t));
                references.Add(new(type.Id, type.Version, type.Kind));
            }
            await shared.SaveOperationAsync(new(Guid.NewGuid(), "ConfiguredRooms", key, fingerprint, actor, clock.GetUtcNow(), location, null,
                Guid.Empty, 0, 0, "RoomDefaults", location, "Completed", created.Select(room => room.Id).ToArray(), references.Distinct().ToArray()), t);
            return new BulkRoomResult(created);
        }, t, validateActiveLocations: false);
    }

    public Task<LocationSetupResult> CompleteAsync(LocationSetupInput input, Guid key, CancellationToken t)
    {
        var actor = Owner();
        if (key == Guid.Empty || input.Location is null || input.RoomTypes is null || input.Rooms is null || input.Fees is null ||
            input.RoomTypes.Length is < 1 or > 100 || input.Rooms.Length is < 1 or > 200 || input.Fees.Length > 1000 ||
            input.RoomTypes.Any(type => type is null) || input.Rooms.Any(room => room is null) || input.Fees.Any(fee => fee is null) ||
            input.SourceLocationId.HasValue != !string.IsNullOrWhiteSpace(input.SourceState) || input.SourceLocationId == Guid.Empty ||
            input.SourceReferences is { Length: > 1000 } || input.SourceReferences?.Any(reference => reference is null) == true)
            throw new PropertyException(400, "invalid_location_setup");
        var fingerprint = SharedConfigurationApplicationService.Hash(input);
        return shared.TransactionAsync(input.SourceLocationId is { } sourceLocation ? [sourceLocation] : [], async () =>
        {
            var prior = await shared.OperationAsync(actor, "LocationSetup", key, t);
            if (prior is not null)
            {
                if (prior.Fingerprint != fingerprint) throw new PropertyException(409, "idempotency_payload_mismatch");
                return new LocationSetupResult(await properties.GetLocationAsync(prior.TargetLocationId, t), prior.CreatedReferences);
            }
            if (input.RentEffectiveFrom < Today) throw new PropertyException(400, "invalid_rent_effective_date");
            var info = input.Location;
            var metadata = new LocationMetadataWrite(info.Code, info.Floors, info.ContactPhone, info.ContactEmail, info.Description);
            ValidateMetadata(metadata); _ = Text(info.Name, 200); _ = Text(info.Address, 1000);
            if (await shared.LocationCodeExistsAsync(info.Code, null, t)) throw new PropertyException(409, "duplicate_location_code");
            LocationSetupSource? source = null;
            if (input.SourceLocationId is { } sourceId)
            {
                source = await Source(sourceId, t);
                if (source.SourceState != input.SourceState) throw new PropertyException(409, "configuration_copy_state_changed");
            }
            if (input.RoomTypes.Select(type => type.Key).Distinct().Count() != input.RoomTypes.Length || input.RoomTypes.Any(type => type.Key == Guid.Empty) ||
                input.RoomTypes.Select(type => Text(type.Name, 150)).Distinct(StringComparer.OrdinalIgnoreCase).Count() != input.RoomTypes.Length ||
                input.Rooms.Select(room => room.Key).Distinct().Count() != input.Rooms.Length || input.Rooms.Any(room => room.Key == Guid.Empty) ||
                input.Rooms.Select(room => Text(room.RoomNumber, 50)).Distinct(StringComparer.OrdinalIgnoreCase).Count() != input.Rooms.Length)
                throw new PropertyException(400, "duplicate_setup_keys_or_names");
            var normalized = new Dictionary<Guid, SharedRoomDefaults>(); var references = new List<ConfigurationSourceReference>();
            var roomScopedFeeSources = new List<string>();
            foreach (var reference in (input.SourceReferences ?? []).Distinct())
            {
                if (reference.Id == Guid.Empty || reference.Version < 1) throw new PropertyException(400, "invalid_setup_source");
                if (reference.Kind is "room-type-templates" or "asset-catalog" or "asset-templates" or "fee-templates" or "policy-templates")
                {
                    var document = await library.GetAsync(reference.Kind, reference.Id, t);
                    if (document.Status != "Published" || document.Version != reference.Version)
                        throw new PropertyException(409, "shared_source_stale_or_unpublished");
                    if (reference.Kind == "fee-templates")
                    {
                        var fee = SharedDataValidator.Read<SharedFeeData>(document.Data);
                        if (fee.Scope == "Room" && fee.Category != ChargeCategory.Rent) roomScopedFeeSources.Add(fee.ChargeCode);
                    }
                }
                else
                {
                    var matches = reference.Kind switch
                    {
                        "RoomDefaults" => source?.RoomTypes.Any(d => d.Id == reference.Id && d.Version == reference.Version),
                        "AssetTemplate" => source?.AssetTemplates.Any(d => d.Id == reference.Id && d.Version == reference.Version),
                        "OperatingPolicy" => source?.Policies.Any(d => d.Id == reference.Id && d.Version == reference.Version),
                        "BillingPolicy" => source?.Fees.Any(d => d.Id == reference.Id && d.Version == reference.Version),
                        _ => throw new PropertyException(400, "invalid_setup_source")
                    };
                    if (matches != true) throw new PropertyException(409, "configuration_copy_state_changed");
                    if (reference.Kind == "BillingPolicy" && source!.Fees.Single(p => p.Id == reference.Id).RoomId.HasValue)
                        roomScopedFeeSources.Add(source.Fees.Single(p => p.Id == reference.Id).ChargeCode);
                }
                references.Add(reference);
            }
            foreach (var type in input.RoomTypes)
            {
                if (Text(type.Name, 150).Length < 2 || type.ReferenceRent is null || type.Assets is null || type.Assets.Length > 100 || type.Assets.Any(asset => asset is null))
                    throw new PropertyException(400, "invalid_room_defaults");
                normalized.Add(type.Key, await ValidateDefaults(new(type.Capacity, type.Area, type.Amenities, type.ReferenceRent), t));
                _ = Text(type.Description, 2000, false);
                if (type.SourceId is { } templateId)
                {
                    if (type.SourceVersion is null || type.SourceVersion < 1) throw new PropertyException(400, "invalid_setup_source");
                    if (type.SourceKind == "SharedTemplate")
                    {
                        var template = await library.GetAsync("room-type-templates", templateId, t);
                        if (template.Version != type.SourceVersion || template.Status != "Published") throw new PropertyException(409, "shared_source_stale_or_unpublished");
                    }
                    else if (type.SourceKind == "RoomDefaults")
                    {
                        var doc = source?.RoomTypes.SingleOrDefault(d => d.Id == templateId && d.Version == type.SourceVersion && d.Status != "Archived");
                        if (doc is null) throw new PropertyException(409, "configuration_copy_state_changed");
                    }
                    else throw new PropertyException(400, "invalid_setup_source");
                    references.Add(new(templateId, type.SourceVersion.Value, type.SourceKind == "SharedTemplate" ? "room-type-templates" : type.SourceKind));
                }
                else if (type.SourceVersion.HasValue || type.SourceKind is not null) throw new PropertyException(400, "invalid_setup_source");
                foreach (var asset in type.Assets)
                {
                    _ = Text(asset.Name, 150); _ = Text(asset.Category, 80);
                    if (asset.Quantity is < 1 or > 10000 || asset.TrackingMode is not ("Serialized" or "BulkQuantity")) throw new PropertyException(400, "invalid_template_item");
                }
            }
            foreach (var room in input.Rooms)
            {
                if (!normalized.ContainsKey(room.RoomTypeKey) || !int.TryParse(room.Floor, out var floor) || floor < 1 || floor > info.Floors)
                    throw new PropertyException(400, "invalid_setup_room");
                _ = SharedDataValidator.Money(room.Rent);
            }
            foreach (var fee in input.Fees)
            {
                if (fee.Category == ChargeCategory.Rent && fee.RoomKey.HasValue || fee.RoomKey.HasValue && !input.Rooms.Any(r => r.Key == fee.RoomKey) ||
                    !Enum.IsDefined(fee.Category) || !Enum.IsDefined(fee.Method) || !PropertyRules.ValidCharge(fee.Category, fee.Method, Text(fee.ChargeCode, 80).ToUpperInvariant()) ||
                    fee.EffectiveFrom < Today || fee.EffectiveTo < fee.EffectiveFrom) throw new PropertyException(400, "invalid_setup_fee");
                _ = Text(fee.Name, 150); _ = SharedDataValidator.Money(fee.Rate);
            }
            foreach (var group in roomScopedFeeSources.GroupBy(code => code, StringComparer.OrdinalIgnoreCase))
                if (input.Fees.Count(fee => fee.RoomKey.HasValue && Same(fee.ChargeCode, group.Key)) < group.Count())
                    throw new PropertyException(400, "source_fee_room_mapping_required");
            for (var i = 0; i < input.Fees.Length; i++)
            for (var j = i + 1; j < input.Fees.Length; j++)
            {
                var a = input.Fees[i]; var b = input.Fees[j];
                if (a.RoomKey == b.RoomKey && Same(a.ChargeCode, b.ChargeCode) && a.EffectiveFrom <= (b.EffectiveTo ?? DateOnly.MaxValue) && b.EffectiveFrom <= (a.EffectiveTo ?? DateOnly.MaxValue))
                    throw new PropertyException(409, "overlapping_setup_fees");
            }
            if (input.Policy is { } policyInput)
            {
                _ = Text(policyInput.Title, 150); _ = Text(policyInput.Content, 12000);
                if (policyInput.EffectiveFrom == default) throw new PropertyException(400, "effective_date_required");
            }

            // All inner services participate in the existing scoped Compact24 transaction.
            // Temporarily active within this uncommitted transaction to reuse existing policy/asset validation.
            var location = await properties.SaveLocationAsync(null, new(info.Name, info.Address, true, Reason: "Owner location setup"), t);
            var created = new List<Guid> { location.Id };
            created.Add((await SaveMetadata(location.Id, metadata, actor, t)).Id);
            var types = new Dictionary<Guid, SetupDocument>();
            foreach (var type in input.RoomTypes)
            {
                Guid? assetTemplateId = null;
                if (type.Assets.Length > 0)
                {
                    var template = await assets.SaveTemplateAsync(null, new(location.Id, type.Name.Trim(), type.Assets.Select(asset => new AssetTemplateItem(Guid.NewGuid(), asset.Name.Trim(), asset.Category.Trim(), asset.TrackingMode, asset.Quantity)).ToArray()), t);
                    await assets.PublishAsync(template.Id, template.Version, t); assetTemplateId = template.Id; created.Add(template.Id);
                }
                var data = new JsonObject
                {
                    ["name"] = type.Name.Trim(), ["description"] = type.Description?.Trim() ?? "", ["defaults"] = JsonSerializer.SerializeToNode(normalized[type.Key], Json),
                    ["assetTemplateId"] = assetTemplateId.HasValue ? JsonValue.Create(assetTemplateId.Value) : null
                };
                if (type.SourceId.HasValue)
                {
                    if (type.SourceKind == "SharedTemplate") { data["sourceId"] = JsonValue.Create(type.SourceId.Value); data["sourceVersion"] = type.SourceVersion; }
                    else { data["copiedFromId"] = JsonValue.Create(type.SourceId.Value); data["copiedFromVersion"] = type.SourceVersion; data["sourceLocationId"] = JsonValue.Create(input.SourceLocationId!.Value); }
                }
                var document = await local.SaveAsync(Guid.NewGuid(), location.Id, "RoomDefaults", "Recorded", data, 0, actor, t);
                types.Add(type.Key, document); created.Add(document.Id);
            }
            var rooms = new Dictionary<Guid, RoomDto>();
            foreach (var draft in input.Rooms)
            {
                var room = await CreateRoom(location.Id, types[draft.RoomTypeKey], draft.RoomNumber, draft.Floor, draft.Rent, input.RentEffectiveFrom, actor, t);
                rooms.Add(draft.Key, room); created.Add(room.Id);
            }
            foreach (var fee in input.Fees)
            {
                Guid? targetRoom = fee.RoomKey is { } roomKey ? rooms[roomKey].Id : null;
                var saved = await properties.CreatePolicyAsync(new(location.Id, targetRoom, fee.Category, fee.ChargeCode, fee.Name, fee.Method, fee.Rate,
                    fee.EffectiveFrom, fee.EffectiveTo, "Owner-confirmed location setup fee"), t);
                created.Add(saved.Id);
            }
            if (input.Policy is { } policy)
            {
                var saved = await policies.SaveAsync(null, new(location.Id, policy.Title, policy.Content, policy.EffectiveFrom), t);
                await policies.PublishAsync(saved.Id, saved.Version, t); created.Add(saved.Id);
            }
            if (!input.Activate)
            {
                foreach (var room in rooms.Values)
                    await properties.SaveRoomAsync(room.Id, new(location.Id, room.RoomNumber, room.Floor, room.Capacity, RoomStatus.Unavailable, room.Version, "Location setup preparing"), t);
                location = await properties.SaveLocationAsync(location.Id, new(location.Name, location.Address, false, location.Version, "Location setup preparing"), t);
            }
            var operation = new SharedOperation(Guid.NewGuid(), "LocationSetup", key, fingerprint, actor, clock.GetUtcNow(), input.SourceLocationId ?? location.Id,
                input.SourceLocationId, Guid.Empty, 0, 0, "LocationSetup", location.Id, "Completed", created.ToArray(), references.Distinct().ToArray(), input.SourceState);
            await shared.SaveOperationAsync(operation, t);
            return new LocationSetupResult(location, created.ToArray());
        }, t, validateActiveLocations: false);
    }
}
