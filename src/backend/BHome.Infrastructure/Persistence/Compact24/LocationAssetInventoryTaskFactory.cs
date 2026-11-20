using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.PropertyManagement;
using BHome.Application.StaffOperations;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.StaffOperations;
using BHome.Domain.TenantContracts;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Persistence.Compact24;

// Called under the Location advisory lock, in the same transaction that activates Staff responsibility.
internal static class LocationAssetInventoryTaskFactory
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static string Fingerprint(object value) =>
        Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value, Json)));
    internal static Guid TaskId(Guid assignmentId) =>
        new(SHA256.HashData(Encoding.UTF8.GetBytes($"location-asset-inventory:{assignmentId:N}")).AsSpan(0, 16));

    private static int Quantity(string? metadata)
    {
        if (string.IsNullOrWhiteSpace(metadata)) return 1;
        try
        {
            using var json = JsonDocument.Parse(metadata);
            return json.RootElement.TryGetProperty("quantity", out var value) &&
                   value.TryGetInt32(out var count) && count > 0 ? count : 1;
        }
        catch (JsonException) { return 1; }
    }

    private static bool SameUnit(string? metadata, string? expected)
    {
        if (string.IsNullOrWhiteSpace(metadata)) return string.IsNullOrWhiteSpace(expected);
        try
        {
            using var json = JsonDocument.Parse(metadata);
            var unit = json.RootElement.TryGetProperty("unit", out var value) &&
                value.ValueKind == JsonValueKind.String ? value.GetString() : null;
            return string.Equals(unit?.Trim(), expected?.Trim(), StringComparison.OrdinalIgnoreCase);
        }
        catch (JsonException) { return false; }
    }

    private static Guid ItemId(Guid assignmentId, Guid roomId, Guid requirementId) =>
        new(SHA256.HashData(Encoding.UTF8.GetBytes($"location-asset-requirement:{assignmentId:N}:{roomId:N}:{requirementId:N}")).AsSpan(0, 16));

    internal static async Task EnsureAsync(Compact24DbContext db, ISetupWorkspaceStore? workspace,
        Guid locationId, Guid assignmentId,
        Guid staffId, DateOnly effectiveFrom, Guid actor, DateTimeOffset now, CancellationToken token)
    {
        var taskId = TaskId(assignmentId);
        if (await db.Set<OperationalTask>().AsNoTracking().AnyAsync(t => t.Id == taskId, token)) return;
        var baseline = await BuildConfirmedSnapshotAsync(db, workspace, locationId, assignmentId, effectiveFrom, now, token);
        var prior = await db.Set<OperationalTask>().AsNoTracking()
            .Where(t => t.LocationId == locationId && t.Kind == OperationalTaskKind.LocationAssetHandover &&
                t.AssignmentId != assignmentId && t.Status == MeterTaskStatus.Cancelled &&
                db.Set<OperationalTaskHistory>().Any(h => h.TaskId == t.Id && h.Action == "responsibility_superseded"))
            .OrderByDescending(t => t.AssignedAt).ThenByDescending(t => t.Id).FirstOrDefaultAsync(token);
        var carried = 0;
        if (prior is not null && !string.IsNullOrWhiteSpace(prior.LocationAssetInventoryJson))
        {
            LocationAssetInventorySnapshot? older;
            try { older = JsonSerializer.Deserialize<LocationAssetInventorySnapshot>(prior.LocationAssetInventoryJson, Json); }
            catch (JsonException) { older = null; }
            if (older?.Items is { } sourceItems && older.AssignmentId == prior.AssignmentId &&
                sourceItems.Select(i => i.Id).Distinct().Count() == sourceItems.Length)
            {
                // Stable physical identity, not assignment-scoped checklist item ID.
                // Ambiguous or Owner-modified rows are never copied as checked.
                var unique = sourceItems.GroupBy(i => (i.RoomId, i.AssetId))
                    .Where(g => g.Count() == 1).ToDictionary(g => g.Key, g => g.Single());
                var targetCounts = baseline.Items.GroupBy(i => (i.RoomId, i.AssetId))
                    .ToDictionary(g => g.Key, g => g.Count());
                var updated = baseline.Items.Select(item =>
                {
                    if (targetCounts[(item.RoomId, item.AssetId)] != 1 ||
                        !unique.TryGetValue((item.RoomId, item.AssetId), out var old) ||
                        old.Quantity != item.Quantity || old.Name != item.Name ||
                        old.CommonArea != item.CommonArea || old.RoomNumber != item.RoomNumber ||
                        old.Inherited != item.Inherited || old.SourceHandoverContractId != item.SourceHandoverContractId ||
                        !(item.AssetId.HasValue || item.RoomId.HasValue && item.Quantity == 0) ||
                        (!old.Checked && old.IncidentId is null && string.IsNullOrWhiteSpace(old.Note))) return item;
                    if (old.Checked && !item.Checked) carried++;
                    return item with
                    {
                        Checked = item.Checked || old.Checked,
                        Note = old.Note,
                        IncidentId = old.IncidentId,
                        // A second replacement keeps the original checker, not the
                        // intermediate successor who merely inherited the prior check.
                        PriorStaffTaskId = old.PriorStaffTaskId ?? prior.Id,
                        PriorStaffUserId = old.PriorStaffUserId ?? prior.AssignedStaffUserId
                    };
                }).ToArray();
                baseline = baseline with { Items = updated };
            }
        }
        var task = new OperationalTask
        {
            Kind = OperationalTaskKind.LocationAssetHandover,
            LocationId = locationId,
            Title = "Kiểm tra tài sản toàn cơ sở",
            Requirements = "Kiểm tra tài sản đã được Owner kiểm kê và xác nhận tại các phòng/khu vực chung. Phòng có bàn giao Tenant hợp lệ được kế thừa. Ghi tiến độ và vướng mắc trước khi trình Owner ký biên bản bàn giao.",
            AssignedStaffUserId = staffId,
            AssignmentId = assignmentId,
            AssignedAt = now,
            ReadingDate = effectiveFrom,
            Status = MeterTaskStatus.Assigned,
            Priority = OperationalTaskPriority.Normal,
            EvidenceRequired = false,
            LocationAssetInventoryJson = JsonSerializer.Serialize(baseline)
        };
        db.Entry(task).Property(t => t.Id).CurrentValue = taskId;
        db.Add(task);
        var history = new OperationalTaskHistory
        {
            TaskId = taskId,
            ActorId = actor,
            Action = "location_asset_inventory_created",
            OccurredAt = now,
            ResponsibleStaffUserId = staffId,
            TaskVersion = 1,
            ChangesJson = JsonSerializer.Serialize(new
            {
                assignmentId,
                effectiveFrom,
                total = baseline.Items.Length,
                inherited = baseline.Items.Count(item => item.Inherited),
                source = "OwnerConfirmedInventory"
            })
        };
        db.Add(history);
        if (carried > 0 && prior is not null)
            db.Add(new OperationalTaskHistory
            {
                TaskId = taskId,
                ActorId = actor,
                Action = "location_asset_inventory_progress_inherited",
                OccurredAt = now,
                ResponsibleStaffUserId = staffId,
                TaskVersion = 1,
                Note = "Tiếp nhận các hạng mục đã kiểm tra phù hợp từ phân công trước",
                ChangesJson = JsonSerializer.Serialize(new
                {
                    sourceTaskId = prior.Id,
                    sourceStaffUserId = prior.AssignedStaffUserId,
                    sourceAssignmentId = prior.AssignmentId,
                    carriedChecked = carried,
                    checkedTotal = baseline.Items.Count(item => item.Checked),
                    total = baseline.Items.Length
                })
            });
        var ownerIds = await db.Users.AsNoTracking().Where(u => u.IsActive &&
            EF.Property<string[]>(u, "roles").Contains("Owner")).Select(u => u.Id).ToArrayAsync(token);
        foreach (var recipient in ownerIds.Append(staffId).Distinct())
            db.Add(new OperationalTaskNotification
            {
                TaskId = taskId,
                RecipientUserId = recipient,
                EventId = history.Id,
                Event = "location_asset_inventory_created"
            });
        await db.SaveChangesAsync(token);
    }

    // Single source for initial task creation AND explicit Owner reconciliation.
    // Merely configured items and unverified physical Assets are never entrusted to Staff.
    internal static async Task<LocationAssetInventorySnapshot> BuildConfirmedSnapshotAsync(
        Compact24DbContext db, ISetupWorkspaceStore? workspace, Guid locationId, Guid assignmentId,
        DateOnly effectiveFrom, DateTimeOffset now, CancellationToken token)
    {
        if (workspace is null) throw new InvalidOperationException("Owner inventory workspace is not available.");
        var rooms = await db.Set<Room>().AsNoTracking().Where(r => r.LocationId == locationId)
            .OrderBy(r => r.RoomNumber).ThenBy(r => r.Id)
            .Select(r => new { r.Id, r.RoomNumber, r.Status }).ToArrayAsync(token);
        var assets = await db.Set<Asset>().AsNoTracking().Where(a => a.LocationId == locationId && a.Status != AssetStatus.Retired)
            .Select(a => new
            {
                a.Id,
                a.RoomId,
                a.CommonArea,
                a.Name,
                a.Category,
                a.Status,
                PurchaseInfo = EF.Property<string>(a, "PurchaseInfo")
            }).ToArrayAsync(token);
        // Query Owner's durable inventory verification documents once per Location.
        var setup = await workspace.ReviewDocumentsAsync(locationId,
            assets.Select(asset => asset.Id).ToArray(), token);
        var desired = setup.Where(document => document.Kind == "DesiredAssets")
            .Select(document => (Document: document, Config: document.Data.Deserialize<DesiredAssets>(Json)))
            .Where(row => row.Config is not null)
            .GroupBy(row => row.Config!.RoomId)
            .ToDictionary(group => group.Key,
                group => group.OrderByDescending(row => row.Document.RecordedAt).ThenByDescending(row => row.Document.Version)
                    .First().Config!);
        var ownerMappings = setup.Where(document => document.Kind == "AssetVerification" && document.Status == "Verified" &&
                document.Data.TryGetProperty("source", out var source) && source.GetString() == "OwnerAttestation" &&
                document.Data.TryGetProperty("roomId", out _) && document.Data.TryGetProperty("templateId", out _) &&
                document.Data.TryGetProperty("itemId", out _) && document.Data.TryGetProperty("assetId", out _) &&
                document.Data.TryGetProperty("quantity", out _))
            .Select(document => (RoomId: document.Data.GetProperty("roomId").GetGuid(),
                TemplateId: document.Data.GetProperty("templateId").GetGuid(),
                ItemId: document.Data.GetProperty("itemId").GetGuid(),
                AssetId: document.Data.GetProperty("assetId").GetGuid(),
                Quantity: document.Data.GetProperty("quantity").GetInt32()))
            .ToArray();
        var reviews = setup.Where(document => document.Kind == "RoomInventoryChecklistReview" &&
                document.Status is "Matched" or "PartiallyChecked" &&
                document.Data.TryGetProperty("roomId", out _) &&
                document.Data.TryGetProperty("items", out var entries) && entries.ValueKind == JsonValueKind.Array)
            .GroupBy(document => document.Data.GetProperty("roomId").GetGuid())
            .ToDictionary(group => group.Key,
                group => group.OrderByDescending(document => document.RecordedAt)
                    .ThenByDescending(document => document.Version).First());
        var commonConfiguration = (await workspace.ListAsync(locationId, "CommonAssetRequirements", token))
            .OrderByDescending(document => document.Version).FirstOrDefault();
        var commonExpected = commonConfiguration?.Data.Deserialize<CommonAssetRequirementsWrite>(Json)?.Items ?? [];
        var commonVerified = (await workspace.ListAsync(locationId, "CommonAssetInventoryVerification", token))
            .Where(document => document.Status == "Verified").ToArray();
        // Restrict inherited evidence to the ACTIVE Tenant's contract chain. A previous unrelated
        // occupant's signed handover must never automatically confirm the new Staff's checklist.
        var contracts = await db.Set<Contract>().AsNoTracking().Where(c => c.Room.LocationId == locationId &&
                (c.Kind == ContractKind.Main || c.Kind == ContractKind.Renewal))
            .Select(c => new
            {
                c.Id,
                c.RoomId,
                c.Status,
                c.TenantUserId,
                c.PreviousContractId,
                c.StartDate,
                c.EndDate
            })
            .ToArrayAsync(token);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now,
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).DateTime);
        var occupied = rooms.Where(room => room.Status == RoomStatus.Occupied)
            .Select(room => room.Id).ToHashSet();
        var accountIds = contracts.Where(c => c.Status == ContractStatus.Active &&
                c.StartDate <= today && today <= c.EndDate && occupied.Contains(c.RoomId) &&
                c.TenantUserId.HasValue)
            .Select(c => c.TenantUserId!.Value).Distinct().ToArray();
        var activeAccounts = (await db.Users.AsNoTracking().Where(u => accountIds.Contains(u.Id) && u.IsActive &&
                EF.Property<string[]>(u, "roles").Contains(Roles.Tenant))
            .Select(u => u.Id).ToArrayAsync(token)).ToHashSet();
        var contractIds = contracts.Select(c => c.Id).ToArray();
        var handovers = (await db.Set<ContractHandover>().AsNoTracking()
            .Where(h => contractIds.Contains(h.ContractId) &&
                        h.Status == ContractHandoverStatus.Confirmed && h.TenantConfirmedAt != null &&
                        h.StaffConfirmedAt != null && h.TenantConfirmedBy != null && h.StaffConfirmedBy != null &&
                        h.TenantConfirmedVersion == h.Version)
            .ToArrayAsync(token)).ToDictionary(h => h.ContractId);
        var contractIndex = contracts.ToDictionary(c => c.Id);
        var inherited = new Dictionary<Guid, (Guid ContractId, HandoverSnapshot Snapshot)>();
        foreach (var group in contracts.Where(c => c.Status == ContractStatus.Active &&
                     c.StartDate <= today && today <= c.EndDate && occupied.Contains(c.RoomId) &&
                     c.TenantUserId is { } id && activeAccounts.Contains(id))
                     .GroupBy(c => c.RoomId).Where(group => group.Count() == 1))
        {
            var cursor = group.Single();
            var visited = new HashSet<Guid>();
            while (visited.Add(cursor.Id))
            {
                if (handovers.TryGetValue(cursor.Id, out var confirmed) &&
                    confirmed.TenantConfirmedBy == cursor.TenantUserId)
                {
                    try
                    {
                        var baseline = JsonSerializer.Deserialize<HandoverSnapshot>(confirmed.Snapshot);
                        if (baseline?.Assets is not null && baseline.Assets.All(a => a.Checked))
                            inherited[group.Key] = (confirmed.ContractId, baseline);
                    }
                    catch (JsonException) { /* Invalid evidence cannot be inherited. */ }
                    break;
                }
                if (cursor.PreviousContractId is not { } previous || !contractIndex.TryGetValue(previous, out var predecessor) ||
                    predecessor.RoomId != cursor.RoomId || predecessor.TenantUserId != cursor.TenantUserId) break;
                cursor = predecessor;
            }
        }

        var items = new List<LocationAssetInventoryItem>();
        var pendingOwnerRooms = new List<string>();
        foreach (var room in rooms)
        {
            var roomAssets = assets.Where(a => a.RoomId == room.Id).OrderBy(a => a.Name).ThenBy(a => a.Id).ToArray();
            var hasBaseline = inherited.TryGetValue(room.Id, out var source);
            var configuration = desired.GetValueOrDefault(room.Id);
            var configured = configuration?.Items ?? [];
            var review = reviews.GetValueOrDefault(room.Id);
            var latestDesired = setup.Where(d => d.Kind == "DesiredAssets" &&
                    d.Data.TryGetProperty("roomId", out var rid) && rid.GetGuid() == room.Id)
                .OrderByDescending(d => d.RecordedAt).ThenByDescending(d => d.Version).FirstOrDefault();
            var checkedIds = review is null || configuration is null || latestDesired is null ||
                !review.Data.TryGetProperty("desiredId", out var desiredId) ||
                !review.Data.TryGetProperty("desiredVersion", out var desiredVersion) ||
                desiredId.GetGuid() != latestDesired.Id || desiredVersion.GetInt32() != latestDesired.Version
                ? new HashSet<Guid>()
                : review.Data.GetProperty("items").EnumerateArray()
                    .Where(entry => entry.TryGetProperty("checked", out var yes) && yes.ValueKind == JsonValueKind.True)
                    .Select(entry => entry.GetProperty("itemId").GetGuid()).ToHashSet();
            foreach (var requirement in configured)
            {
                if (!checkedIds.Contains(requirement.Id)) continue;
                var ownerLinks = ownerMappings.Where(m => m.RoomId == room.Id &&
                    m.TemplateId == configuration!.TemplateId && m.ItemId == requirement.Id &&
                    m.Quantity == requirement.Quantity).ToArray();
                if (ownerLinks.Length != 1) continue;
                var matched = roomAssets.SingleOrDefault(asset => asset.Id == ownerLinks[0].AssetId &&
                    asset.Status == AssetStatus.Active && Quantity(asset.PurchaseInfo) == requirement.Quantity &&
                    SameUnit(asset.PurchaseInfo, requirement.Unit) &&
                    string.Equals(asset.Name, requirement.Name, StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(asset.Category, requirement.Category, StringComparison.OrdinalIgnoreCase));
                if (matched is null) continue;
                var checkedByTenant = hasBaseline && source.Snapshot.Assets.Any(group => group.Checked &&
                    (group.Id == requirement.Id || group.ConfigurationItemId == requirement.Id ||
                     matched is not null && (group.Id == matched.Id || group.PhysicalAssets?.Any(p => p.Id == matched.Id) == true)) &&
                    (group.HandedOverQuantity ?? group.ConfiguredQuantity ?? requirement.Quantity) >= requirement.Quantity);
                items.Add(new(ItemId(assignmentId, room.Id, requirement.Id), room.Id, room.RoomNumber,
                    matched.Id, requirement.Name, requirement.Quantity, null,
                    checkedByTenant, checkedByTenant, checkedByTenant ? source.ContractId : null));
            }
            if (roomAssets.Length == 0 && configured.Length == 0)
            {
                var confirmation = setup.Where(d => d.Kind == "RoomNoAssets" && d.Status == "Confirmed" &&
                    d.Data.TryGetProperty("roomId", out var id) && id.GetGuid() == room.Id)
                    .OrderByDescending(d => d.RecordedAt).ThenByDescending(d => d.Version).FirstOrDefault();
                var assignment = setup.FirstOrDefault(d => d.Kind == "AssetTemplateAssignment" &&
                    d.Id == new Guid(SHA256.HashData(Encoding.UTF8.GetBytes($"asset-template-assignment:{room.Id}")).AsSpan(0, 16)));
                var currentDesired = setup.Where(d => d.Kind == "DesiredAssets" &&
                    d.Data.TryGetProperty("roomId", out var id) && id.GetGuid() == room.Id)
                    .OrderByDescending(d => d.RecordedAt).ThenByDescending(d => d.Version).FirstOrDefault();
                var expected = Fingerprint(new
                {
                    Id = room.Id,
                    assignment = assignment is null ? null : new { assignment.Id, assignment.Version },
                    desired = currentDesired is null ? null : new { currentDesired.Id, currentDesired.Version }
                });
                if (confirmation is not null && confirmation.Data.TryGetProperty("baseline", out var baselineHash) &&
                    baselineHash.GetString() == expected)
                {
                    var acknowledgedEmpty = hasBaseline && source.Snapshot.NoAssetsConfirmed;
                    items.Add(new(room.Id, room.Id, room.RoomNumber, null,
                        "Phòng đã được Owner xác nhận không có tài sản", 0, null,
                        acknowledgedEmpty, acknowledgedEmpty,
                        acknowledgedEmpty ? source.ContractId : null));
                }
            }
            var ownerVerifiedCount = items.Count(item => item.RoomId == room.Id && item.AssetId.HasValue);
            var emptyConfirmed = items.Any(item => item.RoomId == room.Id && item.AssetId is null && item.Quantity == 0);
            if (!emptyConfirmed && !(configured.Length > 0 && ownerVerifiedCount == configured.Length &&
                  roomAssets.Length == ownerVerifiedCount))
                pendingOwnerRooms.Add(room.RoomNumber);
        }
        var common = assets.Where(a => a.RoomId is null).OrderBy(a => a.CommonArea)
            .ThenBy(a => a.Name).ThenBy(a => a.Id).ToArray();
        var confirmedCommonCount = 0;
        foreach (var item in commonExpected)
        {
            var verified = commonVerified.Where(document => document.Data.TryGetProperty("itemId", out var id) &&
                id.GetGuid() == item.Id && document.Data.TryGetProperty("fingerprint", out var hash) &&
                hash.GetString() == Fingerprint(new { item.Id, item.Name, item.Category, item.CommonArea, item.Quantity, item.Unit }) &&
                document.Data.TryGetProperty("assetId", out var assetId) && assetId.ValueKind == JsonValueKind.String).ToArray();
            if (verified.Length != 1) continue;
            var matches = common.Where(asset => asset.Id == verified[0].Data.GetProperty("assetId").GetGuid() &&
                asset.Status == AssetStatus.Active && string.Equals(asset.Name, item.Name, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(asset.Category, item.Category, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(asset.CommonArea, item.CommonArea, StringComparison.OrdinalIgnoreCase)).ToArray();
            var matched = matches.Length == 1 && Quantity(matches[0].PurchaseInfo) == item.Quantity &&
                SameUnit(matches[0].PurchaseInfo, item.Unit) ? matches[0] : null;
            if (matched is null) continue;
            confirmedCommonCount++;
            items.Add(new(ItemId(assignmentId, locationId, item.Id), null, null, matched?.Id,
                item.Name, item.Quantity, item.CommonArea));
        }
        return new LocationAssetInventorySnapshot(assignmentId, effectiveFrom, items.ToArray())
        {
            PendingOwnerRooms = pendingOwnerRooms.ToArray(),
            PendingOwnerCommonAssets = confirmedCommonCount != commonExpected.Length ||
                common.Length != confirmedCommonCount
        };
    }
}
