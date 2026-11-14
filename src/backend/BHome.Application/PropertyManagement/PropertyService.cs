using System.ComponentModel.DataAnnotations;
using System.Linq.Expressions;
using System.Reflection;
using System.Text.Json;
using BHome.Application.IdentityAccess;
using BHome.Application.Contracts;
using BHome.Domain.Common;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;

namespace BHome.Application.PropertyManagement;

public sealed class PropertyService(IPropertyRepository repository, ICurrentUser user,
    PermissionAccess access, TimeProvider clock, IRoomInsightsRepository? insights = null,
    IAdministrativeContractReadiness? contractReadiness = null, IPropertyLifecycleChecks? lifecycle = null)
{
    private DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
        clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
    private Guid Actor => user.UserId ?? throw Error(403, "permission_denied");
    private static PropertyException Error(int status, string code) => new(status, code);
    private void Require(string permission)
    {
        if (!access.HasPermission(permission)) throw Error(403, "permission_denied");
    }
    private async Task<Location> LocationAsync(Guid id, bool write, CancellationToken t)
    {
        Require(write ? Permissions.Property.Manage : Permissions.Property.View);
        var location = await repository.FindAsync<Location>(id, t) ?? throw Error(404, "resource_not_found");
        if (!await access.CanAccessAsync(write ? Permissions.Property.Manage : Permissions.Property.View,
                new(location.Id, null), t)) throw Error(404, "resource_not_found");
        return location;
    }
    private static void Validate(object input)
    {
        if (!Validator.TryValidateObject(input, new ValidationContext(input), [], true))
            throw Error(400, "invalid_input");
        // Positional records put MVC validation attributes on constructor parameters.
        // Enforce those same bounds when another application workflow calls this service directly.
        var type = input.GetType();
        foreach (var parameter in type.GetConstructors().OrderByDescending(x => x.GetParameters().Length)
                     .FirstOrDefault()?.GetParameters() ?? [])
        {
            var property = type.GetProperty(parameter.Name!, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
            if (property is not null && parameter.GetCustomAttributes<ValidationAttribute>()
                    .Any(attribute => !attribute.IsValid(property.GetValue(input))))
                throw Error(400, "invalid_input");
        }
    }
    private static string Text(string? value) => value?.Trim() ?? "";
    private static string? Optional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static void CheckVersion(int actual, int expected)
    {
        if (expected < 1) throw Error(400, "version_required");
        if (actual != expected) throw Error(409, "stale_version");
    }
    private void Audit(Guid? location, AuditableEntity entity, string action, string reason, string? before)
        => repository.Audit(new PropertyChange
        {
            ActorId = Actor,
            LocationId = location,
            TargetId = entity.Id,
            TargetType = entity.GetType().Name,
            Action = action,
            Reason = Text(reason),
            Before = before,
            After = Snapshot(entity),
            OccurredAt = clock.GetUtcNow()
        });
    // Explicit DTOs avoid navigation cycles and accidental capture of unrelated personal data.
    private static string Snapshot(AuditableEntity e) => JsonSerializer.Serialize(e switch
    {
        Location x => (object)Map(x),
        RoomType x => Map(x),
        Room x => Map(x),
        Asset x => Map(x),
        BillingPolicy x => Map(x),
        _ => throw new InvalidOperationException()
    });
    private void ValidateQuery(PropertyQuery q)
    {
        Require(Permissions.Property.View);
        Validate(q);
        if (q.RoomStatus is { } rs && !Enum.IsDefined(rs) || q.AssetStatus is { } a && !Enum.IsDefined(a) ||
            q.ChargeCategory is { } c && !Enum.IsDefined(c) || q.LocationId == Guid.Empty ||
            q.RoomId == Guid.Empty || q.EffectiveOn == default(DateOnly) ||
            (long)(q.Page - 1) * q.PageSize > int.MaxValue)
            throw Error(400, "invalid_filter");
    }
    private Task<PagedResult<TDto>> List<T, TDto>(Expression<Func<T, bool>> predicate,
        Expression<Func<T, TDto>> projection, PropertyQuery q, CancellationToken t) where T : AuditableEntity
    {
        ValidateQuery(q);
        return repository.ListAsync(predicate, projection, q, user.IsInRole(Roles.Owner) ? null : Actor, Today, t);
    }

    public Task<PagedResult<LocationDto>> LocationsAsync(LocationQuery q, CancellationToken t) =>
        List<Location, LocationDto>(x => (!q.IsActive.HasValue || x.IsActive == q.IsActive) &&
            (q.Search == null || x.Name.Contains(q.Search) || x.Address.Contains(q.Search)),
            x => new(x.Id, x.Name, x.Address, x.IsActive, x.Version),
            new PropertyQuery { Page = q.Page, PageSize = q.PageSize, Search = q.Search, IsActive = q.IsActive }, t);
    public Task<PagedResult<RoomDto>> RoomsAsync(PropertyQuery q, CancellationToken t) =>
        List<Room, RoomDto>(x => (!q.LocationId.HasValue || x.LocationId == q.LocationId) &&
            (!q.RoomId.HasValue || x.Id == q.RoomId) &&
            (!q.RoomStatus.HasValue || x.Status == q.RoomStatus) && (q.Search == null || x.RoomNumber.Contains(q.Search)),
            x => new(x.Id, x.LocationId, x.RoomNumber, x.Floor, x.Capacity, x.Status, x.Version, x.RoomTypeId), q, t);
    public Task<PagedResult<RoomTypeDto>> RoomTypesAsync(PropertyQuery q, CancellationToken t) =>
        List<RoomType, RoomTypeDto>(x => (!q.LocationId.HasValue || x.LocationId == q.LocationId) &&
            (!q.IsActive.HasValue || x.IsActive == q.IsActive) &&
            (q.Search == null || x.Name.Contains(q.Search)),
            x => new(x.Id, x.LocationId, x.Name, x.Description, x.DefaultCapacity, x.AreaM2,
                x.Amenities, x.IsActive, x.Version), q, t);
    public Task<PagedResult<AssetDto>> AssetsAsync(PropertyQuery q, CancellationToken t) =>
        List<Asset, AssetDto>(x => (!q.LocationId.HasValue || x.LocationId == q.LocationId) &&
            (!q.RoomId.HasValue || x.RoomId == q.RoomId) && (!q.AssetStatus.HasValue || x.Status == q.AssetStatus) &&
            (q.Search == null || x.Name.Contains(q.Search) || x.Code != null && x.Code.Contains(q.Search)),
            x => new(x.Id, x.LocationId, x.RoomId, x.CommonArea, x.Code, x.Name, x.Category, x.Condition, x.Status, x.Version), q, t);
    public Task<PagedResult<PolicyDto>> PoliciesAsync(PropertyQuery q, CancellationToken t) =>
        List<BillingPolicy, PolicyDto>(x => (!q.LocationId.HasValue || x.LocationId == q.LocationId) &&
            (!q.RoomId.HasValue || x.RoomId == q.RoomId) &&
            (!q.ChargeCategory.HasValue || x.Category == q.ChargeCategory) &&
            (!q.EffectiveOn.HasValue || x.EffectiveFrom <= q.EffectiveOn && (x.EffectiveTo == null || x.EffectiveTo >= q.EffectiveOn)) &&
            (q.Search == null || x.ChargeCode.Contains(q.Search) || x.Name.Contains(q.Search)),
            x => new(x.Id, x.LocationId, x.RoomId, x.Category, x.ChargeCode, x.Name, x.Method,
                x.Rate, x.EffectiveFrom, x.EffectiveTo, x.Version, x.FirstUsedAt, x.RoomTypeId), q, t);

    public async Task<LocationDto> GetLocationAsync(Guid id, CancellationToken t) => Map(await LocationAsync(id, false, t));
    public async Task<RoomDto> GetRoomAsync(Guid id, CancellationToken t)
    {
        Require(Permissions.Property.View);
        var x = await repository.FindAsync<Room>(id, t) ?? throw Error(404, "resource_not_found");
        await LocationAsync(x.LocationId, false, t); return Map(x);
    }
    public async Task<RoomTypeDto> GetRoomTypeAsync(Guid id, CancellationToken t)
    {
        Require(Permissions.Property.View);
        var x = await repository.FindAsync<RoomType>(id, t) ?? throw Error(404, "resource_not_found");
        await LocationAsync(x.LocationId, false, t); return Map(x);
    }
    public async Task<AssetDto> GetAssetAsync(Guid id, CancellationToken t)
    {
        Require(Permissions.Property.View);
        var x = await repository.FindAsync<Asset>(id, t) ?? throw Error(404, "resource_not_found");
        await LocationAsync(x.LocationId, false, t); return Map(x);
    }
    public async Task<PolicyDto> GetPolicyAsync(Guid id, CancellationToken t)
    {
        Require(Permissions.Property.View);
        var x = await repository.FindAsync<BillingPolicy>(id, t) ?? throw Error(404, "resource_not_found");
        await LocationAsync(x.LocationId, false, t); return Map(x);
    }

    public async Task<LocationDto> SaveLocationAsync(Guid? id, LocationWrite input, CancellationToken t)
    {
        Require(Permissions.Property.Manage); Validate(input);
        if (Text(input.Name).Length < 2 || Text(input.Address).Length == 0)
            throw Error(400, "invalid_location");
        var key = id ?? Guid.NewGuid();
        return await repository.WithLocationLockAsync(key, async () =>
        {
            var x = id.HasValue ? await LocationAsync(id.Value, true, t) : new Location(Text(input.Name));
            if (!id.HasValue) x.ChainId = await repository.LegacySystemChainIdAsync(t);
            var before = id.HasValue ? Snapshot(x) : null;
            if (id.HasValue)
            {
                CheckVersion(x.Version, input.Version);
                if (x.IsActive && !input.IsActive && lifecycle is not null && !(await lifecycle.ClosureAsync(x.Id, t)).CanClose)
                    throw Error(409, "location_closure_blocked");
                if (x.IsActive && !input.IsActive && (await repository.AnyAsync<Room>(r => r.LocationId == x.Id && r.Status != RoomStatus.Unavailable, t) ||
                    (await repository.ObligationsAsync(x.Id, null, Today, t)).PreventsConfigurationChange))
                    throw Error(409, "location_has_operational_rooms");
                x.Version++;
            }
            x.Name = Text(input.Name); x.Address = Text(input.Address); x.IsActive = input.IsActive;
            if (!id.HasValue) repository.Add(x);
            Audit(x.Id, x, id.HasValue ? "Updated" : "Created", input.Reason, before); return Map(x);
        }, t);
    }

    public async Task<RoomDto> SaveRoomAsync(Guid? id, RoomWrite input, CancellationToken t)
    {
        Require(Permissions.Property.Manage); Validate(input);
        if (Text(input.RoomNumber).Length == 0 || !Enum.IsDefined(input.Status)) throw Error(400, "invalid_room");
        return await repository.WithLocationLockAsync(input.LocationId, async () =>
        {
            var l = await LocationAsync(input.LocationId, true, t);
            if (Text(l.Address).Length == 0) throw Error(409, "location_requires_configuration");
            var x = id.HasValue ? await repository.FindAsync<Room>(id.Value, t) ?? throw Error(404, "resource_not_found") : new Room { LocationId = l.Id, Status = RoomStatus.Available };
            if (x.LocationId != l.Id) throw Error(409, "location_immutable");
            if (input.RoomTypeId is { } roomTypeId && !await repository.AnyAsync<RoomType>(type =>
                    type.Id == roomTypeId && type.LocationId == l.Id && type.IsActive, t))
                throw Error(400, "room_type_scope_invalid");
            var residents = await repository.HasResidentsAsync(x.Id, t);
            if (id.HasValue) CheckVersion(x.Version, input.Version);
            var obligations = await repository.ObligationsAsync(l.Id, x.Id, Today, t);
            var protectedRoom = residents || obligations.PreventsConfigurationChange;
            if ((!id.HasValue && input.Status is RoomStatus.OnHold or RoomStatus.Occupied) ||
                !PropertyRules.CanChangeRoomStatus(x.Status, input.Status, RoomTransitionSource.Configuration, protectedRoom))
                throw Error(409, "room_status_controlled");
            if (input.Status != RoomStatus.Unavailable && !l.IsActive) throw Error(409, "configuration_inactive");
            if ((protectedRoom || x.Status is RoomStatus.Occupied or RoomStatus.OnHold) &&
                (x.Capacity != input.Capacity || x.RoomTypeId != input.RoomTypeId))
                throw Error(409, "room_has_obligations");
            var before = id.HasValue ? Snapshot(x) : null;
            if (id.HasValue) x.Version++;
            x.RoomNumber = Text(input.RoomNumber); x.Floor = Optional(input.Floor); x.RoomTypeId = input.RoomTypeId;
            x.Capacity = input.Capacity; x.Status = input.Status;
            if (!id.HasValue) repository.Add(x);
            Audit(l.Id, x, id.HasValue ? "Updated" : "Created", input.Reason, before); return Map(x);
        }, t);
    }

    public async Task<RoomTypeDto> SaveRoomTypeAsync(Guid? id, RoomTypeWrite input, CancellationToken t)
    {
        Require(Permissions.Property.Manage); Validate(input);
        if (Text(input.Name).Length < 2 || input.Amenities is null || input.Amenities.Any(string.IsNullOrWhiteSpace))
            throw Error(400, "invalid_room_type");
        return await repository.WithLocationLockAsync(input.LocationId, async () =>
        {
            var location = await LocationAsync(input.LocationId, true, t);
            var x = id.HasValue
                ? await repository.FindAsync<RoomType>(id.Value, t) ?? throw Error(404, "resource_not_found")
                : new RoomType { LocationId = location.Id };
            if (x.LocationId != location.Id) throw Error(409, "location_immutable");
            if (await repository.AnyAsync<RoomType>(candidate => candidate.LocationId == location.Id &&
                    candidate.Id != x.Id && candidate.Name.ToUpper() == Text(input.Name).ToUpper(), t))
                throw Error(409, "room_type_name_exists");
            var before = id.HasValue ? Snapshot(x) : null;
            if (id.HasValue)
            {
                CheckVersion(x.Version, input.Version);
                if (x.IsActive && !input.IsActive && await repository.AnyAsync<Room>(room =>
                        room.LocationId == location.Id && room.RoomTypeId == x.Id, t))
                    throw Error(409, "room_type_in_use");
                x.Version++;
            }
            x.Name = Text(input.Name); x.Description = Optional(input.Description);
            x.DefaultCapacity = input.DefaultCapacity; x.AreaM2 = input.AreaM2;
            x.Amenities = input.Amenities.Select(Text).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            x.IsActive = input.IsActive;
            if (!id.HasValue) repository.Add(x);
            Audit(location.Id, x, id.HasValue ? "Updated" : "Created", input.Reason, before);
            return Map(x);
        }, t);
    }

    public async Task<BulkRoomResult> BulkCreateRoomsAsync(BulkRoomWrite input, CancellationToken t)
    {
        Require(Permissions.Property.Manage); Validate(input);
        if (input.Rooms is null || input.Rooms.Length is < 1 or > 200) throw Error(400, "invalid_bulk_rooms");
        return await repository.WithLocationLockAsync<BulkRoomResult>(input.LocationId, async () =>
        {
            var location = await LocationAsync(input.LocationId, true, t);
            if (!location.IsActive) throw Error(409, "configuration_inactive");
            var normalized = input.Rooms.Select(x => PropertyRules.Normalize(x.RoomNumber)).ToArray();
            if (normalized.Any(string.IsNullOrWhiteSpace) || normalized.Distinct().Count() != normalized.Length)
                throw Error(409, "duplicate_room_number");
            foreach (var item in input.Rooms)
            {
                Validate(item);
                if (!await repository.AnyAsync<RoomType>(type => type.Id == item.RoomTypeId &&
                        type.LocationId == location.Id && type.IsActive, t))
                    throw Error(400, "room_type_scope_invalid");
                if (await repository.AnyAsync<Room>(room => room.LocationId == location.Id &&
                        room.RoomNumber.ToUpper() == Text(item.RoomNumber).ToUpper(), t))
                    throw Error(409, "duplicate_room_number");
            }
            var created = new List<RoomDto>(input.Rooms.Length);
            foreach (var item in input.Rooms)
            {
                var type = await repository.FindAsync<RoomType>(item.RoomTypeId, t) ?? throw Error(400, "room_type_scope_invalid");
                var room = new Room
                {
                    LocationId = location.Id,
                    RoomTypeId = type.Id,
                    RoomNumber = Text(item.RoomNumber),
                    Floor = Optional(item.Floor),
                    Capacity = item.Capacity ?? type.DefaultCapacity,
                    Status = RoomStatus.Available
                };
                repository.Add(room); Audit(location.Id, room, "Created", input.Reason, null); created.Add(Map(room));
            }
            return new BulkRoomResult(created);
        }, t);
    }

    public async Task<AssetDto> SaveAssetAsync(Guid? id, AssetWrite input, CancellationToken t)
    {
        Require(Permissions.Property.Manage); Validate(input);
        if (Text(input.Name).Length == 0 || Text(input.Category).Length == 0 || Text(input.Condition).Length == 0 ||
            !Enum.IsDefined(input.Status) || input.RoomId.HasValue == !string.IsNullOrWhiteSpace(input.CommonArea))
            throw Error(400, "invalid_asset");
        return await repository.WithLocationLockAsync(input.LocationId, async () =>
        {
            var l = await LocationAsync(input.LocationId, true, t);
            var x = id.HasValue ? await repository.FindAsync<Asset>(id.Value, t) ?? throw Error(404, "resource_not_found") : new Asset { LocationId = l.Id };
            if (x.LocationId != l.Id) throw Error(409, "location_immutable");
            if (input.RoomId is { } roomId && !await repository.AnyAsync<Room>(r => r.Id == roomId && r.LocationId == l.Id, t))
                throw Error(400, "asset_room_scope_invalid");
            if (!l.IsActive && input.Status != AssetStatus.Retired) throw Error(409, "location_inactive");
            var before = id.HasValue ? Snapshot(x) : null;
            if (id.HasValue)
            {
                CheckVersion(x.Version, input.Version);
                if (x.RoomId != input.RoomId || x.CommonArea != Optional(input.CommonArea)) throw Error(409, "asset_transfer_deferred");
                if (x.Status == AssetStatus.UnderRepair && (x.Condition != Text(input.Condition) || x.Status != input.Status) ||
                    x.Status == AssetStatus.Retired && input.Status != AssetStatus.Retired)
                    throw Error(409, "asset_workflow_controlled");
                if ((x.Condition != Text(input.Condition) || x.Status != input.Status) &&
                    await repository.AnyAsync<BHome.Domain.IncidentMaintenance.MaintenanceWorkOrder>(w =>
                        w.AssetId == x.Id && w.Status != BHome.Domain.IncidentMaintenance.WorkOrderStatus.Verified &&
                        w.Status != BHome.Domain.IncidentMaintenance.WorkOrderStatus.Cancelled, t))
                    throw Error(409, "asset_workflow_controlled");
                x.Version++;
            }
            x.RoomId = input.RoomId; x.CommonArea = Optional(input.CommonArea); x.Code = Optional(input.Code);
            x.Name = Text(input.Name); x.Category = Text(input.Category); x.Condition = Text(input.Condition); x.Status = input.Status;
            if (!id.HasValue) repository.Add(x);
            Audit(l.Id, x, id.HasValue ? "Updated" : "Created", input.Reason, before); return Map(x);
        }, t);
    }

    public async Task<AssetDto> UpdateAssetConditionAsync(Guid id, AssetConditionUpdate input, CancellationToken t)
    {
        Require(Permissions.Assets.UpdateCondition); Validate(input);
        if (Text(input.Condition).Length == 0 || Text(input.Reason).Length == 0)
            throw Error(400, "invalid_asset_condition");
        var current = await repository.FindAsync<Asset>(id, t) ?? throw Error(404, "resource_not_found");
        if (!await access.CanAccessAsync(Permissions.Assets.UpdateCondition, new(current.LocationId, current.RoomId), t))
            throw Error(404, "resource_not_found");
        return await repository.WithLocationLockAsync(current.LocationId, async () =>
        {
            var asset = await repository.FindAsync<Asset>(id, t) ?? throw Error(404, "resource_not_found");
            CheckVersion(asset.Version, input.Version);
            if (asset.Status == AssetStatus.Retired || await repository.AnyAsync<BHome.Domain.IncidentMaintenance.MaintenanceWorkOrder>(w =>
                    w.AssetId == asset.Id && w.Status != BHome.Domain.IncidentMaintenance.WorkOrderStatus.Verified &&
                    w.Status != BHome.Domain.IncidentMaintenance.WorkOrderStatus.Cancelled, t))
                throw Error(409, "asset_workflow_controlled");
            var before = Snapshot(asset); asset.Condition = Text(input.Condition); asset.Version++;
            Audit(asset.LocationId, asset, "ConditionUpdated", input.Reason, before); return Map(asset);
        }, t);
    }

    private async Task ValidatePolicyAsync(PolicyWrite input, CancellationToken t)
    {
        Validate(input);
        if (!Enum.IsDefined(input.Category) || !Enum.IsDefined(input.Method) || Text(input.Name).Length == 0 ||
            input.EffectiveFrom < Today ||
            input.EffectiveTo < input.EffectiveFrom || decimal.Round(input.Rate, 4) != input.Rate)
            throw Error(400, "invalid_policy");
        var code = PropertyRules.Normalize(input.ChargeCode);
        if (code.Length == 0 || code.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_')) ||
            !PropertyRules.ValidCharge(input.Category, input.Method, code)) throw Error(400, "unsupported_charge");
        var location = await LocationAsync(input.LocationId, true, t);
        if (Text(location.Address).Length == 0) throw Error(409, "location_requires_configuration");
        if (!location.IsActive) throw Error(409, "location_inactive");
        if (input.RoomId.HasValue && input.RoomTypeId.HasValue) throw Error(400, "policy_scope_invalid");
        if (input.RoomId is { } room && !await repository.AnyAsync<Room>(x => x.Id == room && x.LocationId == location.Id, t))
            throw Error(400, "policy_scope_invalid");
        if (input.RoomTypeId is { } roomType && !await repository.AnyAsync<RoomType>(x =>
                x.Id == roomType && x.LocationId == location.Id && x.IsActive, t))
            throw Error(400, "policy_scope_invalid");
        await RoomPricingLock.EnsureUnlockedAsync(repository, input.RoomId, t);
    }
    private static BillingPolicy NewPolicy(PolicyWrite input) => new()
    {
        LocationId = input.LocationId,
        RoomId = input.RoomId,
        RoomTypeId = input.RoomTypeId,
        Category = input.Category,
        ChargeCode = PropertyRules.Normalize(input.ChargeCode),
        Name = Text(input.Name),
        Method = input.Method,
        Rate = input.Rate,
        EffectiveFrom = input.EffectiveFrom,
        EffectiveTo = input.EffectiveTo
    };
    public async Task<PolicyDto> CreatePolicyAsync(PolicyWrite input, CancellationToken t)
    {
        Require(Permissions.Property.Manage);
        return await repository.WithLocationLockAsync(input.LocationId, async () =>
        {
            await ValidatePolicyAsync(input, t); var x = NewPolicy(input); repository.Add(x);
            Audit(x.LocationId, x, "Created", input.Reason, null); return Map(x);
        }, t);
    }
    public async Task<PolicyDto> UpdateFuturePolicyAsync(Guid id, PolicyUpdate update, CancellationToken t)
    {
        Require(Permissions.Property.Manage); Validate(update);
        if (update.Policy is null) throw Error(400, "invalid_policy");
        var input = update.Policy;
        return await repository.WithLocationLockAsync(input.LocationId, async () =>
        {
            var x = await repository.FindAsync<BillingPolicy>(id, t) ?? throw Error(404, "resource_not_found");
            await LocationAsync(x.LocationId, true, t);
            CheckVersion(x.Version, update.ExpectedVersion);
            if (x.FirstUsedAt.HasValue || x.EffectiveFrom <= Today) throw Error(409, "policy_not_editable");
            if (x.LocationId != input.LocationId || x.RoomTypeId != input.RoomTypeId || x.RoomId != input.RoomId ||
                x.Category != input.Category || x.ChargeCode != PropertyRules.Normalize(input.ChargeCode))
                throw Error(400, "policy_scope_immutable");
            await ValidatePolicyAsync(input, t);
            if (input.EffectiveFrom <= Today) throw Error(400, "future_policy_date_required");
            var before = Snapshot(x);
            x.Name = Text(input.Name); x.Rate = input.Rate; x.Method = input.Method;
            x.EffectiveFrom = input.EffectiveFrom; x.EffectiveTo = input.EffectiveTo; x.Version++;
            Audit(x.LocationId, x, "Updated", input.Reason, before); return Map(x);
        }, t);
    }

    public async Task<PolicyDto> ReplacePolicyAsync(Guid id, PolicyReplacement replacement, CancellationToken t)
    {
        Require(Permissions.Property.Manage); Validate(replacement);
        if (replacement.Policy is null) throw Error(400, "invalid_policy");
        var input = replacement.Policy;
        return await repository.WithLocationLockAsync(input.LocationId, async () =>
        {
            await ValidatePolicyAsync(input, t);
            var old = await repository.FindAsync<BillingPolicy>(id, t) ?? throw Error(404, "resource_not_found");
            CheckVersion(old.Version, replacement.ExpectedVersion);
            if (old.LocationId != input.LocationId || old.RoomTypeId != input.RoomTypeId || old.RoomId != input.RoomId ||
                old.Category != input.Category || old.ChargeCode != PropertyRules.Normalize(input.ChargeCode))
                throw Error(400, "replacement_scope_mismatch");
            if (input.EffectiveFrom <= Today || input.EffectiveFrom <= old.EffectiveFrom || old.EffectiveTo < input.EffectiveFrom)
                throw Error(409, "replacement_date_invalid");
            var before = Snapshot(old); old.EffectiveTo = input.EffectiveFrom.AddDays(-1); old.Version++;
            Audit(old.LocationId, old, "Superseded", input.Reason, before);
            var next = NewPolicy(input); repository.Add(next); Audit(next.LocationId, next, "Created", input.Reason, null);
            return Map(next);
        }, t);
    }
    public async Task<PolicyDto> EndPolicyAsync(Guid id, PolicyEnd input, CancellationToken t)
    {
        Require(Permissions.Property.Manage); Validate(input);
        var found = await GetPolicyAsync(id, t);
        return await repository.WithLocationLockAsync(found.LocationId, async () =>
        {
            await LocationAsync(found.LocationId, true, t);
            var x = await repository.FindAsync<BillingPolicy>(id, t) ?? throw Error(404, "resource_not_found");
            CheckVersion(x.Version, input.Version);
            await RoomPricingLock.EnsureUnlockedAsync(repository, x.RoomId, t);
            if (input.EffectiveTo < Today || input.EffectiveTo < x.EffectiveFrom ||
                x.EffectiveTo.HasValue && input.EffectiveTo > x.EffectiveTo || Text(input.Reason).Length == 0)
                throw Error(400, "policy_end_invalid");
            var before = Snapshot(x); x.EffectiveTo = input.EffectiveTo; x.Version++;
            Audit(x.LocationId, x, "Ended", input.Reason, before); return Map(x);
        }, t);
    }
    public async Task<ResolvedPrices> ResolvePricesAsync(Guid roomId, DateOnly date, CancellationToken t)
    {
        if (date == default) throw Error(400, "date_required");
        var dto = await GetRoomAsync(roomId, t);
        var room = await repository.FindAsync<Room>(dto.Id, t) ?? throw Error(404, "resource_not_found");
        var candidates = await repository.ApplicablePoliciesAsync(room, date, t);
        var charges = candidates.GroupBy(x => x.ChargeCode).Select(g =>
            g.OrderByDescending(x => x.RoomId.HasValue).ThenByDescending(x => x.RoomTypeId.HasValue).First())
            .OrderBy(x => x.ChargeCode, StringComparer.Ordinal).Select(Map).ToArray();
        return new(roomId, date, charges, new[] { "RENT", "ELECTRICITY", "WATER" }.Except(charges.Select(x => x.ChargeCode)).ToArray());
    }

    public async Task<RoomReadinessDto> RoomReadinessAsync(Guid roomId, RoomReadinessPurpose purpose,
        Guid? contractId, DateOnly? effectiveOn, CancellationToken t)
    {
        if (!Enum.IsDefined(purpose) || roomId == Guid.Empty || contractId == Guid.Empty)
            throw Error(400, "invalid_readiness_request");
        var room = await repository.FindAsync<Room>(roomId, t) ?? throw Error(404, "resource_not_found");
        await LocationAsync(room.LocationId, false, t);
        if (purpose == RoomReadinessPurpose.MoveIn && !contractId.HasValue)
            throw Error(400, "contract_id_required");
        var date = effectiveOn ?? Today;
        if (date == default) throw Error(400, "effective_date_required");
        var data = await (insights ?? throw new InvalidOperationException("Room insights are unavailable."))
            .ReadinessAsync(roomId, contractId, date, t);
        List<ReadinessFinding> blockers = [], warnings = [], unverified = [];
        void Block(string code, string message) => blockers.Add(new(code, message));
        if (!data.LocationActive) Block("LOCATION_INACTIVE", "The Location is not active.");
        if (data.RoomStatus == RoomStatus.Unavailable) Block("ROOM_UNAVAILABLE", "The Room is unavailable.");
        if (!data.HasRentPolicy) Block("RENT_POLICY_MISSING", "No applicable rental policy exists for the effective date.");
        if (data.HasBlockingAsset) Block("ASSET_MAINTENANCE_REQUIRED", "A Room asset requires repair or is under repair.");

        if (purpose == RoomReadinessPurpose.Holding)
        {
            if (data.RoomStatus is RoomStatus.OnHold or RoomStatus.Occupied || data.Obligations.HasActiveContracts)
                Block("ACTIVE_TENANCY_CONFLICT", "The Room already has an active tenancy obligation.");
            if (data.Obligations.HasBindingPendingContracts)
                Block("PROTECTED_PENDING_CONTRACT", "The Room has a protected pending contract obligation.");
            if (data.Obligations.HasCurrentOccupancy)
                Block("RESIDENT_OBLIGATION", "Current occupancy prevents a new Holding commitment.");
        }
        else
        {
            var c = data.Contract!;
            if (!c.Exists) Block("CONTRACT_NOT_FOUND", "The Contract does not exist.");
            else if (!c.BelongsToRoom) Block("CONTRACT_ROOM_MISMATCH", "The Contract does not belong to this Room.");
            else
            {
                if (!c.PendingActivation) Block("CONTRACT_NOT_PENDING_ACTIVATION", "The Contract is not eligible for activation.");
                if (!c.InEffectivePeriod) Block("CONTRACT_NOT_EFFECTIVE", "The effective date is outside the Contract period.");
                if (c.VerifiedResidentCount != c.ResidentCount || !c.RepresentativeVerified)
                    Block("VERIFIED_RESIDENTS_REQUIRED", "All Contract residents and the representative must be verified.");
                if (c.HasContractConflict)
                    Block("ACTIVE_TENANCY_CONFLICT", "The Contract conflicts with another active tenancy or resident interval.");
                if (data.CurrentOccupantCount + c.ResidentCount > data.Capacity)
                    Block("ROOM_CAPACITY_EXCEEDED", "The Contract would exceed Room capacity.");
                if (!c.HasConfirmedHandover) warnings.Add(new("HANDOVER_NOT_CONFIRMED",
                    "The supported move-in handover is not confirmed."));
                if (contractReadiness is not null)
                    foreach (var code in await contractReadiness.BlockersAsync(contractId!.Value, roomId, t))
                        Block(code.ToUpperInvariant(), "The Contract activation validator reported an unmet requirement.");
                else
                    unverified.Add(new("CONTRACT_ACTIVATION_VALIDATOR_UNAVAILABLE",
                        "Full Contract activation readiness could not be evaluated."));
            }
            if (!data.HasElectricityMeter) Block("ELECTRICITY_METER_MISSING", "An active electricity meter is required.");
            else if (!data.HasElectricityBaseline) Block("ELECTRICITY_BASELINE_MISSING", "The electricity baseline has not been confirmed.");
            if (!data.HasWaterMeter) Block("WATER_METER_MISSING", "An active water meter is required.");
            else if (!data.HasWaterBaseline) Block("WATER_BASELINE_MISSING", "The water baseline has not been confirmed.");
            if (lifecycle is null) unverified.Add(new("SAFETY_INCIDENT_DATA_UNAVAILABLE",
                "Safety incident evidence is unavailable."));
        }
        if (lifecycle is not null)
            foreach (var code in await lifecycle.RoomBlockersAsync(roomId, t)) Block(code.ToUpperInvariant(), "An unresolved operational restriction prevents use of this Room.");
        var status = blockers.Count > 0 ? "Blocked" : unverified.Count > 0 ? "Indeterminate" : "Ready";
        return new(roomId, purpose.ToString(), status, status == "Ready", date, clock.GetUtcNow(),
            blockers.DistinctBy(x => x.Code).ToArray(), warnings.DistinctBy(x => x.Code).ToArray(),
            unverified.DistinctBy(x => x.Code).ToArray());
    }

    public async Task<LocationClosureCheck> ClosureCheckAsync(Guid locationId, CancellationToken t)
    {
        Require(Permissions.Property.Manage); await LocationAsync(locationId, true, t);
        return await (lifecycle ?? throw new InvalidOperationException("Lifecycle checks are unavailable.")).ClosureAsync(locationId, t);
    }
    public async Task<StaffChangePreview> StaffChangePreviewAsync(Guid locationId, CancellationToken t)
    {
        Require(Permissions.Property.Manage); await LocationAsync(locationId, true, t);
        return await (lifecycle ?? throw new InvalidOperationException("Lifecycle checks are unavailable.")).StaffChangeAsync(locationId, t);
    }

    public async Task<RoomHistoryPage> RoomHistoryAsync(Guid roomId, RoomHistoryQuery query, CancellationToken t)
    {
        Validate(query);
        if (roomId == Guid.Empty || query.From == default(DateOnly) || query.To == default(DateOnly) ||
            query.From > query.To || (long)(query.Page - 1) * query.PageSize > int.MaxValue)
            throw Error(400, "invalid_history_filter");
        var room = await repository.FindAsync<Room>(roomId, t) ?? throw Error(404, "resource_not_found");
        await LocationAsync(room.LocationId, false, t);
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");
        DateTimeOffset? Boundary(DateOnly? value) => value is null ? null :
            new DateTimeOffset(value.Value.ToDateTime(TimeOnly.MinValue), zone.GetUtcOffset(value.Value.ToDateTime(TimeOnly.MinValue))).ToUniversalTime();
        var result = await (insights ?? throw new InvalidOperationException("Room insights are unavailable."))
            .HistoryAsync(roomId, query, Boundary(query.From), Boundary(query.To?.AddDays(1)), t);
        var limitations = result.HasCompletePropertyAudit ? Array.Empty<string>() :
            new[] { "Property audit predating the current append-only capture may be incomplete." };
        return new(result.Items, query.Page, query.PageSize, result.TotalCount,
            limitations.Length == 0 ? "CompleteForPersistedSources" : "Partial", limitations);
    }

    public async Task<OccupancySummaryDto> OccupancySummaryAsync(Guid locationId, OccupancySummaryQuery query,
        CancellationToken t)
    {
        await LocationAsync(locationId, false, t);
        if (query.From.HasValue != query.To.HasValue || query.From > query.To ||
            query.From.HasValue && query.To!.Value.DayNumber - query.From.Value.DayNumber > 366)
            throw Error(400, "invalid_occupancy_period");
        var model = await (insights ?? throw new InvalidOperationException("Room insights are unavailable."))
            .OccupancyAsync(locationId, Today, query.From, query.To, t);
        HistoricalOccupancy historical;
        if (!query.From.HasValue)
            historical = new("NotRequested", null, null, null, null, null, []);
        else if (!model.CompleteAvailabilityEvidence)
            historical = new("InsufficientData", query.From, query.To, null, null, null,
                ["Complete Location/Room availability audit is not available for the requested period."]);
        else
            historical = CalculateHistorical(query.From.Value, query.To!.Value, locationId, model);
        return new(locationId, Today, model.Snapshot, historical);
    }

    public static HistoricalOccupancy CalculateHistorical(DateOnly from, DateOnly to, Guid locationId,
        OccupancyReadModel model)
    {
        var occupied = 0; var rentable = 0;
        for (var date = from; date <= to; date = date.AddDays(1))
        {
            var locationActive = model.LocationStatuses.Where(x => x.TargetId == locationId && x.EffectiveOn <= date)
                .OrderByDescending(x => x.EffectiveOn).ThenByDescending(x => x.RecordedAt)
                .Select(x => x.Status != 0).FirstOrDefault();
            if (!locationActive) continue;
            foreach (var roomId in model.RoomIds)
            {
                var state = model.RoomStatuses.Where(x => x.TargetId == roomId && x.EffectiveOn <= date)
                    .OrderByDescending(x => x.EffectiveOn).ThenByDescending(x => x.RecordedAt)
                    .Select(x => (RoomStatus?)x.Status).FirstOrDefault();
                if (state is null || state == RoomStatus.Unavailable) continue;
                rentable++;
                if (model.OccupancyIntervals.Any(x => x.RoomId == roomId && x.From <= date && x.To >= date)) occupied++;
            }
        }
        decimal? rate = rentable == 0 ? null : decimal.Round(occupied * 100m / rentable, 2);
        return new("Complete", from, to, occupied, rentable, rate, []);
    }

    public static LocationDto Map(Location x) => new(x.Id, x.Name, x.Address, x.IsActive, x.Version);
    public static RoomDto Map(Room x) => new(x.Id, x.LocationId, x.RoomNumber, x.Floor, x.Capacity, x.Status, x.Version, x.RoomTypeId);
    public static RoomTypeDto Map(RoomType x) => new(x.Id, x.LocationId, x.Name, x.Description,
        x.DefaultCapacity, x.AreaM2, x.Amenities, x.IsActive, x.Version);
    public static AssetDto Map(Asset x) => new(x.Id, x.LocationId, x.RoomId, x.CommonArea, x.Code, x.Name, x.Category, x.Condition, x.Status, x.Version);
    public static PolicyDto Map(BillingPolicy x) => new(x.Id, x.LocationId, x.RoomId, x.Category, x.ChargeCode, x.Name, x.Method, x.Rate, x.EffectiveFrom, x.EffectiveTo, x.Version, x.FirstUsedAt, x.RoomTypeId);
}
